import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const algokitBase = path.dirname(require.resolve('@algorandfoundation/algokit-utils/package.json'))

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@algorandfoundation/algokit-utils/transact': path.join(algokitBase, 'transact/index.mjs'),
      '@algorandfoundation/algokit-utils': path.join(algokitBase, 'index.mjs'),
    },
  },
})
