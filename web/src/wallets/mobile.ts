// Phones have no wallet extensions: nothing injects window.solana or window.ethereum into a
// mobile browser or an installed app. Two ways in from a phone: open this site inside the wallet
// app's own browser (Phantom and MetaMask both have one, and inject there), or sign the phone in
// with a one-time code made on a computer that is already signed in (no wallet needed).

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  return navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820;
}

/** Phantom's in-app browser, opened on this page. */
export const phantomBrowseUrl = (url = location.href): string => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`;
/** MetaMask's in-app browser, opened on this page (https sites only). */
export const metamaskBrowseUrl = (url = location.href): string => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}`;
