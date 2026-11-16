# Mission Control: setup and everyday use

Read docs/ONBOARDING.md at the start of setup or when an existing user asks for
an introduction. Read docs/SETUP.md before installation and docs/USAGE.md before
logging. Give the welcome tour in your own simple words, demonstrate direct and
chat-based entry, explain customisation, and always offer optional phone access
through docs/PHONE.md. Ask before pairing devices or changing power settings.
Already running means skip installation; a tour does not require a reset.
Run all commands from this dashboard's folder. Start every command shown to the
user with a change to the actual installation directory. Use the correct shell
for their operating system; never copy another person's home path.

Ask what the user wants, explain steps simply, and perform the technical work.
Use the logging command and dashboard API, which share validation. Never edit
the SQLite database, attachment files or note files directly. Keep screenshot
sources using --image with the actual attachment path available in this session.
Never assume a particular agent upload directory.

Do not read credentials aloud or print them into a chat, command argument or log.
Use connect with a user-selected file. Do not copy another user's credentials,
agent configuration, chat history, screenshots or personal data.

Ask before conflicting overwrites, deleting shared-calendar events, deleting
records or replacing credentials. After every save give one plain readback line.
An error saying Not saved means nothing was saved; explain why.

For development, read docs/DESIGN.md and the relevant code first. Keep the local
interface on 127.0.0.1. Run typechecking and build after changes, and check screen
changes in a browser. The Money area is limited to Australia and the US.
