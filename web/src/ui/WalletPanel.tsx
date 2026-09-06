// The Wallet tab: both bot wallets (unlocked), balances, deposit from Phantom/MetaMask,
// withdraw back to the linked gate wallet, lock.

import { useEffect, useState } from 'preact/hooks';
import { CHAINS, isEvmChain, type Chain, type HubInfo, type SessionUser } from '@tradewarz/shared';
import { describeError } from '../api.js';
import { registerBotWallets } from '../botwallet/register.js';
import type { VaultBlob } from '../botwallet/vault.js';
import { botAddress, explorerAddress, explorerTx, lock, nativeBalance, withdraw } from '../botwallet/wallet.js';
import { depositFromMetaMask } from '../wallets/metamask.js';
import { depositSolFromPhantom } from '../wallets/phantom.js';
import { CHAIN_LABEL, NATIVE, WALLET_APP, copyText, fmtAmount, short } from './helpers.js';
import { toast } from './toast.js';

export function WalletPanel({ vault, me, info, onChange, onLocked }: { vault: VaultBlob; me: SessionUser; info: HubInfo; onChange: (me: SessionUser) => void; onLocked: () => void }) {
  return (
    <div class="stack" style="gap:20px">
      <p class="muted">This wallet lives only in this browser and signs your bots' trades. Fund it with what you intend to trade this week; move the rest back to your own wallet whenever you like. Deposits are signed by your Phantom or MetaMask; withdrawals only go to the wallet you signed in with. The same EVM address serves Robinhood Chain, Base and BNB Chain — fund it on whichever chains you run a bot.</p>
      {CHAINS.map((chain) => <ChainPanel key={chain} chain={chain} me={me} info={info} onChange={onChange} />)}
      <div class="btnrow"><button class="btn sm" onClick={() => { lock(); onLocked(); }}>Lock wallet</button><span class="muted small">Locking stops anything from signing until you unlock again. Created {new Date(vault.createdAt).toLocaleDateString()}.</span></div>
    </div>
  );
}

function ChainPanel({ chain, me, info, onChange }: { chain: Chain; me: SessionUser; info: HubInfo; onChange: (me: SessionUser) => void }) {
  const address = botAddress(chain)!;
  const registered = me.wallets.find((w) => w.role === 'bot' && w.chain === chain);
  const isThisOne = registered?.address.toLowerCase() === address.toLowerCase();
  // The sign-in wallet on this chain. One MetaMask address covers every EVM chain, so Base and BNB use the one linked for Robinhood Chain.
  const gate = me.wallets.find((w) => w.role === 'gate' && (w.chain === chain || (isEvmChain(chain) && isEvmChain(w.chain))));
  const [balance, setBalance] = useState<number | null>(null);
  const [gateBalance, setGateBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dep, setDep] = useState(''); const [wd, setWd] = useState('');
  const rpc = info.rpc[chain];

  const refresh = async () => {
    try { setBalance(await nativeBalance(chain, address, rpc)); } catch { setBalance(null); }
    if (gate) { try { setGateBalance(await nativeBalance(chain, gate.address, rpc)); } catch { setGateBalance(null); } }
  };
  useEffect(() => { void refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [address, gate?.address]);

  const register = async () => {
    setBusy('register');
    try { const m = await registerBotWallets(me); if (m) { onChange(m); toast(`${CHAIN_LABEL[chain]} bot wallet registered`); } else toast('Could not register right now; try again in a moment.', 'bad'); }
    finally { setBusy(null); }
  };

  const deposit = async () => {
    const n = Number(dep);
    if (!(n > 0)) return toast(`Enter how much ${NATIVE[chain]} to deposit.`, 'bad');
    if (!gate) return toast(`Link your ${WALLET_APP[chain]} wallet first (Account tab): it is where the deposit comes from.`, 'bad');
    if (!confirm(`Send ${dep} ${NATIVE[chain]} from ${short(gate.address)} (${WALLET_APP[chain]}) to your bot wallet ${short(address)}? ${WALLET_APP[chain]} will ask you to confirm.`)) return;
    setBusy('deposit');
    try {
      const hash = chain === 'solana' ? await depositSolFromPhantom(rpc, gate.address, address, n) : await depositFromMetaMask(chain, gate.address, address, dep, rpc);
      toast(`Deposit sent: ${short(hash, 6)}`);
      setDep('');
      setTimeout(refresh, 4000); setTimeout(refresh, 15000);
      window.open(explorerTx(chain, hash), '_blank', 'noopener');
    } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); }
  };

  const doWithdraw = async () => {
    if (!gate) return toast(`Link your ${WALLET_APP[chain]} wallet first (Account tab): withdrawals only go to your own linked wallet.`, 'bad');
    const raw = wd.trim().toLowerCase();
    const amount: number | 'all' = raw === '' || raw === 'all' || raw === 'max' ? 'all' : Number(raw);
    if (amount !== 'all' && !(amount > 0)) return toast(`Enter an amount of ${NATIVE[chain]}, or leave it empty for all.`, 'bad');
    if (!confirm(`Withdraw ${amount === 'all' ? 'everything (minus a small fee reserve)' : `${amount} ${NATIVE[chain]}`} from the bot wallet to ${short(gate.address)}? The bot wallet signs this now.`)) return;
    setBusy('withdraw');
    try {
      const r = await withdraw(chain, gate.address, amount, rpc);
      toast(`Withdrew ${r.amount.toFixed(4)} ${NATIVE[chain]} · ${short(r.hash, 6)}`);
      setWd(''); void refresh();
    } catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); }
  };

  return (
    <section class="card">
      <h2>{CHAIN_LABEL[chain]} bot wallet {isThisOne ? <span class="pill ok">registered</span> : <span class="pill warn">{busy === 'register' ? 'registering…' : 'not registered'}</span>}</h2>
      <div class="rows">
        <div class="row"><div class="k">Address</div><div class="v"><span class="addr" title={address}>{address}</span> <button class="btn sm" style="margin-left:6px" onClick={async () => toast((await copyText(address)) ? 'Address copied' : 'Copy blocked')}>Copy</button> <a class="small" href={explorerAddress(chain, address)} target="_blank" rel="noopener">explorer</a></div></div>
        <div class="row"><div class="k">Balance</div><div class="v">{fmtAmount(balance, NATIVE[chain])} <button class="btn sm" style="margin-left:6px" onClick={refresh}>Refresh</button></div></div>
        <div class="row"><div class="k">Your {WALLET_APP[chain]}</div><div class="v">{gate ? <><span class="addr">{short(gate.address, 6)}</span> <span class="muted small">· {fmtAmount(gateBalance, NATIVE[chain])}</span></> : <span class="muted">not linked yet — link it in the Account tab to deposit and withdraw</span>}</div></div>
        <div class="row"><div class="k">Deposit</div><div class="v inline"><input class="input" inputMode="decimal" placeholder={`${NATIVE[chain]} to send from ${WALLET_APP[chain]}`} value={dep} onInput={(e) => setDep((e.target as HTMLInputElement).value)} /><button class="btn" disabled={!gate || busy !== null} onClick={deposit}>{busy === 'deposit' ? 'Waiting…' : 'Deposit'}</button></div></div>
        <div class="row"><div class="k">Withdraw</div><div class="v inline"><input class="input" inputMode="decimal" placeholder={`${NATIVE[chain]} to send back, or all`} value={wd} onInput={(e) => setWd((e.target as HTMLInputElement).value)} /><button class="btn" disabled={!gate || busy !== null} onClick={doWithdraw}>{busy === 'withdraw' ? 'Sending…' : 'Withdraw'}</button></div></div>
        {!isThisOne && busy !== 'register' && <div class="row"><div class="k"></div><div class="v"><button class="btn sm" onClick={register}>Register with the hub</button> <span class="muted small">Only registered wallets are scored on the leaderboard.</span></div></div>}
      </div>
    </section>
  );
}
