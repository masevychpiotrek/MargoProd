import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import AppRouter from './router'
import { useAuthStore } from './stores/authStore'
import './index.css'

function isChunkLoadError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason ?? '')
  const normalized = message.toLowerCase()
  return normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('error loading dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('/assets/') && normalized.includes('.js')
}

async function resetAppCache() {
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map(key => caches.delete(key)))
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map(registration => registration.unregister()))
  }
}

function reloadAfterChunkError(reason: unknown) {
  if (!isChunkLoadError(reason)) return
  const key = 'margoline-last-chunk-reload'
  const lastReload = Number(sessionStorage.getItem(key) || 0)
  if (Date.now() - lastReload < 10_000) return
  sessionStorage.setItem(key, String(Date.now()))
  resetAppCache().finally(() => window.location.reload())
}

window.addEventListener('error', event => reloadAfterChunkError(event.error || event.message))
window.addEventListener('unhandledrejection', event => reloadAfterChunkError(event.reason))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: true
    }
  }
})

function AppWithInit() {
  const initialize = useAuthStore(s => s.initialize)
  React.useEffect(() => { initialize() }, [initialize])
  return <AppRouter />
}

class AppCrashBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    reloadAfterChunkError(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunkError = isChunkLoadError(this.state.error)
    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-navy-700 bg-navy-800 p-6 shadow-2xl">
          <div className="text-sm font-bold uppercase tracking-wider text-brand">MargoLine MES</div>
          <h1 className="mt-2 text-2xl font-bold text-white">
            {chunkError ? 'Aktualizacja aplikacji' : 'Blad aplikacji'}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-navy-300">
            {chunkError
              ? 'Przegladarka trzyma stara wersje plikow. Kliknij odswiez, zeby pobrac aktualna wersje.'
              : 'Widok nie zaladowal sie poprawnie. Odswiez aplikacje i sprobuj ponownie.'}
          </p>
          <button
            type="button"
            onClick={() => resetAppCache().finally(() => window.location.reload())}
            className="btn-primary mt-5 w-full py-3"
          >
            Odswiez aplikacje
          </button>
        </div>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppCrashBoundary>
        <AppWithInit />
      </AppCrashBoundary>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>
)
