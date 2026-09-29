import { createApp } from "./app.js";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PORT must be a valid TCP port");
if (production && (!process.env.DATA_FILE || !isAbsolute(process.env.DATA_FILE)))
  throw new Error("Production DATA_FILE must be an absolute path on persistent local storage");
const proxy = process.env.TRUST_PROXY;
if (proxy && /^(true|\d+)$/i.test(proxy)) throw new Error("TRUST_PROXY must name explicit proxy IPs/subnets, not true or a hop count");
const demo = process.env.DEMO_MODE === "true";
let bootstrap;
if (!demo) {
  let storeExists = false;
  if (process.env.DATA_FILE) {
    try { await access(process.env.DATA_FILE); storeExists = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!storeExists)
    bootstrap = {
      name: process.env.BOOTSTRAP_NAME,
      pin: process.env.BOOTSTRAP_PIN_FILE
        ? (await readFile(process.env.BOOTSTRAP_PIN_FILE, "utf8")).trim()
        : undefined,
    };
}
const app = await createApp({
  production,
  dataFile: process.env.DATA_FILE,
  demo,
  origin: process.env.APP_ORIGIN,
  trustProxy: !proxy || proxy === "false" ? false : proxy.split(",").map(s => s.trim()),
  secureCookie: process.env.COOKIE_SECURE === undefined ? production : process.env.COOKIE_SECURE === "true",
  staticDir: fileURLToPath(new URL("../dist", import.meta.url)),
  bootstrap,
});
const server = app.listen(port, host, () =>
  console.log(`Jeffreyys: http://${host}:${server.address().port}`),
);
server.requestTimeout = 60000;
server.headersTimeout = 15000;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => {
    console.error("Shutdown timed out; store lock retained for operator review");
    server.closeAllConnections(); process.exit(1);
  },10000);
  timeout.unref();
  app.locals.stopEvents();
  await new Promise(resolve => server.close(resolve));
  await app.locals.close();
  clearTimeout(timeout);
  process.exitCode = code;
}
server.on("error", error => { console.error(error.message); shutdown(1).catch(e=>{console.error(e.message);process.exitCode=1;}); });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => shutdown().catch(e=>{console.error(e.message);process.exitCode=1;}));
