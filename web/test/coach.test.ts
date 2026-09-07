// The AI coach without a browser or a provider: the request each provider shape receives (with a
// fake fetch), the suggestion block parsing, applying a setting through the schema, and the
// Markdown renderer's escaping. Runs under node --test like the other packages' tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preset } from '@tradewarz/shared';
import { chat, listModels, type CoachCall } from '../src/coach/providers.js';
import { coachSystemPrompt, mdToHtml, parseSuggestions, withSetting, withoutSuggestions } from '../src/coach/coach.js';

type Captured = { url: string; init: RequestInit };
function fakeFetch(reply: unknown, status = 200): { calls: Captured[] } {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls };
}
const body = (c: Captured): Record<string, unknown> => JSON.parse(String(c.init.body)) as Record<string, unknown>;
const header = (c: Captured, name: string): string | undefined => (c.init.headers as Record<string, string>)[name];
const msgs = [{ role: 'system' as const, content: 'be brief' }, { role: 'user' as const, content: 'hello' }];

test('OpenAI-compatible providers get the bearer key, the model and the whole conversation', async () => {
  const { calls } = fakeFetch({ choices: [{ message: { content: 'hi there' } }] });
  const s: CoachCall = { provider: 'groq', model: 'llama-3.3-70b-versatile', key: 'gsk_test', endpoint: 'https://api.groq.com/openai/v1' };
  assert.equal(await chat(s, msgs), 'hi there');
  assert.equal(calls[0]!.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(header(calls[0]!, 'authorization'), 'Bearer gsk_test');
  const b = body(calls[0]!);
  assert.equal(b.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(b.messages, msgs);
});

test('OpenRouter adds its referer headers and lists only free models; Ollama needs no key', async () => {
  const { calls } = fakeFetch({ data: [{ id: 'a/b:free', pricing: { prompt: '0', completion: '0' } }, { id: 'c/d', pricing: { prompt: '0.001', completion: '0.002' } }, { id: 'e/f', pricing: { prompt: '0', completion: '0' } }] });
  const or: CoachCall = { provider: 'openrouter', model: '', key: 'sk-or', endpoint: 'https://openrouter.ai/api/v1' };
  assert.deepEqual(await listModels(or), ['a/b:free', 'e/f']);
  assert.equal(calls[0]!.url, 'https://openrouter.ai/api/v1/models');
  fakeFetch({ choices: [{ message: { content: 'local hi' } }] });
  const ol: CoachCall = { provider: 'ollama', model: 'llama3.1', key: '', endpoint: 'http://localhost:11434/v1' };
  assert.equal(await chat(ol, msgs), 'local hi');
  await assert.rejects(chat({ ...or, key: '', model: 'a/b:free' }, msgs), /Paste your OpenRouter key/);
  await assert.rejects(chat({ provider: 'lmstudio', model: '', key: '', endpoint: 'http://localhost:1234/v1' }, msgs), /Pick a model/);
});

test('Gemini gets the key as a header, the system prompt as system_instruction and user/model roles', async () => {
  const { calls } = fakeFetch({ candidates: [{ content: { parts: [{ text: 'gem' }, { text: 'ini' }] } }] });
  const s: CoachCall = { provider: 'gemini', model: 'gemini-2.5-flash', key: 'AIza', endpoint: 'https://generativelanguage.googleapis.com/v1beta' };
  assert.equal(await chat(s, [...msgs, { role: 'assistant', content: 'earlier' }, { role: 'user', content: 'more' }]), 'gemini');
  assert.equal(calls[0]!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(header(calls[0]!, 'x-goog-api-key'), 'AIza');
  assert.ok(!calls[0]!.url.includes('AIza'), 'the key is never in the URL');
  const b = body(calls[0]!) as { system_instruction: { parts: Array<{ text: string }> }; contents: Array<{ role: string }> };
  assert.equal(b.system_instruction.parts[0]!.text, 'be brief');
  assert.deepEqual(b.contents.map((c) => c.role), ['user', 'model', 'user']);
});

test('Anthropic gets its version and browser-access headers, and a blocked or failed call reads as a sentence', async () => {
  const { calls } = fakeFetch({ content: [{ type: 'text', text: 'claude says' }] });
  const s: CoachCall = { provider: 'anthropic', model: 'claude-sonnet-4-5', key: 'sk-ant', endpoint: 'https://api.anthropic.com/v1' };
  assert.equal(await chat(s, msgs), 'claude says');
  assert.equal(calls[0]!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(header(calls[0]!, 'anthropic-dangerous-direct-browser-access'), 'true');
  assert.equal(header(calls[0]!, 'x-api-key'), 'sk-ant');
  const b = body(calls[0]!) as { system: string; messages: unknown[]; max_tokens: number };
  assert.equal(b.system, 'be brief');
  assert.equal(b.messages.length, 1);
  fakeFetch({ error: { message: 'invalid x-api-key' } }, 401);
  await assert.rejects(chat(s, msgs), /401: invalid x-api-key/);
});

test('suggestions are parsed from the JSON block, filtered to known settings, and stripped from the shown answer', () => {
  const answer = '## Verdict\nToo loose.\n\n```json\n{"suggestions":[{"chain":"solana","setting":"exits.stopLossPct","value":20,"why":"cut losers"},{"chain":"mars","setting":"exits.stopLossPct","value":5},{"chain":"base","setting":"entry.leverage","value":10},{"chain":"bsc","setting":"copy.copySells","value":false,"why":"x"}]}\n```\n';
  const sg = parseSuggestions(answer);
  assert.deepEqual(sg.map((s) => `${s.chain}:${s.setting}=${JSON.stringify(s.value)}`), ['solana:exits.stopLossPct=20', 'bsc:copy.copySells=false']);
  assert.equal(withoutSuggestions(answer), '## Verdict\nToo loose.');
  assert.deepEqual(parseSuggestions('no block here'), []);
  assert.deepEqual(parseSuggestions('```json\nnot json\n```'), []);
});

test('applying a setting changes exactly that field and refuses paths the coach may not touch', () => {
  const s = preset('balanced', 'solana');
  const next = withSetting(s, 'exits.stopLossPct', 20);
  assert.equal(next.exits.stopLossPct, 20);
  assert.equal(s.exits.stopLossPct, preset('balanced', 'solana').exits.stopLossPct, 'the original is untouched');
  assert.equal(next.entry.sizeNative, s.entry.sizeNative);
  const nested = withSetting(s, 'advanced.pump.progressPct.min', 10);
  assert.equal(nested.advanced.pump.progressPct.min, 10);
  assert.throws(() => withSetting(s, 'version', 2), /not a setting/);
  assert.throws(() => withSetting(s, 'constructor.prototype.x', 1), /not a setting/);
});

test('the system prompt names the guardrails and every allowed setting', () => {
  const p = coachSystemPrompt();
  assert.match(p, /stop loss at most 90%/);
  assert.match(p, /exits\.stopLossPct/);
  assert.match(p, /copy\.maxAgeSec/);
  assert.match(p, /Never suggest adding money/);
});

test('the Markdown renderer escapes HTML before adding its own tags', () => {
  const html = mdToHtml('# Title <script>x</script>\n\n- **bold** item\n- `code` item\n\n1. first\n2. second\n\nA *word* and a & sign.\n\n```\n<pre> stuff\n```');
  assert.ok(!html.includes('<script>'), 'no raw script tag');
  assert.match(html, /<h4>Title &lt;script&gt;x&lt;\/script&gt;<\/h4>/);
  assert.match(html, /<ul>\n<li><b>bold<\/b> item<\/li>\n<li><code>code<\/code> item<\/li>\n<\/ul>/);
  assert.match(html, /<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/);
  assert.match(html, /<p>A <i>word<\/i> and a &amp; sign\.<\/p>/);
  assert.match(html, /<pre>&lt;pre&gt; stuff<\/pre>/);
});
