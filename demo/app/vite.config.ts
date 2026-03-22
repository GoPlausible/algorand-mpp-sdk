import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    envPrefix: 'VITE_',
    resolve: {
      // Force Vite to use the ESM (.mjs) build of algokit-utils.
      // The package declares "type": "commonjs" which causes Vite to
      // resolve the CJS build by default, breaking transaction encoding.
      conditions: ['import'],
    },
    server: {
      port: Number(env.VITE_PORT ?? 5173),
      proxy: {
        '/api': env.VITE_API_BASE_URL ?? 'http://localhost:3000',
      },
    },
  }
})
