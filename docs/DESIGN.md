# Mission Control design

Each person runs a separate local installation. The Node server listens on
127.0.0.1. React is built by Vite. Runtime data is stored in a SQLite database and
attachment directories under data; notes live in the user's notes folder.

The logging command and HTTP API use the same repository functions and shared
validation. They are the supported save paths. Preserve source images, refuse
conflicting duplicate writes, and keep dates as local calendar days.

Profile settings live in the database settings table, accessed through
server/profile.ts. No personal name is a source-code default. Fresh installations
get an exercise catalogue but no training program. Document search is opt-in for
personal folders. Sidebar shortcuts are preferences, not access controls.

Google, TMDB and OMDb are optional. Credentials are local files, never browser
configuration or release assets. Google writes use the connected account's
primary calendar. Shared-event deletions need explicit confirmation.

The pilot retains the task and Film & TV board templates. Money supports only
AU/US and AUD/USD, and health records kilograms. Further customisation should
preserve existing records and avoid rewriting unrelated modules.

Keep the established visual design. Use the common sheets, forms, validation and
snapshot stores. Verify new user behaviour with empty data and updates with
existing data. Check UI changes in a real browser. Windows and Mac require native
validation before making full platform-support claims.
