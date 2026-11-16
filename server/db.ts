import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Each entry runs once, in order. Never edit a shipped migration; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE nutrition_days (
    date              TEXT PRIMARY KEY,
    eaten_kcal        REAL NOT NULL,
    target_kcal       REAL,
    burned_kcal       REAL NOT NULL DEFAULT 0,
    protein_g         REAL,
    protein_target_g  REAL,
    carbs_g           REAL,
    carbs_target_g    REAL,
    fat_g             REAL,
    fat_target_g      REAL,
    note              TEXT,
    source            TEXT NOT NULL,
    source_image      TEXT,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE weights (
    date              TEXT PRIMARY KEY,
    kg                REAL NOT NULL,
    macrau_trend_kg   REAL,
    note              TEXT,
    source            TEXT NOT NULL,
    source_image      TEXT,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE exercises (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL,
    equipment   TEXT NOT NULL,
    unilateral  INTEGER NOT NULL DEFAULT 0,
    aliases     TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE program_days (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    position  INTEGER NOT NULL,
    name      TEXT NOT NULL
  );

  CREATE TABLE program_exercises (
    day_id       INTEGER NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    exercise_id  TEXT NOT NULL REFERENCES exercises(id),
    sets         INTEGER NOT NULL,
    PRIMARY KEY (day_id, position)
  );

  CREATE TABLE workouts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    date              TEXT NOT NULL,
    program_day_id    INTEGER,
    program_day_name  TEXT,
    note              TEXT,
    source            TEXT NOT NULL,
    source_image      TEXT,
    created_at        TEXT NOT NULL
  );
  CREATE INDEX idx_workouts_date ON workouts(date);

  CREATE TABLE workout_sets (
    workout_id     INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_pos   INTEGER NOT NULL,
    exercise_id    TEXT NOT NULL REFERENCES exercises(id),
    set_pos        INTEGER NOT NULL,
    kg             REAL,
    reps           INTEGER NOT NULL,
    PRIMARY KEY (workout_id, exercise_pos, set_pos)
  );

  CREATE TABLE skips (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,
    program_day_id  INTEGER NOT NULL,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE photos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    file        TEXT NOT NULL,
    pose        TEXT,
    note        TEXT,
    width       INTEGER,
    height      INTEGER,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_photos_date ON photos(date);
  `,
  `
  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  -- Google calendars on the connected account. Only shown ones are pulled.
  CREATE TABLE calendars (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    color     TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    writable  INTEGER NOT NULL DEFAULT 0,
    shown     INTEGER NOT NULL DEFAULT 0,
    position  INTEGER NOT NULL DEFAULT 0
  );

  -- Timed events: start/end are UTC instants. All-day: dates, end exclusive.
  CREATE TABLE events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    all_day             INTEGER NOT NULL,
    start               TEXT NOT NULL,
    end                 TEXT NOT NULL,
    location            TEXT,
    notes               TEXT,
    calendar_id         TEXT,
    google_id           TEXT,
    google_etag         TEXT,
    google_updated      TEXT,
    html_link           TEXT,
    meet_link           TEXT,
    recurring           INTEGER NOT NULL DEFAULT 0,
    source              TEXT NOT NULL,
    synced_at           TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_events_google ON events(calendar_id, google_id) WHERE google_id IS NOT NULL;
  CREATE INDEX idx_events_start ON events(start);
  `,
  `
  -- Google events deleted here, kept a day so a pull already in flight
  -- (in another process) can't bring them back.
  CREATE TABLE deleted_events (
    calendar_id  TEXT NOT NULL,
    google_id    TEXT NOT NULL,
    deleted_at   TEXT NOT NULL,
    PRIMARY KEY (calendar_id, google_id)
  );
  ALTER TABLE events ADD COLUMN has_guests INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Software projects: a tag with a colour. Film & TV cards are projects themselves.
  CREATE TABLE work_projects (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    colour    TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'active',
    position  INTEGER NOT NULL
  );

  CREATE TABLE cards (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    board        TEXT NOT NULL,
    col          TEXT NOT NULL,
    position     INTEGER NOT NULL,
    title        TEXT NOT NULL,
    notes        TEXT,
    links        TEXT NOT NULL DEFAULT '[]',
    due          TEXT,
    focus        INTEGER NOT NULL DEFAULT 0,
    logline      TEXT,
    format       TEXT,
    draft        TEXT,
    draft_date   TEXT,
    next_action  TEXT,
    project_id   INTEGER REFERENCES work_projects(id),
    kind         TEXT NOT NULL DEFAULT 'feature',
    source       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    done_on      TEXT
  );
  CREATE INDEX idx_cards_col ON cards(board, col, position);

  CREATE TABLE submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id       INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    recipient     TEXT NOT NULL,
    sent_on       TEXT NOT NULL,
    follow_up_on  TEXT,
    response      TEXT,
    responded_on  TEXT,
    notes         TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_submissions_card ON submissions(card_id);
  `,
  `
  CREATE TABLE ideas (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    text          TEXT NOT NULL,
    source        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'inbox',
    outcome       TEXT,
    outcome_link  TEXT,
    sorted_at     TEXT
  );

  CREATE TABLE saved_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    url         TEXT NOT NULL,
    title       TEXT,
    note        TEXT,
    project     TEXT,
    created_at  TEXT NOT NULL
  );
  `,
  `
  -- Money is in whole cents.
  CREATE TABLE income (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payer           TEXT NOT NULL,
    description     TEXT,
    card_id         INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    country         TEXT NOT NULL,
    currency        TEXT NOT NULL,
    amount          INTEGER NOT NULL,
    invoice_number  TEXT,
    invoice_date    TEXT NOT NULL,
    due_date        TEXT,
    paid_date       TEXT,
    received_aud    INTEGER,
    withheld        INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT NOT NULL,
    supplier     TEXT NOT NULL,
    description  TEXT,
    currency     TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    gst          INTEGER,
    category     TEXT NOT NULL,
    country      TEXT NOT NULL,
    notes        TEXT,
    receipt      TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX idx_expenses_date ON expenses(date);

  CREATE TABLE vault_docs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    title     TEXT NOT NULL,
    country   TEXT NOT NULL,
    tax_year  TEXT NOT NULL,
    type      TEXT NOT NULL,
    issuer    TEXT,
    expires   TEXT,
    notes     TEXT,
    file      TEXT NOT NULL,
    added_at  TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE watch_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    year          INTEGER,
    tmdb_id       INTEGER,
    poster        TEXT,
    overview      TEXT,
    genres        TEXT NOT NULL DEFAULT '[]',
    runtime       INTEGER,
    seasons       INTEGER,
    status        TEXT NOT NULL DEFAULT 'to-watch',
    rating        INTEGER,
    note          TEXT,
    watched_on    TEXT,
    providers     TEXT,
    providers_at  TEXT,
    source        TEXT NOT NULL,
    added_at      TEXT NOT NULL
  );

  -- A watchlist title tagged as a comparison for a Film & TV project.
  CREATE TABLE watch_comps (
    item_id  INTEGER NOT NULL REFERENCES watch_items(id) ON DELETE CASCADE,
    card_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, card_id)
  );
  `,
  `
  -- The invoice or remittance an income entry was made from.
  ALTER TABLE income ADD COLUMN source_file TEXT;
  `,
  `
  -- Critics' and audiences' scores: TMDB's own, and IMDb, Rotten Tomatoes and
  -- Metacritic through OMDb (scores_at is when OMDb was last asked).
  ALTER TABLE watch_items ADD COLUMN imdb_id TEXT;
  ALTER TABLE watch_items ADD COLUMN scores TEXT;
  ALTER TABLE watch_items ADD COLUMN scores_at TEXT;
  `,
  `
  -- Categories the user names, each with a colour; a project takes its
  -- category's colour. Work projects now hold cards on either board.
  -- (work_projects.colour is no longer read.)
  CREATE TABLE work_categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    colour    TEXT NOT NULL,
    position  INTEGER NOT NULL
  );
  ALTER TABLE work_projects ADD COLUMN category_id INTEGER REFERENCES work_categories(id) ON DELETE SET NULL;
  `,
  `
  CREATE TABLE recipes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    title_key      TEXT NOT NULL UNIQUE,
    description    TEXT,
    servings       REAL,
    prep_minutes   INTEGER,
    cook_minutes   INTEGER,
    ingredients    TEXT NOT NULL,
    steps          TEXT NOT NULL,
    tags           TEXT NOT NULL DEFAULT '[]',
    notes          TEXT,
    source_url     TEXT,
    source_image   TEXT,
    favourite      INTEGER NOT NULL DEFAULT 0,
    source         TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    revision       INTEGER NOT NULL DEFAULT 1
  );
  `,
  `
  -- Keep existing Google ids while isolating additional calendar accounts.
  ALTER TABLE calendars ADD COLUMN connection_id TEXT NOT NULL DEFAULT 'google';
  ALTER TABLE calendars ADD COLUMN remote_id TEXT;
  UPDATE calendars SET remote_id = id;
  ALTER TABLE events ADD COLUMN write_protected INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_calendars_connection ON calendars(connection_id);
  `,
];

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run `fn` atomically. Nested calls join the outer transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
