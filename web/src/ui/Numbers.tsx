// The first slice of the editor: the numbers people change most, validated by the same
// schema and guardrails as everything else, saved in place.

import { useState } from 'preact/hooks';
import { guardrailViolations, parseStrategy, type Strategy, type StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { NATIVE } from './helpers.js';
import { toast } from './toast.js';

type Field = { key: string; label: string; get: (s: Strategy) => number | null; set: (s: Strategy, v: number | null) => void; unit?: string; nullable?: boolean; step?: number };

const fields = (s: Strategy): Field[] => [
  { key: 'size', label: 'Per trade', unit: NATIVE[s.chain], step: 0.001, get: (x) => x.entry.sizeNative, set: (x, v) => { x.entry.sizeNative = v ?? 0; } },
  { key: 'maxOpen', label: 'Max open', step: 1, get: (x) => x.entry.maxOpenPositions, set: (x, v) => { x.entry.maxOpenPositions = Math.round(v ?? 1); } },
  { key: 'budget', label: 'Daily budget', unit: NATIVE[s.chain], step: 0.01, get: (x) => x.entry.dailyBudgetNative, set: (x, v) => { x.entry.dailyBudgetNative = v ?? 0; } },
  { key: 'slip', label: 'Slippage', unit: '%', step: 0.5, get: (x) => x.entry.slippagePct, set: (x, v) => { x.entry.slippagePct = v ?? 3; } },
  { key: 'tp', label: 'Take profit', unit: '%', nullable: true, step: 5, get: (x) => x.exits.takeProfitPct, set: (x, v) => { x.exits.takeProfitPct = v; } },
  { key: 'sl', label: 'Stop loss', unit: '%', step: 1, get: (x) => x.exits.stopLossPct, set: (x, v) => { x.exits.stopLossPct = v ?? 25; } },
  { key: 'trail', label: 'Trailing', unit: '% off peak', nullable: true, step: 1, get: (x) => x.exits.trailingPct, set: (x, v) => { x.exits.trailingPct = v; } },
  { key: 'hold', label: 'Max hold', unit: 'min', nullable: true, step: 5, get: (x) => x.exits.maxHoldMinutes, set: (x, v) => { x.exits.maxHoldMinutes = v === null ? null : Math.round(v); } },
  ...(s.chain === 'robinhood' ? [{ key: 'tax', label: 'Opening tax ceiling', unit: '%', step: 0.5, get: (x: Strategy) => x.advanced.pons.maxOpeningTaxBps / 100, set: (x: Strategy, v: number | null) => { x.advanced.pons.maxOpeningTaxBps = Math.round((v ?? 3) * 100); } } as Field] : []),
];

export function Numbers({ record, onSaved }: { record: StrategyRecord; onSaved: (r: StrategyRecord) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields(record.strategy).map((f) => [f.key, f.get(record.strategy) === null ? '' : String(f.get(record.strategy))])));
  const [busy, setBusy] = useState(false);
  const fs = fields(record.strategy);

  const build = (): { ok: true; strategy: Strategy } | { ok: false; problems: string[] } => {
    const next = structuredClone(record.strategy) as Strategy;
    for (const f of fs) {
      const raw = (draft[f.key] ?? '').trim();
      if (raw === '') { if (f.nullable) { f.set(next, null); continue; } return { ok: false, problems: [`${f.label} needs a number`] }; }
      const n = Number(raw);
      if (!Number.isFinite(n)) return { ok: false, problems: [`${f.label}: "${raw}" is not a number`] };
      f.set(next, n);
    }
    const parsed = parseStrategy(next);
    if (!parsed.ok) return parsed;
    const v = guardrailViolations(parsed.strategy);
    if (v.length) return { ok: false, problems: v.map((x) => x.message) };
    return { ok: true, strategy: parsed.strategy };
  };
  const result = build();

  const save = async () => {
    if (!result.ok) return;
    setBusy(true);
    try { const r = await api.saveStrategy(result.strategy, record.id); onSaved(r.strategy); toast('Numbers saved; the bot uses them from the next launch'); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };

  return (
    <div class="numbers">
      <div class="grid">
        {fs.map((f) => (
          <label key={f.key} class="num">
            <span class="k">{f.label}</span>
            <span class="inp"><input class="input sm" inputMode="decimal" step={f.step} value={draft[f.key] ?? ''} placeholder={f.nullable ? 'off' : ''} onInput={(e) => setDraft({ ...draft, [f.key]: (e.target as HTMLInputElement).value })} />{f.unit && <span class="unit">{f.unit}</span>}</span>
          </label>
        ))}
      </div>
      {!result.ok && <div class="notice bad small" style="margin-top:8px">{result.problems.join(' ')}</div>}
      <div class="btnrow" style="margin-top:8px"><button class="btn sm primary" disabled={busy || !result.ok} onClick={save}>{busy ? 'Saving…' : 'Save numbers'}</button><span class="muted small">Leave take profit, trailing or max hold empty to turn that exit off. The stop loss and the rug exit can never be turned off.</span></div>
    </div>
  );
}
