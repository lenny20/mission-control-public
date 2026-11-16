import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { connectionInput, type StoredConnection } from '../../shared/calendar/connections.ts';
import { config } from '../config.ts';
import { UserError } from '../errors.ts';

export const connectionDir = () => path.join(config.dataDir, 'calendars');
export function connectionFile(id: string, cache = false) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new UserError('Unknown calendar connection.');
  return path.join(connectionDir(), `${id}${cache ? '.cache' : ''}.json`);
}
export function writePrivate(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
    chmodSync(file, 0o600);
  } finally { rmSync(temporary, { force: true }); }
}
export function listConnections(): StoredConnection[] {
  if (!existsSync(connectionDir())) return [];
  return readdirSync(connectionDir()).filter((file) => /^[0-9a-f-]{36}\.json$/.test(file)).sort().map((file) => {
    try {
      const id = file.slice(0, -5);
      return { ...connectionInput.parse(JSON.parse(readFileSync(connectionFile(id), 'utf8'))), id };
    } catch { throw new UserError('A saved calendar connection cannot be read. Ask your agent to check its configuration without displaying credentials.'); }
  });
}
export function getConnection(id: string) {
  const connection = listConnections().find((c) => c.id === id);
  if (!connection) throw new UserError('Unknown calendar connection.', 404);
  return connection;
}
export function addConnection(raw: unknown) {
  const input = connectionInput.parse(raw);
  const id = randomUUID();
  writePrivate(connectionFile(id), JSON.stringify(input));
  return { id, provider: input.provider, label: input.label };
}
export function importConnection(file: string) {
  let input: unknown;
  try { input = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new UserError('Choose a readable calendar connection JSON file. Its contents will not be displayed.'); }
  return addConnection(input);
}
export function removeConnection(id: string) {
  getConnection(id);
  rmSync(connectionFile(id));
  rmSync(connectionFile(id, true), { force: true });
}
