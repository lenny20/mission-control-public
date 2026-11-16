import { useState } from 'react';
import { AREAS, type Profile } from '../../shared/profile.ts';
import { api } from '../lib/api.ts';
import { profileStore } from '../profile.ts';
import { Sheet } from './Sheet.tsx';
import { TextField } from './fields.tsx';
import { toast } from './toast.tsx';

export function Settings({ profile, connections, onClose }: { profile: Profile; connections: Record<string, boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState(profile);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await profileStore.mutate(() => api.put('/api/profile', { ...draft, setupComplete: true }));
      toast('Your settings are saved.');
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  return <Sheet title={profile.setupComplete ? 'Your dashboard' : 'Make yourself at home'} subtitle="Your own settings, records and connections, on this computer." onClose={onClose}
    footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button></>}>
    <div className="card-form">
      <TextField label="What should we call you?" value={draft.displayName} onChange={(displayName) => setDraft({ ...draft, displayName })} placeholder="Your name" />
      <label className="field"><span>Streaming country</span><input maxLength={2} value={draft.watchRegion} onChange={(e) => setDraft({ ...draft, watchRegion: e.target.value.toUpperCase() })} /><small>Two-letter code: AU, US, GB, NZ, CA… Used for streaming availability.</small></label>
      <fieldset><legend>Sidebar shortcuts</legend><p className="faint small">Choose what appears in the sidebar. All areas remain available through Search.</p>
        {AREAS.map((area) => <label className="check" key={area} style={{ display: 'flex', gap: 10, padding: '6px 0' }}><input type="checkbox" checked={draft.sidebarAreas.includes(area)} onChange={(e) => setDraft({ ...draft, sidebarAreas: e.target.checked ? [...draft.sidebarAreas, area] : draft.sidebarAreas.filter((a) => a !== area) })} />{area === 'watch' ? 'Watchlist' : area[0]!.toUpperCase() + area.slice(1)}</label>)}
      </fieldset>
      <section><h3>Connections</h3><p>Google Calendar: {connections.googleLogin ? 'Signed in' : connections.googleClient ? 'Ready to sign in from Calendar' : 'Not configured'}</p><p>TMDB: {connections.tmdb ? 'Configured' : 'Optional · not configured'}</p><p>OMDb ratings: {connections.omdb ? 'Configured' : 'Optional · not configured'}</p><p className="faint small">Ask your agent to follow docs/SETUP.md to connect your accounts. Sign in yourself and keep credential files on this computer.</p></section>
      <p className="faint small">Set your own training program in Health. Choose document folders in Notes → Search → Places searched. No personal folders are searched by default; dashboard notes and tax documents are included.</p>
      <p className="faint small">Money currently supports Australian and US records in AUD and USD. Work includes task and Film &amp; TV boards.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Sheet>;
}
