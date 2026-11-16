# Your Mission Control

A dashboard on your own computer for projects, calendars, notes, recipes,
health, money and things to watch. Each installation has its own records and
connections. No account or credential from the person who shared it is included.

## Start with your agent

If you are reading this on GitHub, open **Releases** and download
**mission-control-pilot.zip** from the newest pilot release. Your local agent can
download and extract it for you. Read the release notes for platform test status.

Extract the ZIP into a permanent folder in your own user account. Avoid a shared
or cloud-synced folder because it will hold personal records and credentials.
Open that folder in a local Codex or Claude Code session and say:

> Read AGENTS.md and docs/SETUP.md. Help me set up my own dashboard. Ask me one
> simple question at a time, do the technical work, and show me how to use it.

Your agent needs permission to run commands on this computer. A chat running only
in a remote cloud workspace will not automatically reach this installation.
Use your own agent account. Anything you send to the agent is subject to that
provider's privacy settings; local dashboard storage does not make AI chat offline.

## What you will do

Choose your name and shortcuts, decide which connections you want, and sign into
your own accounts when asked. All connections are optional. You can use local
calendar events, projects, recipes, notes and manual logging without API keys.

After setup, open http://127.0.0.1:4747. Keep the server running while you use it.
On Windows, double-click **Start Mission Control.cmd**. On Mac, your agent can
make **Start Mission Control.command** executable. The terminal stays open;
closing it stops the dashboard. Linux also has an optional login service.

## Everyday use

Use the dashboard's Add and Edit buttons, or message the agent in this project:

- “Add a task to book the car service.”
- “Save this recipe.”
- “Put lunch with Alex on my dashboard calendar tomorrow at 1.”
- “Here is my workout history screenshot. Please log it.”

Ask for Google explicitly when you want an event sent there. Your agent should
read back each save and ask before replacing conflicting information.
For logging from another project, ask your agent to load this installation's
AGENTS.md and run its logging command from this folder.

The time zone follows this computer. Health uses kilograms. Work currently offers
Software task and Film & TV templates. Money supports AU/US records and AUD/USD;
it is not a general international tax tool. Sidebar choices hide shortcuts,
not records; all areas remain reachable through Search.

Read docs/SETUP.md for installation, connections, updates and backups.
