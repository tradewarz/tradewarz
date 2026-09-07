// The owner's brake and megaphone: pause buying hub-wide (every tab stops entering; positions stay
// priced and sellable) and post a notice everyone sees. Both live in the hub's settings table and
// reach open tabs on the next heartbeat, within ten seconds. Bots run in browsers, so the pause is
// honoured by the page rather than enforced - but every tab running this code honours it.

import { useState } from 'preact/hooks';
import type { HubControl } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { toast } from './toast.js';

export function ControlPanel({ control, onChange }: { control: HubControl; onChange: (c: HubControl) => void }) {
  const [notice, setNotice] = useState(control.notice);
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<HubControl>) => {
    setBusy(true);
    try { const c = await api.setControl(patch); onChange(c); setNotice(c.notice); toast(c.paused ? 'Buying is paused on every tab' : patch.paused === false ? 'Buying resumed' : 'Notice saved'); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <div class="card control">
      <h2>Controls <span class="muted small">owner only · reaches open tabs within ten seconds</span></h2>
      <div class="btnrow" style="align-items:center">
        <button class={`btn ${control.paused ? 'primary' : 'danger'}`} disabled={busy} onClick={() => { if (control.paused || confirm('Pause buying on every tab? Positions stay priced and can still be sold; nothing new is bought until you resume.')) void save({ paused: !control.paused }); }}>
          {control.paused ? 'Resume buying' : 'Pause all buying'}
        </button>
        <span class={`pill ${control.paused ? 'bad' : 'ok'}`}>{control.paused ? 'PAUSED' : 'trading normally'}</span>
        <span class="muted small">A pause stops every bot from entering and disables Buy everywhere; exits, sells and withdrawals keep working.</span>
      </div>
      <div class="inline" style="margin-top:12px">
        <input class="input" placeholder="Notice shown to everyone (empty = none), e.g. Solana RPC is degraded; sells may be slow." maxLength={240} value={notice} onInput={(e) => setNotice((e.target as HTMLInputElement).value)} />
        <button class="btn" disabled={busy || notice === control.notice} onClick={() => void save({ notice: notice.trim() })}>Save notice</button>
        {control.notice && <button class="btn sm" disabled={busy} onClick={() => void save({ notice: '' })}>Clear</button>}
      </div>
    </div>
  );
}
