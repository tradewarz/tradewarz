// One toast for the whole page: short, then gone. Errors stay a little longer.
let el: HTMLDivElement | null = null;
let timer: number | undefined;

export function toast(message: string, kind: 'ok' | 'bad' = 'ok'): void {
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = message;
  el.className = `toast show${kind === 'bad' ? ' bad' : ''}`;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { if (el) el.className = 'toast'; }, kind === 'bad' ? 5000 : 2600);
}
