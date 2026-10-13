import {accessSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Hostinger keeps private configuration beside versions, while each deploy
// replaces versions/<release>/nodejs. Never look outside this exact layout.
export function findWinorderConfig(entryUrl, env = process.env) {
  if (env.WINORDER_CONFIG_FILE) return env.WINORDER_CONFIG_FILE;
  if (env.NODE_ENV !== 'production' || env.WINORDER_USERNAME || env.WINORDER_PASSWORD) return undefined;
  const serverDir = dirname(fileURLToPath(entryUrl));
  const appDir = dirname(serverDir);
  const versionsDir = dirname(dirname(appDir));
  const buildsDir = dirname(versionsDir);
  if (basename(serverDir) !== 'server' || basename(appDir) !== 'nodejs'
      || basename(versionsDir) !== 'versions' || basename(buildsDir) !== 'hbuilds') return undefined;
  const file = join(buildsDir, 'config', 'winorder.env');
  try {accessSync(file); return file;}
  catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
}
