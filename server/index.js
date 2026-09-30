import { createApp } from "./app.js";
import { readFile, access } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { databaseConfig } from "./mysql-store.js";

if (process.env.DB_CONFIG_FILE) process.loadEnvFile(process.env.DB_CONFIG_FILE);
const database = databaseConfig();

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("PORT must be a valid TCP port");
if (production && !database && (!process.env.DATA_FILE || !isAbsolute(process.env.DATA_FILE)))
  throw new Error("Production DATA_FILE must be an absolute path on persistent local storage");
const proxy = process.env.TRUST_PROXY;
if (proxy && /^(true|\d+)$/i.test(proxy))
  throw new Error("TRUST_PROXY must name explicit proxy IPs/subnets, not true or a hop count");
const demo = process.env.DEMO_MODE === "true";

let app;
let stopping = false;
let initialization;
const server = createServer((request, response) => {
  response.writeHead(503, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end('{"status":"starting"}');
});
server.requestTimeout = 60000;
server.headersTimeout = 15000;

async function initialize() {
  let bootstrap;
  if (!demo) {
    let storeExists = false;
    if (!database && process.env.DATA_FILE) {
      try {
        await access(process.env.DATA_FILE);
        storeExists = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!storeExists) {
      const loadBootstrap = async () => ({
        name: process.env.BOOTSTRAP_NAME,
        pin: process.env.BOOTSTRAP_PIN_FILE
          ? (await readFile(process.env.BOOTSTRAP_PIN_FILE, "utf8")).trim()
          : undefined,
      });
      bootstrap = database ? loadBootstrap : await loadBootstrap();
    }
  }

  const created = await createApp({
    production,
    dataFile: process.env.DATA_FILE,
    database,
    demo,
    origin: process.env.APP_ORIGIN,
    trustProxy:
      !proxy || proxy === "false"
        ? false
        : proxy.split(",").map((item) => item.trim()),
    secureCookie:
      process.env.COOKIE_SECURE === undefined
        ? production
        : process.env.COOKIE_SECURE === "true",
    assumeHttps: process.env.HTTPS_BEHIND_PROXY === "true",
    staticDir: fileURLToPath(new URL("../dist", import.meta.url)),
    bootstrap,
  });

  if (stopping) {
    created.locals.stopEvents();
    await created.locals.close();
    return;
  }

  app = created;
  server.removeAllListeners("request");
  server.on("request", app);
  console.log("Jeffreyys: http://" + host + ":" + server.address().port);
}

async function closeServer() {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => {
    console.error("Shutdown timed out; store lock retained for operator review");
    server.closeAllConnections();
    process.exit(1);
  }, 10000);
  timeout.unref();
  app?.locals.stopEvents();
  await closeServer();
  await initialization?.catch(() => {});
  if (app) await app.locals.close();
  clearTimeout(timeout);
  process.exitCode = code;
}

server.on("error", (error) => {
  console.error(error.message);
  shutdown(1).catch((shutdownError) => {
    console.error(shutdownError.message);
    process.exitCode = 1;
  });
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    shutdown().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    }),
  );

server.listen(port, host, () => {
  initialization = initialize().catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    await closeServer();
  });
});
