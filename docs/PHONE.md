# Use your dashboard through your phone

You can message the agent that works on your home computer. Ask it to save a recipe,
log a workout, check your week, or change your dashboard. The agent uses the same
installation and records you see at home.

This is phone access to the agent. The dashboard's local web address still points
to the computer where it runs; entering that address on a phone does not open the
home computer's dashboard. Direct browser access from a phone needs a separate
private connection, which this setup does not create.

## Before linking anything

The setup agent should offer this as an option and wait for the user to accept.
Ask which ecosystem and phone they use. Check the current official guide linked
below and the controls actually present in their app. These steps were checked on
17 November 2026; labels, availability and account requirements can change.

Start from the dashboard project and use the existing chat where possible. Keep
using the installation folder and data location already configured. Do not create
a second installation, cloud copy or separate worktree for everyday logging.
Let the user review device access and complete pairing and account verification.
Do not copy keys, passwords or private pairing links into shared instructions.

## ChatGPT / Codex

1. On the dashboard computer, open the ChatGPT desktop app. Find **Settings >
   Connections > Control this Mac or PC** and choose **Set up** or **Add**.
2. Let the user approve access, scan the displayed QR code with their phone, and
   complete pairing with the same ChatGPT account and workspace.
3. On the phone, open **Codex** (or **Remote** in versions using that label),
   select the home computer, and continue the dashboard's project chat.
4. Confirm that the chat is operating on that computer and installation. A new
   cloud task does not automatically have the local dashboard's records.

The documented host setup supports Mac and Windows, with iOS and Android clients.
Check support for other host systems rather than assuming these steps apply.
Availability also depends on rollout and workspace policy. Pairing starts in the
desktop app, not the Codex terminal or editor extension.

Sources: [Mobile setup](https://learn.chatgpt.com/docs/mobile),
[Remote connections](https://learn.chatgpt.com/docs/remote-connections).

## Claude Code

1. In the existing local Claude Code conversation for this dashboard, have the
   user enter `/remote-control` in Claude's prompt and approve the connection.
   This is a Claude command, not a shell command.
2. Use its connection link or QR code, or open **Code** in the Claude phone app
   and select the same session. Use the same Claude account.
3. Confirm that messages reach the local dashboard session. Keep that session
   running on the computer.

If they need to start a local interactive session first, the agent can guide them
through this shell command. Replace INSTALL_FOLDER with their actual folder:

```text
cd INSTALL_FOLDER && claude --remote-control
```

Remote Control requires an eligible Claude subscription and account login; API-key
login alone is insufficient. Organisations may require administrator approval.
Check the official guide if the command or feature is unavailable. Do not change
security policy or switch authentication arrangements without the user's agreement.

Source: [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control).

## What to leave running at home

Keep the computer powered, awake and online. Keep the relevant desktop app or local
Claude Code session running. Keep the dashboard server running for its page and
calendar refreshes; if it stops, the linked agent can help restart it. Do not leave
a laptop expecting remote work to continue while it sleeps. With the user's consent,
help them choose suitable power settings. Never disable the screen lock as a default
setup step. Windows screen-based Computer Use may need an unlocked session; normal
logging should use the dashboard's command rather than screen clicks.

A phone is a way to send instructions to the home session. When that session is
unavailable, say so; do not claim a record was saved remotely. Once the computer
and agent are reachable again, confirm the session and readback before proceeding.

## Prove the connection with one simple check

Ask the user to send from their phone:

> Tell me which computer and dashboard folder you are using, and show my latest
> saved recipe or task without changing it.

Verify the actual host and folder. With their agreement, have them send one harmless
local entry and check that it appears in the same dashboard at home. Read it back.
Test image delivery too if they want to log photos or screenshots; confirm the local
session can access the attachment rather than assuming a fixed upload directory.

Report phone setup as working only after this round trip succeeds. If it is unavailable
or deferred, explain that the desktop dashboard still works and how to try again later.

## If they want the dashboard website on the phone

Treat this as a separate request. Recommend a private, authenticated connection to
the home computer and check compatibility with the dashboard's local Host/Origin
checks before proposing concrete changes. Do not open router ports, publish the
local API, or change its bind address as part of ordinary phone-agent setup.
