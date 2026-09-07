// The AI coach card: pick a provider (free ones first), paste your own key, press Review. The
// review pack goes from this browser straight to the provider; the answer comes back here, with
// the coach's suggestions as Apply buttons that run through the same checks as the Builder. The
// hub never sees the key, the pack, or the conversation.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { StrategyRecord } from '@tradewarz/shared';
import { api, describeError } from '../api.js';
import { botFor } from '../engine/bot.js';
import { coachSystemPrompt, mdToHtml, parseSuggestions, withSetting, withoutSuggestions, type Suggestion } from '../coach/coach.js';
import { PROVIDERS, callOf, chat, listModels, loadSettings, providerOf, saveSettings, type ChatMessage, type CoachSettings, type ProviderId } from '../coach/providers.js';
import { checkRules } from './Builder.jsx';
import { openGuide } from './Guide.jsx';
import { CHAIN_LABEL } from './helpers.js';
import { reviewPack } from './MyData.jsx';
import { toast } from './toast.js';

type Turn = { role: 'user' | 'assistant'; shown: string; html?: string };

export function Coach({ handle, strategies, onStrategies }: { handle: string; strategies: StrategyRecord[]; onStrategies: (s: StrategyRecord[]) => void }) {
  const [s, setS] = useState<CoachSettings>(() => loadSettings());
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'models' | 'chat' | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState('');
  const [showSettings, setShowSettings] = useState(() => !loadSettings().keys[loadSettings().provider] && providerOf(loadSettings().provider).needsKey);
  const [sent, setSent] = useState<{ chars: number; pack: string } | null>(null);
  const [showPack, setShowPack] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const p = providerOf(s.provider);
  const key = s.keys[s.provider] ?? '';

  useEffect(() => () => abort.current?.abort(), []);
  const update = (patch: Partial<CoachSettings>) => { const next = { ...s, ...patch }; setS(next); saveSettings(next); };
  const pickProvider = (id: ProviderId) => { const np = providerOf(id); update({ provider: id, model: np.defaultModel, endpoint: np.endpoint }); setModels([]); setShowSettings(true); };
  const setKey = (v: string) => update({ keys: { ...s.keys, [s.provider]: v } });
  const forget = () => { const keys = { ...s.keys }; delete keys[s.provider]; update({ keys }); toast(`${p.name} key forgotten on this computer`); };

  const fetchModels = async () => {
    setBusy('models');
    try { const list = await listModels(callOf(s)); setModels(list); if (!list.length) toast('No models came back', 'bad'); else if (!list.includes(s.model)) update({ model: list[0]! }); }
    catch (e) { toast(describeError(e), 'bad'); } finally { setBusy(null); }
  };

  const run = async (messages: ChatMessage[], shownUser: string) => {
    setBusy('chat');
    abort.current?.abort();
    const ac = new AbortController(); abort.current = ac;
    setTurns((t) => [...t, { role: 'user', shown: shownUser }]);
    try {
      const answer = await chat(callOf(s), messages, ac.signal);
      history.current = [...messages, { role: 'assistant', content: answer }];
      const shown = withoutSuggestions(answer);
      setTurns((t) => [...t, { role: 'assistant', shown, html: mdToHtml(shown) }]);
      const sg = parseSuggestions(answer);
      if (sg.length) setSuggestions(sg);
    } catch (e) {
      if (!ac.signal.aborted) { toast(describeError(e), 'bad'); setTurns((t) => t.slice(0, -1)); }
    } finally { if (abort.current === ac) setBusy(null); }
  };

  const review = async () => {
    setBusy('chat');
    let pack: string;
    try { pack = reviewPack(handle, strategies, await api.myTrades()); }
    catch (e) { toast(describeError(e), 'bad'); setBusy(null); return; }
    const system = coachSystemPrompt();
    const user = `${pack}\n\n---\nReview my trading as instructed: what is working, what is not, and what to change.`;
    setSent({ chars: system.length + user.length, pack });
    setTurns([]); setSuggestions([]); setApplied(new Set());
    await run([{ role: 'system', content: system }, { role: 'user', content: user }], `Review pack sent (${Math.round(pack.length / 1000)}k characters).`);
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || !history.current.length) return;
    setQuestion('');
    await run([...history.current, { role: 'user', content: q }], q);
  };

  const apply = async (sg: Suggestion) => {
    const rec = strategies.find((r) => r.chain === sg.chain);
    if (!rec) { toast(`You have no ${CHAIN_LABEL[sg.chain]} bot to apply that to`, 'bad'); return; }
    try {
      const draft = withSetting(rec.strategy, sg.setting, sg.value);
      const check = checkRules(draft);
      if (!check.ok || !check.strategy) { toast(`Not applied — ${check.problems[0] ?? 'the rules would be invalid'}`, 'bad'); return; }
      await api.saveStrategy(check.strategy, rec.id);
      const list = (await api.strategies()).strategies;
      onStrategies(list);
      const updated = list.find((r) => r.id === rec.id);
      if (updated?.active) botFor(rec.chain).updateStrategy(updated.strategy);
      setApplied((a) => new Set([...a, `${sg.chain}:${sg.setting}`]));
      toast(`Applied to the ${CHAIN_LABEL[sg.chain]} bot: ${sg.setting} = ${JSON.stringify(sg.value)}`);
    } catch (e) { toast(describeError(e), 'bad'); }
  };

  const ready = (!p.needsKey || !!key) && !!(s.model || p.defaultModel);
  return (
    <section class="card coach">
      <h2>AI coach <span class="pill">your own key</span></h2>
      <p class="muted small">Sends your <b>review pack</b> (rules in words, closed trades, the bots' recent decisions, open positions) from this browser straight to the AI you choose, and shows the answer here with its suggestions as buttons. Your key is stored in this browser only; the TradeWarz hub never sees the key, the pack or the conversation. The provider's own data terms apply. <a href="#" onClick={(e) => { e.preventDefault(); openGuide('coach'); }}>How it works</a></p>

      <div class="coach-bar">
        <label class="muted small">Provider&nbsp;
          <select class="input sm" value={s.provider} onChange={(e) => pickProvider((e.target as HTMLSelectElement).value as ProviderId)}>
            {PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}{x.free ? ` · ${x.free}` : ''}</option>)}
          </select>
        </label>
        <span class="muted small">model <b>{s.model || p.defaultModel || '—'}</b></span>
        <button class="btn sm" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Hide settings' : 'Settings'}</button>
        <span class="spacer" />
        <button class="btn sm primary" disabled={busy !== null || !ready} onClick={() => void review()}>{busy === 'chat' ? 'Thinking…' : turns.length ? 'Review again' : 'Review my trading'}</button>
        {busy === 'chat' && <button class="btn sm" onClick={() => abort.current?.abort()}>Stop</button>}
      </div>

      {showSettings && (
        <div class="coach-settings">
          {p.needsKey && (
            <div class="row"><div class="k">API key</div><div class="v">
              <input class="input mono" type="password" autocomplete="off" placeholder={`${p.name} key`} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value.trim())} />
              {key && <button class="btn sm" style="margin-left:6px" onClick={forget}>Forget</button>}
              <div class="muted small" style="margin-top:4px">{p.keyHelp} {p.keyUrl && <a href={p.keyUrl} target="_blank" rel="noopener noreferrer">get one →</a>}</div>
            </div></div>
          )}
          <div class="row"><div class="k">Model</div><div class="v">
            <input class="input" list="coach-models" placeholder={p.defaultModel || 'model name'} value={s.model} onInput={(e) => update({ model: (e.target as HTMLInputElement).value.trim() })} />
            <datalist id="coach-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <button class="btn sm" style="margin-left:6px" disabled={busy !== null || (p.needsKey && !key)} onClick={() => void fetchModels()}>{busy === 'models' ? 'Fetching…' : 'Fetch models'}</button>
            {models.length > 0 && <div class="muted small" style="margin-top:4px">{models.length} model{models.length === 1 ? '' : 's'} your key can use{p.id === 'openrouter' ? ' (free ones only)' : ''}; start typing to pick one.</div>}
          </div></div>
          {!p.needsKey && (
            <div class="row"><div class="k">Endpoint</div><div class="v">
              <input class="input mono" value={s.endpoint} onInput={(e) => update({ endpoint: (e.target as HTMLInputElement).value.trim() })} />
            </div></div>
          )}
          {p.note && <div class="notice small" style="margin-top:8px">{p.note.replace('<this site>', location.origin)}</div>}
        </div>
      )}

      {sent && (
        <div class="muted small" style="margin-top:8px">
          Sent about {Math.round(sent.chars / 4).toLocaleString('en-US')} tokens to {p.name}. <a href="#" onClick={(e) => { e.preventDefault(); setShowPack(!showPack); }}>{showPack ? 'Hide' : 'Show'} exactly what was sent</a>
          {showPack && <pre class="coach-pack">{sent.pack}</pre>}
        </div>
      )}

      {turns.length > 0 && (
        <div class="coach-chat">
          {turns.map((t, i) => t.role === 'user'
            ? <div key={i} class="coach-user muted small">You: {t.shown}</div>
            : <div key={i} class="coach-answer" dangerouslySetInnerHTML={{ __html: t.html ?? '' }} />)}
          {busy === 'chat' && <div class="muted small">{p.name} is thinking…</div>}
        </div>
      )}

      {suggestions.length > 0 && (
        <div class="coach-suggestions">
          <h3>Suggested rule changes <span class="muted small">each one is checked against the schema and the guardrails before it is saved</span></h3>
          {suggestions.map((sg) => {
            const k = `${sg.chain}:${sg.setting}`;
            const done = applied.has(k);
            const has = strategies.some((r) => r.chain === sg.chain);
            return (
              <div class="suggestion" key={k}>
                <span class="pill">{CHAIN_LABEL[sg.chain]}</span>
                <span><code>{sg.setting}</code> → <b>{JSON.stringify(sg.value)}</b>{sg.why ? <span class="muted"> — {sg.why}</span> : null}</span>
                <button class="btn sm" disabled={done || !has || busy !== null} onClick={() => void apply(sg)}>{done ? 'Applied' : has ? 'Apply' : `no ${CHAIN_LABEL[sg.chain]} bot`}</button>
              </div>
            );
          })}
        </div>
      )}

      {turns.length > 0 && (
        <form class="coach-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
          <input class="input" placeholder="Ask a follow-up… e.g. why do my Solana trades lose more than Base?" value={question} onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} disabled={busy !== null} />
          <button class="btn sm" type="submit" disabled={busy !== null || !question.trim()}>Ask</button>
        </form>
      )}
    </section>
  );
}
