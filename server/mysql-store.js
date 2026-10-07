import mysql from 'mysql2/promise';
import { bootstrapState, seed } from './store.js';

export const collections = ['employees', 'orders', 'shifts', 'schedule', 'zones', 'tasks', 'handoffs', 'audit', 'shiftRequests'];
const table = key => `jm_${key}`;
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;

export function databaseConfig(env = process.env) {
  if (!env.DB_NAME && !env.DB_USER && !env.DB_PASSWORD && env.STORAGE_BACKEND !== 'mysql') return undefined;
  for (const key of ['DB_NAME', 'DB_USER', 'DB_PASSWORD'])
    if (!env[key]) throw new Error(`MySQL requires ${key}; refusing to fall back to a JSON file`);
  const port = Number(env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DB_PORT');
  return {host: env.DB_HOST || '127.0.0.1', port, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
    ...(env.DB_SOCKET ? {socketPath: env.DB_SOCKET} : {})};
}

function validate(state) {
  for (const key of collections) {
    if (!Array.isArray(state[key])) throw new Error(`Invalid database: ${key}`);
    const ids = new Set();
    for (const row of state[key]) {
      if (typeof row.id !== 'string' || !row.id || row.id.length > 191 || ids.has(row.id))
        throw new Error(`Invalid or duplicate ${key} id`);
      ids.add(row.id);
    }
  }
  if (!state.settings || !state.employees.some(e => e.active && e.role === 'chef'))
    throw new Error('Invalid database: settings or active chef missing');
}

// Each collection has its own InnoDB table, one row per record. The metadata
// row serializes business transactions across processes. MySQL releases locks
// automatically when a connection dies; no filesystem lock needs recovery.
export async function createMysqlStore(config, {demo = false, bootstrap, initialState} = {}) {
  const pool = mysql.createPool({...config, charset: 'utf8mb4', connectionLimit: 3,
    connectTimeout: 10000, waitForConnections: true, queueLimit: 50});
  let state, revision, queue = Promise.resolve(), closed = false;
  const enqueue = fn => {
    if (closed) return Promise.reject(new Error('Store closed'));
    const pending = queue.then(fn);
    queue = pending.catch(() => {});
    return pending;
  };
  async function load(connection, meta) {
    const next = {settings: decode(meta.settings)};
    for (const key of collections) {
      const [rows] = await connection.query(`SELECT payload FROM ${table(key)} ORDER BY position`);
      next[key] = rows.map(row => decode(row.payload));
    }
    validate(next);
    return next;
  }
  async function persist(connection, next, previous) {
    validate(next);
    for (const key of collections) {
      const old = new Map((previous?.[key] || []).map((row, position) => [row.id, {payload: JSON.stringify(row), position}]));
      for (const [position, row] of next[key].entries()) {
        const payload = JSON.stringify(row), before = old.get(row.id);
        if (!before || before.payload !== payload || before.position !== position)
          await connection.execute(`INSERT INTO ${table(key)} (id, position, payload) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE position=VALUES(position), payload=VALUES(payload)`, [row.id, position, payload]);
        old.delete(row.id);
      }
      for (const id of old.keys()) await connection.execute(`DELETE FROM ${table(key)} WHERE id=?`, [id]);
    }
    await connection.execute('UPDATE jm_metadata SET settings=?, revision=revision+1 WHERE id=1', [JSON.stringify(next.settings)]);
  }
  async function transaction(fn) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT settings, revision FROM jm_metadata WHERE id=1 FOR UPDATE');
      const result = await fn(connection, rows[0]);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  }
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS jm_metadata (id TINYINT PRIMARY KEY, settings JSON NULL, revision BIGINT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB');
    for (const key of collections)
      await pool.query(`CREATE TABLE IF NOT EXISTS ${table(key)} (id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY, position INT UNSIGNED NOT NULL, payload JSON NOT NULL) ENGINE=InnoDB`);
    await pool.query('INSERT IGNORE INTO jm_metadata (id) VALUES (1)');
    const loaded = await transaction(async (connection, meta) => {
      if (meta.settings !== null) {
        if (initialState) throw new Error('Migration refused: MySQL already contains application data');
        return {state: await load(connection, meta), revision: Number(meta.revision)};
      }
      for (const key of collections) {
        const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${table(key)}`);
        if (Number(rows[0].count)) throw new Error('Database has records without metadata; refusing initialization');
      }
      const next = initialState ? structuredClone(initialState) : demo ? seed() : bootstrapState(await (typeof bootstrap === 'function' ? bootstrap() : bootstrap));
      next.shiftRequests ??= [];
      await persist(connection, next);
      return {state: next, revision: Number(meta.revision) + 1};
    });
    state = loaded.state; revision = loaded.revision;
  } catch (error) { await pool.end(); throw error; }
  return {
    backend: 'mysql',
    read: () => structuredClone(state),
    refresh() {
      return enqueue(async () => {
        const [rows] = await pool.query('SELECT revision FROM jm_metadata WHERE id=1');
        if (Number(rows[0]?.revision) === revision) return false;
        const next = await transaction(async (connection, meta) => ({state: await load(connection, meta), revision: Number(meta.revision)}));
        const changed = revision !== next.revision;
        state = next.state; revision = next.revision;
        return changed;
      });
    },
    transact(fn) {
      return enqueue(async () => {
        const committed = await transaction(async (connection, meta) => {
          const previous = await load(connection, meta), next = structuredClone(previous);
          const value = await fn(next);
          await persist(connection, next, previous);
          return {value, state: next, revision: Number(meta.revision) + 1};
        });
        state = committed.state; revision = committed.revision;
        return committed.value;
      });
    },
    async close() { if (closed) return queue; closed = true; await queue; await pool.end(); },
  };
}
