import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createMysqlStore, databaseConfig, collections } from '../server/mysql-store.js';

if (process.env.DB_CONFIG_FILE) process.loadEnvFile(process.env.DB_CONFIG_FILE);
const config = databaseConfig();
if (!config) throw new Error('MySQL configuration is required');
const source = process.argv[2];
if (!source || !isAbsolute(source)) throw new Error('Usage: node scripts/migrate-mysql.mjs /absolute/path/to/state.json (stop the app and back up first)');
const initialState = JSON.parse(await readFile(source, 'utf8'));
const store = await createMysqlStore(config, {initialState});
try {
  const migrated = store.read();
  for (const key of [...collections, 'settings'])
    if (JSON.stringify(migrated[key]) !== JSON.stringify(initialState[key])) throw new Error(`Migration mismatch: ${key}`);
  console.log('MySQL migration verified:', Object.fromEntries(collections.map(key => [key, migrated[key].length])));
} finally { await store.close(); }
