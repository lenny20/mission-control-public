import { createPortal } from 'react-dom';
import { useState } from 'react';
import { PROVIDER_LABELS, type ProviderKind } from '../../shared/calendar/connections.ts';
import type { CalendarStatus } from '../../shared/calendar/types.ts';
import { api } from '../lib/api.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { confirmAction } from '../ui/confirm.tsx';
import { toast } from '../ui/toast.tsx';
import { calMutate, requestSync } from './store.ts';

export function CalendarConnections({ status }: { status: CalendarStatus }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { await requestSync(true); } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return <section className="calendar-connections" aria-label="Calendar accounts">
    <div className="section-head"><h3>Calendar accounts</h3><button className="link-btn" onClick={() => setAdding(true)}>Add account</button></div>
    {(status.connections ?? []).filter((c) => c.configured || c.connected).map((c) => <div className="calendar-account" key={c.id}>
      <strong>{c.label}</strong><span className="faint small">{PROVIDER_LABELS[c.provider]}{c.provider === 'ics' ? ' · Read-only' : ''}</span>
      <p className={c.error ? 'bad small' : 'faint small'}>{c.error || (c.lastSync ? `Synced ${new Date(c.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : c.connected ? 'Ready to sync' : 'Sign-in needed')}</p>
      <div className="calendar-account-actions">
        {c.provider === 'google' || c.provider === 'microsoft' ? <a className="link-btn" href={c.provider === 'google' ? '/api/google/connect' : `/api/microsoft/connect/${c.id}`}>{c.connected ? 'Reconnect' : 'Sign in'}</a> : null}
        <button className="link-btn" onClick={async () => {
          if (!await confirmAction({ title: `Disconnect ${c.label}?`, body: 'Removes this connection and its cached events from this dashboard. Events on the original service are kept.' })) return;
          try { await calMutate(() => api.del(`/api/calendar/connections/${c.id}?confirmed=1`)); } catch (e) { toast((e as Error).message, 'error'); }
        }}>Disconnect</button>
      </div>
    </div>)}
    {!status.connected && <p className="faint small">Use local events, or connect Google, Outlook, iCloud, Yahoo, Fastmail or another calendar.</p>}
    {status.error && <p className="bad small" role="status">{status.error}</p>}
    <button className="link-btn" disabled={busy || !status.connected} onClick={refresh}>{busy ? 'Syncing…' : 'Sync now'}</button>
    {adding && createPortal(<AddConnection status={status} onClose={() => setAdding(false)} />, document.querySelector('.shell') ?? document.body)}
  </section>;
}

function AddConnection({ status, onClose }: { status: CalendarStatus; onClose: () => void }) {
  const [provider, setProvider] = useState<ProviderKind>('microsoft');
  const [label, setLabel] = useState('');
  const [clientId, setClientId] = useState('');
  const [tenant, setTenant] = useState('common');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || provider === 'google') return;
    setBusy(true); setError('');
    try {
      const body = { provider, label: label.trim() || PROVIDER_LABELS[provider], ...(provider === 'microsoft' ? { clientId, tenant } : provider === 'ics' ? { url } : { username, password, ...(provider === 'caldav' ? { url } : {}) }) };
      const added = await calMutate(() => api.post<{ id: string }>('/api/calendar/connections', body));
      setPassword(''); setUrl(''); onClose();
      if (provider === 'microsoft') window.location.assign(`/api/microsoft/connect/${added.id}`);
      else void requestSync(true).catch((e: Error) => toast(e.message, 'error'));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const google = status.connections?.find((c) => c.id === 'google');
  return <Sheet title="Connect a calendar" subtitle="Use your own account. Connection details are kept on this computer." onClose={onClose}
    footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>{provider !== 'google' && <button className="btn btn-primary" type="submit" form="calendar-connection" disabled={busy}>{busy ? 'Connecting…' : provider === 'microsoft' ? 'Save and sign in' : 'Connect'}</button>}</>}>
    <form id="calendar-connection" className="card-form" onSubmit={submit}>
      <label className="field"><span>Calendar service</span><select value={provider} onChange={(e) => { setProvider(e.target.value as ProviderKind); setPassword(''); setUrl(''); setError(''); }}>{Object.entries(PROVIDER_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {provider === 'google' ? <>
        <p>Google connects through its own sign-in page.</p>
        {google?.configured ? <a className="btn btn-primary" href="/api/google/connect">Sign in with Google</a> : <p>Ask your agent to follow the Google setup guide included with this dashboard. It will help you create and import your own desktop app credentials, then you can sign in here.</p>}
      </> : <>
        <label className="field"><span>Name in this dashboard</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={PROVIDER_LABELS[provider]} maxLength={80} /></label>
        {provider === 'microsoft' ? <>
          <p className="faint small">Ask your agent to register a Microsoft desktop app for this dashboard and provide its Application ID. Sign in yourself on the next screen. No client secret is needed.</p>
          <label className="field"><span>Application ID</span><input value={clientId} onChange={(e) => setClientId(e.target.value.trim())} required /></label>
          <label className="field"><span>Account type</span><select value={tenant} onChange={(e) => setTenant(e.target.value)}><option value="common">Personal or work account</option><option value="consumers">Personal Outlook.com</option><option value="organizations">Work or school, including shared calendars</option></select></label>
        </> : provider === 'ics' ? <>
          <label className="field"><span>Subscription link</span><input type="password" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" required /><small>An HTTPS or webcal iCalendar link. Keep private links out of chat.</small></label>
          <p className="faint small">Subscriptions can be viewed here. Edit their events in the original service.</p>
        </> : <>
          {provider === 'caldav' && <label className="field"><span>CalDAV server address</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.example.com/" required /></label>}
          <label className="field"><span>{provider === 'icloud' ? 'Apple Account email' : 'Username'}</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
          <label className="field"><span>App password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required /><small>{provider === 'icloud' ? 'Generate an app-specific password in your Apple Account settings. Use that instead of your normal Apple password.' : 'Use the app password or credential your calendar service provides for CalDAV.'}</small></label>
        </>}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  </Sheet>;
}
