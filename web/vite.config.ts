import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The page is one origin with no third-party scripts. In development Vite serves the
// page and proxies /api to the hub; in production the hub serves the built files.
export default defineConfig({
  plugins: [preact()],
  define: { global: 'globalThis' },
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { include: ['buffer', '@solana/web3.js', 'tweetnacl', 'bs58'] },
  build: { target: 'es2022', sourcemap: false, outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
});
