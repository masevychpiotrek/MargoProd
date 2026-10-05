import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Operators from '../src/pages/manager/Operators'
import '../src/index.css'
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><main className="p-3 md:p-6"><Operators /></main></QueryClientProvider>)
