// Machine-specific settings live here and in the environment, never in feature code.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Expand a leading "~" so stored paths work on any machine. */
export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export const config = {
  // The always-on service uses 4747; `npm run dev` runs on 4748 so both can run at once.
  port: Number(process.env.MC_PORT ?? (process.argv.includes('--dev') ? 4748 : 4747)),
  host: '127.0.0.1',
  dataDir: path.resolve(expandHome(process.env.MC_DATA_DIR ?? path.join(REPO_ROOT, 'data'))),
  timeZone: process.env.MC_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
};

export const paths = {
  db: path.join(config.dataDir, 'mission-control.db'),
  files: path.join(config.dataDir, 'files'),
  sources: path.join(config.dataDir, 'files', 'sources'),
  photos: path.join(config.dataDir, 'files', 'photos'),
  receipts: path.join(config.dataDir, 'files', 'receipts'),
  /** Tax documents, in readable folders ("AU 2025-26/Notice of assessment.pdf") so doc search shows good names. */
  vault: path.join(config.dataDir, 'files', 'vault'),
  dist: path.join(REPO_ROOT, 'dist'),
  /** The document search index: separate, and safe to delete (it rebuilds). */
  search: path.join(config.dataDir, 'search.db'),
  /** The OAuth client file downloaded from Google Cloud, and the saved login. */
  googleClient: path.join(config.dataDir, 'google', 'client.json'),
  googleToken: path.join(config.dataDir, 'google', 'token.json'),
  /** TMDB API read access token, for the Watchlist's posters and streaming details. */
  tmdbToken: path.join(config.dataDir, 'tmdb', 'token'),
  /** OMDb API key, for IMDb, Rotten Tomatoes and Metacritic scores. */
  omdbKey: path.join(config.dataDir, 'omdb', 'key'),
};
