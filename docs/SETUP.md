# Agent-guided setup

Work in the extracted dashboard folder. Ask one question at a time and do the
technical steps yourself. Start with the operating system and what the person
wants to use. Do not require every integration to finish setup.

## 1. Install and verify

Check Node with `node --version`. Use Node.js 24 or newer from https://nodejs.org/.
If missing, guide the user through installing the supported release for their OS;
then open a new terminal. Git is optional, but document search uses it to respect
ignored files inside Git repositories.

The commands below use INSTALL_FOLDER as a placeholder. Replace it with the
actual folder before running or showing a command. On Windows use PowerShell 7
or Command Prompt for &&; in Windows PowerShell 5.1 use Set-Location followed by
the command on the next line.

```text
cd INSTALL_FOLDER && node scripts/setup.mjs
cd INSTALL_FOLDER && npm start
```

Setup installs locked dependencies, builds the page, and checks local configuration.
It can be rerun without resetting records. The server uses http://127.0.0.1:4747.
If the port is occupied, inspect the existing process before stopping anything.
MC_PORT can select another port; the browser URL must match it.

Windows: Start Mission Control.cmd runs the server in a visible terminal.
Mac: make Start Mission Control.command executable and launch it, or run npm start.
Linux: npm start works; npm run service:install additionally installs a systemd
user service. The Linux installer is optional and is not for Windows or Mac.
No Windows or Mac login service is installed by this pilot. Use the launcher
when needed. Native Windows and Mac operation still needs a trial on real hardware.

## 2. Personalise

Open Your dashboard in the sidebar. Set the person's name, streaming country and
sidebar shortcuts. Or use profile-set with JSON over stdin: run the logging
command with arguments ['profile-set', '-'] and pass JSON to its standard input.
Set setupComplete to true when the initial choices are saved.

Use the computer's correct local time zone. MC_TIME_ZONE is an advanced override;
set it consistently for both the server and logging commands. MC_DATA_DIR is an
advanced data-directory override with the same requirement. Do not assume .env
files are automatically loaded. The normal install needs neither override.

Training starts with an exercise catalogue and no program. Ask for their program;
use program-set only with the days and exercises they supply. Workouts may be
logged without a program by using day: null.

Document search starts with dashboard notes and tax-vault files only. Ask which
additional folders they want searched. Use Notes, Search, Places searched, or
read/set them with docs-settings. Empty roots means no extra folders. Notes are
in ~/Documents/Mission Control/Notes unless configured otherwise.

## 3. Optional Google Calendar

Use the user's own Google Cloud project and account. Follow Google's current
Desktop app OAuth instructions:
https://developers.google.com/identity/protocols/oauth2/native-app

Enable Google Calendar API in their project, configure consent, and create a
Desktop app OAuth client. Internal consent is only appropriate for a qualifying
Workspace organisation. Personal Gmail accounts need External consent. Review
Google's current personal-use verification rules and any warning with the user.
External apps left in Testing receive calendar refresh tokens that expire after
seven days: https://developers.google.com/identity/protocols/oauth2
Do not promise that verification or organisational policy can be bypassed.

Have the user download the Desktop client JSON. Import it without printing it:

```text
cd INSTALL_FOLDER && npm run log -- connect google PATH_TO_CLIENT_JSON
```

Quote paths containing spaces. Then open Calendar, Connect and let the user sign
in and approve Google's consent screen. The callback is on this same computer.
Confirm the displayed account is theirs and review the calendars they want shown.
New Google events go to their primary calendar. Local-only events remain local.
Do not create or delete an external test event without their agreement.

The saved login lives in data/google/token.json. Never include it in a shared
package. Replacing a Google client requires stopping the server and disconnecting
the previous account first; this pilot's import command refuses replacement
while a saved login exists. Ask the user before disconnecting or removing it.

## 4. Optional film details and ratings

TMDB: use the user's own API Read Access Token from their TMDB account settings.
Official instructions: https://developer.themoviedb.org/docs/getting-started
OMDb: an optional API key from https://www.omdbapi.com/apikey.aspx adds ratings.
The user may need to complete account and activation steps themselves.

Ask them to save only the token/key in a local plain text file. Import using
connect tmdb or connect omdb and the file path. Never ask them to paste a key in
chat or a shell command. Protect or remove the source file after import at their
request. Runtime files stay in data/tmdb/token and data/omdb/key.

Changing streaming country clears cached provider availability. Existing titles
get refreshed by the normal watchlist refresh; fresh lookups use the new country.

## 5. Check and teach

Run doctor. It reports file presence, not whether an external provider accepts
a credential. Verify each requested connection in the UI; do not claim it works
from file presence alone. Check that the user's name appears and the records are
empty. With their agreement, create a harmless local card through the logging
command, find it in the dashboard, edit it there, and read it back with card-show.
Explain how to add and correct records through both routes.

Show three examples relevant to what they want. Explain where data lives, how to
start the dashboard, and how to return to this agent/project next time. For phone
logging, arrange an agent session that actually runs on this computer. Do not
expose the dashboard to the internet to make phone chat work.

## Backups and updates

Before updating, stop the dashboard and logging agents. Back up the entire data
folder plus the notes folder and any exports kept outside it. Include SQLite WAL
and SHM files if present. Backups contain credentials and sensitive records: keep
them private, and never send them to the person who supplied the software.
Restore while stopped, to the same configured folders, then start and check.

To update, back up first, replace application files from a reviewed release while
retaining data and notes, and rerun setup. Database migrations run automatically
at startup. If an update fails, keep the backup; do not reset the database or
attempt a rollback using old code against a migrated database.

## Trouble

Run doctor, check Node version, read the actual error, and check whether the server
terminal is still running. Reconnect Google from Calendar if signed out. A hidden
sidebar shortcut remains available through Search. Never fix setup by copying
someone else's data folder or by turning off the local-only network restriction.
