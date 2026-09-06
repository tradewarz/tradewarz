// Alerts: a short tone and, when the browser allows it, a desktop notification - so nobody has
// to stare at the table. Everything is opt-in and remembered in this browser only. The tone is
// synthesized (no audio file) and needs one click on the page first; the bell button is that click.

export type AlertKind = 'pass' | 'trade' | 'bundle' | 'error';

export interface AlertSettings {
  sound: boolean;
  notify: boolean;
  /** A token passes your rules on a chain whose bot is off (when it is on, the trade alert covers it). */
  onPass: boolean;
  /** Your bots bought or sold. */
  onTrade: boolean;
  /** A bundle turned up on a token you hold or watch. */
  onBundle: boolean;
  /** A bot hit an error. */
  onError: boolean;
}

const KEY = 'tradewarz.alerts';
const DEFAULTS: AlertSettings = { sound: false, notify: false, onPass: true, onTrade: true, onBundle: true, onError: true };
let cached: AlertSettings | null = null;
const listeners = new Set<() => void>();

export function alertSettings(): AlertSettings {
  if (cached) return cached;
  try { cached = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AlertSettings>) }; } catch { cached = { ...DEFAULTS }; }
  return cached;
}
export function setAlertSettings(patch: Partial<AlertSettings>): AlertSettings {
  cached = { ...alertSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* private mode: lives for this tab */ }
  for (const l of listeners) l();
  return cached;
}
export function onAlertSettings(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }

export const notificationsSupported = (): boolean => typeof Notification !== 'undefined';
export const notificationsAllowed = (): boolean => notificationsSupported() && Notification.permission === 'granted';

/** Ask the browser; resolves to whether notifications may be shown. Must be called from a click. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

// ---- the tone ------------------------------------------------------------------------------------

let ctx: AudioContext | null = null;
/** Create (or resume) the audio context; browsers only allow this inside a user gesture. */
export function unlockSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}

const TONES: Record<AlertKind, number[]> = { pass: [880, 1175], trade: [659, 880, 1319], bundle: [440, 330], error: [330, 262] };

function beep(kind: AlertKind): void {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  TONES[kind].forEach((f, i) => {
    const o = ctx!.createOscillator(); const g = ctx!.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.11);
    o.connect(g).connect(ctx!.destination);
    o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.12);
  });
}

// ---- firing --------------------------------------------------------------------------------------

const recent = new Map<string, number>();

/** One alert per (kind, key) per minute; the key is usually the token. */
export function alert(kind: AlertKind, key: string, title: string, body: string): void {
  const s = alertSettings();
  const enabled = kind === 'pass' ? s.onPass : kind === 'trade' ? s.onTrade : kind === 'bundle' ? s.onBundle : s.onError;
  if (!enabled || (!s.sound && !s.notify)) return;
  const k = `${kind}:${key}`;
  const last = recent.get(k) ?? 0;
  if (Date.now() - last < 60_000) return;
  recent.set(k, Date.now());
  if (recent.size > 500) for (const [rk, at] of recent) if (Date.now() - at > 600_000) recent.delete(rk);
  if (s.sound) beep(kind);
  if (s.notify && notificationsAllowed() && document.visibilityState !== 'visible') {
    try { new Notification(title, { body, tag: k, silent: true }); } catch { /* some browsers refuse outside a service worker */ }
  }
}
