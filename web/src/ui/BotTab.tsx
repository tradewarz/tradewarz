// The Bot tab: what you land on. Your bots readable as sentences, on/off, the numbers you
// change most, and the live panel showing what the bot is doing and why.

import { useState } from 'preact/hooks';
import { CHAINS, PRESET_NAMES, describeStrategy, preset, presetBlurb, type Chain, type HubInfo, type PresetName, type SessionUser, type StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { botFor } from '../engine/bot.js';
import { BotPanel } from './BotPanel.jsx';
import { Builder } from './Builder.jsx';
import { CHAIN_LABEL } from './helpers.js';
import { Numbers } from './Numbers.jsx';
import { PickBot } from './Onboarding.jsx';
import { toast } from './toast.js';

export function BotTab({ me, strategies, onStrategies, onTerminal }: { me: SessionUser; info: HubInfo; strategies: StrategyRecord[]; onStrategies: (s: StrategyRecord[]) => void; onTerminal?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<Chain | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const hasBot = (c: Chain) => me.wallets.some((w) => w.role === 'bot' && w.chain === c);
  const chains: Chain[] = [...CHAINS];
  const missing = chains.filter((c) => !strategies.some((s) => s.chain === c));

  const toggle = async (r: StrategyRecord) => {
    setBusy(r.id);
    try { onStrategies((await api.setActive(r.id, !r.active)).strategies); toast(r.active ? `${r.strategy.name} is off` : `${r.strategy.name} is on`); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); }
  };
  const changePreset = async (r: StrategyRecord, p: PresetName) => {
    setBusy(r.id);
    try { await api.saveStrategy(preset(p, r.chain), r.id); onStrategies((await api.strategies()).strategies); toast(`Switched to ${p[0]!.toUpperCase() + p.slice(1)}`); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); }
  };
  const remove = async (r: StrategyRecord) => {
    if (!confirm(`Delete the ${CHAIN_LABEL[r.chain]} bot "${r.strategy.name}"?`)) return;
    setBusy(r.id);
    try { await api.deleteStrategy(r.id); onStrategies((await api.strategies()).strategies); } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); }
  };
  const saved = async (r: StrategyRecord) => {
    onStrategies(strategies.map((s) => (s.id === r.id ? r : s))); // show it at once
    if (r.active) botFor(r.chain).updateStrategy(r.strategy);
    try { onStrategies((await api.strategies()).strategies); } catch { /* the optimistic copy stands */ }
  };

  const buildingRecord = building ? strategies.find((s) => s.id === building) ?? null : null;
  if (buildingRecord) {
    return <Builder record={buildingRecord} onSaved={(r) => { void saved(r); }} onClose={() => setBuilding(null)} />;
  }
  if (adding) {
    return (
      <div>
        <p class="muted small"><a href="#" onClick={(e) => { e.preventDefault(); setAdding(null); }}>← Back to your bots</a></p>
        <PickBot me={me} defaultChain={adding} onDone={(list) => { onStrategies(list); setAdding(null); }} onSkip={() => setAdding(null)} />
      </div>
    );
  }

  return (
    <div class="stack" style="gap:20px">
      {strategies.length === 0 && <div class="notice">No bots yet. Add one below; it takes ten seconds.</div>}
      {chains.map((chain) => strategies.filter((s) => s.chain === chain).map((r) => {
        const currentPreset = PRESET_NAMES.find((p) => p[0]!.toUpperCase() + p.slice(1) === r.strategy.name) ?? null;
        const sentences = describeStrategy(r.strategy);
        return (
          <section class="card" key={r.id}>
            <h2>
              {CHAIN_LABEL[chain]} bot
              <span class={`pill ${r.active ? 'ok' : ''}`}>{r.active ? 'on' : 'off'}</span>
            </h2>
            <div class="botbar">
              <label class="muted small">Preset&nbsp;
                <select class="input sm" disabled={busy === r.id} value={currentPreset ?? ''} onChange={(e) => changePreset(r, (e.target as HTMLSelectElement).value as PresetName)}>
                  {currentPreset === null && <option value="">Custom</option>}
                  {PRESET_NAMES.map((p) => <option key={p} value={p} title={presetBlurb(p, chain)}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}
                </select>
              </label>
              <button class="btn sm" onClick={() => setEditing(editing === r.id ? null : r.id)}>{editing === r.id ? 'Hide numbers' : 'Edit numbers'}</button>
              <button class="btn sm" onClick={() => setBuilding(r.id)}>Edit all rules</button>
              <span class="spacer" />
              <button class={`btn sm${r.active ? '' : ' primary'}`} disabled={busy === r.id || (!r.active && !hasBot(chain))} onClick={() => toggle(r)}>{r.active ? 'Switch off' : 'Switch on'}</button>
              <button class="btn sm danger" disabled={busy === r.id} onClick={() => remove(r)}>Delete</button>
            </div>
            {!r.active && !hasBot(chain) && <div class="notice" style="margin:10px 0">This bot has no {CHAIN_LABEL[chain]} wallet registered yet. Open the Wallet tab and press "Register with the hub", then switch on.</div>}
            {editing === r.id && <Numbers record={r} onSaved={saved} />}
            <details class="rules" open={!r.active}>
              <summary class="muted small">The rules, in words</summary>
              <div class="sentences" style="margin-top:8px">{sentences.map((t, i) => <div key={i}>{t}</div>)}</div>
            </details>
            <BotPanel chain={chain} active={r.active} onTerminal={onTerminal} />
          </section>
        );
      }))}
      {missing.length > 0 && (
        <div class="btnrow">
          {missing.map((c) => <button key={c} class="btn" onClick={() => setAdding(c)}>Add a {CHAIN_LABEL[c]} bot</button>)}
        </div>
      )}
    </div>
  );
}
