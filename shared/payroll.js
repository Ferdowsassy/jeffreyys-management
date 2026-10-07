export const cents = (value) => Math.round(value * 100);
const euros = (value) => Math.round(value) / 100;
export function payroll(state, now = Date.now()) {
  return state.employees.map((employee) => {
    const shifts = state.shifts.filter((s) => s.employeeId === employee.id);
    const orders = state.orders.filter(
      (o) => o.employeeId === employee.id && o.status === "delivered",
    );
    const hourlyCents = shifts.reduce(
      (sum, s) =>
        sum +
        Math.round(
          (Math.max(
            0,
            (s.end ? Date.parse(s.end) : now) - Date.parse(s.start),
          ) /
            3600000) *
            cents(s.hourlyRate),
        ),
      0,
    );
    const deliveryCents = orders.reduce(
      (sum, o) => sum + cents(o.deliveryFee),
      0,
    );
    const collected = orders
      .filter((o) => o.payment === "cash")
      .reduce((sum, o) => sum + cents(o.amount), 0);
    // A physical return acknowledged by the driver is provisional until counted by chef.
    const returned = state.handoffs
      .filter((h) => h.employeeId === employee.id)
      .reduce(
        (sum, h) =>
          sum +
          (h.chefConfirmed
            ? cents(h.counted)
            : h.driverConfirmed
              ? cents(h.expected)
              : 0),
        0,
      );
    const retained = Math.max(0, collected - returned);
    return {
      employeeId: employee.id,
      hours: shifts.reduce(
        (sum, s) =>
          sum +
          Math.max(0, (s.end ? Date.parse(s.end) : now) - Date.parse(s.start)) /
            3600000,
        0,
      ),
      hourlyPay: euros(hourlyCents),
      deliveryPay: euros(deliveryCents),
      gross: euros(hourlyCents + deliveryCents),
      collectedCash: euros(collected),
      returnedCash: euros(returned),
      retainedCash: euros(retained),
      payout: euros(hourlyCents + deliveryCents - retained),
      pendingHandoffs: state.handoffs.filter(
        (h) => h.employeeId === employee.id && !h.chefConfirmed && !h.cashRetained,
      ).length,
    };
  });
}
