import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { profilePatch, profileSchema } from '../shared/profile.ts';
import { getSetting, setSetting } from './calendar/repo.ts';
import { config, paths } from './config.ts';
import { transaction, type Db } from './db.ts';
import { UserError } from './errors.ts';

export function getProfile(db: Db) {
  return profileSchema.parse(JSON.parse(getSetting(db, 'profile') ?? '{}'));
}

export function saveProfile(db: Db, raw: unknown) {
  const profile = profileSchema.parse({ ...getProfile(db), ...profilePatch.parse(raw) });
  transaction(db, () => {
    if (profile.watchRegion !== getProfile(db).watchRegion) db.prepare('UPDATE watch_items SET providers = NULL, providers_at = NULL').run();
    setSetting(db, 'profile', JSON.stringify(profile));
  });
  return profile;
}

export function doctor(db: Db) {
  return {
    node: process.version, platform: process.platform, dataDirectory: config.dataDir,
    timeZone: config.timeZone, profile: getProfile(db),
    connections: { googleClient: existsSync(paths.googleClient), googleLogin: existsSync(paths.googleToken), tmdb: existsSync(paths.tmdbToken), omdb: existsSync(paths.omdbKey) },
    built: existsSync(path.join(paths.dist, 'index.html')),
  };
}

/** Import a user-selected file without echoing its contents into the chat or logs. */
export function importCredential(kind: string, file: string, replace = false) {
  const destinations: Record<string, string> = { google: paths.googleClient, tmdb: paths.tmdbToken, omdb: paths.omdbKey };
  const destination = destinations[kind];
  if (!destination) throw new UserError('Choose google, tmdb or omdb.');
  if (kind === 'google' && existsSync(paths.googleToken)) throw new UserError('Google is already signed in. Stop the server and disconnect the previous account before changing its client.');
  if (existsSync(destination) && !replace) throw new UserError('Already configured. Ask the user before importing a replacement with --replace.');
  let content: string;
  try { content = readFileSync(file, 'utf8').trim(); }
  catch { throw new UserError('Cannot read that credential file. Check its path.'); }
  if (!content || content.length > 20_000) throw new UserError('The credential file is empty or too large.');
  if (kind === 'google') {
    let client;
    try { client = JSON.parse(content).installed; } catch { /* report no contents */ }
    if (!client || typeof client.client_id !== 'string' || !client.client_id || typeof client.client_secret !== 'string' || !client.client_secret) {
      throw new UserError('Choose the Desktop app client JSON downloaded from Google Cloud.');
    }
  } else if (/\s/.test(content)) throw new UserError('Use a plain text file containing only the token or key.');
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  writeFileSync(destination, content + '\n', { mode: 0o600, flag: replace ? 'w' : 'wx' });
  chmodSync(destination, 0o600);
  return `Configured ${kind}. Credential contents were not displayed.`;
}
