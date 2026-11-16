# Logging through the agent

From the actual installation directory, run the logging command's help first:
`cd INSTALL_FOLDER && npm run log -- help` (replace INSTALL_FOLDER).
Prefer passing JSON via standard input using '-' as the payload argument to avoid
shell quoting differences on Windows. Use execution APIs with argument arrays.

- Parse dates from the content, not the sending time. Ask about ambiguous dates.
- Preserve screenshot attachments with --image and the actual available file path.
- Read back exactly what the command reports. Never invent missing information.
- Ask before --replace or --confirm. An identical resend may be unchanged.
- Calendar entries are local by default. Use calendars to find destination ids.
  Use calendarId only when requested; google: true still chooses the primary Google calendar.
  Deleting shared or invited events affects other people and always needs approval.
- Gym screenshots must show every set. A best-set summary is not a full workout.
  Match day using program, or use null for an off-program session. Dumbbell kg is
  per dumbbell; pull-up and dip kg is added weight; leg raises use null kg.
- A Macrau recap's large calorie number is eatenKcal, its target is targetKcal,
  and burnedKcal is separate (zero when absent). A labelled weigh-in date takes
  precedence over the recap date. Keep the trend separately. Other food apps need
  their own interpretation; ask about missing or ambiguous fields.
- Project and category names belong to this user. Ask before creating them.
- Recipes retain the supplied ingredients, quantities and method. Do not invent
  nutrition, servings or times. Read a web recipe before saving its source URL.
- Receipts retain their source file. Log GST only when shown. Money currently
  supports AUD/USD and Australian/US years; never invent currency conversions.
- Notes must go through note and note-edit, not direct file edits while open.

Helpful commands: cards, card-show, projects, events, program, show, recipes,
recipe-show, notes, note-show, watchlist, profile and doctor. Inspect help for the
payload and options. Run commands only when the user asks for the relevant action.

When the person asks how this works or what they can customise, use ONBOARDING.md
for a short, personal explanation. Offer PHONE.md when they want phone control.
In a remote session, confirm the host and installation folder before using the
logging command. Keep using the same saved records, not a cloud or worktree copy.
