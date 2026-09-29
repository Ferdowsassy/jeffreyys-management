import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
test("standalone entrypoint binds localhost and serves API", async (t) => {
  const dir = await mkdtemp(tmpdir() + "/jeffreyys-entry-");
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: "0", DEMO_MODE: "true", DATA_FILE: dir + "/state.json" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  const output = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("Startup timeout")), 5000);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.includes("http://")) {
        clearTimeout(timer);
        resolve(out);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Server exited " + code));
    });
  });
  const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(url);
  assert.deepEqual(await (await fetch(url + "/api/session")).json(), {
    user: null,
  });
});
