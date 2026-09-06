// The tab's end of the hub stream. Event-driven on purpose: browsers throttle timers in
// background tabs but keep delivering network messages, so everything the bot does is a
// reaction to a message here. Also tracks whether the connection looks alive.

import type { Candidate, Chain, FeedInfo, StreamMessage } from '@tradewarz/shared';
import { api } from '../api.js';

type Listener = (m: StreamMessage) => void;

class HubStream {
  private es: EventSource | null = null;
  private listeners = new Set<Listener>();
  clientId: string | null = null;
  candidates = new Map<string, Candidate>();
  feed: FeedInfo | null = null;
  ethUsd: number | null = null;
  solUsd: number | null = null;
  bnbUsd: number | null = null;
  lastMessageAt = 0;
  connected = false;
  private watches = new Map<string, { chain: Chain; token: string; tokens: string }>();

  /** EVM addresses are case-insensitive; Solana mints are base58 and keep their case. */
  static key(chain: Chain, address: string): string { return `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`; }

  start(): void {
    if (this.es) return;
    const es = new EventSource('/api/stream', { withCredentials: true });
    this.es = es;
    es.addEventListener('client', (e) => {
      try { this.clientId = (JSON.parse((e as MessageEvent).data) as { id: string }).id; } catch { /* ignore */ }
      // A reconnect gets a new client id on the hub: re-register every watch.
      for (const w of this.watches.values()) void this.sendWatch(w);
    });
    es.onopen = () => { this.connected = true; this.lastMessageAt = Date.now(); this.emit({ kind: 'tick', now: Date.now(), ethUsd: this.ethUsd, solUsd: this.solUsd, bnbUsd: this.bnbUsd, feed: this.feed ?? { robinhood: { mode: 'off', lastLaunchAt: 0, candidates: 0, note: '' } } }); };
    es.onerror = () => { this.connected = false; };
    es.onmessage = (ev) => {
      let m: StreamMessage;
      try { m = JSON.parse(ev.data) as StreamMessage; } catch { return; }
      this.lastMessageAt = Date.now();
      this.connected = true;
      if (m.kind === 'hello') { this.candidates.clear(); for (const c of m.candidates) this.candidates.set(HubStream.key(c.chain, c.address), c); this.feed = m.feed; this.ethUsd = m.ethUsd; this.solUsd = m.solUsd ?? this.solUsd; this.bnbUsd = m.bnbUsd ?? this.bnbUsd; }
      else if (m.kind === 'candidate') this.candidates.set(HubStream.key(m.candidate.chain, m.candidate.address), m.candidate);
      else if (m.kind === 'drop') this.candidates.delete(HubStream.key(m.chain, m.address));
      else if (m.kind === 'tick') { this.feed = m.feed; this.ethUsd = m.ethUsd; this.solUsd = m.solUsd ?? this.solUsd; this.bnbUsd = m.bnbUsd ?? this.bnbUsd; }
      this.emit(m);
    };
  }
  stop(): void { this.es?.close(); this.es = null; this.connected = false; }

  on(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  private emit(m: StreamMessage): void { for (const l of this.listeners) { try { l(m); } catch (e) { console.error('[stream listener]', e); } } }

  /** Seconds since the last message; the hub ticks every 10 s, so > 35 s means throttled or disconnected. */
  silenceSec(): number { return this.lastMessageAt ? (Date.now() - this.lastMessageAt) / 1000 : Infinity; }

  async watch(chain: Chain, token: string, tokens: bigint): Promise<void> {
    const w = { chain, token, tokens: tokens.toString() };
    this.watches.set(HubStream.key(chain, token), w);
    await this.sendWatch(w);
  }
  async unwatch(chain: Chain, token: string): Promise<void> {
    this.watches.delete(HubStream.key(chain, token));
    if (!this.clientId) return;
    try { await api.unwatch(this.clientId, { chain, token }); } catch { /* the hub forgets it on disconnect anyway */ }
  }
  private async sendWatch(w: { chain: Chain; token: string; tokens: string }): Promise<void> {
    if (!this.clientId) return;
    try { await api.watch(this.clientId, w); } catch (e) { console.warn('[stream] watch failed', e); }
  }
  candidate(chain: Chain, address: string): Candidate | undefined { return this.candidates.get(HubStream.key(chain, address)); }
  /** Feed a candidate in locally, as if the hub had sent it (end-to-end tests and demos; never used by the hub path). */
  inject(candidate: Candidate): void { this.candidates.set(HubStream.key(candidate.chain, candidate.address), candidate); this.emit({ kind: 'candidate', candidate }); }
}

export const hubStream = new HubStream();
