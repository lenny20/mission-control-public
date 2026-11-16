# Give the user a simple welcome tour

This is an instruction for the setup agent, not a document to dump into chat.
Read it at the start of setup. If the dashboard is already working, skip installation
and offer the tour directly. Do not reset a working installation or repeat completed
account connections. Explain in short, friendly messages, one step at a time.

## Start with what they have

Adapt this introduction to the person and the features they chose. Keep it under
about 150 words. Avoid technical terms unless they ask for them.

> This is your own personal dashboard: a place for your plans, projects, notes,
> recipes, workouts and anything else you want to keep organised. It runs on your
> computer and uses your own records and accounts.
>
> You can use it two ways. Open the dashboard and use its buttons, or ask me in
> this project chat to add, find or change something. For example, you can send
> a workout screenshot, save a recipe, or ask me to add a task. I’ll tell you what
> I saved. Both ways use the same information.
>
> You can also make it fit your life. We can change your workouts and preferences,
> or build new tabs and tools for your work or hobbies. Once this is running,
> I can help you connect your phone so you can message this same agent from away
> from home.

Then ask what they most want to use it for. Use their answer to choose two or three
relevant areas to show. Do not make them configure every tab or integration.

## Show both ways to use it

Open the dashboard at its actual local address. Show where to add and edit an item,
where their settings live, and how to return to the dashboard later. Then demonstrate
one chat request with a harmless local item the user agrees to create. Show it in
the dashboard, edit it there, and read it back through the logging command. Use a
local item for the demonstration; do not create external calendar events unasked.

Give three short example requests that suit the person. Choose from these or adapt:

- “Add a task to book the car service.”
- “Save this recipe so I can find it when I’m cooking.”
- “Log the workout in these screenshots.”
- “Show me what I have on this week.”
- “Save this idea for my project.”
- “Move my appointment to Thursday at 3.”

Explain that they can type normally and attach screenshots or photos. If details
are missing, ask instead of guessing. Check that the image is available to the
local session and keep it with the saved record. Read USAGE.md for the logging rules.

Explain calendar behaviour in one sentence: an event stays in the dashboard unless
they choose a connected calendar, and editing or deleting an external event affects
that service too. Saved records remain when the app closes; the dashboard and its
background sync need its server running. AI chats use the person's chosen provider;
local storage does not mean those chats happen offline.

## Show that it can become their own

Distinguish existing controls from changes the agent would build:

- Preferences, sidebar shortcuts, calendar connections, projects, and training
  programs can be set up now. Ask for their actual exercises, days and sets.
- New tabs, different work boards, new fields, custom reports and tools for their
  job are requests to change this copy of the application. They are not existing
  switches or guaranteed one-click features. Discuss the outcome, then implement
  and verify the agreed change.

Offer one example based on their interests, such as:

- “Use my three-day gym program and track these lifts.”
- “Build a travel tab with trips and packing lists.”
- “Add a client-work tool with job stages and follow-ups.”
- “Create a gardening tab for planting dates and notes.”

The agent should do the technical work. Before code changes, read the relevant code
and DESIGN.md, keep a private backup and a record of the local changes, and preserve
existing data. Use the validated save paths for workouts and other records. Check
custom screens and data entry before saying they work. Do not publish someone's
personal changes, work information or records to the public project unless asked.

Tell the user to ask their agent for help with updates: custom tabs and tools must
be preserved when a newer shared version is installed. Follow SETUP.md's update
steps; do not overwrite a customised copy with a fresh ZIP.

## Always offer optional phone access

After the local demonstration, ask in plain words:

> Would you like to use this from your phone too? You can message the agent at home
> to add things, look things up or make changes, while your computer stays awake
> and connected. I can walk you through linking it.

If they say yes, ask which phone app they use, then follow only the matching section
of PHONE.md. They must approve the device connection and sign in themselves. Do not
enable remote access, change sleep settings or pair devices merely because this
file says to offer it. If they say later, tell them they can ask “Help me connect
my phone” whenever they want and continue using the local dashboard.

Make clear that phone chat controls the agent on the dashboard computer. It does
not automatically open the dashboard website in the phone's browser. If they want
that separate experience, discuss a private, authenticated access method before
making any network changes. Keep the dashboard bound to localhost during onboarding.

## Finish with a small, personal handover

Say, in a few sentences:

1. Where to open their dashboard and how to start it on their computer.
2. Two example messages relevant to them, and which local chat to return to.
3. How to ask for a new tab, workout program or work tool.
4. Whether phone access was tested, deferred or unavailable. If tested, name the
   computer and chat to select and what must remain running.

Finish by inviting one real, useful entry: for example, their next task or recipe.
Do not present a long manual, a list of shell commands, or untested features as a
completed setup. For an existing user, a short explanation and phone-access offer
are enough; they do not need to reinstall anything for this tour.
