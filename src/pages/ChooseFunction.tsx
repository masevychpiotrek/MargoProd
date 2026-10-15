import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Factory, ClipboardList } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { canChooseFunction } from '@/lib/accountRoles'

export default function ChooseFunction() {
  const { profile, selectFunction, signOut } = useAuthStore()
  const [selecting, setSelecting] = useState<'operator' | 'manager' | null>(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  if (!canChooseFunction(profile)) return <Navigate to="/" replace />
  const choose = async (role: 'operator' | 'manager') => {
    if (selecting) return
    setSelecting(role)
    setError('')
    const result = await selectFunction(role)
    if (result.error) { setError(result.error); setSelecting(null); return }
    queryClient.clear()
    navigate(role === 'operator' ? '/operator' : '/manager', { replace: true })
  }
  return <div className="min-h-[100dvh] bg-navy-900 flex items-center justify-center p-4">
    <div className="w-full max-w-xl card space-y-5">
      <div>
        <p className="text-sm text-brand">{profile?.full_name}</p>
        <h1 className="text-2xl font-bold text-white mt-1">Wybierz funkcję</h1>
        <p className="text-sm text-navy-300 mt-2">Jak chcesz teraz pracować?</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <button disabled={!!selecting} onClick={() => choose('operator')} className="btn-secondary min-h-36 flex-col text-base py-6">
          <Factory size={32} /><span className="font-bold">Operator</span>
          <span className="text-xs text-navy-300">{selecting === 'operator' ? 'Otwieranie...' : 'Zmiana, produkcja i zlecenia'}</span>
        </button>
        <button disabled={!!selecting} onClick={() => choose('manager')} className="btn-secondary min-h-36 flex-col text-base py-6">
          <ClipboardList size={32} /><span className="font-bold">Kierownik</span>
          <span className="text-xs text-navy-300">{selecting === 'manager' ? 'Otwieranie...' : 'Nadzór, wyniki i raporty'}</span>
        </button>
      </div>
      <p className="text-xs text-navy-400">Funkcję możesz później zmienić przyciskiem „Zmień funkcję”. Wybór obowiązuje dla tego konta również na innych otwartych urządzeniach. Aktywna zmiana produkcyjna pozostaje zapisana.</p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button disabled={!!selecting} onClick={() => { queryClient.clear(); void signOut() }} className="btn-secondary w-full">Wyloguj się</button>
    </div>
  </div>
}
