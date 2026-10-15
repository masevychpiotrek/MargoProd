import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../src/stores/authStore'
import { RequireAuth, PublicOnly } from '../src/features/auth/RequireAuth'
import { roleChoiceState } from '../src/lib/accountRoles'
import ChooseFunction from '../src/pages/ChooseFunction'
import Login from '../src/pages/Login'
import AdminUsers from '../src/pages/admin/Users'
import type { Profile } from '../src/types/database'
import '../src/index.css'

const query = new URLSearchParams(location.search)
const profile = (window as unknown as { __roleProfile?: Profile }).__roleProfile ?? null
sessionStorage.setItem('ml-intro-shown', '1')
useAuthStore.setState({ user: profile ? { id: profile.id } as never : null, profile, isInitialized: true, isLoading: false, ...roleChoiceState(profile) })

function Home() {
  const { profile, requestRoleChoice } = useAuthStore()
  const navigate = useNavigate()
  return <main className="p-5"><h1>{profile?.role === 'operator' ? 'Panel operatora' : 'Panel kierownika'}</h1>
    <button onClick={() => { requestRoleChoice(); navigate('/choose-function') }}>Zmień funkcję</button>
  </main>
}

function Redirect() {
  const role = useAuthStore(state => state.profile?.role)
  return <Navigate to={role === 'manager' ? '/manager' : role === 'admin' ? '/admin/users' : '/operator'} replace />
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[query.get('path') ?? '/']}>
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/choose-function" element={<RequireAuth><ChooseFunction /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><Redirect /></RequireAuth>} />
      <Route path="/manager" element={<RequireAuth roles="manager"><Home /></RequireAuth>} />
      <Route path="/operator" element={<RequireAuth roles="operator"><Home /></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth roles="admin"><AdminUsers /></RequireAuth>} />
      <Route path="/password" element={<RequireAuth><h1>Zmień hasło</h1></RequireAuth>} />
    </Routes>
  </MemoryRouter></QueryClientProvider>
)
