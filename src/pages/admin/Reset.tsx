import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

interface ResetOption {
  id: string
  label: string
  desc: string
  color: string
  tables: string[]
  warn: string
}

const OPTIONS: ResetOption[] = [
  {
    id: 'reports',
    label: 'Raporty godzinowe',
    desc: 'Usuwa wszystkie raporty godzinowe i zdarzenia przestojowe',
    color: 'border-amber-500/30 hover:border-amber-500/60',
    tables: ['downtime_events', 'hourly_reports'],
    warn: 'Usuniecie raportów jest nieodwracalne.'
  },
  {
    id: 'shifts',
    label: 'Zmiany produkcyjne',
    desc: 'Usuwa wszystkie zmiany (wymaga wcześniejszego usunięcia raportów)',
    color: 'border-amber-500/30 hover:border-amber-500/60',
    tables: ['shifts'],
    warn: 'Usuwa wszystkie zmiany.'
  },
  {
    id: 'orders',
    label: 'Zlecenia produkcyjne',
    desc: 'Usuwa wszystkie zlecenia produkcyjne',
    color: 'border-red-500/30 hover:border-red-500/60',
    tables: ['production_orders'],
    warn: 'Usuwa wszystkie zlecenia.'
  },
  {
    id: 'plans',
    label: 'Plany miesięczne',
    desc: 'Usuwa wszystkie plany miesięczne asortymentów',
    color: 'border-navy-600 hover:border-navy-500',
    tables: ['monthly_plans'],
    warn: 'Usuwa wszystkie plany.'
  },
  {
    id: 'audit',
    label: 'Audit log',
    desc: 'Usuwa historię zdarzeń systemowych',
    color: 'border-navy-600 hover:border-navy-500',
    tables: ['audit_logs'],
    warn: 'Usuwa historię zdarzeń.'
  },
  {
    id: 'all',
    label: '🚨 RESET WSZYSTKICH DANYCH',
    desc: 'Usuwa wszystkie dane produkcyjne — raporty, zmiany, zlecenia, plany, audit',
    color: 'border-red-500/60 hover:border-red-500 bg-red-500/5',
    tables: ['downtime_events', 'hourly_reports', 'shifts', 'production_orders', 'monthly_plans', 'audit_logs'],
    warn: 'To usunie WSZYSTKIE dane produkcyjne. Tej operacji nie można cofnąć!'
  }
]

export default function AdminReset() {
  const [testMode, setTestMode] = useState(() => localStorage.getItem('margoline-test-mode') === '1')
  const [selected,  setSelected]  = useState<string | null>(null)
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [msg,       setMsg]       = useState('')
  const [error,     setError]     = useState('')

  const selectedOption = OPTIONS.find(o => o.id === selected)

  const handleReset = async () => {
    if (!selectedOption) return
    if (confirm !== 'RESET') { setError('Wpisz RESET żeby potwierdzić'); return }
    setLoading(true); setError('')
    try {
      for (const table of selectedOption.tables) {
        const { error: err } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
        if (err) { setError(`Błąd przy usuwaniu ${table}: ${err.message}`); setLoading(false); return }
      }
      setMsg(`✓ ${selectedOption.label} — dane usunięte`)
      setSelected(null); setConfirm('')
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
              setTestMode(next)
              localStorage.setItem('margoline-test-mode', next ? '1' : '0')
              window.location.reload()
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

      {/* Options */}
      <div className="space-y-3">
        {OPTIONS.map(o => (
          <button key={o.id} onClick={() => { setSelected(o.id); setConfirm(''); setError('') }}
            className={cn('w-full p-4 rounded-xl border-2 text-left transition-all',
              selected === o.id ? 'border-red-500 bg-red-500/10' : o.color, 'bg-navy-800'
            )}>
            <div className="font-bold text-white">{o.label}</div>
            <div className="text-xs text-navy-400 mt-1">{o.desc}</div>
          </button>
        ))}
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
            <button onClick={handleReset} disabled={loading || confirm !== 'RESET'}
              className="btn-danger flex-1 py-3 font-bold disabled:opacity-40">
              {loading ? 'Usuwanie...' : '🗑 Usuń dane'}
            </button>
            <button onClick={() => { setSelected(null); setConfirm(''); setError('') }}
              className="btn-secondary px-6 py-3">
              Anuluj
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
