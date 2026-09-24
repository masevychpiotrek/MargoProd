import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../src/stores/authStore'
import Messages from '../src/pages/Messages'
import MessengerLink from '../src/components/shared/MessengerLink'
import '../src/index.css'

useAuthStore.setState({ profile: (window as any).__chatProfile, isInitialized: true, isLoading: false })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><header className="flex justify-end p-3"><MessengerLink /></header><main className="p-3 md:p-6"><Messages /></main></MemoryRouter>
  </QueryClientProvider>,
)
