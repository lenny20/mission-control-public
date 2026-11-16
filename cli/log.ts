import { importConnection } from '../server/calendar/connections.ts';
// The logging command. Claude (or the user) runs this to put data into the
// dashboard; it uses the same checks as the dashboard's own edit screens.
//
//   npm run log -- <command> [payload] [--image <file>] [--replace] [--date YYYY-MM-DD]
//
// Run `npm run log -- help` for the full list.

import { getProfile, saveProfile, doctor, importCredential } from '../server/profile.ts';
import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { addDays, formatLong, isDateStr, today } from '../shared/dates.ts';
import type { CalEvent } from '../shared/calendar/types.ts';
import { belowTarget, cycleState, lastTime } from '../shared/health/metrics.ts';
import type { Exercise, NutritionDay, WeightEntry, Workout } from '../shared/health/types.ts';
import { config, paths } from '../server/config.ts';
import { openDb, type Db } from '../server/db.ts';
import { ConflictError, describeZodError, UserError } from '../server/errors.ts';
import { storeImage } from '../server/files.ts';
import * as calRepo from '../server/calendar/repo.ts';
import { createCalendarService } from '../server/calendar/service.ts';
import * as repo from '../server/health/repo.ts';
import { seedIfEmpty } from '../server/health/seed.ts';
import * as work from '../server/work/repo.ts';
import * as notes from '../server/notes/repo.ts';
import { forgetFile, indexAll, indexFile, openSearch, search as searchDocs } from '../server/docs/search.ts';
import { DOC_KINDS, type DocKind } from '../shared/docs/types.ts';
import * as money from '../server/money/repo.ts';
import { exportTaxYear } from '../server/money/export.ts';
import * as watch from '../server/watch/repo.ts';
import * as recipes from '../server/recipes/repo.ts';
import { filterRecipes, recipeTime } from '../shared/recipes/search.ts';
import type { Recipe } from '../shared/recipes/types.ts';
import { auTaxYear, isTaxYear, money as fmtMoney, taxYearRange } from '../shared/money/tax.ts';
import type { Expense, Income } from '../shared/money/types.ts';
import { formsToFlag } from '../shared/money/flags.ts';
import type { WatchItem } from '../shared/watch/types.ts';
import { BOARD_LABELS, BOARDS, COLUMNS, DONE_CLEARS_AFTER, type Board } from '../shared/work/schemas.ts';
import type { Card } from '../shared/work/types.ts';

const HELP = `Mission Control logging command

Setup
  profile                  Show personal settings (no credentials).
  profile-set <json>       Update displayName, watchRegion, sidebarAreas, setupComplete.
  doctor                   Check local installation and connection file presence.
  connect <kind> <file>    Import your google client JSON, tmdb token or omdb key.
  docs-settings [json]    Read or set document search roots and exclusions.

  recap '<json>'            A Macrau daily recap: nutrition plus the weigh-in it shows.
                            { "date", "eatenKcal", "targetKcal", "burnedKcal",
                              "proteinG", "proteinTargetG", "carbsG", "carbsTargetG",
                              "fatG", "fatTargetG",
                              "weight": { "kg", "labelledDate": null | "YYYY-MM-DD", "macrauTrendKg" } }
  nutrition '<json>'        Nutrition only (same fields as recap, without weight).
  weight '<json>'           { "date", "kg", "note"? }
  workout '<json>'          { "date", "day": 2 | "Back & biceps" | null, "note"?,
                              "exercises": [ { "exercise": "pull ups", "sets": [ { "kg": 0, "reps": 8 } ] } ] }
                            kg is per dumbbell for dumbbells, ADDED weight for pull-ups/dips,
                            and null for reps-only lifts (leg raises). Single-side lifts: reps per side.
  photo <file> ['<json>']   A progress photo. { "date"?, "pose"?: "front"|"side"|"back", "note"? }
                            Date defaults to today.
  skip <day number>         Skip a program day this cycle (use --date for another day).
  next                      The next workout, with last time's numbers.
  show <date>               Everything stored for one day.
  program                   The current program, numbered.
  program-set '<json>'      Replace the program: [ { "id", "name", "exercises": [ { "exercise", "sets" } ] } ].
                            Keep each existing day's id (from the program command) so its history
                            stays linked. A day without an id is new; a day left out is removed.
  exercises                 Every exercise with its aliases.
  exercise '<json>'         Add or update an exercise (aliases are added to existing ones):
                            { "name", "kind": "weighted"|"bodyweight"|"reps",
                              "equipment": "barbell"|"dumbbell"|"smith"|"machine"|"cable"|"bodyweight"|"other",
                              "unilateral"?, "aliases"? }
  delete <what> <key>       what = nutrition|weight (key = date),
                            workout|photo|skip|event|card|project|submission|idea|link|
                            income|expense|vault|watch|recipe (key = id),
                            note (key = file; it moves to the notes folder's .trash).

Calendar
  calendars                 List accounts, calendars and destination ids; never credentials.
  calendar-connect <file>  Import a private JSON file for microsoft, icloud, caldav or ics.
  calendar-disconnect <id> --confirm
                            Disconnect locally. Ask the user first. Remote events are kept.
  event '<json>'            Add an event: { "title", "start", "end"?, "location"?, "notes"?, "google"?, "calendarId"? }
                            start/end are local times "2026-11-10T15:00", or dates "2026-11-10" for
                            all day (end = the last day). end defaults to an hour later, or the same day.
                            "calendarId": an id from calendars chooses a writable destination.
                            "google": true still chooses the main Google calendar. Default: dashboard only.
  event-edit <id> '<json>'  Change an event: any of title, start, end, location, notes;
                            "google": true adds a dashboard-only event to Google. Changes Google too.
  events [date] [days]      Events with their ids, from date (default today) for days (default 7).
  calendar-sync             Pull from Google now.

Work (Film & TV and Software boards)
  card '<json>'             Add a card: { "board": "film"|"software", "title", "column"?, "top"?,
                              "notes"?, "due"?, "links"?: [{ "label"?, "url" }], "focus"? }
                            Either board: "project" (name or id). Software: "kind": "feature"|"bug".
                            Film & TV: "logline", "format": "feature"|"pilot"|"series"|"short",
                              "draft", "draftDate", "nextAction".
                            Goes to the bottom of the board's first column unless "column"/"top" say otherwise.
  card-edit <id> '<json>'   Change any of the fields above (not board or column).
  card-show <id>            One card in full, with its submissions.
  cards [board] [column]    Cards with their ids. Done cards older than two weeks are left out.
  move <id> <column> [pos]  Move a card. pos 1 is the top (the priority); default is the bottom.
  done <id>                 Move a software card to Done.
  focus [id ...]            With ids: exactly these cards in focus (3 at most). Without: list them.
  projects                  Projects with their ids. A project holds cards on either board.
  project '<json>'          Add a project: { "name", "category"? (name or id), "status"?: "active"|"paused" }
  project-edit <id|name> '<json>'
  categories                Categories with their ids. A project takes its category's colour.
  category '<json>'         Add a category: { "name", "colour"?: "#5b8def" }
  category-edit <id|name> '<json>'
  submit <card id> '<json>' Log a submission: { "recipient", "sentOn"?, "followUpOn"?, "notes"? }.
                            sentOn defaults to today, followUpOn to six weeks later.
  submission-edit <id> '<json>'  Record a response: { "response": "Passed", "respondedOn"? }, or fix fields.

Ideas, notes, links and doc search
  idea '<text>'             Capture an idea in the inbox (plain text, or { "text" }).
  ideas [all]               The inbox with ids (all: sorted and archived too).
  idea-sort <id> <where> ['<json>']  where = card { "board", "project"? } | note { "project"? } | archive | inbox
  note '<json>'             A new note: { "title", "body"?, "project"? }. Notes are markdown files.
  notes                     Notes, newest first.
  note-show <file>          One note in full.
  note-edit <file> '<json>' Change { "title"?, "body"?, "project"? }. A new title renames the file.
  link '<json>'             Save a link: { "url", "title"?, "note"?, "project"? }
  links                     Saved links with ids.
  search '<words>' [kind]   Search documents (kind = markdown|text|pdf|word|script).
  docs-reindex              Re-read changed files into the search index now.

Money & tax (amounts in dollars, like 54.99; tax years like 2025-26)
  income '<json>'           Money owed to you: { "payer", "amount", "invoiceDate", "currency"?: "AUD"|"USD",
                              "country"?: "AU"|"US", "dueDate"?, "paidDate"?, "receivedAud"?, "withheld"?,
                              "description"?, "invoiceNumber"?, "project"? (a Film & TV card's title or id) }
  paid <id> ['<json>']      Mark income paid: { "paidDate"? (today), "receivedAud"?, "withheld"? }
  income-edit <id> '<json>' Change any income field.
  expense '<json>' --image <receipt>
                            { "date", "supplier", "amount", "gst"?, "category"?, "currency"?, "description"? }
                            The same supplier, date and amount twice is refused; --replace adds it anyway.
  expense-edit <id> '<json>' [--image <receipt>]
  vault <file> '<json>'     File a tax document: { "title", "country", "taxYear", "type", "issuer"?, "expires"? }
  money [tax year]          The year's totals, what's owed, and forms expiring.
  export-tax <tax year>     The accountant export: spreadsheet, receipts, documents and a zip.

Watchlist
  watch '<title>'           Add a film or series (or { "title", "kind"?: "movie"|"tv", "year"? }).
                            Matched on TMDB when it's set up.
  watchlist [status]        Titles with ids (status = to-watch|watching|watched).
  watched <id> ['<json>']   Mark watched: { "rating"?: 1-5, "note"?: "one line" }
  watch-edit <id> '<json>'  { "status"?, "rating"?, "note"?, "comps"?: [Film & TV card ids] }
  import-weights <file>     One-off import of a Mission Control health.json.

Recipes
  recipe '<json>'           Save { "title", "ingredients": ["200 g rice", ...], "steps": ["Rinse the rice.", ...],
                              "description"?, "servings"?, "prepMinutes"?, "cookMinutes"?, "tags"?: ["dinner"],
                              "notes"?, "sourceUrl"?, "favourite"? }. Keep screenshots with --image.
                            Unknown servings and times stay null. Duplicate names are checked; ask before --replace.
  recipes [words]           Find recipes by name, ingredients, tags or other text; lists ids.
  recipe-show <id>          One recipe in full, including its source.
  recipe-edit <id> '<json>' Change any recipe field. Omitted fields and the source image are kept.
  delete recipe <id>        Delete a recipe.

Options
  --image <file>            Keep this screenshot as the entry's source image.
  --replace                 Overwrite an entry that already exists with different values
                            (for a workout: the one already logged for that date and program day).
  --date YYYY-MM-DD         For skip and photo.
  --confirm                 Deleting an event from a shared Google calendar (one shared with other people) removes it for everyone, so it needs this. Ask the user first.
  Payload can also come on stdin by passing "-".`;

// ------------------------------------------------------------------ helpers

type Args = { command: string; positional: string[]; image: string | null; replace: boolean; confirm: boolean; date: string | null };

function parseArgs(argv: string[]): Args {
  const out: Args = { command: argv[0] ?? 'help', positional: [], image: null, replace: false, confirm: false, date: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--image') out.image = argv[++i] ?? null;
    else if (a === '--replace') out.replace = true;
    else if (a === '--confirm') out.confirm = true;
    else if (a === '--date') out.date = argv[++i] ?? null;
    else out.positional.push(a);
  }
  if (out.date && !isDateStr(out.date)) throw new UserError(`--date must be a real date as YYYY-MM-DD, got ${out.date}`);
  return out;
}

function payload(arg: string | undefined): unknown {
  const text = arg === '-' || arg === undefined ? (process.stdin.isTTY ? '' : readFileSync(0, 'utf8')) : arg;
  if (!text.trim()) throw new UserError('This command needs a JSON payload.');
  try {
    return JSON.parse(text);
  } catch {
    throw new UserError('The payload is not valid JSON.');
  }
}

const n = (v: number | null | undefined, digits = 0) =>
  v == null ? '?' : v.toLocaleString('en-AU', { maximumFractionDigits: digits === 0 ? 2 : digits });

function describeNutrition(d: NutritionDay): string {
  const below = belowTarget(d);
  const parts = [
    `${n(d.eatenKcal)} kcal${d.targetKcal != null ? ` of ${n(d.targetKcal)}` : ''}`,
    d.burnedKcal ? `${n(d.burnedKcal)} burned` : null,
    below != null ? (below >= 0 ? `${n(below)} under target` : `${n(-below)} over target`) : null,
  ].filter(Boolean);
  const macro = (label: string, g: number | null, t: number | null) => (g == null ? null : `${label} ${n(g)}${t != null ? `/${n(t)}` : ''}g`);
  const macros = [macro('protein', d.proteinG, d.proteinTargetG), macro('carbs', d.carbsG, d.carbsTargetG), macro('fat', d.fatG, d.fatTargetG)]
    .filter(Boolean)
    .join(', ');
  return `${parts.join(', ')}${macros ? `; ${macros}` : ''}`;
}

const describeWeight = (w: WeightEntry) => `${n(w.kg, 2)} kg on ${formatLong(w.date)}${w.macrauTrendKg != null ? ` (Macrau trend ${n(w.macrauTrendKg, 2)})` : ''}`;

function describeSets(ex: Exercise, sets: Workout['exercises'][number]['sets']): string {
  const side = ex.unilateral ? ' each side' : '';
  const groups: string[] = [];
  for (const s of sets) {
    const load = ex.kind === 'reps' ? '' : ex.kind === 'bodyweight' ? (s.kg ? `+${n(s.kg)}kg ` : 'BW ') : `${n(s.kg)}kg `;
    groups.push(`${load}×${s.reps}`);
  }
  return groups.join(', ') + side;
}

function resolveDay(db: Db, day: unknown): number | null {
  if (day == null) return null;
  const program = repo.getProgram(db);
  if (typeof day === 'number') {
    const d = program.find((p) => p.position === day);
    if (!d) throw new UserError(`There's no day ${day} in the program (it has ${program.length} days).`);
    return d.id;
  }
  const matches = program.filter((p) => p.name.toLowerCase() === String(day).toLowerCase());
  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) throw new UserError(`More than one day is called "${day}" (days ${matches.map((m) => m.position).join(' and ')}). Use the day number.`);
  throw new UserError(`No program day called "${day}". Use a day number from: npm run log -- program`);
}

// ------------------------------------------------------------------ commands

async function run(db: Db, args: Args): Promise<string> {
  const origin = () => ({ source: 'chat' as const, sourceImage: args.image ? storeImage(args.image, 'sources') : null });
  const mode = args.replace ? 'replace' : 'create';
  const todayStr = today(config.timeZone);
  const exercises = () => new Map(repo.listExercises(db).map((e) => [e.id, e]));

  switch (args.command) {
    case 'calendar-connect': {
      const c = importConnection(args.positional[0] ?? '');
      return `Calendar connection added: ${c.label} (${c.provider}), id ${c.id}. Open Calendar to sign in or sync. Credentials were not displayed.`;
    }
    case 'calendars': return JSON.stringify(calendar(db).status(), null, 2);
    case 'calendar-disconnect': {
      if (!args.confirm) throw new UserError('Ask the user before disconnecting. Then run calendar-disconnect <id> --confirm.');
      await calendar(db).disconnect(args.positional[0] ?? '');
      return 'Calendar disconnected locally. Its events on the original service were not changed.';
    }
    case 'profile': return JSON.stringify(getProfile(db), null, 2);
    case 'profile-set': return `Settings saved: ${JSON.stringify(saveProfile(db, payload(args.positional[0])))}`;
    case 'doctor': return JSON.stringify(doctor(db), null, 2);
    case 'connect': return importCredential(args.positional[0] ?? '', args.positional[1] ?? '', args.replace);
    case 'docs-settings': return JSON.stringify(args.positional.length ? notes.setDocPlaces(db, payload(args.positional[0])) : notes.docPlaces(db), null, 2);
    case 'help':
    case '--help':
      return HELP;

    case 'recap': {
      const r = repo.saveRecap(db, payload(args.positional[0]), origin(), mode);
      const lines = [`Nutrition ${r.nutrition.outcome} for ${formatLong(r.nutrition.day.date)}: ${describeNutrition(r.nutrition.day)}.`];
      if (r.weight && 'weight' in r.weight) lines.push(`Weight ${r.weight.outcome}: ${describeWeight(r.weight.weight)}.`);
      else if (r.weight) lines.push(`Weight not saved: ${r.weight.reason}.`);
      else lines.push('No weight on this recap.');
      return lines.join('\n');
    }

    case 'nutrition': {
      const r = repo.saveNutrition(db, payload(args.positional[0]), origin(), mode);
      return `Nutrition ${r.outcome} for ${formatLong(r.day.date)}: ${describeNutrition(r.day)}.`;
    }

    case 'weight': {
      const r = repo.saveWeight(db, payload(args.positional[0]), origin(), mode);
      return `Weight ${r.outcome}: ${describeWeight(r.weight)}.`;
    }

    case 'workout': {
      const p = payload(args.positional[0]) as { day?: unknown; exercises?: { exercise?: string; exerciseId?: string; sets?: unknown }[] } & Record<string, unknown>;
      if (!Array.isArray(p.exercises)) throw new UserError('A workout needs an "exercises" list.');
      const input = {
        ...p,
        programDayId: resolveDay(db, p.day ?? null),
        exercises: p.exercises.map((e) => ({ exerciseId: repo.resolveExercise(db, String(e.exercise ?? e.exerciseId ?? '')).id, sets: e.sets })),
      };
      delete (input as Record<string, unknown>).day;
      const r = repo.addWorkout(db, input, origin(), mode);
      const exs = exercises();
      const w = r.workout;
      const head = `Workout ${r.outcome} for ${formatLong(w.date)}${w.programDayName ? `, ${w.programDayName}` : ''} (id ${w.id}).`;
      return [head, ...w.exercises.map((e) => `  ${exs.get(e.exerciseId)!.name}: ${describeSets(exs.get(e.exerciseId)!, e.sets)}`)].join('\n');
    }

    case 'photo': {
      const file = args.positional[0];
      if (!file) throw new UserError('Give the photo file: npm run log -- photo <file>');
      const meta = (args.positional[1] ? payload(args.positional[1]) : {}) as Record<string, unknown>;
      const r = repo.addPhoto(db, file, { date: args.date ?? todayStr, ...meta });
      return `Photo ${r.outcome} for ${formatLong(r.photo.date)}${r.photo.pose ? ` (${r.photo.pose})` : ''}, id ${r.photo.id}.`;
    }

    case 'skip': {
      const position = Number(args.positional[0]);
      const id = resolveDay(db, Number.isInteger(position) ? position : args.positional[0]);
      const s = repo.addSkip(db, { date: args.date ?? todayStr, programDayId: id });
      const day = repo.getProgram(db).find((d) => d.id === s.programDayId)!;
      return `Skipped day ${day.position} (${day.name}) on ${formatLong(s.date)}, skip id ${s.id}.\n${describeNext(db)}`;
    }

    case 'next':
      return describeNext(db);

    case 'show': {
      const date = args.positional[0] ?? todayStr;
      if (!isDateStr(date)) throw new UserError('show needs a date as YYYY-MM-DD.');
      const s = repo.snapshot(db, todayStr);
      const exs = exercises();
      const lines = [formatLong(date)];
      const nd = s.nutrition.find((x) => x.date === date);
      lines.push(nd ? `  Nutrition: ${describeNutrition(nd)}` : '  Nutrition: none');
      const wt = s.weights.find((x) => x.date === date);
      lines.push(wt ? `  Weight: ${n(wt.kg, 2)} kg` : '  Weight: none');
      for (const w of s.workouts.filter((x) => x.date === date)) {
        lines.push(`  Workout ${w.id}${w.programDayName ? ` (${w.programDayName})` : ''}:`);
        for (const e of w.exercises) lines.push(`    ${exs.get(e.exerciseId)?.name ?? e.exerciseId}: ${describeSets(exs.get(e.exerciseId)!, e.sets)}`);
      }
      for (const p of s.photos.filter((x) => x.date === date)) lines.push(`  Photo ${p.id}${p.pose ? ` (${p.pose})` : ''}`);
      return lines.join('\n');
    }

    case 'program': {
      const exs = exercises();
      return repo
        .getProgram(db)
        .map((d) => `Day ${d.position}: ${d.name} [id ${d.id}]\n${d.exercises.map((e) => `  ${exs.get(e.exerciseId)?.name} (${e.sets} sets)`).join('\n')}`)
        .join('\n');
    }

    case 'program-set': {
      // Existing days are matched by id (shown by the program command), never by
      // position or name: two days can share a name, and positions shift.
      const p = payload(args.positional[0]);
      if (!Array.isArray(p)) throw new UserError('program-set takes a list of days.');
      const days = (p as { id?: number; name: string; exercises: { exercise?: string; exerciseId?: string; sets?: number }[] }[]).map((d) => ({
        id: d.id,
        name: d.name,
        exercises: (d.exercises ?? []).map((e) => ({ exerciseId: repo.resolveExercise(db, String(e.exercise ?? e.exerciseId ?? '')).id, sets: e.sets ?? 3 })),
      }));
      const known = new Set(repo.getProgram(db).map((d) => d.id));
      const unknown = days.filter((d) => d.id != null && !known.has(d.id));
      if (unknown.length) throw new UserError(`No program day with id ${unknown.map((d) => d.id).join(', ')}. Run the program command for the ids.`);
      repo.setProgram(db, days);
      return `Program saved.\n${run(db, { ...args, command: 'program' })}`;
    }

    case 'exercises':
      return repo
        .listExercises(db)
        .map((e) => `${e.name} [${e.id}] ${e.kind}, ${e.equipment}${e.unilateral ? ', per side' : ''}${e.aliases.length ? `; also: ${e.aliases.join(', ')}` : ''}`)
        .join('\n');

    case 'exercise': {
      // Updating an exercise adds aliases to the ones it has, so names the
      // gym app relies on are never dropped by accident.
      const p = payload(args.positional[0]) as { id?: string; name?: string; aliases?: string[] } & Record<string, unknown>;
      const current = repo.listExercises(db).find((e) => e.id === (p.id ?? repo.slugify(String(p.name ?? ''))));
      const aliases = [...new Set([...(current?.aliases ?? []), ...(p.aliases ?? [])])];
      const e = repo.saveExercise(db, { ...current, ...p, aliases });
      return `Exercise saved: ${e.name} [${e.id}], also known as: ${e.aliases.join(', ') || 'nothing yet'}.`;
    }

    case 'delete': {
      const [what, key] = args.positional;
      if (!what || !key) throw new UserError('delete needs what and which: e.g. delete weight 2026-11-04');
      if (what === 'nutrition') repo.deleteNutrition(db, key);
      else if (what === 'weight') repo.deleteWeight(db, key);
      else if (what === 'workout') repo.deleteWorkout(db, Number(key));
      else if (what === 'photo') repo.deletePhoto(db, Number(key));
      else if (what === 'skip') repo.deleteSkip(db, Number(key));
      else if (what === 'income') return `Deleted income ${key}: ${describeIncome(money.deleteIncome(db, Number(key)))}.`;
      else if (what === 'expense') return `Deleted expense ${key}: ${describeExpense(money.deleteExpense(db, Number(key)))}.`;
      else if (what === 'vault') return `Moved tax document ${key} ("${money.deleteVaultDoc(db, Number(key)).title}") to the vault's .trash.`;
      else if (what === 'watch') return `Took "${watch.deleteItem(db, Number(key)).title}" off the watchlist.`;
      else if (what === 'recipe') return `Deleted recipe ${key}: "${recipes.deleteRecipe(db, idArg(key, 'delete recipe')).title}".`;
      else if (what === 'idea') return `Deleted idea ${key}: "${notes.deleteIdea(db, Number(key)).text.split('\n')[0]}".`;
      else if (what === 'link') return `Deleted link ${key}: ${notes.deleteLink(db, Number(key)).url}.`;
      else if (what === 'note') {
        const n = notes.deleteNote(db, key);
        forgetFile(openSearch(paths.search), notes.noteAbsPath(db, n.file));
        return `Moved note "${n.title}" to the notes folder's .trash.`;
      }
      else if (what === 'card') return `Deleted card ${key}: "${work.deleteCard(db, Number(key)).title}".`;
      else if (what === 'project') return `Deleted project ${key}: ${work.deleteProject(db, Number(key)).name}.`;
      else if (what === 'category') return `Deleted category ${key}: ${work.deleteCategory(db, Number(key)).name}. Its projects are uncategorised now.`;
      else if (what === 'submission') {
        const sub = work.deleteSubmission(db, Number(key));
        return `Deleted submission ${key}: to ${sub.recipient}, sent ${formatLong(sub.sentOn)}.`;
      } else if (what === 'event') {
        const ev = await calendar(db).remove(Number(key), args.confirm);
        return `Deleted event ${key}: ${describeEvent(db, ev)}.`;
      } else throw new UserError(`Can't delete "${what}". Use nutrition, weight, workout, photo, skip, event, card, project, category, submission, idea, link, note, income, expense, vault, watch or recipe.`);
      return `Deleted ${what} ${key}.`;
    }

    case 'import-weights': {
      const file = args.positional[0];
      if (!file) throw new UserError('Give the file: npm run log -- import-weights <health.json>');
      const rows = JSON.parse(readFileSync(file, 'utf8')) as { date: string; weight: number; notes?: string }[];
      const counts = { created: 0, updated: 0, unchanged: 0, conflicts: [] as string[] };
      for (const r of rows) {
        try {
          const res = repo.saveWeight(db, { date: r.date, kg: r.weight, note: r.notes || null }, { source: 'import' });
          counts[res.outcome] += 1;
        } catch (err) {
          if (err instanceof ConflictError) counts.conflicts.push(`${r.date} (file ${r.weight} kg)`);
          else throw err;
        }
      }
      return [
        `Imported ${rows.length} weigh-ins: ${counts.created} new, ${counts.updated} updated, ${counts.unchanged} already there.`,
        counts.conflicts.length ? `Left alone because a different weight was already stored: ${counts.conflicts.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    case 'event': {
      const ev = await calendar(db).create(payload(args.positional[0]), 'chat');
      return `Event added (id ${ev.id}): ${describeEvent(db, ev)}.`;
    }

    case 'event-edit': {
      const id = Number(args.positional[0]);
      if (!Number.isInteger(id) || id <= 0) throw new UserError('event-edit needs the event id first: event-edit 12 \'{"title":"..."}\'');
      const ev = await calendar(db).update(id, payload(args.positional[1]));
      return `Event ${id} saved: ${describeEvent(db, ev)}.`;
    }

    case 'events': {
      const from = args.positional[0] ?? todayStr;
      if (!isDateStr(from)) throw new UserError('events takes a start date as YYYY-MM-DD.');
      const days = Number(args.positional[1] ?? 7);
      if (!Number.isInteger(days) || days < 1 || days > 400) throw new UserError('days is a whole number from 1 to 400.');
      const { events, status } = calendar(db).range(from, addDays(from, days));
      const head = status.connected ? `Calendars: ${status.account}${status.error ? ` (problem: ${status.error})` : ''}` : 'No calendar accounts connected; dashboard events only.';
      return [head, ...events.map((e) => `  [id ${e.id}] ${describeEvent(db, e)}`)].join('\n') + (events.length ? '' : '\n  Nothing on.');
    }

    case 'calendar-sync': {
      const changes = await calendar(db).sync();
      const status = calendar(db).status();
      if (!status.connected) return 'No calendar accounts are connected. Add one from the Calendar screen.';
      return `Pulled from calendar accounts: ${changes} change${changes === 1 ? '' : 's'}. Calendars shown: ${status.calendars.filter((c) => c.shown).map((c) => c.name).join(', ')}.`;
    }

    case 'card': {
      const c = work.createCard(db, withProject(db, payload(args.positional[0])), 'chat', todayStr);
      return `Card added: ${describeCard(db, c)}.`;
    }

    case 'card-edit': {
      const c = work.updateCard(db, idArg(args.positional[0], 'card-edit'), withProject(db, payload(args.positional[1])));
      return `Card saved: ${describeCard(db, c)}.`;
    }

    case 'card-show': {
      const c = work.getCard(db, idArg(args.positional[0], 'card-show'));
      const lines = [describeCard(db, c)];
      if (c.logline) lines.push(`  Logline: ${c.logline}`);
      if (c.notes) lines.push(`  Notes: ${c.notes.replace(/\n/g, '\n    ')}`);
      for (const l of c.links) lines.push(`  Link: ${l.label ? `${l.label} ` : ''}${l.url}`);
      for (const sub of work.listSubmissions(db, c.id)) lines.push(`  ${describeSubmission(sub)}`);
      return lines.join('\n');
    }

    case 'cards': {
      const [board, column] = args.positional;
      if (board && !(BOARDS as readonly string[]).includes(board)) throw new UserError(`The board is ${BOARDS.join(' or ')}.`);
      if (board && column && !(COLUMNS[board as Board] as readonly string[]).includes(column)) throw new UserError(`Columns on that board: ${COLUMNS[board as Board].join(', ')}.`);
      const cutoff = addDays(todayStr, -DONE_CLEARS_AFTER);
      const cards = work.listCards(db).filter((c) => (!board || c.board === board) && (!column || c.column === column) && !(c.doneOn && c.doneOn < cutoff));
      const lines: string[] = [];
      for (const b of BOARDS) {
        if (board && b !== board) continue;
        for (const col of COLUMNS[b]) {
          const inCol = cards.filter((c) => c.board === b && c.column === col);
          if (!inCol.length || (column && col !== column)) continue;
          lines.push(`${BOARD_LABELS[b]} / ${work.columnLabel(col)}`);
          for (const c of inCol) lines.push(`  ${describeCard(db, c, false)}`);
        }
      }
      return lines.join('\n') || 'No cards.';
    }

    case 'move':
    case 'done': {
      const id = idArg(args.positional[0], args.command);
      const column = args.command === 'done' ? 'done' : args.positional[1];
      if (!column) throw new UserError('move needs a column: move 12 doing');
      const card = work.getCard(db, id);
      const pos = args.positional[args.command === 'done' ? 1 : 2];
      let before: number | null = null;
      if (pos != null) {
        const n = Number(pos);
        if (!Number.isInteger(n) || n < 1) throw new UserError('The position is a whole number, 1 for the top.');
        const others = work.listCards(db).filter((c) => c.board === card.board && c.column === column && c.id !== id);
        before = others[n - 1]?.id ?? null;
      }
      const c = work.moveCard(db, id, { column, before }, todayStr);
      return `Moved: ${describeCard(db, c)}.`;
    }

    case 'focus': {
      if (args.positional.length) {
        const cards = work.setFocus(db, args.positional.map((p) => idArg(p, 'focus')));
        return `In focus now:\n${cards.map((c) => `  ${describeCard(db, c, false)}`).join('\n')}`;
      }
      const cards = work.listCards(db).filter((c) => c.focus);
      return cards.length ? `In focus:\n${cards.map((c) => `  ${describeCard(db, c, false)}`).join('\n')}` : 'Nothing in focus.';
    }

    case 'projects': {
      const projects = work.listProjects(db);
      const cards = work.listCards(db);
      return (
        projects.map((p) => `${describeProject(db, p)}; ${cards.filter((c) => c.projectId === p.id && c.column !== 'done').length} open cards`).join('\n') ||
        'No projects yet.'
      );
    }

    case 'project': {
      const p = work.createProject(db, withCategory(db, payload(args.positional[0])));
      return `Project added: ${describeProject(db, p)}.`;
    }

    case 'project-edit': {
      const key = args.positional[0];
      if (!key) throw new UserError('project-edit needs the project id or name first.');
      const p = work.updateProject(db, work.resolveProject(db, key).id, withCategory(db, payload(args.positional[1])));
      return `Project saved: ${describeProject(db, p)}.`;
    }

    case 'categories': {
      const projects = work.listProjects(db);
      return (
        work
          .listCategories(db)
          .map((c) => {
            const names = projects.filter((p) => p.categoryId === c.id).map((p) => p.name);
            return `[category ${c.id}] ${c.name}, ${c.colour}; ${names.length ? names.join(', ') : 'no projects'}`;
          })
          .join('\n') || 'No categories yet.'
      );
    }

    case 'category': {
      const c = work.createCategory(db, payload(args.positional[0]));
      return `Category added: [category ${c.id}] ${c.name}, ${c.colour}.`;
    }

    case 'category-edit': {
      const key = args.positional[0];
      if (!key) throw new UserError('category-edit needs the category id or name first.');
      const c = work.updateCategory(db, work.resolveCategory(db, key).id, payload(args.positional[1]));
      return `Category saved: [category ${c.id}] ${c.name}, ${c.colour}.`;
    }

    case 'submit': {
      const sub = work.addSubmission(db, idArg(args.positional[0], 'submit'), payload(args.positional[1]), todayStr);
      return `Submission logged: ${describeSubmission(sub)}.`;
    }

    case 'submission-edit': {
      const sub = work.updateSubmission(db, idArg(args.positional[0], 'submission-edit'), payload(args.positional[1]), todayStr);
      return `Submission saved: ${describeSubmission(sub)}.`;
    }

    case 'idea': {
      const arg = args.positional.join(' ');
      const raw = arg.trim().startsWith('{') ? payload(arg) : { text: arg || (process.stdin.isTTY ? '' : readFileSync(0, 'utf8')) };
      const idea = notes.addIdea(db, raw, 'chat');
      return `Idea ${idea.id} captured: "${idea.text.split('\n')[0]}". ${notes.listIdeas(db).filter((i) => i.status === 'inbox').length} in the inbox.`;
    }

    case 'ideas': {
      const all = args.positional[0] === 'all';
      const list = notes.listIdeas(db).filter((i) => all || i.status === 'inbox');
      return list.map((i) => `[idea ${i.id}] ${i.text.split('\n')[0]}${i.status === 'inbox' ? '' : ` (${i.status}${i.outcome ? `: ${i.outcome}` : ''})`}`).join('\n') || 'The inbox is empty.';
    }

    case 'idea-sort': {
      const id = idArg(args.positional[0], 'idea-sort');
      const to = args.positional[1];
      // A card's project is a Work project (an id); a note's is free text.
      const raw = args.positional[2] ? payload(args.positional[2]) : {};
      const extra = (to === 'card' ? withProject(db, raw) : raw) as Record<string, unknown>;
      const idea = notes.sortIdea(
        db,
        id,
        { to, ...extra },
        todayStr,
        (title) => {
          const w = watch.addItem(db, { title }, 'chat');
          return { outcome: `watchlist ${w.id}`, link: `#/watch/to-watch/${w.id}` };
        },
        'chat',
      );
      if (idea.outcome?.startsWith('watchlist ')) await watch.matchByTitle(db, Number(idea.outcome.slice(10)), todayStr).catch(() => false);
      if (idea.outcome?.startsWith('note ')) await indexNote(db, idea.outcome.slice(5));
      return `Idea ${id} ${idea.status === 'archived' ? 'archived' : idea.status === 'inbox' ? 'back in the inbox' : `became ${idea.outcome}`}.`;
    }

    case 'note': {
      const n = notes.createNote(db, payload(args.positional[0]));
      await indexNote(db, n.file);
      return `Note saved: "${n.title}"${n.project ? ` (${n.project})` : ''}, file ${n.file} in ${notes.notesDir(db)}.`;
    }

    case 'notes':
      return notes.listNotes(db).map((n) => `${n.file}${n.project ? ` [${n.project}]` : ''}, changed ${formatLong(n.modified.slice(0, 10))}`).join('\n') || 'No notes yet.';

    case 'note-show': {
      const n = notes.readNote(db, args.positional[0] ?? '');
      return `${n.title}${n.project ? ` [${n.project}]` : ''}\n\n${n.body}`;
    }

    case 'note-edit': {
      const before = args.positional[0] ?? '';
      const n = notes.updateNote(db, before, payload(args.positional[1]));
      if (n.file !== before) forgetFile(openSearch(paths.search), notes.noteAbsPath(db, before));
      await indexNote(db, n.file);
      return `Note saved: "${n.title}", file ${n.file}.`;
    }

    case 'link': {
      const l = notes.addLink(db, payload(args.positional[0]));
      return `Link ${l.id} saved: ${l.title ?? l.url}${l.project ? ` (${l.project})` : ''}.`;
    }

    case 'links':
      return notes.listLinks(db).map((l) => `[link ${l.id}] ${l.title ? `${l.title} ` : ''}${l.url}${l.project ? ` [${l.project}]` : ''}`).join('\n') || 'No links yet.';

    case 'search': {
      const [q, kind] = args.positional;
      if (!q) throw new UserError("search needs some words: search 'lock pages'");
      if (kind && !(DOC_KINDS as readonly string[]).includes(kind)) throw new UserError(`kind is one of ${DOC_KINDS.join(', ')}.`);
      const sdb = openSearch(paths.search);
      const hits = searchDocs(sdb, q, (kind as DocKind) ?? null, 15);
      const links = notes.searchLinks(db, q);
      const lines = hits.map((h) => `${h.display}${h.snippet ? `\n    ${h.snippet.replace(/[\u0002\u0003]/g, '').replace(/\s+/g, ' ')}` : ''}`);
      for (const l of links) lines.push(`[link ${l.id}] ${l.title ?? ''} ${l.url}`);
      return lines.join('\n') || 'Nothing found.';
    }

    case 'docs-reindex': {
      const r = await indexAll(openSearch(paths.search), notes.searchPlaces(db));
      return `Search index: ${r.total} files, ${r.read} read, ${r.removed} dropped.`;
    }

    case 'income': {
      const i = money.addIncome(db, withFilmCard(db, payload(args.positional[0])), args.image);
      return `Income ${i.id} saved: ${describeIncome(i)}.`;
    }

    case 'income-edit': {
      const i = money.updateIncome(db, idArg(args.positional[0], 'income-edit'), withFilmCard(db, payload(args.positional[1])), args.image);
      return `Income ${i.id} saved: ${describeIncome(i)}.`;
    }

    case 'paid': {
      const extra = (args.positional[1] ? payload(args.positional[1]) : {}) as Record<string, unknown>;
      const id = idArg(args.positional[0], 'paid');
      const paidDate = (extra.paidDate as string | undefined) ?? args.date ?? todayStr;
      const was = money.getIncome(db, id);
      // Already paid on another day: changing that can move it to another tax year, so it's never silent.
      if (was.paidDate && was.paidDate !== paidDate && !args.replace) {
        throw new ConflictError(`Income ${id} is already marked paid on ${formatLong(was.paidDate)}.`, describeIncome(was));
      }
      const i = money.updateIncome(db, id, { ...extra, paidDate }, args.image);
      return `Income ${i.id} paid: ${describeIncome(i)}.`;
    }

    case 'expense': {
      const e = money.addExpense(db, payload(args.positional[0]), args.image, { allowDuplicate: args.replace });
      return `Expense ${e.id} saved: ${describeExpense(e)}.`;
    }

    case 'expense-edit': {
      const e = money.updateExpense(db, idArg(args.positional[0], 'expense-edit'), payload(args.positional[1]), args.image);
      return `Expense ${e.id} saved: ${describeExpense(e)}.`;
    }

    case 'vault': {
      const file = args.positional[0];
      if (!file) throw new UserError('Give the document: vault <file> \'{"title":...}\'');
      const v = money.addVaultDoc(db, file, payload(args.positional[1]));
      await indexFile(openSearch(paths.search), v.path).catch(() => false);
      return `Filed in the vault (id ${v.id}): ${v.title}, ${v.country} ${v.taxYear}, ${v.type}${v.expires ? `, expires ${formatLong(v.expires)}` : ''}.`;
    }

    case 'money': {
      const fy = args.positional[0] ?? auTaxYear(todayStr);
      if (!isTaxYear('AU', fy)) throw new UserError('Tax years are written like 2025-26.');
      const [from, to] = taxYearRange('AU', fy);
      const inc = money.listIncome(db);
      const received = inc.filter((i) => i.auTaxYear === fy && i.paidDate);
      const owed = inc.filter((i) => !i.paidDate);
      const exp = money.listExpenses(db).filter((e) => e.date >= from && e.date <= to && e.currency === 'AUD');
      const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
      const lines = [
        `Tax year ${fy}`,
        `  Received: ${fmtMoney(sum(received.map((i) => i.receivedAud)))} from ${received.length} payments`,
        `  Expenses: ${fmtMoney(sum(exp.map((e) => e.amount)))} (GST ${fmtMoney(sum(exp.map((e) => e.gst)))}) over ${exp.length} receipts`,
        owed.length ? `Owed now:\n${owed.map((i) => `  [income ${i.id}] ${describeIncome(i)}`).join('\n')}` : 'Nothing owed.',
      ];
      const soon = formsToFlag(money.listVault(db), todayStr);
      if (soon.length) lines.push(`Forms expiring:\n${soon.map((v) => `  ${v.title}, ${formatLong(v.expires!)}`).join('\n')}`);
      return lines.join('\n');
    }

    case 'export-tax': {
      const r = await exportTaxYear(db, args.positional[0] ?? '');
      return `Exported ${r.counts.income} income entries, ${r.counts.expenses} expenses (${r.counts.receipts} receipts) and ${r.counts.documents} documents to ${r.folder}\nZip: ${r.zip}`;
    }

    case 'recipe': {
      const result = recipes.addRecipe(db, payload(args.positional[0]), { source: 'chat', image: args.image, replace: args.replace });
      return `Recipe ${result.outcome}: ${describeRecipe(result.recipe)}.`;
    }

    case 'recipes':
      return filterRecipes(recipes.listRecipes(db), args.positional.join(' ')).map(describeRecipe).join('\n') || 'No recipes found.';

    case 'recipe-show':
      return JSON.stringify(recipes.getRecipe(db, idArg(args.positional[0], 'recipe-show')), null, 2);

    case 'recipe-edit':
      return `Recipe saved: ${describeRecipe(recipes.updateRecipe(db, idArg(args.positional[0], 'recipe-edit'), payload(args.positional[1]), args.image))}.`;

    case 'watch': {
      const arg = args.positional.join(' ');
      const w = await watch.addByName(db, arg.trim().startsWith('{') ? payload(arg) : { title: arg }, 'chat');
      return `Added to the watchlist (id ${w.id}): ${describeWatch(w)}.`;
    }

    case 'watchlist': {
      const status = args.positional[0];
      const items = watch.listItems(db).filter((w) => !status || w.status === status);
      return items.map((w) => `[watch ${w.id}] ${describeWatch(w)}`).join('\n') || 'Nothing on the watchlist.';
    }

    case 'watched': {
      const extra = (args.positional[1] ? payload(args.positional[1]) : {}) as Record<string, unknown>;
      const w = watch.updateItem(db, idArg(args.positional[0], 'watched'), { status: 'watched', ...extra }, todayStr);
      return `Watched: ${describeWatch(w)}.`;
    }

    case 'watch-edit': {
      const id = idArg(args.positional[0], 'watch-edit');
      const p = payload(args.positional[1]) as Record<string, unknown>;
      let w = watch.updateItem(db, id, p, todayStr);
      if ('tmdbId' in p) w = await watch.enrich(db, id).catch(() => w);
      return `Saved: ${describeWatch(w)}.`;
    }

    default:
      throw new UserError(`Unknown command "${args.command}". Run: npm run log -- help`);
  }
}

function describeNext(db: Db): string {
  const s = repo.snapshot(db, today(config.timeZone));
  const { next } = cycleState(s.program, s.workouts, s.skips);
  if (!next) return 'No program set up yet.';
  const exs = new Map(s.exercises.map((e) => [e.id, e]));
  const lines = [`Next: day ${next.position}, ${next.name}`];
  for (const e of next.exercises) {
    const ex = exs.get(e.exerciseId)!;
    const last = lastTime(e.exerciseId, s.workouts);
    lines.push(`  ${ex.name}, ${e.sets} sets${last ? `; last time (${formatLong(last.date)}): ${describeSets(ex, last.sets)}` : ''}`);
  }
  return lines.join('\n');
}

const calendar = (db: Db) => createCalendarService(db, config.timeZone);

/** Chat names a Film & TV project; income wants its card id. */
function withFilmCard(db: Db, p: unknown): unknown {
  if (!p || typeof p !== 'object' || !('project' in p)) return p;
  const { project, ...rest } = p as { project: unknown } & Record<string, unknown>;
  if (project == null) return { ...rest, cardId: null };
  const films = work.listCards(db).filter((c) => c.board === 'film');
  const card = films.find((c) => String(c.id) === String(project) || c.title.toLowerCase() === String(project).toLowerCase());
  if (!card) throw new UserError(`No Film & TV project called "${project}". Projects: ${films.map((c) => c.title).join(', ') || 'none yet'}.`);
  return { ...rest, cardId: card.id };
}

function describeIncome(i: Income): string {
  const state = i.paidDate
    ? `paid ${formatLong(i.paidDate)}${i.withheld ? `, ${fmtMoney(i.withheld, i.currency)} US tax withheld` : ''}${i.receivedAud != null ? `, ${fmtMoney(i.receivedAud)} received` : ''}`
    : `unpaid${i.dueDate ? `, due ${formatLong(i.dueDate)}` : ''}`;
  return `${i.payer} ${fmtMoney(i.amount, i.currency)}${i.description ? ` for ${i.description}` : ''}, invoiced ${formatLong(i.invoiceDate)}, ${state} (tax year ${i.auTaxYear}${i.usTaxYear ? `, US ${i.usTaxYear}` : ''})`;
}

function describeExpense(e: Expense): string {
  return `${e.supplier} ${fmtMoney(e.amount, e.currency)}${e.gst != null ? ` incl. ${fmtMoney(e.gst)} GST` : ''} on ${formatLong(e.date)}, ${e.category}${e.receipt ? ', receipt kept' : ', no receipt'} (tax year ${e.auTaxYear})`;
}

function describeRecipe(r: Recipe): string {
  return `[recipe ${r.id}] "${r.title}", ${[
    r.servings != null ? `${r.servings} serving${r.servings === 1 ? '' : 's'}` : null,
    recipeTime(r), `${r.ingredients.length} ingredients`, `${r.steps.length} steps`,
    r.tags.length ? `tags: ${r.tags.join(', ')}` : null, r.favourite ? 'favourite' : null,
    r.sourceUrl ? 'source link kept' : null, r.sourceImage ? 'source image kept' : null,
  ].filter(Boolean).join(', ')}`;
}

function describeWatch(w: WatchItem): string {
  const bits = [
    w.year,
    w.kind === 'tv' ? 'series' : 'film',
    w.status.replace('-', ' '),
    w.rating ? `${w.rating}/5` : null,
    w.note ? `"${w.note}"` : null,
    w.scores?.imdb != null ? `IMDb ${w.scores.imdb}` : w.scores?.tmdb != null ? `TMDB ${w.scores.tmdb}` : null,
    w.scores?.rottenTomatoes != null ? `Rotten Tomatoes ${w.scores.rottenTomatoes}%` : null,
    w.scores?.metacritic != null ? `Metacritic ${w.scores.metacritic}` : null,
    w.providers?.flatrate.length ? `on ${w.providers.flatrate.join(', ')}` : null,
    w.tmdbId ? null : 'not matched on TMDB',
  ].filter(Boolean);
  return `"${w.title}", ${bits.join(', ')}`;
}

/** A note saved from chat is searchable at once. */
async function indexNote(db: Db, file: string) {
  await indexFile(openSearch(paths.search), notes.noteAbsPath(db, file)).catch(() => false);
}

function idArg(v: string | undefined, command: string): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new UserError(`${command} needs an id number first.`);
  return id;
}

/** Chat names the category; the repo wants its id. */
function withCategory(db: Db, p: unknown): unknown {
  if (!p || typeof p !== 'object' || !('category' in p)) return p;
  const { category, ...rest } = p as { category: unknown } & Record<string, unknown>;
  return { ...rest, categoryId: category == null ? null : work.resolveCategory(db, String(category)).id };
}

function describeProject(db: Db, p: ReturnType<typeof work.listProjects>[number]): string {
  const category = p.categoryId ? work.listCategories(db).find((c) => c.id === p.categoryId)?.name : null;
  return `[project ${p.id}] ${p.name}, ${category ?? 'no category'}, ${p.status}`;
}

/** Chat names the project; the repo wants its id. */
function withProject(db: Db, p: unknown): unknown {
  if (!p || typeof p !== 'object' || !('project' in p)) return p;
  const { project, ...rest } = p as { project: unknown } & Record<string, unknown>;
  return { ...rest, projectId: project == null ? null : work.resolveProject(db, String(project)).id };
}

/** '[card 12] "Fix login", Software / Next, Mission Control, bug, due Tuesday 10 November, in focus' */
function describeCard(db: Db, c: Card, withPlace = true): string {
  const project = c.projectId ? work.listProjects(db).find((p) => p.id === c.projectId)?.name : null;
  const open = c.board === 'film' ? work.listSubmissions(db, c.id).filter((s) => !s.response).at(-1) : undefined;
  const bits = [
    withPlace ? `${BOARD_LABELS[c.board as Board]} / ${work.columnLabel(c.column)}` : null,
    project,
    c.board === 'software' ? c.kind : c.format,
    c.draft ? `${c.draft}${c.draftDate ? ` (${formatLong(c.draftDate)})` : ''}` : null,
    c.nextAction ? `next: ${c.nextAction}` : null,
    open ? `with ${open.recipient} since ${formatLong(open.sentOn)}` : null,
    c.due ? `due ${formatLong(c.due)}` : null,
    c.doneOn ? `done ${formatLong(c.doneOn)}` : null,
    c.focus ? 'in focus' : null,
  ].filter(Boolean);
  return `[card ${c.id}] "${c.title}"${bits.length ? `, ${bits.join(', ')}` : ''}`;
}

function describeSubmission(s: ReturnType<typeof work.listSubmissions>[number]): string {
  const outcome = s.response ? `${s.response}${s.respondedOn ? ` (${formatLong(s.respondedOn)})` : ''}` : `no response yet${s.followUpOn ? `, follow up ${formatLong(s.followUpOn)}` : ''}`;
  return `[submission ${s.id}] to ${s.recipient}, sent ${formatLong(s.sentOn)}: ${outcome}`;
}

/** "Call Sam, Tuesday 10 November 3:00 pm to 4:00 pm, on a shared calendar" */
function describeEvent(db: Db, ev: CalEvent): string {
  const input = calRepo.toInput(ev, config.timeZone);
  const when = ev.allDay
    ? input.end === input.start
      ? `${formatLong(input.start)}, all day`
      : `${formatLong(input.start)} to ${formatLong(input.end)}, all day`
    : `${formatLong(input.start.slice(0, 10))} ${input.start.slice(11)} to ${input.end.slice(0, 10) === input.start.slice(0, 10) ? '' : `${formatLong(input.end.slice(0, 10))} `}${input.end.slice(11)}`;
  const where = ev.calendarId ? `on ${calRepo.getCalendar(db, ev.calendarId)?.name ?? ev.calendarId}` : 'dashboard only';
  return `"${ev.title}", ${when}${ev.location ? `, at ${ev.location}` : ''}, ${where}`;
}

// ------------------------------------------------------------------ main

try {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb(paths.db);
  seedIfEmpty(db);
  console.log(await run(db, args));
} catch (err) {
  if (err instanceof ConflictError) {
    console.error(`Not saved: ${err.message}\nStored now: ${JSON.stringify(err.existing)}\nAsk the user before running the same command again with --replace.`);
    process.exit(2);
  }
  if (err instanceof UserError) {
    // A shared-calendar delete needs the user's confirmation.
    const confirmable = err.status === 409 && process.argv.includes('event');
    console.error(`Not saved: ${err.message}${confirmable ? '\nAsk the user. If they say yes, run the same command again with --confirm.' : ''}`);
    process.exit(confirmable ? 2 : 1);
  }
  if (err instanceof ZodError) {
    console.error(`Not saved: ${describeZodError(err)}`);
    process.exit(1);
  }
  throw err;
}
