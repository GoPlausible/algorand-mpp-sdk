import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const algokitBase = path.dirname(require.resolve('@algorandfoundation/algokit-utils/package.json'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    envPrefix: 'VITE_',
    resolve: {
      alias: {
        // Force ESM (.mjs) builds for algokit-utils.
        // The package declares "type": "commonjs" causing Vite to use CJS by default,
        // which breaks transaction encoding in the browser.
        '@algorandfoundation/algokit-utils/transact': path.join(algokitBase, 'transact/index.mjs'),
        '@algorandfoundation/algokit-utils': path.join(algokitBase, 'index.mjs'),
      },
    },
    server: {
      port: Number(env.VITE_PORT ?? 5173),
      proxy: {
        '/api': env.VITE_API_BASE_URL ?? 'http://localhost:3000',
      },
    },
  }
})
