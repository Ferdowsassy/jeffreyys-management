import { payroll as calculatePayroll } from "../shared/payroll.js";
export const euro = (n) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    Number(n) || 0,
  );
export const day = (d) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(d));
export const hours = (s) =>
  Math.max(0, (new Date(s.end || Date.now()) - new Date(s.start)) / 3600000);
export function formatHours(value) {
  const minutes = Math.max(0, Math.round((Number(value) || 0) * 60));
  return `${Math.floor(minutes / 60)} Std. ${String(minutes % 60).padStart(2, '0')} Min.`;
}
export const sum = (xs, fn) => xs.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
export const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function payroll(e, data, month, now = Date.now()) {
  const inMonth = (d) => day(d).startsWith(month);
  const scoped = {
    employees: [e],
    shifts: data.shifts.filter((s) => inMonth(s.start)),
    orders: data.orders.filter((o) => inMonth(o.createdAt)),
    handoffs: data.handoffs.filter((h) => inMonth(h.createdAt)),
  };
  const p = calculatePayroll(scoped, now)[0];
  return { hours: p.hours, wages: p.hourlyPay, fees: p.deliveryPay,
    cash: p.collectedCash, returned: p.returnedCash, retained: p.retainedCash, payout: p.payout };
}
