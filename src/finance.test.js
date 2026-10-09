import { test } from "node:test";
import assert from "node:assert/strict";
test("payroll subtracts retained cash, not cash already handed back", async () => {
  const { payroll } = await import("./finance.js");
  const result = payroll(
    { id: "a" },
    {
      shifts: [
        {
          employeeId: "a",
          start: "2026-09-01T10:00:00Z",
          end: "2026-09-01T12:00:00Z",
          hourlyRate: 15,
        },
      ],
      orders: [
        {
          employeeId: "a",
          amount: 40,
          status: "delivered",
          payment: "cash",
          deliveryFee: 3,
          createdAt: "2026-09-01T11:00:00Z",
        },
      ],
      handoffs: [
        {
          employeeId: "a",
          expected: 40,
          counted: 30,
          chefConfirmed: true,
          createdAt: "2026-09-01T12:00:00Z",
        },
      ],
    },
    "2026-09",
  );
  assert.equal(result.wages, 30);
  assert.equal(result.retained, 10);
  assert.equal(result.payout, 23);
});

test('work durations display hours and minutes with carry and no decimal hours', async()=>{
  const {formatHours}=await import('./finance.js');
  assert.equal(formatHours(1.5),'1 Std. 30 Min.');
  assert.equal(formatHours(1.999),'2 Std. 00 Min.');
  assert.equal(formatHours(0),'0 Std. 00 Min.');
  assert.equal(formatHours(-2),'0 Std. 00 Min.');
  assert.equal(formatHours(25.25),'25 Std. 15 Min.');
});
