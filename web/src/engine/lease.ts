// One tab trades. Open TradeWarz twice and two engines would each buy the same launch and each
// keep saving its own copy of the positions over the other's - which is exactly how a position
// that was removed in one tab came back after a refresh. So the engine runs behind a lease: the
// first tab to ask holds it (a Web Lock, released automatically when the tab closes); every other
// tab is a viewer that shows the same positions from the shared store but never signs or saves.
// A viewer can ask the active tab to hand over, and takes the lease the moment it is free.

export type LeaseState = 'active' | 'standby' | 'unsupported';

const NAME = 'tradewarz-engine';
const CHANNEL = 'tradewarz';

class EngineLease {
  state: LeaseState = 'standby';
  private listeners = new Set<() => void>();
  private release: (() => void) | null = null;
  private channel: BroadcastChannel | null = null;
  private started = false;

  get active(): boolean { return this.state === 'active' || this.state === 'unsupported'; }
  on(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private set(s: LeaseState): void { if (this.state !== s) { this.state = s; for (const l of this.listeners) l(); } }

  /** Ask for the lease; resolves once this tab holds it (or at once when locks are unsupported). Waits otherwise. */
  start(): void {
    if (this.started) return;
    this.started = true;
    try { this.channel = new BroadcastChannel(CHANNEL); this.channel.onmessage = (e) => this.onMessage(e.data as { kind?: string }); } catch { this.channel = null; }
    if (typeof navigator === 'undefined' || !('locks' in navigator)) { this.set('unsupported'); return; }
    this.request();
  }

  private request(): void {
    void navigator.locks.request(NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        this.set('standby');
        // Queue behind the holder: this resolves when the other tab closes or hands over.
        return navigator.locks.request(NAME, (held) => this.hold(held));
      }
      return this.hold(lock);
    });
  }

  /** Hold the lock until release() - the promise stays pending for the tab's lifetime. */
  private hold(lock: Lock | null): Promise<void> {
    if (!lock) return Promise.resolve();
    this.set('active');
    return new Promise<void>((resolve) => { this.release = resolve; });
  }

  /** Give the lease up (another tab asked). The engine stops trading here; positions stay visible. */
  handOver(): void {
    if (this.state !== 'active') return;
    this.set('standby');
    const r = this.release; this.release = null;
    r?.();
    // Queue up again so this tab takes over if the other one closes later.
    void navigator.locks.request(NAME, (held) => this.hold(held));
  }

  /** From a viewer: ask whoever holds the lease to hand it over. */
  requestTakeover(): void { this.channel?.postMessage({ kind: 'release' }); }
  /** Tell viewers that positions changed so they re-read the store. */
  announceChange(): void { this.channel?.postMessage({ kind: 'changed' }); }
  onChange(cb: () => void): () => void {
    const h = (e: MessageEvent) => { if ((e.data as { kind?: string })?.kind === 'changed') cb(); };
    this.channel?.addEventListener('message', h);
    return () => this.channel?.removeEventListener('message', h);
  }

  private onMessage(m: { kind?: string }): void {
    if (m?.kind === 'release') this.handOver();
  }
}

export const engineLease = new EngineLease();
