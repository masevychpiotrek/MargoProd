import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { MachineSignals, Severity } from '@/lib/machineDiagnostics'

interface AiRecommendation {
  recommendation: string
  severity: Severity
}

const SIGNAL_ICON: Record<string, string> = {
  repeated_defect: '🔁',
  high_reject: '⚠️',
  low_performance: '🐢',
  low_availability: '⏸️',
  missing_summary: '📋'
}

// Sekcja "Automaty wymagaja uwagi" - obok istniejacych "Sugestii kierownika"
// (te zostaja jako tania, natychmiastowa lista zbiorcza). Ta jest per-maszyna:
// sygnaly z regul dzialaja od razu za darmo, AI (na zadanie, jeden przycisk)
// sklada je w konkretna rekomendacje - zeby nie generowac kosztu AI przy
// kazdej zmianie filtra/zakresu dat na dashboardzie.
export default function MachineDiagnostics({ machines }: { machines: MachineSignals[] }) {
  const [aiResults, setAiResults] = useState<Record<string, AiRecommendation>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generateAi = async () => {
    if (machines.length === 0) return
    setLoading(true)
    setError('')
    try {
      const { data, error: fnError } = await supabase.functions.invoke<{
        results?: { machineId: string; recommendation: string; severity: Severity }[]
        error?: string
      }>('diagnose-machines', {
        body: { machines: machines.map(m => ({ machineId: m.machineId, machineName: m.machineName, signals: m.signals })) }
      })
      if (fnError || data?.error) {
        let detail = data?.error || fnError?.message || ''
        if (!detail) {
          const ctx = (fnError as { context?: Response } | undefined)?.context
          if (ctx && typeof ctx.text === 'function') {
            try { detail = await ctx.text() } catch { /* ignore */ }
          }
        }
        setError(detail || 'Nie udało się wygenerować analizy AI.')
        return
      }
      const next: Record<string, AiRecommendation> = {}
      for (const r of data?.results ?? []) {
        next[r.machineId] = { recommendation: r.recommendation, severity: r.severity }
      }
      setAiResults(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się wygenerować analizy AI.')
    } finally {
      setLoading(false)
    }
  }

  if (machines.length === 0) return null

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">Automaty wymagają uwagi</div>
          <div className="card-sub">Wzorce wykryte automatycznie z danych — kliknij, aby dodać krótką analizę AI</div>
        </div>
        <button onClick={generateAi} disabled={loading} className="btn-secondary text-xs px-3 py-2 disabled:opacity-50">
          {loading ? 'Generowanie...' : '✨ Generuj analizę AI'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 mb-3">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {machines.map(m => {
          const ai = aiResults[m.machineId]
          const worstSeverity: Severity = m.signals.some(s => s.severity === 'high') ? 'high' : 'medium'
          return (
            <div
              key={m.machineId}
              className={cn(
                'rounded-xl border p-3',
                worstSeverity === 'high' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'
              )}
            >
              <div className="font-bold text-white">{m.machineName}</div>

              {ai ? (
                <div className="mt-2 text-sm text-navy-100">{ai.recommendation}</div>
              ) : (
                <div className="mt-2 space-y-1">
                  {m.signals.map((s, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      <span className="shrink-0">{SIGNAL_ICON[s.type] ?? '•'}</span>
                      <span className={s.severity === 'high' ? 'text-red-300' : 'text-amber-300'}>{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
