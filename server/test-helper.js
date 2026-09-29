import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp } from "./app.js";
export async function fixture(t) {
  const dir = await mkdtemp(`${tmpdir()}/jeffreyys-`);
  const app = await createApp({ dataFile: `${dir}/db.json`, demo: true });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await app.locals.store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, cookie = "") {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(id, pin) {
    return (await request("/api/login", { id, pin })).cookie;
  }
  return { request, login, app, dir, base };
}
