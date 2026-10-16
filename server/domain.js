import {driverColor, driverColors} from "../shared/return-trip.js";
import { payroll } from "../shared/payroll.js";
import { randomUUID } from "node:crypto";
import { safeEmployee, hashPin, seed } from "./store.js";
import {absenceNames} from '../shared/schedule.js';
import {monthlyPayroll} from '../shared/accounting.js';
import {berlinDate} from '../shared/daily-stats.js';
export const cents = (value) => Math.round(value * 100);
const euros = (value) => Math.round(value) / 100;
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
const requireRole = (user, ...roles) => {
  if (!roles.includes(user.role)) fail("Not authorized for this action", 403);
};
const text = (value, label, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    fail(`Invalid ${label}`);
  return value.trim();
};
const number = (value, label, min = 0, max = 100000) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(`Invalid ${label}`);
  return value;
};
const money = (value, label) => euros(cents(number(value, label)));
const orderItems = (items = []) => {
  if (!Array.isArray(items) || items.length > 100) fail("Invalid order items");
  return items.map(item => {
    if (!item || typeof item !== "object") fail("Invalid order item");
    const quantity = number(item.quantity, "item quantity", 1, 1000);
    if (!Number.isInteger(quantity)) fail("Item quantity must be an integer");
    return {name: text(item.name, "item name", 120), quantity, unitPrice: money(item.unitPrice, "item price")};
  });
};
const day = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("Invalid date");
  return value;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const timestamp = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("Invalid ISO timestamp");
  return new Date(value).toISOString();
};
const time = (value) => {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    fail("Invalid time");
  return value;
};
const lookup = (list, id) => {
  const item = list.find((x) => x.id === id);
  if (!item) fail("Record not found", 404);
  return item;
};
const rate = (history, date, key, fallback) =>
  [...history]
    .filter((x) => x.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.[key] ??
  fallback;
const owned = (record, user) => {
  if (user.role !== "chef" && record.employeeId !== user.id)
    fail("Not your record", 403);
  return record;
};
const requireOrderAccounting = order => {
  if (order.source==='winorder' && (typeof order.amount!=='number' || !Number.isFinite(order.amount) || !['cash','online'].includes(order.payment)))
    fail('Bitte bei der Bestellung Betrag und Zahlungsart ergänzen. Die Angaben kannst du unter Tour selbst speichern.',409);
};
export { payroll } from "../shared/payroll.js";
const privateTask = (t) => t.visibility === "chef" || t.text?.startsWith("Kundenreaktivierung prüfen:");
export function filterState(state, user) {
  const s = structuredClone(state);
  // Previously held imports are immediately claimable too; no release step.
  for (const order of s.orders) if (order.source==='winorder' && order.status==='review') order.status='available';
  s.employees = s.employees.map(safeEmployee);
  s.payroll = payroll(state);
  s.availableOrders = s.orders.filter(o => ['available', 'review'].includes(o.status));
  s.deliveryBoard = s.orders.filter(o=>o.source==='winorder' && (o.status==='open' || (o.status==='delivered' && o.deliveredAt && berlinDate(o.deliveredAt)===today())))
    .map(({id,orderNumber,employeeId,status,createdAt,claimedAt,deliveredAt,address,postalCode,city,amount,payment,paymentLabel,customerName,customerPhone,deliveryNotes,articleDescription,winorderDetails,reviewIssues,source})=>
      ({id,orderNumber,employeeId,status,createdAt,claimedAt,deliveredAt,address,postalCode,city,amount,payment,paymentLabel,customerName,customerPhone,deliveryNotes,articleDescription,winorderDetails,reviewIssues,source,
        driverName:state.employees.find(e=>e.id===employeeId)?.name || 'Nicht zugeordnet'}));
  s.settings.routingConfigured = !!(s.settings.geoapifyApiKey || process.env.GEOAPIFY_API_KEY);
  delete s.settings.geoapifyApiKey;
  delete s.settings.googleMapsBrowserKey;
  s.settings.receiptMapsConfigured=!!(s.settings.googleMapsServerKey || process.env.GOOGLE_MAPS_SERVER_KEY);
  delete s.settings.googleMapsServerKey;
  delete s.settings.routingApiKey;
  delete s.settings.webPushVapid;
  s.shiftRequests = (s.shiftRequests || []).filter(r => user.role === "chef" || r.employeeId === user.id);
  s.expenses = (s.expenses || []).map(({attachment,...expense})=>({...expense,hasAttachment:!!attachment}));
  s.salaryPayments = s.salaryPayments || [];
  if (user.role === "chef") return s;
  s.audit = [];
  s.expenses = [];
  s.salaryPayments = s.salaryPayments.filter(p=>p.employeeId===user.id);
  s.settings = { longShiftHours: s.settings.longShiftHours, store:s.settings.store, routingConfigured:s.settings.routingConfigured, receiptMapsConfigured:s.settings.receiptMapsConfigured };
  if (user.role === "driver") {
    s.employees = s.employees.filter((e) => e.id === user.id);
    for (const key of ["orders", "shifts", "schedule", "handoffs", "payroll"])
      s[key] = s[key].filter((x) => x.employeeId === user.id);
    s.tasks = [];
  } else {
    s.employees = s.employees.map(({ id, name, role, active, demo, hourlyRate, wageHistory, location, phone, returnTrip }) => ({
      id,
      name,
      role,
      active,
      demo,
      ...(id === user.id ? { hourlyRate, wageHistory, phone } : {}),
      ...(role === "driver" && active && s.shifts.some(shift => shift.employeeId === id && !shift.end) ? {location, returnTrip} : {}),
    }));
    s.shifts = s.shifts.map(({ id, employeeId, start, end, demo, hourlyRate }) => ({
      id,
      employeeId,
      start,
      end,
      demo,
      ...(employeeId === user.id ? {hourlyRate} : {}),
    }));
    s.orders = s.orders.map(
      ({ id, employeeId, orderNumber, status, createdAt, deliveredAt, completionSource, demo, shiftId, amount, payment, deliveryFee }) => ({
        id,
        employeeId,
        orderNumber,
        status,
        createdAt,
        deliveredAt,
        completionSource,
        demo,
        ...(employeeId === user.id ? {shiftId, amount, payment, deliveryFee} : {}),
      }),
    );
    s.tasks = s.tasks.filter((t) => !privateTask(t));
    s.handoffs = s.handoffs.filter(h => h.employeeId === user.id);
    s.zones = [];
    s.payroll = s.payroll.filter(p => p.employeeId === user.id);
  }
  return s;
}
function createHandoff(s, shift, cashConfirmed, now, cashRetained = false) {
  if (s.handoffs.some(h => h.shiftId === shift.id)) return null;
  const expected = euros(s.orders.filter(o => o.shiftId === shift.id && o.status === "delivered" && o.payment === "cash").reduce((n,o) => n+cents(o.amount),0));
  const owner = s.employees.find(e => e.id === shift.employeeId);
  if (owner.role !== "driver" && expected === 0) return null;
  const handoff = {id:randomUUID(), employeeId:shift.employeeId, shiftId:shift.id, expected, counted:null, driverConfirmed:cashConfirmed, chefConfirmed:false, cashRetained, createdAt:now, demo:false};
  s.handoffs.push(handoff);
  return handoff;
}
function validateShiftRange(s, employeeId, shiftId, start, end) {
  if (Date.parse(start) > Date.now() || (end && (Date.parse(end) <= Date.parse(start) || Date.parse(end) > Date.now())))
    fail("Beginn und Ende müssen in der Vergangenheit liegen; Ende muss nach Beginn liegen.");
  const endMs = end ? Date.parse(end) : Infinity;
  if (s.shifts.some(x => x.id !== shiftId && x.employeeId === employeeId
    && Date.parse(x.start) < endMs && (x.end ? Date.parse(x.end) : Infinity) > Date.parse(start)))
    fail("Die vorgeschlagenen Zeiten überschneiden sich mit einer anderen Schicht.", 409);
}
function applyShiftCorrection(s, shift, start, end, now) {
  if (shift.end && !end) fail("Cannot reopen a closed shift; clock in for a new shift", 409);
  validateShiftRange(s, shift.employeeId, shift.id, start, end);
  if (!shift.end && end) {
    if (s.orders.some(o => o.shiftId === shift.id && o.status === "open"))
      fail("Deliver all open orders before closing shift", 409);
    createHandoff(s, shift, false, now);
    delete lookup(s.employees, shift.employeeId).location;
    delete lookup(s.employees, shift.employeeId).returnTrip;
  }
  shift.start = start;
  shift.end = end;
}
export function action(s, user, p, { minPinLength = 4, returnTrip } = {}) {
  const validPin = (pin) => typeof pin === "string" && new RegExp(`^\\d{${minPinLength},12}$`).test(pin);
  if (!p || typeof p !== "object" || typeof p.type !== "string")
    fail("Action type required");
  const now = new Date().toISOString(),
    id = randomUUID();
  let result = null;
  const employee = () => lookup(s.employees, user.id);
  switch (p.type) {
    case "clockIn": {
      if (s.shifts.some((x) => x.employeeId === user.id && !x.end))
        fail("Already clocked in", 409);
      const e = employee();
      delete e.returnTrip;
      result = {
        id,
        employeeId: user.id,
        start: now,
        end: null,
        hourlyRate: rate(e.wageHistory, today(), "hourlyRate", e.hourlyRate),
        demo: false,
      };
      s.shifts.push(result);
      break;
    }
    case "clockOut": {
      const shift = s.shifts.find((x) => x.employeeId === user.id && !x.end);
      if (!shift) fail("No active shift", 409);
      const end = p.end === undefined ? now : timestamp(p.end);
      validateShiftRange(s,user.id,shift.id,shift.start,end);
      if (s.orders.some(o=>o.shiftId===shift.id && Date.parse(o.deliveredAt || o.createdAt)>Date.parse(end)))
        fail('Das Schichtende liegt vor einer erfassten Bestellung oder Zustellung. Bitte einen späteren Zeitpunkt wählen.',409);
      for (const order of s.orders.filter(o=>o.employeeId===user.id && o.status==='open')) requireOrderAccounting(order);
      for (const order of s.orders.filter(o => o.employeeId === user.id && o.status === "open")) {
        order.status = "delivered";
        order.deliveredAt = end;
        order.completionSource = "clockOut";
      }
      shift.end = end;
      shift.clockedOutAt = now;
      delete employee().location;
      delete employee().returnTrip;
      result = createHandoff(s, shift, false, now, true);
      break;
    }
    case 'assignOrder': {
      requireRole(user,'chef');
      result=lookup(s.orders,p.id);
      if (result.status!=='open') fail('Nur offene Bestellungen können neu zugeordnet werden.',409);
      const driver=lookup(s.employees,p.employeeId);
      const shift=s.shifts.find(x=>x.employeeId===driver.id && !x.end);
      if (!driver.active || driver.role!=='driver' || !shift) fail('Bitte einen Fahrer im Dienst wählen.',409);
      if (s.handoffs.some(h=>h.shiftId===result.shiftId)) fail('Diese Bestellung gehört bereits zu einer Bargeldabrechnung.',409);
      Object.assign(result,{employeeId:driver.id,shiftId:shift.id,assignedAt:now,assignedBy:user.id});
      break;
    }
    case 'recordSalaryPayment': {
      requireRole(user,'chef');
      const e=lookup(s.employees,p.employeeId), month=text(p.month,'Monat',7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month>today().slice(0,7)) fail('Ungültiger Abrechnungsmonat.');
      const requestId=text(p.requestId,'Zahlungs-ID',80);
      s.salaryPayments ??= [];
      const existing=s.salaryPayments.find(x=>x.requestId===requestId);
      if(existing) {
        if(existing.employeeId!==e.id || existing.month!==month || existing.amount!==p.amount || existing.method!==p.method)fail('Die Zahlungs-ID wurde bereits für eine andere Zahlung verwendet.',409);
        result=existing;break;
      }
      const amount=money(p.amount,'Auszahlungsbetrag');
      if(amount<=0 || amount>monthlyPayroll(e,s,month).balance) fail('Der Betrag muss positiv sein und darf den offenen Auszahlungsbetrag nicht übersteigen.',409);
      if(!['cash','transfer'].includes(p.method)) fail('Bitte die Zahlungsart wählen.');
      result={id,requestId,employeeId:e.id,month,amount,method:p.method,note:p.note ? text(p.note,'Notiz',500):'',createdAt:now,recordedBy:user.id,demo:false};
      s.salaryPayments.push(result);
      break;
    }
    case 'saveExpense': {
      requireRole(user,'chef');
      const existing=p.id ? lookup(s.expenses || [],p.id):null;
      if(!['food','fuel','commission','fixed','other'].includes(p.category)) fail('Ungültige Ausgabenkategorie.');
      let attachment=existing?.attachment;
      if(p.attachment!==undefined) {
        const a=p.attachment;
        if(a===null) attachment=undefined;
        else {
          if(!a || !['application/pdf','image/jpeg','image/png'].includes(a.type) || typeof a.data!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data) || Buffer.byteLength(a.data,'base64')>2*1024*1024) fail('Rechnung als PDF, JPG oder PNG mit maximal 2 MB hochladen.');
          attachment={name:text(a.name,'Dateiname',180),type:a.type,data:a.data};
        }
      }
      const date=day(p.date);
      if(date>today()) fail('Ausgaben dürfen nicht in der Zukunft liegen.');
      result={id:existing?.id || id,date,category:p.category,description:text(p.description,'Beschreibung',200),amount:money(p.amount,'Betrag'),attachment,createdAt:existing?.createdAt || now,updatedAt:now,demo:false};
      s.expenses ??= [];
      if(existing) Object.assign(existing,result);else s.expenses.push(result);
      result={...result,attachment:undefined,hasAttachment:!!attachment};
      break;
    }
    case 'archiveEmployee': {
      requireRole(user,'chef');
      const e=lookup(s.employees,p.id);
      if(e.id===user.id) fail('Du kannst deinen eigenen Zugang nicht entfernen.');
      if(s.shifts.some(x=>x.employeeId===e.id && !x.end) || s.orders.some(x=>x.employeeId===e.id && x.status==='open')) fail('Bitte zuerst die laufende Schicht und offene Lieferungen abschließen.',409);
      if(e.role==='chef' && e.active && s.employees.filter(x=>x.role==='chef' && x.active).length<=1) fail('Mindestens ein aktiver Chef muss erhalten bleiben.');
      e.active=false;e.archived=true;delete e.passkeys;delete e.pushSubscriptions;
      break;
    }
    case 'restoreEmployee':
      requireRole(user,'chef');
      Object.assign(lookup(s.employees,p.id),{active:true,archived:false});
      break;
    case 'deleteZone':
      requireRole(user,'chef');
      lookup(s.zones,p.id);
      s.zones=s.zones.filter(z=>z.id!==p.id);
      break;
    case "claimOrder": {
      requireRole(user, 'driver', 'chef');
      result = lookup(s.orders, p.id);
      if (!(result.status==='available' || (result.source==='winorder' && result.status==='review')) || result.employeeId) fail('Diese Bestellung wurde bereits übernommen oder abgeschlossen.', 409);
      const driverId = user.role === 'chef' ? text(p.employeeId, 'Fahrer') : user.id;
      const driver = lookup(s.employees, driverId);
      if (!driver.active || driver.role !== 'driver') fail('Bitte einen aktiven Fahrer wählen.', 409);
      const shift = s.shifts.find(x => x.employeeId === driverId && !x.end);
      if (!shift) fail('Bitte zuerst einstempeln, um eine Bestellung zu übernehmen.', 409);
      const zone = s.zones.find(z => z.postalCode === result.postalCode);
      Object.assign(result, {employeeId:driverId, shiftId:shift.id, status:'open', claimedAt:now,
        deliveryFee:zone ? rate(zone.feeHistory || [], today(), 'fee', zone.fee) : 0});
      break;
    }
    case "releaseOrder": {
      requireRole(user, 'driver', 'chef');
      result = owned(lookup(s.orders, p.id), user);
      if (result.source !== 'winorder' || result.status !== 'open') fail('Nur offene WinOrder-Lieferungen können zurückgegeben werden.', 409);
      Object.assign(result, {employeeId:null, shiftId:null, status:'available', deliveryFee:0});
      delete result.claimedAt;
      break;
    }
    case "reviewImportedOrder": {
      requireRole(user, 'chef', 'driver');
      result = lookup(s.orders, p.id);
      if (result.source !== 'winorder' || !['review','available','open'].includes(result.status)) fail('Diese Bestellung kann nicht mehr bearbeitet werden.', 409);
      if (user.role==='driver' && (result.status!=='open' || result.employeeId!==user.id)) fail('Nur selbst übernommene Bestellungen können ergänzt werden.',403);
      if (!['cash','online'].includes(p.payment)) fail('Bitte die Zahlungsart bestätigen.');
      const postalCode = text(p.postalCode, 'PLZ', 5);
      if (!/^\d{5}$/.test(postalCode)) fail('Bitte eine fünfstellige PLZ angeben.');
      Object.assign(result, {address:text(p.address, 'Adresse'), postalCode, city:text(p.city, 'Ort', 100),
        amount:money(p.amount, 'Betrag'), payment:p.payment, reviewIssues:[], status:result.employeeId ? 'open' : 'available', reviewedAt:now, reviewedBy:user.id});
      break;
    }
    case "addOrder": {
      requireRole(user, "driver", "chef");
      const employeeId =
        user.role === "chef" ? p.employeeId || user.id : user.id;
      const driver = lookup(s.employees, employeeId);
      if (!driver.active) fail("Employee inactive");
      const shift = s.shifts.find((x) => x.employeeId === employeeId && !x.end);
      if (!shift) fail("Clock in before adding orders", 409);
      if (!["cash", "online"].includes(p.payment)) fail("Invalid payment");
      if (p.noAddress !== undefined && typeof p.noAddress !== "boolean")
        fail("Invalid noAddress");
      const noAddress = p.noAddress === true;
      const postalCode = noAddress ? "" : text(p.postalCode, "postal code", 5);
      if (!noAddress && !/^\d{5}$/.test(postalCode))
        fail("Postal code must be five digits");
      const orderNumber = text(p.orderNumber, "order number", 60);
      if (
        s.orders.some(
          (o) =>
            o.orderNumber === orderNumber &&
            o.createdAt.slice(0, 10) === now.slice(0, 10),
        )
      )
        fail("Order number already exists today", 409);
      const zone = s.zones.find((z) => z.postalCode === postalCode);
      result = {
        id,
        employeeId,
        shiftId: shift.id,
        address: noAddress ? "" : text(p.address, "address"),
        postalCode,
        city: noAddress ? "" : text(p.city, "city", 100),
        amount: money(p.amount, "amount"),
        payment: p.payment,
        orderNumber,
        status: "open",
        createdAt: now,
        deliveredAt: null,
        deliveryFee: noAddress ? (s.settings.flatFee ?? 0) : zone
          ? rate(zone.feeHistory || [], today(), "fee", zone.fee)
          : 0,
        items: orderItems(p.items),
        noAddress,
        demo: false,
      };
      s.orders.push(result);
      break;
    }
    case "saveOrderItems": {
      requireRole(user, "driver", "chef");
      result = owned(lookup(s.orders, p.id), user);
      result.items = orderItems(p.items);
      break;
    }
    case "delivered": {
      requireRole(user, "driver", "chef");
      result = owned(lookup(s.orders, p.id), user);
      if (!['open','delivered'].includes(result.status)) fail('Bitte die Bestellung zuerst einem Fahrer zuordnen.', 409);
      if (result.status !== "delivered") {
        requireOrderAccounting(result);
        result.status = "delivered";
        result.deliveredAt = now;
      }
      break;
    }
    case "addTask":
      requireRole(user, "kitchen", "chef");
      if (p.visibility === "chef") requireRole(user, "chef");
      result = {
        id,
        text: text(p.text, "task", 500),
        visibility: p.visibility === "chef" ? "chef" : "team",
        done: false,
        createdAt: now,
        demo: false,
      };
      s.tasks.push(result);
      break;
    case "toggleTask":
      requireRole(user, "kitchen", "chef");
      result = lookup(s.tasks, p.id);
      if (privateTask(result)) requireRole(user, "chef");
      result.done = !result.done;
      break;
    case "saveEmployee": {
      requireRole(user, "chef");
      const name = text(p.name, "name", 80);
      if (!["chef", "kitchen", "driver"].includes(p.role)) fail("Invalid role");
      const hourlyRate = money(p.hourlyRate, "hourly rate"),
        effectiveDate = day(p.effectiveDate || today());
      let existing = p.id ? lookup(s.employees, p.id) : null;
      const phone = p.phone === undefined ? existing?.phone || "" : p.phone === "" ? "" : text(p.phone, "phone", 40);
      if (phone && !/^[+\d\s()./-]+$/.test(phone)) fail("Invalid phone");
      if (
        existing?.role === "chef" &&
        p.role !== "chef" &&
        s.employees.filter((e) => e.role === "chef" && e.active).length === 1
      )
        fail("Keep at least one active chef");
      if (
        p.pin !== undefined &&
        p.pin !== "" &&
        !validPin(p.pin)
      )
        fail(`PIN must be ${minPinLength}–12 digits`);
      if (!existing && !validPin(p.pin))
        fail(`New employee needs a ${minPinLength}–12 digit PIN`);
      const wageHistory = [
        ...(existing?.wageHistory || []).filter(
          (w) => w.effectiveDate !== effectiveDate,
        ),
        { effectiveDate, hourlyRate },
      ].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
      result = {
        ...existing,
        id: existing?.id || id,
        name,
        phone,
        role: p.role,
        hourlyRate: rate(
          wageHistory,
          today(),
          "hourlyRate",
          existing?.hourlyRate || hourlyRate,
        ),
        active: existing?.active ?? true,
        wageHistory,
        demo: false,
        pinHash: p.pin ? hashPin(p.pin) : existing.pinHash,
      };
      if (existing) Object.assign(existing, result);
      else s.employees.push(result);
      result = safeEmployee(result);
      break;
    }
    case "deactivateEmployee": {
      requireRole(user, "chef");
      const e = lookup(s.employees, p.id);
      if (e.id === user.id) fail("Cannot deactivate yourself");
      if (
        s.shifts.some((x) => x.employeeId === e.id && !x.end) ||
        s.orders.some((x) => x.employeeId === e.id && x.status === "open")
      )
        fail("Employee has an active shift or open orders", 409);
      e.active = false;
      break;
    }
    case "saveZone": {
      requireRole(user, "chef");
      const postalCode = text(p.postalCode, "postal code", 5);
      if (!/^\d{5}$/.test(postalCode)) fail("Postal code must be five digits");
      if (s.zones.some((z) => z.postalCode === postalCode && z.id !== p.id))
        fail("Postal code already exists", 409);
      const fee = money(p.fee, "delivery fee"),
        effectiveDate = day(p.effectiveDate || today()),
        existing = p.id ? lookup(s.zones, p.id) : null;
      const feeHistory = [
        ...(existing?.feeHistory || []).filter(
          (f) => f.effectiveDate !== effectiveDate,
        ),
        { effectiveDate, fee },
      ];
      result = {
        id: existing?.id || id,
        postalCode,
        name: text(p.name, "zone name", 100),
        fee: rate(feeHistory, today(), "fee", existing?.fee || 0),
        effectiveDate,
        feeHistory,
        demo: false,
      };
      if (existing) Object.assign(existing, result);
      else s.zones.push(result);
      break;
    }
    case "saveSchedule": {
      requireRole(user, "chef");
      const e = lookup(s.employees, p.employeeId);
      if (!e.active) fail("Inactive employee");
      const date = day(p.date), kind = p.kind ?? 'shift';
      if (kind !== 'shift' && !Object.hasOwn(absenceNames,kind)) fail('Invalid schedule type');
      const start = kind === 'shift' ? time(p.start) : null;
      const end = kind === 'shift' ? time(p.end) : null;
      if (kind === 'shift' && start === end) fail("Shift cannot have zero duration");
      const atDate = s.schedule.find(
        (x) => x.employeeId === e.id && x.date === date,
      );
      const existing = p.id ? lookup(s.schedule, p.id) : atDate;
      if (p.id && atDate && atDate.id !== existing.id) fail("Employee already scheduled on this date", 409);
      result = {
        id: existing?.id || id,
        employeeId: e.id,
        date,
        start,
        end,
        kind,
        templateName:kind === 'shift' && p.templateName ? text(p.templateName,'Vorlagenname',60) : null,
        demo: false,
      };
      if (existing) Object.assign(existing, result);
      else s.schedule.push(result);
      break;
    }
    case "saveShiftTemplates": {
      requireRole(user,'chef');
      if (!Array.isArray(p.templates) || p.templates.length < 1 || p.templates.length > 12) fail('Bitte 1–12 Schichtvorlagen angeben.');
      const ids=new Set();
      s.settings.shiftTemplates=p.templates.map(template => {
        if (!template || typeof template !== 'object') fail('Invalid shift template');
        const templateId=text(template.id,'Vorlagen-ID',80), start=time(template.start), end=time(template.end);
        if (ids.has(templateId) || start === end) fail('Vorlagen benötigen eindeutige IDs und unterschiedliche Start- und Endzeiten.');
        ids.add(templateId);
        return {id:templateId,name:text(template.name,'Vorlagenname',60),start,end};
      });
      break;
    }
    case "deleteSchedule": {
      requireRole(user, "chef");
      result = lookup(s.schedule, p.id);
      s.schedule = s.schedule.filter(entry => entry.id !== result.id);
      break;
    }
    case "copyWeek": {
      requireRole(user, "chef");
      const start = Date.parse(day(p.weekStart)) - 7 * 86400000;
      const source = s.schedule.filter(
        (x) =>
          Date.parse(x.date) >= start &&
          Date.parse(x.date) < start + 7 * 86400000,
      );
      let copied = 0;
      for (const x of source.filter(x => s.employees.some(e => e.id === x.employeeId && e.active))) {
        const date = new Date(Date.parse(x.date) + 7 * 86400000)
          .toISOString()
          .slice(0, 10);
        if (
          !s.schedule.some(
            (y) => y.employeeId === x.employeeId && y.date === date,
          )
        )
          { s.schedule.push({ ...x, id: randomUUID(), date, demo: false }); copied++; }
      }
      result = { copied };
      break;
    }
    case "saveReceiptMapsKey":
      requireRole(user, "chef");
      s.settings.googleMapsServerKey = text(p.key, "Google Places API-Schlüssel", 1000);
      break;
    case "saveRoutingKey":
      requireRole(user, "chef");
      s.settings.geoapifyApiKey = text(p.key, "Geoapify API-Schlüssel", 1000);
      break;
    case "saveStoreLocation": {
      requireRole(user, "chef");
      s.settings.store = {address:text(p.address, "Ladenadresse", 400),
        latitude:number(p.latitude,"latitude",-90,90),longitude:number(p.longitude,"longitude",-180,180)};
      break;
    }
    case "startReturnTrip": {
      requireRole(user, "driver");
      const shift = s.shifts.find(x => x.employeeId === user.id && !x.end);
      if (!returnTrip || !shift || returnTrip.shiftId !== shift.id || Date.now()-Date.parse(returnTrip.startedAt)>30000) fail("Bitte einstempeln und die Rückfahrt erneut starten.",409);
      const store = s.settings.store;
      if (!store || store.address !== returnTrip.destination.address || store.latitude !== returnTrip.destination.latitude || store.longitude !== returnTrip.destination.longitude)
        fail("Die Ladenadresse wurde geändert. Bitte Rückfahrt erneut starten.",409);
      let color = employee().returnTrip?.color || driverColor(user.id);
      const used = new Set(s.employees.filter(e => e.id !== user.id && e.returnTrip).map(e => e.returnTrip.color));
      if (used.has(color)) color = driverColors.find(candidate => !used.has(candidate)) || color;
      let hue = 0;
      while (used.has(color)) color = `hsl(${(++hue*137.508)%360}, 75%, 38%)`;
      employee().returnTrip = {...returnTrip,color};
      result = employee().returnTrip;
      break;
    }
    case "finishReturnTrip":
    case "cancelReturnTrip":
      requireRole(user, "driver");
      delete employee().returnTrip;
      break;
    case "saveSettings":
      requireRole(user, "chef");
      s.settings = {
        ...s.settings,
        foodCostPercent: number(p.foodCostPercent === undefined ? s.settings.foodCostPercent : p.foodCostPercent, "food cost percent", 0, 100),
        flatFee: money(p.flatFee === undefined ? (s.settings.flatFee ?? 0) : p.flatFee, "flat fee"),
        fixedCosts: money(p.fixedCosts === undefined ? s.settings.fixedCosts : p.fixedCosts, "fixed costs"),
        longShiftHours: number(p.longShiftHours === undefined ? s.settings.longShiftHours : p.longShiftHours, "long shift threshold", 1, 24),
        demo: false,
      };
      break;
    case "confirmHandoff": {
      requireRole(user, "chef");
      result = lookup(s.handoffs, p.id);
      if (result.chefConfirmed) fail("Handoff already confirmed", 409);
      result.counted = money(p.counted, "counted cash");
      result.chefConfirmed = true;
      result.confirmedAt = now;
      result.confirmedBy = user.id;
      break;
    }
    case "requestShiftCorrection": {
      requireRole(user, "driver", "kitchen");
      const shift = p.shiftId ? lookup(s.shifts, p.shiftId) : null;
      if (shift && shift.employeeId !== user.id) fail("Not your shift", 403);
      const start = timestamp(p.start), end = timestamp(p.end);
      validateShiftRange(s, user.id, shift?.id, start, end);
      if (shift && shift.start === start && shift.end === end) fail("Die Zeiten wurden nicht geändert.");
      s.shiftRequests ||= [];
      if (shift && s.shiftRequests.some(r => r.shiftId === shift.id && r.status === "pending"))
        fail("Für diese Schicht wartet bereits eine Anfrage auf Freigabe.", 409);
      if (!shift && s.shiftRequests.some(r => r.employeeId === user.id && !r.shiftId && r.status === "pending"
        && Date.parse(r.start) < Date.parse(end) && Date.parse(r.end) > Date.parse(start)))
        fail("Für diesen Zeitraum wartet bereits eine Anfrage auf Freigabe.", 409);
      result = {id, employeeId:user.id, shiftId:shift?.id || null, start, end,
        originalStart:shift?.start || null, originalEnd:shift?.end || null,
        reason:text(p.reason, "Begründung", 1000), status:"pending", createdAt:now, demo:false};
      s.shiftRequests.push(result);
      break;
    }
    case "reviewShiftCorrection": {
      requireRole(user, "chef");
      result = lookup(s.shiftRequests || [], p.id);
      if (result.status !== "pending") fail("Diese Anfrage wurde bereits entschieden.", 409);
      if (!["approved", "rejected"].includes(p.decision)) fail("Invalid decision");
      if (p.decision === "approved") {
        if (result.shiftId) {
          const shift = lookup(s.shifts, result.shiftId);
          if (shift.start !== result.originalStart || shift.end !== result.originalEnd)
            fail("Die Schicht wurde inzwischen geändert. Bitte ablehnen und eine neue Anfrage stellen lassen.", 409);
          applyShiftCorrection(s, shift, result.start, result.end, now);
        } else {
          validateShiftRange(s, result.employeeId, null, result.start, result.end);
          const e = lookup(s.employees, result.employeeId);
          const date = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(result.start));
          const shift = {id:randomUUID(),employeeId:e.id,start:result.start,end:result.end,
            hourlyRate:rate(e.wageHistory, date, "hourlyRate", e.hourlyRate),demo:false};
          s.shifts.push(shift);
          result.appliedShiftId = shift.id;
        }
      }
      result.status = p.decision;
      result.reviewedAt = now;
      result.reviewedBy = user.id;
      break;
    }
    case "updateShift": {
      requireRole(user, "chef");
      result = lookup(s.shifts, p.id);
      applyShiftCorrection(s, result, timestamp(p.start), p.end === null ? null : timestamp(p.end), now);
      break;
    }
    case "clearDemo": {
      requireRole(user, "chef");
      // Keep the whole cash ledger for mixed demo/real shifts; deleting only
      // demo orders would invalidate the real handoff's expected amount.
      const keep = new Set(s.shifts.filter(x => !x.demo).map(x => x.id));
      for (const x of [...s.orders, ...s.handoffs]) if (!x.demo) keep.add(x.shiftId);
      for (const x of s.shifts) if (keep.has(x.id)) x.demo = false;
      for (const x of [...s.orders, ...s.handoffs]) if (keep.has(x.shiftId)) x.demo = false;
      for (const key of [
        "orders",
        "shifts",
        "schedule",
        "tasks",
        "handoffs",
        "audit",
      ])
        s[key] = s[key].filter((x) => !x.demo);
      for (const e of s.employees) e.demo = false;
      for (const z of s.zones) z.demo = false;
      s.settings.demo = false;
      break;
    }
    case "reset":
      requireRole(user, "chef");
      if (p.confirmation !== "RESET") fail("Type RESET to confirm");
      Object.assign(s, seed());
      break;
    case "saveLocation": {
      requireRole(user, "driver", "chef");
      if (p.employeeId && p.employeeId !== user.id) fail("Not your location", 403);
      if (user.role === "driver" && !s.shifts.some(shift => shift.employeeId === user.id && !shift.end)) fail("Clock in before sharing location", 409);
      const capturedAt = p.capturedAt === undefined ? now : timestamp(p.capturedAt);
      if (Date.parse(now) - Date.parse(capturedAt) > 30000 || Date.parse(capturedAt) - Date.parse(now) > 30000) fail("GPS position is too old or in the future");
      employee().location = {
        latitude: number(p.latitude, "latitude", -90, 90),
        longitude: number(p.longitude, "longitude", -180, 180),
        updatedAt: now,
        capturedAt,
        ...(p.accuracy !== undefined ? {accuracy:number(p.accuracy, "GPS accuracy", 0, 1000000)} : {}),
      };
      break;
    }
    case "stopLocation":
      requireRole(user, "driver", "chef");
      if (p.employeeId && p.employeeId !== user.id) fail("Not your location", 403);
      delete employee().location;
      break;
    default:
      fail("Unknown action");
  }
  if (["saveLocation", "stopLocation"].includes(p.type)) return result;
  s.audit.push({
    id: randomUUID(),
    type: p.type,
    employeeId: user.id,
    targetId: result?.id || p.id || null,
    createdAt: now,
    demo: false,
  });
  if (s.audit.length > 10000) s.audit = s.audit.slice(-10000);
  return result;
}
