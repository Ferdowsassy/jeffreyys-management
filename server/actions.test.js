import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-helper.js";
test("driver shift lifecycle snapshots rates and deducts only retained cash", async (t) => {
  const { request, login } = await fixture(t);
  const driver = await login("leo", "3456"),
    chef = await login("alex", "1234");
  const act = (body, cookie = driver) => request("/api/action", body, cookie);
  assert.equal((await act({ type: "clockIn" })).status, 409);
  assert.equal(
    (
      await act({
        type: "addOrder",
        address: "Test 1",
        postalCode: "80802",
        city: "München",
        amount: 20.1,
        payment: "cash",
        orderNumber: "101",
      })
    ).status,
    200,
  );
  const order = (
    await request("/api/state", undefined, driver)
  ).body.orders.find((o) => o.orderNumber === "101");
  assert.equal(order.deliveryFee, 2.5);
  assert.equal((await act({type:"clockOut"})).status,200);
  const afterClockOut=(await request("/api/state",undefined,driver)).body;
  assert.equal(afterClockOut.orders.find(o=>o.id===order.id).status,"delivered");
  assert.equal(afterClockOut.orders.find(o=>o.id===order.id).completionSource,"clockOut");
  let state = (await request("/api/state", undefined, chef)).body;
  const h = state.handoffs.find((h) => h.employeeId === "leo");
  assert.equal(h.expected, 52.6);
  assert.equal(h.driverConfirmed, false);
  assert.equal(h.cashRetained, true);
  assert.equal(
    (await act({ type: "confirmHandoff", id: h.id, counted: 50 }, chef)).status,
    200,
  );
  state = (await request("/api/state", undefined, chef)).body;
  const p = state.payroll.find((p) => p.employeeId === "leo");
  assert.equal(p.collectedCash, 52.6);
  assert.equal(p.returnedCash, 50);
  assert.equal(p.retainedCash, 2.6);
  assert.equal(Math.round(p.payout * 100), Math.round(p.gross * 100) - 260);
  assert.equal(
    (await act({ type: "delivered", id: "demo-order-2" })).status,
    403,
  );
  assert.equal(
    (
      await act({
        type: "saveEmployee",
        name: "Bad",
        role: "chef",
        pin: "1234",
        hourlyRate: 20,
      })
    ).status,
    403,
  );
});
test("chef administration validates data and preserves historical snapshots", async (t) => {
  const { request, login } = await fixture(t);
  const chef = await login("alex", "1234"),
    kitchen = await login("samira", "2345");
  const act = (body) => request("/api/action", body, chef);
  assert.equal(
    (
      await act({
        type: "saveEmployee",
        name: "New",
        role: "driver",
        pin: "9999",
        hourlyRate: 18,
        effectiveDate: "2026-01-01",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await act({
        type: "saveEmployee",
        id: "leo",
        name: "Leo",
        role: "driver",
        hourlyRate: 25,
        effectiveDate: "2020-01-01",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await act({
        type: "saveZone",
        postalCode: "99999",
        name: "Test",
        fee: 4,
        effectiveDate: "2020-01-01",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await act({
        type: "saveSchedule",
        employeeId: "leo",
        date: "2026-09-21",
        start: "18:00",
        end: "23:00",
      })
    ).status,
    200,
  );
  assert.equal(
    (await act({ type: "copyWeek", weekStart: "2026-09-28" })).status,
    200,
  );
  assert.equal(
    (
      await act({
        type: "saveSettings",
        foodCostPercent: 31,
        fixedCosts: 3000,
        longShiftHours: 9,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/action",
        { type: "addTask", text: "Real task" },
        kitchen,
      )
    ).status,
    200,
  );
  let s = (await request("/api/state", undefined, chef)).body;
  assert.equal(s.shifts.find((x) => x.employeeId === "leo").hourlyRate, 13.5);
  assert.equal(s.orders[0].deliveryFee, 2.5);
  assert.ok(s.schedule.find((x) => x.date === "2026-09-28"));
  assert.equal(
    (
      await request(
        "/api/action",
        {
          type: "toggleTask",
          id: s.tasks.find((x) => x.text === "Real task").id,
        },
        kitchen,
      )
    ).status,
    200,
  );
  for (const invalid of [
    {
      type: "saveSettings",
      foodCostPercent: 101,
      fixedCosts: 1,
      longShiftHours: 8,
    },
    {
      type: "saveSchedule",
      employeeId: "leo",
      date: "2026-02-30",
      start: "99:00",
      end: "23:00",
    },
    {
      type: "saveEmployee",
      name: "X",
      role: "driver",
      pin: "12",
      hourlyRate: 1,
    },
    { type: "saveLocation", latitude: 100, longitude: 0 },
    { type: "reset", confirmation: "no" },
  ])
    assert.equal((await act(invalid)).status, 400);
  assert.equal(
    (await act({ type: "saveLocation", latitude: 48.137, longitude: 11.575 }))
      .status,
    200,
  );
  assert.equal((await act({ type: "clearDemo" })).status, 200);
  s = (await request("/api/state", undefined, chef)).body;
  assert.equal(s.orders.length, 0);
  assert.ok(s.employees.some((x) => x.id === "alex" && x.active));
  assert.ok(s.tasks.some((x) => x.text === "Real task"));
  assert.equal(
    (await act({ type: "reset", confirmation: "RESET" })).status,
    200,
  );
});
