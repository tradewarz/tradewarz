// Installing the site as an app. Chrome, Edge and Android hand the page a deferred install prompt
// (beforeinstallprompt) which the header's "Install app" button replays; iOS Safari has no such
// event, so there the button points at the Guide's Share → Add to Home Screen instructions.
// Nothing about running changes when installed: the bots still run only while the app is open.

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

/** Already running as an installed app (standalone window / home-screen icon)? */
export const isStandalone = (): boolean => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
/** iPhone or iPad Safari: installable by hand only. */
export const isIOS = (): boolean => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
/** The browser has offered an install prompt we can replay. */
export const canPromptInstall = (): boolean => deferred !== null;

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  deferred = null; notify();
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  return outcome;
}

export function onInstallChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Registered only in production builds and only on secure origins (localhost counts); Vite's dev server stays untouched. */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* an install-less page still works */ });
}
