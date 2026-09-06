// The dashboard: Bot (default), Terminal, Board, Wallet, Account — and Review for the owner.
// One status line up top.

import { useEffect, useState } from 'preact/hooks';
import { CHAINS, type HubInfo, type SessionUser, type StrategyRecord } from '@tradewarz/shared';
import { api } from '../api.js';
import type { VaultBlob } from '../botwallet/vault.js';
import { Account } from './Account.jsx';
import { BotTab } from './BotTab.jsx';
import { allBots, botFor } from '../engine/bot.js';
import { startReporting, stopReporting } from '../engine/report.js';
import { hubStream } from '../engine/stream.js';
import { CHAIN_LABEL } from './helpers.js';
import { Leaderboard } from './Leaderboard.jsx';
import { Review } from './Review.jsx';
import { Terminal } from './Terminal.jsx';
import { Guide, type GuideSection } from './Guide.jsx';
import { WalletPanel } from './WalletPanel.jsx';

type Tab = 'bot' | 'terminal' | 'board' | 'wallet' | 'account' | 'guide' | 'review';
const TAB_LABEL: Record<Tab, string> = { bot: 'Bot', terminal: 'Terminal', board: 'Board', wallet: 'Wallet', account: 'Account', guide: 'Guide', review: 'Review' };

export function Dashboard({ me, info, vault, strategies, onMe, onStrategies, onLocked, onSignOut }: {
  me: SessionUser; info: HubInfo; vault: VaultBlob; strategies: StrategyRecord[];
  onMe: (me: SessionUser) => void; onStrategies: (s: StrategyRecord[]) => void; onLocked: () => void; onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('bot');
  const [guideSection, setGuideSection] = useState<GuideSection | null>(null);
  const active = strategies.filter((s) => s.active);
  // "what's this?" links anywhere on the site open the Guide at their section.
  useEffect(() => {
    const on = (e: Event) => { setGuideSection((e as CustomEvent<GuideSection>).detail); setTab('guide'); };
    window.addEventListener('tw:guide', on);
    return () => window.removeEventListener('tw:guide', on);
  }, []);

  // The scanning is always on while the dashboard is open, so the Terminal shows launches
  // whether or not a bot is switched on. Only the engine follows the on/off switch.
  useEffect(() => { hubStream.start(); }, []);
  // Every trade the bot makes is reported to the hub by hash, so the board can read it off the
  // chain. Runs whenever the dashboard is open; it catches up on anything missed while it wasn't.
  useEffect(() => { startReporting(); return () => stopReporting(); }, []);
  // Both bots load their positions and listen for prices from the start, so you can buy by hand,
  // watch a position and sell it whether or not the rules are switched on.
  useEffect(() => { for (const b of allBots()) void b.prime(info.rpc[b.chain]); }, []);

  // Each chain's engine follows that chain's active strategy for as long as the dashboard is
  // open, whatever tab is showing: on when one is on, off otherwise, re-armed when its rules change.
  // One effect per chain, keyed on that chain's active strategy identity.
  const actives = CHAINS.map((c) => strategies.find((s) => s.chain === c && s.active) ?? null);
  const activeKey = actives.map((a) => (a ? `${a.id}:${a.updatedAt}` : '-')).join('|');
  useEffect(() => {
    CHAINS.forEach((c, i) => {
      const a = actives[i];
      if (a) void botFor(c).start(a.strategy, a.id, info.rpc[c]);
      else botFor(c).stop();
    });
  }, [activeKey]);
  useEffect(() => () => { for (const b of allBots()) b.stop(); }, []);
  // After any save: reload the list and, if that bot is running, hand it the new rules at once.
  const saved = async (r: StrategyRecord) => {
    onStrategies(strategies.map((s) => (s.id === r.id ? r : s))); // show it at once
    if (r.active) botFor(r.chain).updateStrategy(r.strategy);
    try { onStrategies((await api.strategies()).strategies); } catch { /* the optimistic copy stands */ }
  };
  const status = active.length ? active.map((s) => `${CHAIN_LABEL[s.chain]}: ${s.strategy.name} on`).join(' · ') : strategies.length ? 'all bots off' : 'no bot yet';
  return (
    <div class={`dash-shell${tab === 'terminal' || tab === 'review' ? ' wide' : ''}`}>
      <div class="dash-tabs" role="tablist">
        {(['bot', 'terminal', 'board', 'wallet', 'account', 'guide', ...(me.owner ? (['review'] as const) : [])] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} class={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
        ))}
        <span class="spacer" />
        <span class="muted small statusline">{status}</span>
      </div>
      {tab === 'bot' && <BotTab me={me} info={info} strategies={strategies} onStrategies={onStrategies} onTerminal={() => setTab('terminal')} />}
      {tab === 'terminal' && <Terminal strategies={strategies} onSaved={(r) => { void saved(r); }} />}
      {tab === 'board' && <Leaderboard chains={info.chains} />}
      {tab === 'review' && me.owner && <Review chains={info.chains} />}
      {tab === 'wallet' && <WalletPanel vault={vault} me={me} info={info} onChange={onMe} onLocked={onLocked} />}
      {tab === 'account' && <Account me={me} info={info} onChange={onMe} onSignOut={onSignOut} />}
      {tab === 'guide' && <Guide section={guideSection} />}
    </div>
  );
}
