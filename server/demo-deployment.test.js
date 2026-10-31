import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp } from "./app.js";

test("hosted demo production rejects missing HTTPS origin", async () => {
  const dir = await mkdtemp(`${tmpdir()}/jeffreyys-demodeny-`);
  await assert.rejects(
    createApp({
      dataFile: `${dir}/state.json`,
      demo: true,
      production: true,
      secureCookie: true,
    }),
    /HTTPS APP_ORIGIN/,
  );
  await rm(dir, { recursive: true, force: true });
});

test("hosted demo production seeds public accounts and allows reset", async (t) => {
  const dir = await mkdtemp(`${tmpdir()}/jeffreyys-demodemo-`);
  const app = await createApp({
    dataFile: `${dir}/state.json`,
    demo: true,
    production: true,
    origin: "https://demo.example",
    trustProxy: ["loopback"],
    assumeHttps: true,
    secureCookie: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
    await rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const people = await (await fetch(`${base}/api/people`)).json();
  assert.equal(people.demo, true);
  assert.ok(people.people.some((person) => person.id === "alex"));

  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://demo.example",
    },
    body: JSON.stringify({ id: "alex", pin: "1234" }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Secure/);

  const headers = {
    "content-type": "application/json",
    origin: "https://demo.example",
    cookie: login.headers.get("set-cookie").split(";")[0],
  };
  const reset = await fetch(`${base}/api/action`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "reset", confirmation: "RESET" }),
  });
  assert.equal(reset.status, 200);
});

test("Hostinger entrypoint boots in DEMO_MODE with HTTPS proxy settings", async (t) => {
  const dir = await mkdtemp(`${tmpdir()}/jeffreyys-demodentry-`);
  const child = spawn(process.execPath, ["hostinger.cjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DEMO_MODE: "true",
      HOST: "127.0.0.1",
      PORT: "0",
      DATA_FILE: `${dir}/state.json`,
      APP_ORIGIN: "https://demo.example",
      COOKIE_SECURE: "true",
      HTTPS_BEHIND_PROXY: "true",
      TRUST_PROXY: "loopback",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  });

  let errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Startup timeout ${errors}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Exit ${code} ${errors}`));
    });
  });

  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.status, "ok");
  assert.equal(health.storage, "file");
  const people = await (await fetch(`${base}/api/people`)).json();
  assert.equal(people.demo, true);

  const exit = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  assert.equal(await exit, 0);
});
