import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { setTestModeEnabled, useTestMode } from '@/hooks/useTestMode'

interface ResetOption {
  id: string
  label: string
  desc: string
  color: string
  warn: string
  rpc?: string
}

const OPTIONS: ResetOption[] = [
  {
    id: 'reports',
    label: 'Raporty godzinowe',
    desc: 'Usuwa wszystkie raporty godzinowe i zdarzenia przestojowe',
    color: 'border-amber-500/30 hover:border-amber-500/60',
    warn: 'Usuniecie raportów jest nieodwracalne.'
  },
  {
    id: 'shifts',
    label: 'Zmiany produkcyjne',
    desc: 'Usuwa wszystkie zmiany (wymaga wcześniejszego usunięcia raportów)',
    color: 'border-amber-500/30 hover:border-amber-500/60',
    warn: 'Usuwa wszystkie zmiany.'
  },
  {
    id: 'audit',
    label: 'Audit log',
    desc: 'Usuwa historię zdarzeń systemowych',
    color: 'border-navy-600 hover:border-navy-500',
    warn: 'Usuwa historię zdarzeń.'
  },
  {
    id: 'all',
    label: '🚨 RESET WSZYSTKICH DANYCH',
    desc: 'Usuwa wszystkie dane produkcyjne - raporty, zmiany i audit',
    color: 'border-red-500/60 hover:border-red-500 bg-red-500/5',
    warn: 'To usunie WSZYSTKIE dane produkcyjne. Tej operacji nie można cofnąć!'
  }
]

const SA_OPTIONS: ResetOption[] = [
  {
    id: 'sessions',
    label: 'Wpisy operatorów (SA)',
    desc: 'Usuwa wszystkie sesje zmianowe, wpisy produkcji, braki, przestoje, awarie, zgłoszenia jakości, zużycie komponentów, przezbrojenia i przekazania zmian na liniach strzykawkowych',
    color: 'border-amber-500/30 hover:border-amber-500/60',
    warn: 'Usuwa WSZYSTKIE dane wprowadzone przez operatorów linii strzykawkowych. Automaty, asortymenty i kategorie (konfiguracja) zostają nienaruszone.',
    rpc: 'sa_admin_reset_data'
  },
  {
    id: 'audit',
    label: 'Audit log (SA)',
    desc: 'Usuwa historię zdarzeń modułu strzykawkowego',
    color: 'border-navy-600 hover:border-navy-500',
    warn: 'Usuwa historię zdarzeń modułu SA.',
    rpc: 'sa_admin_reset_data'
  },
  {
    id: 'all',
    label: '🚨 RESET WSZYSTKICH DANYCH SA',
    desc: 'Usuwa wszystkie wpisy operatorów oraz audit log modułu strzykawkowego',
    color: 'border-red-500/60 hover:border-red-500 bg-red-500/5',
    warn: 'To usunie WSZYSTKIE dane operatorskie modułu strzykawkowego (sesje, produkcja, braki, przestoje, awarie, jakość, komponenty, przezbrojenia, przekazania) oraz audit log SA. Tej operacji nie można cofnąć!',
    rpc: 'sa_admin_reset_data'
  }
]

type Group = 'ispro' | 'sa'

export default function AdminReset() {
  const testMode = useTestMode()
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [selected,  setSelected]  = useState<string | null>(null)
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [msg,       setMsg]       = useState('')
  const [error,     setError]     = useState('')

  const selectedOption = (selectedGroup === 'sa' ? SA_OPTIONS : OPTIONS).find(o => o.id === selected)

  const pick = (group: Group, id: string) => {
    setSelectedGroup(group); setSelected(id); setConfirm(''); setError('')
  }
  const cancelSelection = () => { setSelectedGroup(null); setSelected(null); setConfirm(''); setError('') }

  const handleResetRpc = async () => {
    if (!selectedOption) return
    if (confirm !== 'RESET') { setError('Wpisz RESET zeby potwierdzic'); return }
    setLoading(true); setError('')
    try {
      const rpcName = selectedOption.rpc ?? 'admin_reset_test_data'
      const { data, error: err } = await supabase.rpc(rpcName, { p_scope: selectedOption.id })
      if (err) {
        const missingFunction = err.message.includes(rpcName) || err.message.includes('schema cache')
        setError(missingFunction
          ? `Reset nie jest jeszcze aktywny w bazie. Wgraj migracje z funkcją ${rpcName} w Supabase SQL Editor i odswiez strone.`
          : `Blad resetu: ${err.message}`)
        return
      }

      const deleted = (data as { deleted?: Record<string, number> } | null)?.deleted ?? {}
      const count = Object.values(deleted).reduce((sum, value) => sum + Number(value), 0)
      setMsg(`OK: ${selectedOption.label} - usunieto ${count} rekordow`)
      cancelSelection()
      setTimeout(() => setMsg(''), 5000)
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Reset danych testowych</h1>
        <p className="text-navy-400 mt-1">Tylko do użytku podczas testowania systemu</p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-sm text-amber-400">
        ⚠ Ta sekcja służy wyłącznie do czyszczenia danych podczas testowania. Po uruchomieniu produkcyjnym zostanie usunięta.
      </div>

      {msg && <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm font-bold">{msg}</div>}

      {/* Tryb testowy */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-white text-sm">Tryb testowy</div>
            <div className="text-xs text-navy-400 mt-1">
              {testMode
                ? '⚡ Aktywny — raporty co minutę, alerty co 10 sekund'
                : '🕐 Produkcyjny — raporty co godzinę, alerty 2 min przed'}
            </div>
          </div>
          <button
            onClick={() => {
              const next = !testMode
              setTestModeEnabled(next)
            }}
            className={cn(
              'px-5 py-2.5 rounded-xl font-bold text-sm transition-all border-2',
              testMode
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-400 hover:bg-amber-500/25'
                : 'bg-brand/10 border-brand/30 text-brand hover:bg-brand/20'
            )}
          >
            {testMode ? '⚡ TEST' : '🕐 PROD'}
          </button>
        </div>
      </div>

      {/* Options — IS PRO */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Automaty IS PRO</div>
        <div className="space-y-3">
          {OPTIONS.map(o => (
            <button key={o.id} onClick={() => pick('ispro', o.id)}
              className={cn('w-full p-4 rounded-xl border-2 text-left transition-all',
                selectedGroup === 'ispro' && selected === o.id ? 'border-red-500 bg-red-500/10' : o.color, 'bg-navy-800'
              )}>
              <div className="font-bold text-white">{o.label}</div>
              <div className="text-xs text-navy-400 mt-1">{o.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Options — Linie strzykawkowe (SA) */}
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-navy-400 mb-2">Linie strzykawkowe (SA)</div>
        <div className="space-y-3">
          {SA_OPTIONS.map(o => (
            <button key={o.id} onClick={() => pick('sa', o.id)}
              className={cn('w-full p-4 rounded-xl border-2 text-left transition-all',
                selectedGroup === 'sa' && selected === o.id ? 'border-red-500 bg-red-500/10' : o.color, 'bg-navy-800'
              )}>
              <div className="font-bold text-white">{o.label}</div>
              <div className="text-xs text-navy-400 mt-1">{o.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Confirm dialog */}
      {selected && selectedOption && (
        <div className="bg-navy-800 border-2 border-red-500/40 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-red-400 mb-2">⚠ Potwierdzenie</h2>
          <p className="text-navy-300 text-sm mb-1">{selectedOption.warn}</p>
          <p className="text-navy-400 text-sm mb-4">Wpisz <span className="font-mono font-bold text-white">RESET</span> żeby potwierdzić:</p>
          <input
            value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())}
            placeholder="RESET" maxLength={5}
            className="input font-mono text-lg font-bold text-center mb-4 tracking-widest"
          />
          {error && <div className="text-red-400 text-sm mb-3">{error}</div>}
          <div className="flex gap-3">
            <button onClick={handleResetRpc} disabled={loading || confirm !== 'RESET'}
              className="btn-danger flex-1 py-3 font-bold disabled:opacity-40">
              {loading ? 'Usuwanie...' : '🗑 Usuń dane'}
            </button>
            <button onClick={cancelSelection}
              className="btn-secondary px-6 py-3">
              Anuluj
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
