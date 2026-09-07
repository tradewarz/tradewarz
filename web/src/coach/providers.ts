// The AI coach talks to the provider the person chose, with the person's own key, straight from
// this browser. Nothing here touches the hub: the key lives in localStorage on this origin, the
// review pack goes from the tab to the provider, and the answer comes back to the tab. Six
// providers behind three request shapes (OpenAI-compatible, Gemini, Anthropic); the free-tier
// ones come first because that is what most people will use.

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'ollama' | 'lmstudio' | 'openai' | 'anthropic';
type Shape = 'openai' | 'gemini' | 'anthropic';

export interface Provider {
  id: ProviderId;
  name: string;
  shape: Shape;
  /** Base URL of the API (OpenAI shape: the .../v1 root). */
  endpoint: string;
  needsKey: boolean;
  /** Shown as a badge: how this one is free. */
  free: string | null;
  defaultModel: string;
  /** Where the key comes from, in one line. */
  keyHelp: string;
  keyUrl: string | null;
  /** Anything the person must do for the browser to be allowed to call it. */
  note: string | null;
}

export const PROVIDERS: Provider[] = [
  { id: 'gemini', name: 'Google Gemini', shape: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true, free: 'free tier', defaultModel: 'gemini-2.5-flash',
    keyHelp: 'Google AI Studio → Get API key (free tier, no card).', keyUrl: 'https://aistudio.google.com/apikey', note: null },
  { id: 'groq', name: 'Groq', shape: 'openai', endpoint: 'https://api.groq.com/openai/v1', needsKey: true, free: 'free tier', defaultModel: 'llama-3.3-70b-versatile',
    keyHelp: 'console.groq.com → API Keys (free tier, fast open models).', keyUrl: 'https://console.groq.com/keys', note: null },
  { id: 'openrouter', name: 'OpenRouter', shape: 'openai', endpoint: 'https://openrouter.ai/api/v1', needsKey: true, free: 'free models', defaultModel: '',
    keyHelp: 'openrouter.ai → Keys. Models ending in ":free" cost nothing; "Fetch models" lists them.', keyUrl: 'https://openrouter.ai/settings/keys', note: null },
  { id: 'ollama', name: 'Ollama (on your computer)', shape: 'openai', endpoint: 'http://localhost:11434/v1', needsKey: false, free: 'runs locally', defaultModel: 'llama3.1',
    keyHelp: 'No key: Ollama runs on your own machine.', keyUrl: 'https://ollama.com', note: 'Start Ollama with this site allowed as an origin, e.g. OLLAMA_ORIGINS=<this site> — otherwise the browser is refused.' },
  { id: 'lmstudio', name: 'LM Studio (on your computer)', shape: 'openai', endpoint: 'http://localhost:1234/v1', needsKey: false, free: 'runs locally', defaultModel: '',
    keyHelp: 'No key: LM Studio runs on your own machine.', keyUrl: 'https://lmstudio.ai', note: 'In LM Studio\'s server settings switch "Enable CORS" on, then "Fetch models".' },
  { id: 'openai', name: 'OpenAI', shape: 'openai', endpoint: 'https://api.openai.com/v1', needsKey: true, free: null, defaultModel: 'gpt-4.1-mini',
    keyHelp: 'platform.openai.com → API keys (paid, per use).', keyUrl: 'https://platform.openai.com/api-keys', note: null },
  { id: 'anthropic', name: 'Anthropic (Claude)', shape: 'anthropic', endpoint: 'https://api.anthropic.com/v1', needsKey: true, free: null, defaultModel: 'claude-sonnet-4-5',
    keyHelp: 'console.anthropic.com → API keys (paid, per use).', keyUrl: 'https://console.anthropic.com/settings/keys', note: null },
];
export const providerOf = (id: ProviderId): Provider => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;

/** What this browser remembers: the chosen provider and model, an endpoint override for the local ones, and one key per provider. */
export interface CoachSettings { provider: ProviderId; model: string; endpoint: string; keys: Partial<Record<ProviderId, string>> }
/** The call-time view: the chosen provider's key and endpoint. */
export interface CoachCall { provider: ProviderId; model: string; key: string; endpoint: string }
const KEY = 'tradewarz.coach';

export function loadSettings(): CoachSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CoachSettings> | null;
    const p = providerOf((raw?.provider as ProviderId) ?? 'gemini');
    return { provider: p.id, model: raw?.model ?? p.defaultModel, endpoint: raw?.endpoint ?? p.endpoint, keys: raw?.keys ?? {} };
  } catch { const p = PROVIDERS[0]!; return { provider: p.id, model: p.defaultModel, endpoint: p.endpoint, keys: {} }; }
}
export function saveSettings(s: CoachSettings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: settings live for the tab only */ } }
export const callOf = (s: CoachSettings): CoachCall => ({ provider: s.provider, model: s.model, key: s.keys[s.provider] ?? '', endpoint: s.endpoint });

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

const baseOf = (s: CoachCall): string => (s.endpoint || providerOf(s.provider).endpoint).replace(/\/+$/, '');

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try { const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string }; const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message; if (m) return `${res.status}: ${m}`; } catch { /* not json */ }
  return `${res.status}: ${text.slice(0, 200) || res.statusText}`;
}

/** The models this key can use. OpenRouter is filtered to the free ones. */
export async function listModels(s: CoachCall): Promise<string[]> {
  const p = providerOf(s.provider);
  const base = baseOf(s);
  if (p.shape === 'gemini') {
    const res = await fetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': s.key } });
    if (!res.ok) throw new Error(await readError(res));
    const j = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    return (j.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).sort();
  }
  if (p.shape === 'anthropic') {
    const res = await fetch(`${base}/models?limit=100`, { headers: anthropicHeaders(s.key) });
    if (!res.ok) throw new Error(await readError(res));
    const j = (await res.json()) as { data?: Array<{ id: string }> };
    return (j.data ?? []).map((m) => m.id).sort();
  }
  const res = await fetch(`${base}/models`, { headers: s.key ? { authorization: `Bearer ${s.key}` } : {} });
  if (!res.ok) throw new Error(await readError(res));
  const j = (await res.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
  let list = j.data ?? [];
  if (p.id === 'openrouter') list = list.filter((m) => m.id.endsWith(':free') || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0));
  return list.map((m) => m.id).sort();
}

const anthropicHeaders = (key: string): Record<string, string> => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' });

/** One turn: every message so far in, the assistant's reply out. */
export async function chat(s: CoachCall, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const p = providerOf(s.provider);
  const base = baseOf(s);
  const model = s.model || p.defaultModel;
  if (!model) throw new Error('Pick a model first ("Fetch models" lists what your key can use).');
  if (p.needsKey && !s.key) throw new Error(`Paste your ${p.name} key first. ${p.keyHelp}`);
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');

  if (p.shape === 'gemini') {
    const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal, headers: { 'x-goog-api-key': s.key, 'content-type': 'application/json' },
      body: JSON.stringify({ ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}), contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { temperature: 0.3 } }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join('');
    if (!text) throw new Error(j.promptFeedback?.blockReason ? `Gemini refused: ${j.promptFeedback.blockReason}` : 'Gemini returned an empty answer');
    return text;
  }
  if (p.shape === 'anthropic') {
    const res = await fetch(`${base}/messages`, {
      method: 'POST', signal, headers: anthropicHeaders(s.key),
      body: JSON.stringify({ model, max_tokens: 4000, ...(system ? { system } : {}), messages: turns.map((m) => ({ role: m.role, content: m.content })) }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    if (!text) throw new Error('Claude returned an empty answer');
    return text;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (s.key) headers.authorization = `Bearer ${s.key}`;
  if (p.id === 'openrouter') { headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://tradewarz'; headers['X-Title'] = 'TradeWarz'; }
  const res = await fetch(`${base}/chat/completions`, { method: 'POST', signal, headers, body: JSON.stringify({ model, messages, temperature: 0.3 }) });
  if (!res.ok) throw new Error(await readError(res));
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; error?: { message?: string } };
  if (j.error?.message) throw new Error(j.error.message);
  const c = j.choices?.[0]?.message?.content;
  const text = typeof c === 'string' ? c : (c ?? []).map((x) => x.text ?? '').join('');
  if (!text) throw new Error(`${p.name} returned an empty answer`);
  return text;
}
