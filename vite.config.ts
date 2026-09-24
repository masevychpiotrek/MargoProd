import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'MargoProd MES',
        short_name: 'MargoProd',
        description: 'System Monitorowania Produkcji',
        theme_color: '#0f1a2e',
        background_color: '#0f1a2e',
        display: 'standalone',
        id: '/',
        start_url: '/',
        scope: '/',
        orientation: 'any',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        importScripts: ['/chat-push-sw.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // Authenticated responses (including private chats) must not be
            // served from a URL-only cache after switching accounts.
            urlPattern: /^https:\/\/.*supabase\.co\/rest/,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  }
})
