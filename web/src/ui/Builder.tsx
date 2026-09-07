// The full rules editor: every field in the strategy schema, grouped the way the blueprint
// groups them (Discovery, Safety, Entry, Exits, Advanced, pons). Validated on every keystroke by
// the same schema and guardrails the hub and the bot use; read back as sentences; counted
// against the launches the hub is streaming right now.

import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  ENTRY_STYLES, MAX_COPY_WALLETS, PRESET_NAMES, WINDOWS, WINDOW_LABEL, describeStrategy, evaluate, guardrailViolations, parseStrategy, preset, presetBlurb,
  type Chain, type PresetName, type Range, type Strategy, type StrategyRecord, type Window,
} from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { hubStream } from '../engine/stream.js';
import { CHAIN_LABEL, NATIVE } from './helpers.js';
import { toast } from './toast.js';

type Draft = Strategy;
const clone = <T,>(x: T): T => structuredClone(x);
const num = (v: string): number | null => { const t = v.trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

export type RulesCheck = { ok: boolean; problems: string[]; strategy: Strategy | null };
/** Schema + guardrails over a draft: the same two checks the hub and the bot apply. */
export function checkRules(draft: Strategy): RulesCheck {
  const parsed = parseStrategy(draft);
  if (!parsed.ok) return { ok: false, problems: parsed.problems, strategy: null };
  const v = guardrailViolations(parsed.strategy);
  return v.length ? { ok: false, problems: v.map((x) => x.message), strategy: parsed.strategy } : { ok: true, problems: [], strategy: parsed.strategy };
}

/** Every field, grouped. Controlled: the parent owns the draft. */
export function RulesForm({ draft, onChange }: { draft: Strategy; onChange: (d: Strategy) => void }) {
  const chain = draft.chain;
  const native = NATIVE[chain];
  const set = (fn: (d: Draft) => void) => { const next = clone(draft); fn(next); onChange(next); };
  return (
    <div class="builder-main">
    <Section title="Name">
      <Row label="Bot name"><input class="input" value={draft.name} maxLength={60} onInput={(e) => set((d) => { d.name = (e.target as HTMLInputElement).value; })} /></Row>
    </Section>

    <Section title="Discovery" blurb="Which tokens the bot is allowed to look at.">
      <RangeRow label="Token age" unit="min" r={draft.discovery.ageMinutes} onChange={(r) => set((d) => { d.discovery.ageMinutes = r; })} />
      <RangeRow label="Liquidity" unit="$" r={draft.discovery.liquidityUsd} onChange={(r) => set((d) => { d.discovery.liquidityUsd = r; })} />
      <RangeRow label="Market cap / FDV" unit="$" r={draft.discovery.marketCapUsd} onChange={(r) => set((d) => { d.discovery.marketCapUsd = r; })} />
      {WINDOWS.map((w) => <RangeRow key={'v' + w} label={`Volume, ${WINDOW_LABEL[w]}`} unit="$" r={draft.discovery.volumeUsd[w]} onChange={(r) => set((d) => { d.discovery.volumeUsd[w] = r; })} />)}
      {WINDOWS.map((w) => <RangeRow key={'p' + w} label={`Price change, ${WINDOW_LABEL[w]}`} unit="%" r={draft.discovery.priceChangePct[w]} onChange={(r) => set((d) => { d.discovery.priceChangePct[w] = r; })} />)}
      <Row label="Buys per sell, at least" hint="1.5 means three buys for every two sells">
        <span class="pair"><NumInput value={draft.discovery.buySellRatio.min} onChange={(v) => set((d) => { d.discovery.buySellRatio.min = v; })} /><WindowSelect value={draft.discovery.buySellRatio.window} onChange={(w) => set((d) => { d.discovery.buySellRatio.window = w; })} /></span>
      </Row>
      <Row label="Transactions, at least">
        <span class="pair"><NumInput value={draft.discovery.minTxns.min} onChange={(v) => set((d) => { d.discovery.minTxns.min = v === null ? null : Math.round(v); })} /><WindowSelect value={draft.discovery.minTxns.window} onChange={(w) => set((d) => { d.discovery.minTxns.window = w; })} /></span>
      </Row>
      <Row label="Quote assets" hint="comma-separated, empty = any"><input class="input" value={draft.discovery.quoteSymbols.join(', ')} placeholder={chain === 'solana' ? 'SOL, USDC' : chain === 'bsc' ? 'WBNB, BNB, USDT' : chain === 'base' ? 'WETH, ETH, USDC' : 'ETH'} onInput={(e) => set((d) => { d.discovery.quoteSymbols = splitList((e.target as HTMLInputElement).value); })} /></Row>
      <Row label="Must declare a website or socials"><Toggle value={draft.discovery.requireSocials} onChange={(v) => set((d) => { d.discovery.requireSocials = v; })} /></Row>
      <Row label="Must be boosted on DexScreener"><Toggle value={draft.discovery.requireBoosted} onChange={(v) => set((d) => { d.discovery.requireBoosted = v; })} /></Row>
    </Section>

    <Section title="Safety" blurb="What the bot refuses however good the chart looks.">
      <Row label="Mint authority must be renounced"><Toggle value={draft.safety.requireMintRenounced} onChange={(v) => set((d) => { d.safety.requireMintRenounced = v; })} /></Row>
      <Row label="Freeze authority must be renounced"><Toggle value={draft.safety.requireFreezeRenounced} onChange={(v) => set((d) => { d.safety.requireFreezeRenounced = v; })} /></Row>
      <Row label="Top 10 holders, at most" unit="%"><NumInput value={draft.safety.maxTop10HoldersPct} onChange={(v) => set((d) => { d.safety.maxTop10HoldersPct = v; })} placeholder="off" /></Row>
      <Row label="Liquidity must be burned or locked"><Toggle value={draft.safety.requireLpBurnedOrLocked} onChange={(v) => set((d) => { d.safety.requireLpBurnedOrLocked = v; })} /></Row>
      <Row label="Reject honeypots"><Toggle value={draft.safety.rejectHoneypot} onChange={(v) => set((d) => { d.safety.rejectHoneypot = v; })} /></Row>
      <Row label="Sell tax, at most" unit="%"><NumInput value={draft.safety.maxSellTaxPct} onChange={(v) => set((d) => { d.safety.maxSellTaxPct = v; })} placeholder="off" /></Row>
      <Row label="When a check cannot be done"><select class="input sm" value={draft.safety.onUnknown} onChange={(e) => set((d) => { d.safety.onUnknown = (e.target as HTMLSelectElement).value as 'skip' | 'allow'; })}><option value="skip">skip the token</option><option value="allow">allow it anyway</option></select></Row>
    </Section>

    <Section title="Entry and sizing">
      <Row label="Per trade" unit={native}><NumInput value={draft.entry.sizeNative} onChange={(v) => set((d) => { d.entry.sizeNative = v ?? 0; })} step={0.001} /></Row>
      <Row label="Max open positions"><NumInput value={draft.entry.maxOpenPositions} onChange={(v) => set((d) => { d.entry.maxOpenPositions = Math.round(v ?? 1); })} step={1} /></Row>
      <Row label="Daily budget" unit={native} hint="new entries stop for the UTC day once spent"><NumInput value={draft.entry.dailyBudgetNative} onChange={(v) => set((d) => { d.entry.dailyBudgetNative = v ?? 0; })} step={0.01} /></Row>
      <Row label="Entry style"><select class="input sm" value={draft.entry.style} onChange={(e) => set((d) => { d.entry.style = (e.target as HTMLSelectElement).value as Strategy['entry']['style']; })}>{ENTRY_STYLES.map((s) => <option key={s} value={s}>{s === 'instant' ? 'instant: as soon as it qualifies' : s === 'pullback' ? 'pullback: after a dip from the local high' : 'breakout: on a new high'}</option>)}</select></Row>
      {draft.entry.style === 'pullback' && (<>
        <Row label="Pullback between" unit="%"><span class="pair"><NumInput value={draft.entry.pullback.minPct} onChange={(v) => set((d) => { d.entry.pullback.minPct = v ?? 12; })} /><span class="muted">and</span><NumInput value={draft.entry.pullback.maxPct} onChange={(v) => set((d) => { d.entry.pullback.maxPct = v ?? 25; })} /></span></Row>
        <Row label="Measured over the last" unit="min"><NumInput value={draft.entry.pullback.windowMinutes} onChange={(v) => set((d) => { d.entry.pullback.windowMinutes = Math.round(v ?? 20); })} step={1} /></Row>
      </>)}
      {draft.entry.style === 'breakout' && <Row label="Break above the high of the last" unit="min"><NumInput value={draft.entry.breakout.lookbackMinutes} onChange={(v) => set((d) => { d.entry.breakout.lookbackMinutes = Math.round(v ?? 30); })} step={1} /></Row>}
      <Row label="Slippage" unit="%"><NumInput value={draft.entry.slippagePct} onChange={(v) => set((d) => { d.entry.slippagePct = v ?? 3; })} step={0.5} /></Row>
      <Row label="Leave a token alone after closing it for" unit="min"><NumInput value={draft.entry.reentryCooldownMinutes} onChange={(v) => set((d) => { d.entry.reentryCooldownMinutes = Math.round(v ?? 30); })} step={5} /></Row>
    </Section>

    <Section title="Copy wallets" blurb={`Follow up to ${MAX_COPY_WALLETS} wallets on ${CHAIN_LABEL[chain]}. When one of them buys a token, the bot buys it too — with your size, your safety rules and every guardrail — and your exits take it from there. Paste a wallet's address (the trader), not a token's.`}>
      <Row label="Wallets" hint={draft.copy.wallets.length ? 'a short label shows in place of the address' : 'none yet'}>
        <div class="ladder">
          {draft.copy.wallets.map((w, i) => (
            <div class="ladder-row" key={i}>
              <input class="input mono" style="flex:1;min-width:220px" placeholder={chain === 'solana' ? 'wallet address (base58)' : '0x… wallet address'} value={w.address} onInput={(e) => set((d) => { d.copy.wallets[i]!.address = (e.target as HTMLInputElement).value.trim(); })} />
              <input class="input sm" style="width:120px" placeholder="label" maxLength={24} value={w.label} onInput={(e) => set((d) => { d.copy.wallets[i]!.label = (e.target as HTMLInputElement).value; })} />
              <button class="btn sm" onClick={() => set((d) => { d.copy.wallets.splice(i, 1); })}>remove</button>
            </div>
          ))}
          {draft.copy.wallets.length < MAX_COPY_WALLETS && <button class="btn sm" onClick={() => set((d) => { d.copy.wallets.push({ address: '', label: '' }); })}>add a wallet</button>}
        </div>
      </Row>
      {draft.copy.wallets.length > 0 && (<>
        <Row label="Copy their sells too" hint="sell the same share of your position when they sell theirs"><Toggle value={draft.copy.copySells} onChange={(v) => set((d) => { d.copy.copySells = v; })} /></Row>
        <Row label="Ignore a signal older than" unit="s" hint="a late copy buys someone else's top"><NumInput value={draft.copy.maxAgeSec} onChange={(v) => set((d) => { d.copy.maxAgeSec = Math.round(v ?? 30); })} step={5} /></Row>
        <Row label="Also apply your discovery rules to copied buys" hint="off = safety rules and guardrails only, which is the point of copying"><Toggle value={draft.copy.applyDiscovery} onChange={(v) => set((d) => { d.copy.applyDiscovery = v; })} /></Row>
        <Row label="Follow only" hint="trade nothing but what these wallets trade; the scanner is ignored"><Toggle value={draft.copy.followOnly} onChange={(v) => set((d) => { d.copy.followOnly = v; })} /></Row>
      </>)}
    </Section>

    <Section title="Exits" blurb="The stop loss and the liquidity-drain exit always exist; everything else is optional.">
      <Row label="Take profit at" unit="%"><NumInput value={draft.exits.takeProfitPct} onChange={(v) => set((d) => { d.exits.takeProfitPct = v; })} placeholder="off" /></Row>
      <Row label="Stop loss at" unit="% (max 90)"><NumInput value={draft.exits.stopLossPct} onChange={(v) => set((d) => { d.exits.stopLossPct = v ?? 25; })} /></Row>
      <Row label="Trailing stop" unit="% below the peak"><NumInput value={draft.exits.trailingPct} onChange={(v) => set((d) => { d.exits.trailingPct = v; })} placeholder="off" /></Row>
      <Row label="Max hold" unit="min"><NumInput value={draft.exits.maxHoldMinutes} onChange={(v) => set((d) => { d.exits.maxHoldMinutes = v === null ? null : Math.round(v); })} placeholder="off" /></Row>
      <Row label="Liquidity-drain exit" unit="% of the pool gone (max 35)"><NumInput value={draft.exits.liquidityDrainExitPct} onChange={(v) => set((d) => { d.exits.liquidityDrainExitPct = v ?? 35; })} /></Row>
      <Row label="Ladder sells" hint="partial sells on the way up, in rising order">
        <div class="ladder">
          {draft.exits.ladder.map((st, i) => (
            <div class="ladder-row" key={i}>
              <span class="muted small">sell</span><NumInput value={st.sellPct} onChange={(v) => set((d) => { d.exits.ladder[i]!.sellPct = v ?? 0; })} /><span class="muted small">% at</span><NumInput value={st.atGainPct} onChange={(v) => set((d) => { d.exits.ladder[i]!.atGainPct = v ?? 0; })} /><span class="muted small">% gain</span>
              <button class="btn sm" onClick={() => set((d) => { d.exits.ladder.splice(i, 1); })}>remove</button>
            </div>
          ))}
          {draft.exits.ladder.length < 6 && <button class="btn sm" onClick={() => set((d) => { const last = d.exits.ladder.at(-1); d.exits.ladder.push({ atGainPct: last ? last.atGainPct * 2 : 50, sellPct: 30 }); })}>add a step</button>}
        </div>
      </Row>
    </Section>

    <Section title="Advanced">
      <Row label="Add on dips"><Toggle value={draft.advanced.dipAdd.enabled} onChange={(v) => set((d) => { d.advanced.dipAdd.enabled = v; })} /></Row>
      {draft.advanced.dipAdd.enabled && (<>
        <Row label="Extra buys, at most"><NumInput value={draft.advanced.dipAdd.maxAdds} onChange={(v) => set((d) => { d.advanced.dipAdd.maxAdds = Math.round(v ?? 1); })} step={1} /></Row>
        <Row label="On a dip between" unit="% off the peak"><span class="pair"><NumInput value={draft.advanced.dipAdd.bandMinPct} onChange={(v) => set((d) => { d.advanced.dipAdd.bandMinPct = v ?? 20; })} /><span class="muted">and</span><NumInput value={draft.advanced.dipAdd.bandMaxPct} onChange={(v) => set((d) => { d.advanced.dipAdd.bandMaxPct = v ?? 30; })} /></span></Row>
      </>)}
      <Row label="After a winning close, allow re-entry after" unit="min"><NumInput value={draft.advanced.winnerReentryCooldownMinutes} onChange={(v) => set((d) => { d.advanced.winnerReentryCooldownMinutes = Math.round(v ?? 5); })} step={1} /></Row>
      <Row label="Only names containing" hint="comma-separated"><input class="input" value={draft.advanced.keywords.include.join(', ')} onInput={(e) => set((d) => { d.advanced.keywords.include = splitList((e.target as HTMLInputElement).value); })} /></Row>
      <Row label="Never names containing" hint="comma-separated"><input class="input" value={draft.advanced.keywords.exclude.join(', ')} onInput={(e) => set((d) => { d.advanced.keywords.exclude = splitList((e.target as HTMLInputElement).value); })} /></Row>
      <Row label="Ignore launches found via" hint="comma-separated source names, e.g. pons-launch"><input class="input" value={draft.advanced.blockedSources.join(', ')} onInput={(e) => set((d) => { d.advanced.blockedSources = splitList((e.target as HTMLInputElement).value); })} /></Row>
    </Section>

    {(chain === 'solana' || chain === 'robinhood') && (
      <Section title="Bundled launches" blurb="The hub reads the launch block of every launch it sees created: which other wallets bought in the same slot/block as the creator, and how much of the supply they took. That is the classic insider bundle.">
        <Row label="Other wallets' share of supply in the launch block, at most" unit="%" hint="blank = do not check"><NumInput value={draft.advanced.maxBundlePct} onChange={(v) => set((d) => { d.advanced.maxBundlePct = v; })} step={5} placeholder="off" /></Row>
        <Row label="Until the launch block has been read" hint="the read lands a few seconds after creation"><span class="pair">{(['allow', 'wait'] as const).map((v) => <label key={v} class="check small"><input type="radio" checked={draft.advanced.bundleUnknown === v} onChange={() => set((d) => { d.advanced.bundleUnknown = v; })} /> {v === 'allow' ? 'judge without it' : 'wait for it'}</label>)}</span></Row>
      </Section>
    )}

    {chain === 'robinhood' && (
      <Section title="pons launches (Robinhood Chain)" blurb="Facts a pons launch carries that DexScreener does not.">
        <Row label="Opening tax ceiling" unit="%" hint="the tax starts at 99% and decays; the bot buys only under this"><NumInput value={draft.advanced.pons.maxOpeningTaxBps / 100} onChange={(v) => set((d) => { d.advanced.pons.maxOpeningTaxBps = Math.round((v ?? 3) * 100); })} step={0.5} /></Row>
        <Row label="Give up waiting for the tax after" unit="s"><NumInput value={draft.advanced.pons.maxTaxWaitMs / 1000} onChange={(v) => set((d) => { d.advanced.pons.maxTaxWaitMs = Math.round((v ?? 12) * 1000); })} step={1} /></Row>
        <Row label="Launcher's own share of supply, at most" unit="%"><NumInput value={draft.advanced.pons.maxDevSharePct} onChange={(v) => set((d) => { d.advanced.pons.maxDevSharePct = v ?? 8; })} /></Row>
        <Row label="Wallets exempted from the opening tax, at most" hint="more than a couple is a declared bundle"><NumInput value={draft.advanced.pons.maxExemptWallets} onChange={(v) => set((d) => { d.advanced.pons.maxExemptWallets = Math.round(v ?? 2); })} step={1} /></Row>
        <Row label="Creator fee must go to the deployer"><Toggle value={draft.advanced.pons.requireFeeToDeployer} onChange={(v) => set((d) => { d.advanced.pons.requireFeeToDeployer = v; })} /></Row>
        <Row label="Only buy while still on the curve"><Toggle value={draft.advanced.pons.curveOnly} onChange={(v) => set((d) => { d.advanced.pons.curveOnly = v; })} /></Row>
        <RangeRow label="Curve progress" unit="% to graduation" r={draft.advanced.pons.progressPct} onChange={(r) => set((d) => { d.advanced.pons.progressPct = r; })} />
        <Row label="Launcher's prior launches, at most" hint="blank = do not check"><NumInput value={draft.advanced.pons.maxDeployerPrior} onChange={(v) => set((d) => { d.advanced.pons.maxDeployerPrior = v === null ? null : Math.round(v); })} step={1} placeholder="off" /></Row>
        <Row label="Launcher's graduated launches, at least" hint="blank = do not check"><NumInput value={draft.advanced.pons.minDeployerGraduated} onChange={(v) => set((d) => { d.advanced.pons.minDeployerGraduated = v === null ? null : Math.round(v); })} step={1} placeholder="off" /></Row>
      </Section>
    )}

    {chain === 'solana' && (
      <Section title="pump.fun launches (Solana)" blurb="Facts a pump.fun launch carries that DexScreener does not. Ignored for tokens that did not start on pump.fun.">
        <Row label="Creator's buy at launch, at most" unit="SOL" hint="blank = do not check"><NumInput value={draft.advanced.pump.maxDevBuySol} onChange={(v) => set((d) => { d.advanced.pump.maxDevBuySol = v; })} step={0.5} placeholder="off" /></Row>
        <Row label="Creator's share of supply, at most" unit="%" hint="blank = do not check"><NumInput value={draft.advanced.pump.maxDevSharePct} onChange={(v) => set((d) => { d.advanced.pump.maxDevSharePct = v; })} placeholder="off" /></Row>
        <Row label="Only buy while still on the bonding curve"><Toggle value={draft.advanced.pump.curveOnly} onChange={(v) => set((d) => { d.advanced.pump.curveOnly = v; if (v) d.advanced.pump.migratedOnly = false; })} /></Row>
        <Row label="Only buy once graduated to a pool"><Toggle value={draft.advanced.pump.migratedOnly} onChange={(v) => set((d) => { d.advanced.pump.migratedOnly = v; if (v) d.advanced.pump.curveOnly = false; })} /></Row>
        <RangeRow label="Curve progress" unit="% to graduation" r={draft.advanced.pump.progressPct} onChange={(r) => set((d) => { d.advanced.pump.progressPct = r; })} />
        <RangeRow label="Market cap on the curve" unit="SOL" r={draft.advanced.pump.marketCapSol} onChange={(r) => set((d) => { d.advanced.pump.marketCapSol = r; })} />
        <Row label="Creator's prior launches, at most" hint="counted since the hub started; blank = do not check"><NumInput value={draft.advanced.pump.maxCreatorPrior} onChange={(v) => set((d) => { d.advanced.pump.maxCreatorPrior = v === null ? null : Math.round(v); })} step={1} placeholder="off" /></Row>
      </Section>
    )}

    <Section title="Listings (CoinGecko + CoinMarketCap)" blurb="For coins the listing intelligence spotted being added to a catalogue. Score and verdict rules only judge tokens that have one.">
      <Row label="Only trade listed coins" hint="skip everything the hub finds any other way"><Toggle value={draft.advanced.listing.onlyListed} onChange={(v) => set((d) => { d.advanced.listing.onlyListed = v; })} /></Row>
      <Row label="Listing score, at least" unit="0–100" hint="blank = do not check"><NumInput value={draft.advanced.listing.minScore} onChange={(v) => set((d) => { d.advanced.listing.minScore = v === null ? null : Math.round(v); })} step={5} placeholder="off" /></Row>
      <Row label="Must be on both catalogues"><Toggle value={draft.advanced.listing.requireConfirmed} onChange={(v) => set((d) => { d.advanced.listing.requireConfirmed = v; })} /></Row>
      <Row label="Allowed verdicts" hint="none ticked = any">
        <span class="pair">{(['ACT', 'WATCH', 'REJECT'] as const).map((v) => (
          <label key={v} class="check small"><input type="checkbox" checked={draft.advanced.listing.verdicts.includes(v)} onChange={(e) => set((d) => { const on = (e.target as HTMLInputElement).checked; d.advanced.listing.verdicts = on ? [...d.advanced.listing.verdicts.filter((x) => x !== v), v] : d.advanced.listing.verdicts.filter((x) => x !== v); })} /> {v}</label>
        ))}</span>
      </Row>
    </Section>
    </div>
  );
}

export function Builder({ record, onSaved, onClose }: { record: StrategyRecord; onSaved: (r: StrategyRecord) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => clone(record.strategy));
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const chain = draft.chain;

  useEffect(() => { hubStream.start(); const off = hubStream.on(() => tick((n) => n + 1)); const t = setInterval(() => tick((n) => n + 1), 5000); return () => { off(); clearInterval(t); }; }, []);

  const check = useMemo(() => checkRules(draft), [draft]);
  const sentences = check.strategy ? describeStrategy(check.strategy) : [];
  const pool = [...hubStream.candidates.values()].filter((c) => c.chain === chain);
  const matching = check.strategy ? pool.filter((c) => evaluate(c, check.strategy!).pass).length : 0;

  const save = async () => {
    if (!check.ok || !check.strategy) return;
    setBusy(true);
    try { const r = await api.saveStrategy(check.strategy, record.id); onSaved(r.strategy); toast('Rules saved'); onClose(); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(false); }
  };
  const loadPreset = (p: PresetName) => { if (confirm(`Replace every setting with the ${p} preset for ${CHAIN_LABEL[chain]}?`)) setDraft(clone(preset(p, chain))); };

  return (
    <div class="builder">
      <div class="builder-head">
        <div>
          <h2>Edit every rule · {CHAIN_LABEL[chain]}</h2>
          <p class="muted small">Blank means no limit. Percentages are percent. Money is US dollars. Time is minutes unless it says otherwise. To watch the effect on live launches as you type, use "Tune rules" in the Terminal.</p>
        </div>
        <div class="btnrow">
          <label class="muted small">Start from&nbsp;<select class="input sm" onChange={(e) => { const v = (e.target as HTMLSelectElement).value as PresetName | ''; if (v) loadPreset(v); (e.target as HTMLSelectElement).value = ''; }}><option value="">a preset…</option>{PRESET_NAMES.map((p) => <option key={p} value={p} title={presetBlurb(p, chain)}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}</select></label>
          <button class="btn sm" onClick={onClose}>Cancel</button>
          <button class="btn sm primary" disabled={!check.ok || busy} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button>
        </div>
      </div>

      <div class="builder-grid">
        <RulesForm draft={draft} onChange={setDraft} />
        <aside class="builder-side">
          <div class="card sticky">
            <h3>Right now</h3>
            <div class={`match ${matching > 0 ? 'ok' : ''}`}><b>{matching}</b> of {pool.length} launches the hub is watching would pass</div>
            <p class="muted small">Counted against the last few hours of {CHAIN_LABEL[chain]} launches, updated as they change.</p>
            <h3>In words</h3>
            {check.problems.length > 0 && <div class="notice bad small">{check.problems.join(' ')}</div>}
            <div class="sentences compact">{sentences.map((t, i) => <div key={i}>{t}</div>)}</div>
            <div class="btnrow" style="margin-top:10px"><button class="btn primary" disabled={!check.ok || busy} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button><button class="btn" onClick={onClose}>Cancel</button></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function splitList(v: string): string[] { return v.split(',').map((s) => s.trim()).filter(Boolean); }

function Section({ title, blurb, children }: { title: string; blurb?: string; children: preact.ComponentChildren }) {
  return <section class="card bsec"><h3>{title}</h3>{blurb && <p class="muted small">{blurb}</p>}<div class="brows">{children}</div></section>;
}
function Row({ label, unit, hint, children }: { label: string; unit?: string; hint?: string; children: preact.ComponentChildren }) {
  return <div class="brow"><div class="bk">{label}{unit ? <span class="unit"> {unit}</span> : null}{hint ? <div class="hint">{hint}</div> : null}</div><div class="bv">{children}</div></div>;
}
function NumInput({ value, onChange, step, placeholder }: { value: number | null; onChange: (v: number | null) => void; step?: number; placeholder?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { const cur = num(text); if (value === null ? text.trim() !== '' : cur !== value) setText(value === null ? '' : String(value)); }, [value]);
  return <input class={`input sm numin${Number.isNaN(num(text)) ? ' bad' : ''}`} inputMode="decimal" step={step} placeholder={placeholder ?? ''} value={text} onInput={(e) => { const t = (e.target as HTMLInputElement).value; setText(t); const n = num(t); if (!Number.isNaN(n)) onChange(n); }} />;
}
function RangeRow({ label, unit, r, onChange }: { label: string; unit: string; r: Range; onChange: (r: Range) => void }) {
  return <Row label={label} unit={unit}><span class="pair"><span class="muted small">from</span><NumInput value={r.min} onChange={(v) => onChange({ ...r, min: v })} placeholder="any" /><span class="muted small">to</span><NumInput value={r.max} onChange={(v) => onChange({ ...r, max: v })} placeholder="any" /></span></Row>;
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <label class="toggle"><input type="checkbox" checked={value} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /><span>{value ? 'yes' : 'no'}</span></label>;
}
function WindowSelect({ value, onChange }: { value: Window; onChange: (w: Window) => void }) {
  return <select class="input sm" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as Window)}>{WINDOWS.map((w) => <option key={w} value={w}>{WINDOW_LABEL[w]}</option>)}</select>;
}
export type { Chain };
