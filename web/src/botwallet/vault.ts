// The vault: the backup phrase encrypted with the person's password, stored in this
// browser's IndexedDB. PBKDF2-SHA256 with many rounds makes guessing slow; AES-GCM
// authenticates the ciphertext so a tampered blob fails instead of yielding garbage
// keys. Nothing in here ever goes over the network.

const DB_NAME = 'tradewarz';
const STORE = 'vault';
const KEY = 'bot-wallet';
export const PBKDF2_ITERATIONS = 600_000;

export interface VaultBlob {
  v: 1;
  createdAt: number;
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64
  /** Public addresses, kept in the clear so the page can show them while locked. */
  addresses: { solana: string; robinhood: string };
  /** The person confirmed they wrote the phrase down. Deposits are refused until true. */
  backedUp: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}
async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => { const bin = atob(s); const out = new Uint8Array(new ArrayBuffer(bin.length)); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

async function deriveAesKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function loadVault(): Promise<VaultBlob | null> {
  try { return await idbGet<VaultBlob>(KEY); } catch { return null; }
}

export async function saveVault(blob: VaultBlob): Promise<void> {
  await idbSet(KEY, blob);
}

export async function createVault(mnemonic: string, password: string, addresses: VaultBlob['addresses']): Promise<VaultBlob> {
  if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic)));
  const blob: VaultBlob = { v: 1, createdAt: Date.now(), iterations: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct), addresses, backedUp: false };
  await saveVault(blob);
  return blob;
}

export async function unlockVault(blob: VaultBlob, password: string): Promise<string> {
  const key = await deriveAesKey(password, unb64(blob.salt), blob.iterations);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Wrong password.');
  }
}

export async function markBackedUp(blob: VaultBlob): Promise<VaultBlob> {
  const next = { ...blob, backedUp: true };
  await saveVault(next);
  return next;
}

/** Forget the wallet in this browser. Funds stay on-chain; only the phrase can bring it back. */
export async function destroyVault(): Promise<void> {
  await idbDelete(KEY);
}
