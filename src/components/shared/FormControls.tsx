import { cn } from '@/lib/utils'

// ── parseHHMM / minsToHHMM ────────────────────────────────────────────────
export function parseHHMM(val: string): number {
  const m = val.match(/^(\d{1,3}):(\d{2})$/)
  if (!m) return 0
  const minutes = parseInt(m[2])
  if (minutes > 59) return 0
  return parseInt(m[1]) * 60 + minutes
}

export function isValidHHMM(val: string): boolean {
  const m = val.match(/^(\d{1,3}):(\d{2})$/)
  return !!m && parseInt(m[2]) <= 59
}
export function minsToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2,'0')}:${String(mins % 60).padStart(2,'0')}`
}

export function formatHHMMInput(value: string): string {
  const raw = value.replace(/[^0-9]/g, '').slice(0, 4)
  if (raw.length < 2) return raw
  if (raw.length === 2) return `${raw}:`
  return `${raw.slice(0, 2)}:${raw.slice(2)}`
}

export function completeHHMMInput(value: string): string {
  const raw = value.replace(/[^0-9]/g, '').slice(0, 4)
  if (!raw) return ''
  if (raw.length === 1) return `0${raw}:00`
  if (raw.length === 2) return `${raw}:00`
  if (raw.length === 3) return `${raw.slice(0, 2)}:${raw.slice(2)}0`
  return `${raw.slice(0, 2)}:${raw.slice(2)}`
}

// ── TimeInput — wygodne wpisywanie HH:MM na tablecie ─────────────────────
interface TimeInputProps {
  label: string
  sublabel?: string
  value: string
  onChange: (v: string) => void
  prevValue?: number
  color?: string
  compact?: boolean
  showDelta?: boolean
}

export function TimeInput({ label, sublabel, value, onChange, prevValue = 0, color = 'text-white', compact = false, showDelta = true }: TimeInputProps) {
  const cur       = parseHHMM(value)
  const increment = value && cur >= prevValue ? cur - prevValue : 0
  const hasError  = value !== '' && cur < prevValue && prevValue > 0

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(formatHHMMInput(e.target.value))
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    onChange(completeHHMMInput(e.target.value))
  }

  return (
    <div>
      {label && <label className="label">{label}</label>}
      {sublabel && <div className="text-xs text-navy-500 mb-1.5">{sublabel}</div>}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9:]*"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="00:00"
        maxLength={6}
        className={cn(
          'input font-bold font-mono text-center',
          compact ? 'text-lg py-3' : 'text-2xl py-4 tracking-widest',
          hasError ? 'border-red-500/60' : ''
        )}
      />
      {prevValue > 0 && (
        <div className="text-xs text-navy-500 mt-1">
          Poprzedni: <span className="font-mono text-navy-300">{minsToHHMM(prevValue)}</span>
        </div>
      )}
      {showDelta && value !== '' && (
        <div className={cn('text-sm font-bold mt-1', hasError ? 'text-red-400' : color)}>
          {hasError ? '⚠ Licznik nie może maleć' : `+${minsToHHMM(increment)}`}
        </div>
      )}
    </div>
  )
}

// ── PlanInput — wpisywanie dużych liczb z przyciskami ─────────────────────
interface PlanInputProps {
  value: number
  onChange: (v: number) => void
  placeholder?: string
}

const QUICK_BUTTONS = [
  { label: '+10k',  val: 10000  },
  { label: '+25k',  val: 25000  },
  { label: '+50k',  val: 50000  },
  { label: '+100k', val: 100000 },
]

export function PlanInput({ value, onChange, placeholder = '0' }: PlanInputProps) {
  const display = value > 0 ? value.toLocaleString('pl-PL') : ''

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\s/g, '').replace(/[^0-9]/g, '')
    onChange(parseInt(raw) || 0)
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        className="input text-xl font-bold font-mono text-right py-3 w-full"
      />
      <div className="flex gap-1.5 flex-wrap">
        {QUICK_BUTTONS.map(b => (
          <button key={b.label} type="button"
            onClick={() => onChange(value + b.val)}
            className="flex-1 py-2 text-xs font-bold bg-navy-700 hover:bg-navy-600 text-navy-300 hover:text-white rounded-lg transition-all border border-navy-600 hover:border-brand/50">
            {b.label}
          </button>
        ))}
        {value > 0 && (
          <button type="button" onClick={() => onChange(0)}
            className="py-2 px-3 text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-all border border-red-500/20">
            ✕
          </button>
        )}
      </div>
      {value > 0 && (
        <div className="text-xs text-navy-400 text-right">
          = <span className="font-mono font-bold text-white">{value.toLocaleString('pl-PL')}</span> szt
          · ≈ <span className="font-mono text-navy-300">{Math.round(value / 2500).toFixed(1)} h</span> prod.
        </div>
      )}
    </div>
  )
}

// ── LogoutButton — duży przycisk z ostrzeżeniem przy aktywnej zmianie ─────
interface LogoutButtonProps {
  hasActiveShift: boolean
  onLogout: () => void
}

export function LogoutButton({ hasActiveShift, onLogout }: LogoutButtonProps) {
  const handleClick = () => {
    if (hasActiveShift) {
      if (window.confirm(
        'Masz aktywną zmianę produkcyjną.\n\n' +
        'Czy na pewno chcesz się wylogować?\n\n' +
        'Zmiana pozostanie aktywna — drugi operator lub Ty po ponownym zalogowaniu możecie kontynuować.'
      )) {
        onLogout()
      }
    } else {
      onLogout()
    }
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-bold text-sm transition-all mt-2',
        hasActiveShift
          ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
          : 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
      )}
    >
      <span className="text-lg">{hasActiveShift ? '⚠' : '🚪'}</span>
      <span>Wyloguj się</span>
      {hasActiveShift && <span className="ml-auto text-xs opacity-70">zmiana aktywna</span>}
    </button>
  )
}
