import { addConnection } from './calendar/connections.ts';
import { microsoftAuthUrl, finishMicrosoftLogin } from './calendar/microsoft.ts';
import { getProfile, saveProfile, doctor } from './profile.ts';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ZodError } from 'zod';
import { daysBetween, isDateStr, today } from '../shared/dates.ts';
import * as google from './calendar/google.ts';
import { setSetting } from './calendar/repo.ts';
import { createCalendarService } from './calendar/service.ts';
import { config, paths } from './config.ts';
import { openDb } from './db.ts';
import { ConflictError, describeZodError, UserError } from './errors.ts';
import * as repo from './health/repo.ts';
import { seedIfEmpty } from './health/seed.ts';
import * as work from './work/repo.ts';
import * as notes from './notes/repo.ts';
import { kindOf, readDoc } from './docs/extract.ts';
import { displayPath, forgetFile, indexFile, indexStatus, openSearch, recent, search, viewablePath } from './docs/search.ts';
import { DOC_KINDS, type DocKind } from '../shared/docs/types.ts';
import * as money from './money/repo.ts';
import { exportTaxYear } from './money/export.ts';
import * as watch from './watch/repo.ts';
import * as tmdb from './watch/tmdb.ts';
import * as recipes from './recipes/repo.ts';

const db = openDb(paths.db);
seedIfEmpty(db);
mkdirSync(paths.files, { recursive: true });
const calendar = createCalendarService(db, config.timeZone);

const app = new Hono();
const dashboard = { source: 'dashboard' as const };

// Only this machine's own pages may use the API. The Host check stops a web
// page from reaching it through DNS rebinding; the Origin check stops another
// site from posting to it (a form or a no-cors fetch would otherwise get through).
const local = (host: string | undefined) => !!host && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
app.use('*', async (c, next) => {
  if (!local(c.req.header('host'))) return c.text('Mission Control only answers on this computer.', 403);
  const origin = c.req.header('origin');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && !local(origin.replace(/^https?:\/\//, ''))) {
    return c.json({ error: 'Requests from other sites are refused.' }, 403);
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof SyntaxError) return c.json({ error: "That request wasn't valid JSON." }, 400);
  if (err instanceof ZodError) return c.json({ error: describeZodError(err) }, 400);
  if (err instanceof UserError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server. Check the log.' }, 500);
});

const idParam = (c: Context) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new UserError('That id is not a number.');
  return id;
};
const dateParam = (c: Context) => {
  const date = c.req.param('date') ?? '';
  if (!isDateStr(date)) throw new UserError('Dates are written YYYY-MM-DD.');
  return date;
};

app.get('/api/profile', (c) => {
  const status = doctor(db);
  return c.json({ today: today(config.timeZone), profile: status.profile, connections: status.connections });
});
app.put('/api/profile', async (c) => {
  const profile = saveProfile(db, await c.req.json());
  broadcast();
  return c.json(profile);
});

// ------------------------------------------------------------------ health

app.get('/api/health', (c) => c.json(repo.snapshot(db, today(config.timeZone))));

// Edits from the dashboard always replace: the person is looking at the value they're changing.
// The day editor: nutrition and weigh-in together, all or nothing.
app.put('/api/health/day/:date', async (c) => {
  const date = dateParam(c);
  const body = (await c.req.json()) as { nutrition?: unknown; weight?: unknown };
  return c.json(repo.saveDay(db, date, { nutrition: body.nutrition, weight: body.weight }, dashboard));
});

app.put('/api/health/nutrition/:date', async (c) => {
  const date = dateParam(c);
  return c.json(repo.saveNutrition(db, { ...(await c.req.json()), date }, dashboard, 'replace'));
});
app.delete('/api/health/nutrition/:date', (c) => (repo.deleteNutrition(db, dateParam(c)), c.body(null, 204)));

app.put('/api/health/weights/:date', async (c) => {
  const date = dateParam(c);
  return c.json(repo.saveWeight(db, { ...(await c.req.json()), date }, dashboard, 'replace'));
});
app.delete('/api/health/weights/:date', (c) => (repo.deleteWeight(db, dateParam(c)), c.body(null, 204)));

app.post('/api/health/workouts', async (c) => {
  try {
    return c.json(repo.addWorkout(db, await c.req.json(), dashboard));
  } catch (err) {
    // In the dashboard the fix is to edit the existing workout, not to replace it blind.
    if (err instanceof ConflictError) throw new UserError(`${err.message} Open it from the workout list to change it.`, 409);
    throw err;
  }
});
app.put('/api/health/workouts/:id', async (c) => c.json(repo.updateWorkout(db, idParam(c), await c.req.json())));
app.delete('/api/health/workouts/:id', (c) => (repo.deleteWorkout(db, idParam(c)), c.body(null, 204)));

app.post('/api/health/skips', async (c) => c.json(repo.addSkip(db, await c.req.json())));
app.delete('/api/health/skips/:id', (c) => (repo.deleteSkip(db, idParam(c)), c.body(null, 204)));

app.put('/api/health/program', async (c) => c.json(repo.setProgram(db, await c.req.json())));
app.post('/api/health/exercises', async (c) => c.json(repo.saveExercise(db, await c.req.json())));

app.post('/api/health/photos', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new UserError('Choose a photo to upload.');
  const tmp = path.join(os.tmpdir(), `mc-upload-${Date.now()}${path.extname(file.name).toLowerCase() || '.jpg'}`);
  writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    return c.json(
      repo.addPhoto(db, tmp, {
        date: String(form.get('date') ?? today(config.timeZone)),
        pose: form.get('pose') ? String(form.get('pose')) : null,
        note: form.get('note') ? String(form.get('note')) : null,
      }),
    );
  } finally {
    rmSync(tmp, { force: true });
  }
});
app.put('/api/health/photos/:id', async (c) => c.json(repo.updatePhoto(db, idParam(c), await c.req.json())));
app.delete('/api/health/photos/:id', (c) => (repo.deletePhoto(db, idParam(c)), c.body(null, 204)));

// ------------------------------------------------------------------ calendar

app.get('/api/calendar', (c) => {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!isDateStr(from) || !isDateStr(to)) throw new UserError('from and to are dates, written YYYY-MM-DD.');
  const span = daysBetween(from, to);
  if (span < 1 || span > 400) throw new UserError('Ask for between 1 and 400 days at a time.');
  const range = calendar.range(from, to);
  return c.json({ ...range, events: [...range.events, ...work.deadlines(db, from, to)] });
});
app.post('/api/calendar/events', async (c) => c.json(await calendar.create(await c.req.json(), 'dashboard')));
app.put('/api/calendar/events/:id', async (c) => c.json(await calendar.update(idParam(c), await c.req.json())));
app.delete('/api/calendar/events/:id', async (c) => c.json(await calendar.remove(idParam(c), c.req.query('confirmed') === '1')));

// The page asks for a pull when the calendar opens or regains focus; more than
// one every 30 seconds is skipped unless forced.
app.post('/api/calendar/sync', async (c) => {
  const changes = await calendar.sync(c.req.query('force') === '1' ? 0 : 30_000);
  if (changes) broadcast();
  return c.json(calendar.status());
});
app.put('/api/calendar/calendars/:id', async (c) => {
  const { shown } = (await c.req.json()) as { shown?: unknown };
  if (typeof shown !== 'boolean') throw new UserError('shown is true or false.');
  calendar.showCalendar(decodeURIComponent(c.req.param('id')), shown);
  await calendar.sync().catch(() => 0);
  return c.json(calendar.status());
});

app.post('/api/calendar/connections', async (c) => {
  const added = addConnection(await c.req.json());
  broadcast();
  return c.json(added);
});
app.delete('/api/calendar/connections/:id', async (c) => {
  if (c.req.query('confirmed') !== '1') throw new UserError('Confirm disconnecting this account first.', 409);
  await calendar.disconnect(c.req.param('id'));
  broadcast();
  return c.body(null, 204);
});
app.get('/api/microsoft/connect/:id', async (c) => {
  setSetting(db, 'calendar.loginError', null);
  return c.redirect(await microsoftAuthUrl(c.req.param('id'), `http://${config.host}:${config.port}/api/microsoft/callback`));
});
app.get('/api/microsoft/callback', async (c) => {
  try {
    if (!c.req.query('code')) throw new UserError('Microsoft sign-in was cancelled or refused.');
    const id = await finishMicrosoftLogin(c.req.query('code')!, c.req.query('state') ?? '');
    setSetting(db, `${id}.error`, null);
    setSetting(db, 'calendar.loginError', null);
    await calendar.sync();
  } catch (error) {
    setSetting(db, 'calendar.loginError', error instanceof UserError ? error.message : 'Microsoft sign-in could not finish. Please try again.');
  }
  broadcast();
  return c.redirect('/#/calendar');
});

// Google sign-in. Desktop-app clients may redirect to any loopback port.
const redirectUri = () => `http://${config.host}:${config.port}/api/google/callback`;
app.get('/api/google/connect', (c) => c.redirect(google.authUrl(redirectUri())));
app.get('/api/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') ?? '';
  if (!code) {
    calendarError(c.req.query('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${c.req.query('error') ?? 'no code returned'}.`);
    return c.redirect('/#/calendar');
  }
  try {
    await calendar.finishLogin(code, state);
    await calendar.sync();
  } catch (err) {
    calendarError((err as Error).message);
  }
  broadcast();
  return c.redirect('/#/calendar');
});
const calendarError = (message: string) => setSetting(db, 'google.error', message);

// Keep the calendar current while the dashboard runs.
const pull = () =>
  calendar
    .sync()
    .then((n) => n && broadcast())
    .catch((err: Error) => console.error(`Calendar sync: ${err.message}`));
setTimeout(pull, 3_000).unref();
setInterval(pull, 5 * 60_000).unref();

// ------------------------------------------------------------------ work

const day = () => today(config.timeZone);
app.get('/api/work', (c) => c.json(work.snapshot(db, day())));
app.post('/api/work/cards', async (c) => c.json(work.createCard(db, await c.req.json(), 'dashboard', day())));
app.put('/api/work/cards/:id', async (c) => c.json(work.updateCard(db, idParam(c), await c.req.json())));
app.post('/api/work/cards/:id/move', async (c) => c.json(work.moveCard(db, idParam(c), await c.req.json(), day())));
app.delete('/api/work/cards/:id', (c) => c.json(work.deleteCard(db, idParam(c))));
app.put('/api/work/focus', async (c) => c.json(work.setFocus(db, await c.req.json())));
app.post('/api/work/projects', async (c) => c.json(work.createProject(db, await c.req.json())));
app.put('/api/work/projects/:id', async (c) => c.json(work.updateProject(db, idParam(c), await c.req.json())));
app.delete('/api/work/projects/:id', (c) => c.json(work.deleteProject(db, idParam(c))));
app.post('/api/work/categories', async (c) => c.json(work.createCategory(db, await c.req.json())));
app.put('/api/work/categories/:id', async (c) => c.json(work.updateCategory(db, idParam(c), await c.req.json())));
app.delete('/api/work/categories/:id', (c) => c.json(work.deleteCategory(db, idParam(c))));
app.post('/api/work/cards/:id/submissions', async (c) => c.json(work.addSubmission(db, idParam(c), await c.req.json(), day())));
app.put('/api/work/submissions/:id', async (c) => c.json(work.updateSubmission(db, idParam(c), await c.req.json(), day())));
app.delete('/api/work/submissions/:id', (c) => c.json(work.deleteSubmission(db, idParam(c))));

// ------------------------------------------------------------------ ideas, notes & links

app.get('/api/notes', (c) => c.json(notes.snapshot(db, day())));
app.post('/api/ideas', async (c) => c.json(notes.addIdea(db, await c.req.json(), 'dashboard')));
app.put('/api/ideas/:id', async (c) => c.json(notes.updateIdea(db, idParam(c), await c.req.json())));
app.post('/api/ideas/:id/sort', async (c) => {
  const idea = notes.sortIdea(db, idParam(c), await c.req.json(), day(), addWatchFromIdea);
  if (idea.outcome?.startsWith('note ')) void reindexNote(idea.outcome.slice(5));
  return c.json(idea);
});
/** An idea sent to the watchlist; TMDB fills in the details afterwards when it can. */
function addWatchFromIdea(title: string) {
  const w = watch.addItem(db, { title }, 'dashboard');
  void watch
    .matchByTitle(db, w.id, day())
    .then((matched) => matched && broadcast())
    .catch((err: Error) => console.error(`Watchlist match for "${title}": ${err.message}`));
  return { outcome: `watchlist ${w.id}`, link: `#/watch/to-watch/${w.id}` };
}
app.delete('/api/ideas/:id', (c) => c.json(notes.deleteIdea(db, idParam(c))));

app.post('/api/links', async (c) => c.json(notes.addLink(db, await c.req.json())));
app.put('/api/links/:id', async (c) => c.json(notes.updateLink(db, idParam(c), await c.req.json())));
app.delete('/api/links/:id', (c) => c.json(notes.deleteLink(db, idParam(c))));

const noteFile = (c: Context) => c.req.query('f') ?? '';
app.get('/api/note', (c) => c.json(notes.readNote(db, noteFile(c))));
app.post('/api/note', async (c) => {
  const n = notes.createNote(db, await c.req.json());
  void reindexNote(n.file);
  return c.json(n);
});
app.put('/api/note', async (c) => {
  const before = noteFile(c);
  const n = notes.updateNote(db, before, await c.req.json());
  if (n.file !== before) forgetFile(searchDb, notes.noteAbsPath(db, before));
  void reindexNote(n.file);
  return c.json(n);
});
app.delete('/api/note', (c) => {
  const n = notes.deleteNote(db, noteFile(c));
  forgetFile(searchDb, notes.noteAbsPath(db, n.file));
  return c.json(n);
});

// ------------------------------------------------------------------ doc search

const searchDb = openSearch(paths.search);
const places = () => notes.searchPlaces(db);
/** A note saved here is searchable at once, not at the next pass. */
async function reindexNote(file: string) {
  try {
    await indexFile(searchDb, notes.noteAbsPath(db, file));
  } catch (err) {
    console.error(`Indexing note ${file}: ${(err as Error).message}`);
  }
}

// Indexing passes run in their own process, one at a time, so searching never waits on one.
let indexing: Promise<void> | null = null;
let again = false;
function runIndex(): Promise<void> {
  // Asked for while one runs (new places saved, Update now): run once more after it, with the places as they are then.
  if (indexing) {
    again = true;
    return indexing;
  }
  indexing = new Promise<void>((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, 'docs', 'run-index.ts'), JSON.stringify(places())], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d: Buffer) => console.log(`Doc search: ${d.toString().trim()}`));
    child.stderr.on('data', (d: Buffer) => console.error(`Doc search: ${d.toString().trim()}`));
    child.on('close', () => {
      indexing = null;
      resolve();
      if (again) {
        again = false;
        void runIndex();
      }
    });
  });
  return indexing;
}
setTimeout(() => void runIndex(), 10_000).unref();
setInterval(() => void runIndex(), 15 * 60_000).unref();

const kindParam = (c: Context): DocKind | null => {
  const k = c.req.query('kind');
  return k && (DOC_KINDS as readonly string[]).includes(k) ? (k as DocKind) : null;
};
app.get('/api/docs/search', (c) => {
  const q = (c.req.query('q') ?? '').slice(0, 300);
  const all = !kindParam(c);
  return c.json({ hits: search(searchDb, q, kindParam(c), 60), links: all ? notes.searchLinks(db, q) : [], vault: all ? money.searchVault(db, q) : [] });
});
app.get('/api/docs/recent', (c) => c.json(recent(searchDb, 40)));
app.get('/api/docs/status', (c) => {
  const status = indexStatus(searchDb, notes.docPlaces(db));
  return c.json({ ...status, running: status.running || !!indexing });
});
app.post('/api/docs/reindex', (c) => {
  void runIndex();
  return c.json({ started: true });
});
app.put('/api/docs/settings', async (c) => {
  notes.setDocPlaces(db, await c.req.json());
  void runIndex();
  return c.json(indexStatus(searchDb, notes.docPlaces(db)));
});

const docPath = (c: Context) => {
  const p = viewablePath(c.req.query('path') ?? '');
  if (!p) throw new UserError("That file can't be opened here. The viewer opens markdown, text, PDF, Word and script files in your home folder, outside hidden folders.", 404);
  return p;
};
app.get('/api/docs/view', async (c) => {
  const p = docPath(c);
  const st = statSync(p);
  let content;
  try {
    content = await readDoc(p);
  } catch (err) {
    throw new UserError(`Couldn't read ${path.basename(p)}: ${(err as Error).message}`, 422);
  }
  return c.json({ path: p, display: displayPath(p), name: path.basename(p), kind: kindOf(p), size: st.size, modified: st.mtime.toISOString(), content });
});
// The file itself, for the PDF viewer.
app.get('/api/docs/raw', (c) => {
  const p = docPath(c);
  const type = kindOf(p) === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8';
  return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { headers: { 'content-type': type, 'content-disposition': 'inline', 'x-content-type-options': 'nosniff' } });
});

// ------------------------------------------------------------------ money

/** A file from a dashboard upload, written somewhere temporary for the repo to take. */
async function withUpload<T>(file: FormDataEntryValue | null, fn: (path: string | null) => T): Promise<T> {
  if (!(file instanceof File) || !file.size) return fn(null);
  const tmp = path.join(os.tmpdir(), `mc-upload-${randomUUID()}${path.extname(file.name).toLowerCase()}`);
  writeFileSync(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}
const formJson = (form: FormData) => {
  try {
    return JSON.parse(String(form.get('data') ?? '{}')) as unknown;
  } catch {
    throw new UserError("That request wasn't valid JSON.");
  }
};

app.get('/api/money', (c) => c.json(money.snapshot(db, day())));
app.post('/api/money/income', async (c) => c.json(money.addIncome(db, await c.req.json())));
app.put('/api/money/income/:id', async (c) => c.json(money.updateIncome(db, idParam(c), await c.req.json())));
app.delete('/api/money/income/:id', (c) => c.json(money.deleteIncome(db, idParam(c))));
app.post('/api/money/expenses', async (c) => {
  const form = await c.req.formData();
  return c.json(await withUpload(form.get('receipt'), (f) => money.addExpense(db, formJson(form), f, { allowDuplicate: form.get('allowDuplicate') === '1' })));
});
app.put('/api/money/expenses/:id', async (c) => {
  const id = idParam(c);
  const form = await c.req.formData();
  return c.json(await withUpload(form.get('receipt'), (f) => money.updateExpense(db, id, formJson(form), f)));
});
app.delete('/api/money/expenses/:id', (c) => c.json(money.deleteExpense(db, idParam(c))));
app.post('/api/money/vault', async (c) => {
  const form = await c.req.formData();
  const doc = await withUpload(form.get('file'), (f) => {
    if (!f) throw new UserError('Choose the document to file.');
    return money.addVaultDoc(db, f, formJson(form));
  });
  void indexFile(searchDb, doc.path).catch(() => false);
  return c.json(doc);
});
app.put('/api/money/vault/:id', async (c) => {
  const doc = money.updateVaultDoc(db, idParam(c), await c.req.json());
  if (doc.movedFrom) {
    forgetFile(searchDb, doc.movedFrom);
    void indexFile(searchDb, doc.path).catch(() => false);
  }
  return c.json(doc);
});
app.delete('/api/money/vault/:id', (c) => {
  const doc = money.deleteVaultDoc(db, idParam(c));
  forgetFile(searchDb, doc.path);
  return c.json(doc);
});
app.post('/api/money/export', async (c) => c.json(await exportTaxYear(db, c.req.query('fy') ?? '')));

// ------------------------------------------------------------------ recipes

app.get('/api/recipes', (c) => c.json({ today: day(), recipes: recipes.listRecipes(db) }));
app.get('/api/recipes/:id', (c) => c.json(recipes.getRecipe(db, idParam(c))));
app.post('/api/recipes', async (c) => {
  if (c.req.header('content-type')?.includes('multipart/form-data')) {
    const form = await c.req.formData();
    return c.json(await withUpload(form.get('image'), (image) => recipes.addRecipe(db, formJson(form), { source: 'dashboard', image })));
  }
  return c.json(recipes.addRecipe(db, await c.req.json(), { source: 'dashboard' }));
});
app.put('/api/recipes/:id', async (c) => {
  const id = idParam(c);
  if (c.req.header('content-type')?.includes('multipart/form-data')) {
    const form = await c.req.formData();
    return c.json(await withUpload(form.get('image'), (image) => recipes.updateRecipe(db, id, formJson(form), image)));
  }
  return c.json(recipes.updateRecipe(db, id, await c.req.json()));
});
app.delete('/api/recipes/:id', (c) => c.json(recipes.deleteRecipe(db, idParam(c))));

// ------------------------------------------------------------------ watchlist

app.get('/api/watch', (c) => c.json(watch.snapshot(db, day())));
app.get('/api/watch/search', async (c) => c.json(await tmdb.search((c.req.query('q') ?? '').slice(0, 200), getProfile(db).watchRegion)));
app.post('/api/watch', async (c) => c.json(await watch.addByName(db, await c.req.json(), 'dashboard')));
app.put('/api/watch/:id', async (c) => {
  const id = idParam(c);
  const body = (await c.req.json()) as Record<string, unknown>;
  const item = watch.updateItem(db, id, body, day());
  return c.json('tmdbId' in body ? await watch.enrich(db, id).catch(() => item) : item);
});
app.delete('/api/watch/:id', (c) => c.json(watch.deleteItem(db, idParam(c))));

// Where things stream changes; re-check unwatched titles now and then.
const refreshStreaming = () =>
  watch
    .refreshProviders(db)
    .then((n) => n && broadcast())
    .catch((err: Error) => console.error(`Watchlist refresh: ${err.message}`));
setTimeout(refreshStreaming, 60_000).unref();
setInterval(refreshStreaming, 6 * 3_600_000).unref();

// ------------------------------------------------------------------ live updates

// SQLite bumps data_version whenever another connection (the logging command)
// commits. The page listens here and refreshes itself when Claude logs something.
// Writes made through this server don't move data_version, so the page
// refetches after its own edits instead.
const listeners = new Set<() => void>();
/** Tell open pages about a change this server made in the background. */
function broadcast() {
  for (const notify of listeners) notify();
}
let lastVersion = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
setInterval(() => {
  const v = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  if (v !== lastVersion) {
    lastVersion = v;
    for (const notify of listeners) notify();
  }
}, 1000).unref();

app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    // A change that lands while the last message is still being written is
    // remembered, not lost, and sent on the next turn of the loop.
    let pending = false;
    let wake: (() => void) | null = null;
    const notify = () => {
      pending = true;
      wake?.();
    };
    listeners.add(notify);
    stream.onAbort(() => {
      listeners.delete(notify);
      wake?.();
    });
    while (!stream.aborted) {
      if (!pending) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 25_000);
        });
        wake = null;
      }
      if (stream.aborted) break;
      const changed = pending;
      pending = false;
      await stream.writeSSE(changed ? { event: 'changed', data: '' } : { event: 'ping', data: '' });
    }
  }),
);

// ------------------------------------------------------------------ files & page

app.use('/files/*', serveStatic({ root: path.relative(process.cwd(), paths.files) || '.', rewriteRequestPath: (p) => p.replace(/^\/files/, '') }));
app.get('/files/*', (c) => c.text('No such file.', 404));

if (existsSync(paths.dist)) {
  const root = path.relative(process.cwd(), paths.dist) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
} else {
  app.get('/', (c) => c.text('The page has not been built yet. Run: npm run build'));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Mission Control on http://${config.host}:${info.port}`);
});
