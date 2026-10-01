import { payroll } from "../shared/payroll.js";
import { randomUUID } from "node:crypto";
import { safeEmployee, hashPin, seed } from "./store.js";
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
export { payroll } from "../shared/payroll.js";
const privateTask = (t) => t.visibility === "chef" || t.text?.startsWith("Kundenreaktivierung prüfen:");
export function filterState(state, user) {
  const s = structuredClone(state);
  s.employees = s.employees.map(safeEmployee);
  s.payroll = payroll(state);
  if (user.role === "chef") return s;
  s.audit = [];
  s.settings = { longShiftHours: s.settings.longShiftHours };
  if (user.role === "driver") {
    s.employees = s.employees.filter((e) => e.id === user.id);
    for (const key of ["orders", "shifts", "schedule", "handoffs", "payroll"])
      s[key] = s[key].filter((x) => x.employeeId === user.id);
    s.tasks = [];
  } else {
    s.employees = s.employees.map(({ id, name, role, active, demo, hourlyRate, wageHistory, location, phone }) => ({
      id,
      name,
      role,
      active,
      demo,
      ...(id === user.id ? { hourlyRate, wageHistory, phone } : {}),
      ...(role === "driver" && active && s.shifts.some(shift => shift.employeeId === id && !shift.end) ? {location} : {}),
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
      ({ id, employeeId, orderNumber, status, createdAt, deliveredAt, demo, shiftId, amount, payment, deliveryFee }) => ({
        id,
        employeeId,
        orderNumber,
        status,
        createdAt,
        deliveredAt,
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
function createHandoff(s, shift, cashConfirmed, now) {
  if (s.handoffs.some(h => h.shiftId === shift.id)) return null;
  const expected = euros(s.orders.filter(o => o.shiftId === shift.id && o.status === "delivered" && o.payment === "cash").reduce((n,o) => n+cents(o.amount),0));
  const owner = s.employees.find(e => e.id === shift.employeeId);
  if (owner.role !== "driver" && expected === 0) return null;
  const handoff = {id:randomUUID(), employeeId:shift.employeeId, shiftId:shift.id, expected, counted:null, driverConfirmed:cashConfirmed, chefConfirmed:false, createdAt:now, demo:false};
  s.handoffs.push(handoff);
  return handoff;
}
export function action(s, user, p, { minPinLength = 4 } = {}) {
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
      if (typeof p.cashConfirmed !== "boolean")
        fail("cashConfirmed must be boolean");
      const shift = s.shifts.find((x) => x.employeeId === user.id && !x.end);
      if (!shift) fail("No active shift", 409);
      if (s.orders.some((o) => o.employeeId === user.id && o.status === "open"))
        fail("Deliver all open orders before clocking out", 409);
      shift.end = now;
      result = createHandoff(s, shift, p.cashConfirmed, now);
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
      if (result.status !== "delivered") {
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
      const date = day(p.date),
        start = time(p.start),
        end = time(p.end);
      if (start === end) fail("Shift cannot have zero duration");
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
        demo: false,
      };
      if (existing) Object.assign(existing, result);
      else s.schedule.push(result);
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
    case "updateShift": {
      requireRole(user, "chef");
      result = lookup(s.shifts, p.id);
      if (result.end && p.end === null) fail("Cannot reopen a closed shift; clock in for a new shift", 409);
      const start = timestamp(p.start),
        end = p.end === null ? null : timestamp(p.end);
      if (
        Date.parse(start) > Date.now() ||
        (end &&
          (Date.parse(end) <= Date.parse(start) ||
            Date.parse(end) > Date.now()))
      )
        fail("Invalid shift range");
      if (
        !end &&
        s.shifts.some(
          (x) =>
            x.id !== result.id && x.employeeId === result.employeeId && !x.end,
        )
      )
        fail("Employee already clocked in", 409);
      const endMs = end ? Date.parse(end) : Infinity;
      if (
        s.shifts.some(
          (x) =>
            x.id !== result.id &&
            x.employeeId === result.employeeId &&
            Date.parse(x.start) < endMs &&
            (x.end ? Date.parse(x.end) : Infinity) > Date.parse(start),
        )
      )
        fail("Shifts overlap", 409);
      if (result.end && !end) fail("Cannot reopen a closed shift; clock in for a new shift", 409);
      if (!result.end && end) {
        if (s.orders.some(o => o.shiftId === result.id && o.status === "open"))
          fail("Deliver all open orders before closing shift", 409);
        createHandoff(s, result, false, now);
      }
      result.start = start;
      result.end = end;
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
    case "saveLocation":
      requireRole(user, "driver", "chef");
      employee().location = {
        latitude: number(p.latitude, "latitude", -90, 90),
        longitude: number(p.longitude, "longitude", -180, 180),
        updatedAt: now,
      };
      break;
    default:
      fail("Unknown action");
  }
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
