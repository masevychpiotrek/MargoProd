import { useEffect, useState } from 'react'
import { playAlertSound } from '@/hooks/useAlertEngine'
import { formatHourBlock } from '@/lib/utils'

interface AlertPopupProps {
  hour: number
  onDismiss: () => void
  onGoToReport: () => void
}

export function AlertPopup({ hour, onDismiss, onGoToReport }: AlertPopupProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    playAlertSound(true)
    const interval = setInterval(() => {
      setElapsed(s => s + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7,8,13,0.95)', backdropFilter: 'blur(8px)' }}>

      {/* Pulsing background */}
      <div className="absolute inset-0 animate-pulse"
        style={{ background: 'radial-gradient(ellipse at center, rgba(244,63,94,0.08) 0%, transparent 70%)' }} />

      <div className="relative w-full max-w-lg">
        {/* Alert card */}
        <div className="bg-navy-800 border-2 border-red-500/50 rounded-3xl p-8 text-center shadow-2xl">

          {/* Icon */}
          <div className="text-7xl mb-4 animate-bounce">🚨</div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-red-400 mb-2">
            CZAS NA WPIS!
          </h1>

          {/* Hour block */}
          <div className="text-xl text-white font-mono font-bold mb-1">
            {formatHourBlock(hour)}
          </div>
          <p className="text-navy-300 mb-6">
            Raport godzinowy nie został wpisany
          </p>

          {/* Elapsed timer */}
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-6 py-4 mb-6">
            <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1">
              Opóźnienie
            </div>
            <div className="text-4xl font-bold font-mono text-red-400">
              {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={onGoToReport}
            className="w-full bg-red-500 hover:bg-red-400 text-white font-bold text-xl py-5 rounded-2xl mb-3 transition-all active:scale-95 shadow-lg shadow-red-500/20"
          >
            ✏️ Wpisz wynik teraz
          </button>

          <button
            onClick={onDismiss}
            className="w-full bg-transparent border border-navy-600 text-navy-400 hover:text-white py-3 rounded-xl text-sm transition-all"
          >
            Zamknij (alert pojawi się ponownie za 1 min)
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Notification permission banner ───────────────────────────────────────────
export function NotificationBanner({ onAllow, onDismiss }: { onAllow: () => void, onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 max-w-lg mx-auto">
      <div className="bg-navy-700 border border-brand/30 rounded-2xl p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="text-2xl flex-shrink-0">🔔</div>
          <div className="flex-1">
            <div className="font-bold text-white text-sm mb-1">Włącz powiadomienia</div>
            <div className="text-navy-300 text-xs">
              MargoProd będzie wysyłał alerty gdy zbliża się koniec godziny produkcyjnej
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={onAllow} className="btn-primary flex-1 py-2 text-sm">
            Włącz powiadomienia
          </button>
          <button onClick={onDismiss} className="btn-secondary px-4 py-2 text-sm">
            Nie teraz
          </button>
        </div>
      </div>
    </div>
  )
}
