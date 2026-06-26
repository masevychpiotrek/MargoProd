interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  color?: 'red' | 'green' | 'yellow' | 'brand'
  disabled?: boolean
}

const COLOR: Record<string, { on: string; thumb: string }> = {
  red:    { on: 'border-red-500 bg-red-500/20',    thumb: 'bg-red-400' },
  green:  { on: 'border-green-500 bg-green-500/20', thumb: 'bg-green-400' },
  yellow: { on: 'border-yellow-500 bg-yellow-500/20', thumb: 'bg-yellow-400' },
  brand:  { on: 'border-brand bg-brand/20',         thumb: 'bg-brand' },
}

/** Dostępny przełącznik — klikalny na całej szerokości wiersza, obsługuje klawiaturę. */
export default function Toggle({ checked, onChange, label, color = 'brand', disabled }: ToggleProps) {
  const c = COLOR[color]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="text-sm text-navy-300">{label}</span>
      <span
        className={`w-12 h-6 rounded-full border-2 transition-all flex items-center px-0.5 flex-shrink-0 ${
          checked ? c.on : 'border-navy-600 bg-navy-700'
        }`}
      >
        <span className={`w-4 h-4 rounded-full transition-all ${checked ? `translate-x-6 ${c.thumb}` : 'translate-x-0 bg-navy-400'}`} />
      </span>
    </button>
  )
}
