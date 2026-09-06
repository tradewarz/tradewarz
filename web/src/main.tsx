// Entry. The Buffer shim is for @solana/web3.js, which still expects Node's Buffer in
// the browser. Everything else is plain browser code.
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { render } from 'preact';
import { App } from './app.js';
import { hubStream } from './engine/stream.js';
import './styles.css';

// A read-mostly handle for the browser console and the end-to-end tests: the stream client
// (candidates, feed status, `inject` for demos). No keys live here.
(globalThis as unknown as { tradewarz: { hubStream: typeof hubStream } }).tradewarz = { hubStream };

render(<App />, document.getElementById('app')!);
