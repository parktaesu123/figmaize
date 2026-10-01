import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
export const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const userData=process.platform==='win32'?path.join(process.env.LOCALAPPDATA||homedir(),'figmaize'):process.platform==='darwin'?path.join(homedir(),'Library','Application Support','figmaize'):path.join(process.env.XDG_DATA_HOME||path.join(homedir(),'.local','share'),'figmaize');
export const DATA_DIR = process.env.FIGMAIZE_DATA_DIR || process.env.LAYER_BRIDGE_DATA_DIR || (existsSync(path.join(ROOT,'.layer-bridge'))?path.join(ROOT,'.layer-bridge'):userData);
export const PORT = Number(process.env.LAYER_BRIDGE_PORT || 4318);
export const URL_BASE = `http://127.0.0.1:${PORT}`;
export async function getToken() {
  if (process.env.LAYER_BRIDGE_TOKEN) {
    if (process.env.LAYER_BRIDGE_TOKEN.length < 24) throw new Error('LAYER_BRIDGE_TOKEN must contain at least 24 characters');
    return process.env.LAYER_BRIDGE_TOKEN;
  }
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DATA_DIR, 'pairing-token');
  try { await writeFile(file, randomBytes(24).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const token = (await readFile(file, 'utf8')).trim();
  if (token.length < 24) throw new Error('Pairing token is invalid. Restore or remove .layer-bridge/pairing-token and restart.');
  return token;
}
