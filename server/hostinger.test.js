import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

test("Hostinger can require the configured ESM entrypoint directly", async (t) => {
  const dir = await mkdtemp(`${tmpdir()}/jeffreyys-hostinger-`);
  await writeFile(`${dir}/pin`, "9876543210", { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ["-e", 'require("./server/index.js")'],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEMO_MODE: "false",
        HOST: "127.0.0.1",
        PORT: "0",
        DATA_FILE: `${dir}/state.json`,
        APP_ORIGIN: "https://workspace.example",
        TRUST_PROXY: "loopback",\n        HTTPS_BEHIND_PROXY: "true",
        BOOTSTRAP_NAME: "Owner",
        BOOTSTRAP_PIN_FILE: `${dir}/pin`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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

  assert.equal((await fetch(`${base}/healthz`)).status, 200);\n  assert.equal((await fetch(`${base}/`)).status, 200);
  const exit = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  assert.equal(await exit, 0);
});
