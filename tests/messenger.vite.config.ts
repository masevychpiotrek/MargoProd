import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:4198'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('isolated-chat-test'),
  },
  server: { host: '127.0.0.1', port: 4181, strictPort: true },
})
