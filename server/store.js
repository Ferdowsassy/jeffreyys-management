import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 64).toString("hex")}`;
}
export function checkPin(pin, hash) {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(scryptSync(pin, salt, 64), Buffer.from(key, "hex"));
}
export const safeEmployee = ({ pinHash, ...user }) => user;
export function seed() {
  const now = new Date();
  const iso = (hours) =>
    new Date(now.getTime() + hours * 3600000).toISOString();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return {
    employees: [
      ["alex", "Alex", "chef", "1234", 22],
      ["samira", "Samira", "kitchen", "2345", 16],
      ["leo", "Leo", "driver", "3456", 13.5],
      ["mia", "Mia", "driver", "4567", 14],
    ].map(([id, name, role, pin, hourlyRate]) => ({
      id,
      name,
      role,
      pinHash: hashPin(pin),
      hourlyRate,
      active: true,
      wageHistory: [{ effectiveDate: "2020-01-01", hourlyRate }],
      demo: true,
    })),
    orders: [
      {
        id: "demo-order-1",
        employeeId: "leo",
        shiftId: "demo-shift-leo",
        address: "Demo: Leopoldstraße 12",
        postalCode: "80802",
        city: "München",
        amount: 32.5,
        payment: "cash",
        orderNumber: "DEMO-101",
        status: "delivered",
        createdAt: iso(-1.5),
        deliveredAt: iso(-1),
        deliveryFee: 2.5,
        noAddress: false,
        demo: true,
      },
      {
        id: "demo-order-2",
        employeeId: "mia",
        shiftId: "demo-shift-mia",
        address: "Demo: Sendlinger Straße 8",
        postalCode: "80331",
        city: "München",
        amount: 24.9,
        payment: "online",
        orderNumber: "DEMO-102",
        status: "open",
        createdAt: iso(-0.2),
        deliveredAt: null,
        deliveryFee: 2,
        noAddress: false,
        demo: true,
      },
      {
        id: "demo-order-3",
        employeeId: "mia",
        shiftId: "demo-shift-previous",
        address: "Demo: Tal 10",
        postalCode: "80331",
        city: "München",
        amount: 18,
        payment: "cash",
        orderNumber: "DEMO-099",
        status: "delivered",
        createdAt: iso(-23),
        deliveredAt: iso(-22.5),
        deliveryFee: 2,
        noAddress: false,
        demo: true,
      },
    ],
    shiftRequests: [],
    shifts: [
      {
        id: "demo-shift-previous",
        employeeId: "mia",
        start: iso(-25),
        end: iso(-22),
        hourlyRate: 14,
        demo: true,
      },
      {
        id: "demo-shift-leo",
        employeeId: "leo",
        start: iso(-3),
        end: null,
        hourlyRate: 13.5,
        demo: true,
      },
      {
        id: "demo-shift-mia",
        employeeId: "mia",
        start: iso(-2),
        end: null,
        hourlyRate: 14,
        demo: true,
      },
      {
        id: "demo-shift-samira",
        employeeId: "samira",
        start: iso(-4),
        end: null,
        hourlyRate: 16,
        demo: true,
      },
    ],
    schedule: [
      {
        id: "demo-schedule",
        employeeId: "leo",
        date,
        start: "17:00",
        end: "23:00",
        demo: true,
      },
    ],
    zones: [
      {
        id: "demo-zone-1",
        postalCode: "80802",
        name: "Schwabing",
        fee: 2.5,
        effectiveDate: date,
        feeHistory: [{ effectiveDate: date, fee: 2.5 }],
        demo: true,
      },
      {
        id: "demo-zone-2",
        postalCode: "80331",
        name: "Altstadt",
        fee: 2,
        effectiveDate: date,
        feeHistory: [{ effectiveDate: date, fee: 2 }],
        demo: true,
      },
    ],
    tasks: [
      {
        id: "demo-task",
        text: "DEMO: Kühltemperaturen dokumentieren",
        done: false,
        createdAt: iso(-2),
        demo: true,
      },
    ],
    handoffs: [
      {
        id: "demo-handoff",
        employeeId: "mia",
        shiftId: "demo-shift-previous",
        expected: 18,
        counted: 18,
        driverConfirmed: true,
        chefConfirmed: true,
        createdAt: iso(-22),
        confirmedAt: iso(-21.9),
        confirmedBy: "alex",
        demo: true,
      },
    ],
    settings: {
      foodCostPercent: 30,
      fixedCosts: 2500,
      longShiftHours: 8,
      demo: true,
    },
    audit: [
      {
        id: "demo-audit",
        type: "seed",
        employeeId: "alex",
        createdAt: iso(0),
        demo: true,
      },
    ],
  };
}
export function bootstrapState({ name, pin } = {}) {
  if (typeof name !== "string" || !name.trim() || name.length > 80 || !/^\d{8,12}$/.test(pin || ""))
    throw new Error("New store requires bootstrap name and an 8–12 digit PIN (BOOTSTRAP_PIN_FILE)");
  return {employees:[{id:randomBytes(16).toString("hex"),name:name.trim(),role:"chef",pinHash:hashPin(pin),hourlyRate:0,active:true,wageHistory:[{effectiveDate:"2020-01-01",hourlyRate:0}],demo:false}],orders:[],shiftRequests:[],shifts:[],schedule:[],zones:[],tasks:[],handoffs:[],audit:[],settings:{foodCostPercent:30,fixedCosts:0,longShiftHours:8,flatFee:0,demo:false}};
}
export async function createStore(file, { demo = false, bootstrap } = {}) {
  file = resolve(file);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const lockFile = `${file}.lock`;
  let lock;
  try { lock = await open(lockFile, "wx", 0o600); }
  catch (e) { if (e.code === "EEXIST") throw new Error(`Store locked: ${lockFile}. Stop the other process; remove stale lock only after verifying no writer is running.`); throw e; }
  let state, queue = Promise.resolve(), closed = false;
  const release = async () => { await lock.close(); await unlink(lockFile); };
  async function persist(next) {
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    const handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(next, null, 2)); await handle.sync(); }
    finally { await handle.close(); }
    try {
      await rename(temp, file);
      const directory = await open(dirname(file), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temp).catch(e => { if (e.code !== "ENOENT") throw e; }); }
  }
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    try { state = JSON.parse(await readFile(file, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; state = demo ? seed() : bootstrapState(bootstrap); }
    state.shiftRequests ??= [];
    if (!Array.isArray(state.shiftRequests)) throw new Error("Invalid store: shiftRequests");
    for (const key of ["employees","orders","shifts","schedule","zones","tasks","handoffs","audit"])
      if (!Array.isArray(state[key])) throw new Error(`Invalid store: ${key}`);
    if (!state.settings || !state.employees.some(e => e.active && e.role === "chef")) throw new Error("Invalid store: settings or active chef missing");
    await persist(state);
  } catch (e) { await release(); throw e; }
  return {
    read: () => structuredClone(state),
    async close() { if (closed) return queue; closed = true; await queue; await release(); },
    transact(fn) {
      if (closed) return Promise.reject(new Error("Store closed"));
      const result = queue.then(async () => {
        const next = structuredClone(state);
        const value = await fn(next);
        await persist(next);
        state = next;
        return value;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}
