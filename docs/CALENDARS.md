# Connect your calendars

Each connection belongs to this installation. Open Calendar, choose Add account,
and pick the service that actually stores your calendar. Outlook, Apple Calendar
and Thunderbird can display accounts from other services: the account provider
is what matters here.

## Supported connections

| Service | Connection | Add, edit and delete events |
| --- | --- | --- |
| Google Calendar | Desktop OAuth sign-in | Yes; new events go to the primary calendar |
| Outlook.com and Microsoft 365 / Exchange Online | Microsoft desktop OAuth and Graph | Yes, subject to account permissions |
| Apple iCloud | CalDAV with an app-specific password | Yes, on writable calendars |
| Yahoo Calendar | CalDAV with an app password | Yes, on writable calendars |
| Fastmail | CalDAV with an app password | Yes, on writable calendars |
| Nextcloud and other CalDAV services | Their HTTPS CalDAV address and credentials | Yes, when the server grants write access |
| iCalendar / ICS subscription links | HTTPS or webcal link | Read-only; edit in the original calendar |

Accounts sync separately. A failed account keeps its cached events and does not
stop other accounts syncing. New events save locally unless you explicitly choose
a destination under Save to. Shared-calendar and invited-event deletions require
confirmation. A change to a repeating event applies to that occurrence only.
Disconnect removes the local connection and cache, not the original service's events.

This version includes automated provider and recurrence checks. New Microsoft,
iCloud, Yahoo and Fastmail accounts still need owner-led real-account trials.
It does not connect to an on-premises Exchange server through EWS, or to calendars
stored only on a device. Providers without a supported writable interface can
only be connected if they supply a subscription link.

## Google

Follow the Google section of SETUP.md. Your own desktop client file is required.
Then use Add account, Google Calendar, Sign in with Google. Existing installations
keep their Google connection and event history. The logging shorthand google:true
continues to choose that account's primary calendar.

## Outlook.com and Microsoft 365

Ask the agent to guide you through registering your own app in Microsoft Entra.
You need access to a directory where app registration is allowed; an employer may
require an administrator. Use the supported account types that match who will
sign in (personal accounts, work/school accounts, or both).

Configure a public desktop client, not a web app requiring a client secret. Register
this exact redirect URI for the default dashboard port:

    http://127.0.0.1:4747/api/microsoft/callback

For HTTP with 127.0.0.1, Microsoft currently requires editing the app manifest
rather than using the portal's redirect-URI text box. Follow its current guidance:
https://learn.microsoft.com/en-us/entra/identity-platform/reply-url
Use the actual port if MC_PORT differs. Never expose this callback to the internet.

Use delegated permissions Calendars.ReadWrite and User.Read, with offline_access
for renewal. For a work/school connection that needs shared calendars, also use
Calendars.ReadWrite.Shared and choose the Work or school account type in the form.
Personal Outlook.com accounts do not use that organisation-only permission.
The application uses Microsoft's authentication library with state and PKCE.

In Calendar, Add account, choose Outlook / Microsoft 365. Enter the Application
(client) ID and the account type, then Save and sign in. Complete Microsoft's
sign-in and consent yourself. Do not supply a client secret or your account password
to the dashboard or chat. Each additional Microsoft account gets a separate connection.
If reconnecting, use the same account; add a new connection to use a different one.

Official references:
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/graph/permissions-reference

## Apple iCloud

Enable two-factor authentication for your Apple Account, then generate an
app-specific password in its account settings. In Calendar, Add account, select
Apple iCloud and enter your Apple Account email and that app-specific password.
Do not use your normal Apple password and do not paste the app password into chat.
The dashboard discovers your iCloud calendars using https://caldav.icloud.com.

Apple's instructions: https://support.apple.com/en-us/102654

## Yahoo and Fastmail

Generate an app password for your account. Choose Yahoo Calendar or Fastmail in
Add account, then enter your full account username and app password yourself.
The standard server address is supplied automatically.

- Yahoo: https://help.yahoo.com/kb/sync-access-calendar-multiple-devices-applications-sln4707.html
- Fastmail: https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports

## Other CalDAV accounts

Choose CalDAV and use the HTTPS server address provided by your service, plus its
username and app password. Self-hosted servers need a valid HTTPS certificate.
Use the final server hostname if the server moves between hostnames: credentials
are not forwarded to arbitrary other hosts. iCloud's own server subdomains are
handled by the dedicated iCloud connection.

The server must provide calendar write privileges and event revision tags (ETags)
for editing. If these are missing, the dashboard refuses unsafe writes. Calendars
containing RECURRENCE-ID;RANGE=THISANDFUTURE rules currently keep their last cached
state and report the unsupported rule. Edit those series in the provider's app.
The dashboard does not silently change the entire series or discard its rule.

## Subscription links

Choose Calendar subscription and paste the HTTPS or webcal subscription URL into
the dashboard, not chat. A private link can grant access to calendar details; it
is stored alongside credentials and never included in connection readbacks.
You do not need to make a private calendar public to use an existing authorised
subscription link. A static exported file is not a live subscription URL.

Subscriptions refresh while the dashboard runs and cannot receive edits. Use a
full account connection when you want two-way sync.

## Agent commands

Run from the actual installation folder. Replace INSTALL_FOLDER with that path.

    cd INSTALL_FOLDER && npm run log -- calendars
    cd INSTALL_FOLDER && npm run log -- calendar-sync

Use calendarId from the calendars readback on event or event-edit to choose a
writable destination. Omit it for dashboard-only events. Existing external events
stay in their current account; moving between accounts is not supported.

An agent can import a private connection JSON file with calendar-connect <file>.
The JSON uses provider and label, plus these fields:

- microsoft: clientId; optional tenant (common, consumers, organizations or a tenant GUID).
- icloud, yahoo, fastmail: username and password (the app password).
- caldav: url, username and password.
- ics: url.

Never print the file's contents or pass passwords in shell arguments. Prefer the
on-screen form for passwords and subscription links. After asking the user,
calendar-disconnect <id> --confirm removes the local connection only.

Configuration and Microsoft token caches are under data/calendars/ with private
file permissions. These files belong in private backups, never in Git, support
attachments or shared releases. Connection status reports do not return passwords,
refresh tokens or subscription URLs.
