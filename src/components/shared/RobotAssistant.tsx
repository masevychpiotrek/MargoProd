import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

interface ChatMessage {
  from: 'bot' | 'user'
  text: string
}

interface ValidationEvent {
  message: string
  selector?: string
}

function getHomePosition() {
  const compact = window.innerWidth < 768 || window.matchMedia('(pointer: coarse)').matches
  return compact
    ? { x: Math.max(12, window.innerWidth - 92), y: Math.max(88, window.innerHeight - 112) }
    : { x: Math.max(340, window.innerWidth - 130), y: Math.max(120, window.innerHeight - 150) }
}

function getPageHint(pathname: string, hasShift: boolean) {
  if (pathname.includes('/operator/report')) {
    return 'Kontroluje raport. Wpisuj liczniki narastajaco i trzymaj kolejnosc blokow godzinowych.'
  }
  if (pathname.includes('/operator/shift')) {
    return hasShift
      ? 'Zmiana jest aktywna. Przed zakonczeniem sprawdz, czy wszystkie otwarte bloki maja raport.'
      : 'Wybierz maszyne, zmiane i zlecenie. Ta sama zmiana na tej samej maszynie moze wystartowac tylko raz.'
  }
  if (pathname.includes('/manager')) return 'Widok kierownika. Kontroluj W EPQ, odrzut, alarmy, wydajnosc i braki raportow.'
  if (pathname.includes('/admin')) return 'Strefa administracyjna. Zmiany tutaj wplywaja na prace calego systemu.'
  return hasShift
    ? 'Aktywna zmiana. Raporty wpisuj po kolei.'
    : 'Brak aktywnej zmiany. Zacznij od wyboru maszyny i zmiany.'
}

function answerFor(text: string, hasShift: boolean) {
  const q = text.toLowerCase()
  const has = (...words: string[]) => words.some(w => q.includes(w))

  if (has('raport', 'wynik')) return 'Raport dotyczy konkretnego bloku godziny. Liczniki wpisujesz jako stan calkowity, a system liczy przyrost.'
  if (has('czas', 'godzin', 'minut', '01:00', '60')) return 'W zwyklym raporcie suma czasu pracy, gotowosci i alarmu powinna dac 01:00.'
  if (has('licznik', 'narast', 'mniejsz')) return 'Licznik nie moze byc mniejszy od poprzedniego stanu. To oznaczaloby ujemny przyrost.'
  if (has('zlecen', 'produkc')) return 'Przed zapisem raportu wybierz aktywne zlecenie. Sztuki na zlecenie nie moga przekraczac dobrego przyrostu.'
  if (has('epq', 'wydajn', 'norm')) return 'W EPQ liczymy z dobrych sztuk wzgledem normy czasu rozliczanego. Wydajnosc maszyny liczymy z dobrych i odrzutu.'
  if (has('alarm', 'awaria', 'postoj')) return 'Czas zatrzymania wpisz jako alarm albo postoj. Jesli ma znaczenie, dodaj opis zdarzenia.'
  if (has('zmian', 'start')) return hasShift
    ? 'Masz juz aktywna zmiane. Najpierw ja zakoncz albo kontynuuj raportowanie.'
    : 'Zmiane uruchamiasz dla konkretnej maszyny, daty i typu zmiany.'
  return 'Podaj ekran, komunikat albo pole, ktore budzi watpliwosci. Wtedy wskaze konkretna decyzje.'
}

export default function RobotAssistant() {
  const location = useLocation()
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()
  const operatorHasShift = profile?.role === 'operator' && !!activeShift
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [pos, setPos] = useState(getHomePosition)
  const [notice, setNotice] = useState('Gotowy do kontroli.')
  const [focused, setFocused] = useState(false)
  const timerRef = useRef<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { from: 'bot', text: 'Jestem kontrolerem raportu. Przy bledzie wskaze konkretne miejsce do poprawy.' }
  ])

  const pageHint = useMemo(
    () => getPageHint(location.pathname, operatorHasShift),
    [location.pathname, operatorHasShift]
  )

  useEffect(() => {
    const resetHome = () => {
      if (!focused && !open) setPos(getHomePosition())
    }
    window.addEventListener('resize', resetHome)
    return () => window.removeEventListener('resize', resetHome)
  }, [focused, open])

  useEffect(() => {
    const onValidation = (event: Event) => {
      const detail = (event as CustomEvent<ValidationEvent>).detail
      const message = detail?.message || 'Sprawdz oznaczone pole.'
      const target = detail?.selector ? document.querySelector(detail.selector) : null

      setNotice(message)
      setFocused(true)
      setOpen(false)

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const rect = target.getBoundingClientRect()
        const x = Math.min(window.innerWidth - 104, Math.max(12, rect.right + 12))
        const y = Math.min(window.innerHeight - 112, Math.max(84, rect.top + rect.height / 2 - 42))
        setPos({ x, y })
      } else {
        setPos(getHomePosition())
      }

      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        setFocused(false)
        setNotice('Gotowy do kontroli.')
        setPos(getHomePosition())
      }, 8000)
    }

    window.addEventListener('margoprod:validation-error', onValidation)
    return () => {
      window.removeEventListener('margoprod:validation-error', onValidation)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    setMessages(prev => [
      ...prev,
      { from: 'user', text: clean },
      { from: 'bot', text: answerFor(clean, operatorHasShift) }
    ])
    setInput('')
  }

  const quickActions = [
    { label: 'Raport', text: 'Jak wpisac raport?' },
    { label: 'Czasy', text: 'Jak wpisac czasy?' },
    { label: 'Zlecenie', text: 'Co ze zleceniem?' },
    { label: 'W EPQ', text: 'Jak liczymy W EPQ?' }
  ]

  const panelWidth = Math.min(380, window.innerWidth - 24)
  const panelHeight = Math.min(520, window.innerHeight - 96)
  const panelLeft = window.innerWidth < 768 ? 12 : Math.min(Math.max(16, pos.x - 300), window.innerWidth - panelWidth - 16)
  const panelTop = window.innerWidth < 768 ? Math.max(12, window.innerHeight - panelHeight - 88) : Math.min(Math.max(16, pos.y - 24), window.innerHeight - panelHeight - 16)

  return (
    <div
      className="fixed z-50 flex flex-col items-end gap-2 transition-[left,top] duration-300 ease-out"
      style={{ left: pos.x, top: pos.y }}
    >
      {open && (
        <div
          className="fixed flex flex-col overflow-hidden rounded-2xl border border-brand/30 bg-navy-800 shadow-2xl shadow-black/40"
          style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: panelHeight }}
        >
          <div className="shrink-0 border-b border-navy-700 bg-navy-900/70 p-4">
            <div className="flex items-center gap-3">
              <RobotIcon active={focused} small />
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">Kontroler raportu</div>
                <div className="truncate text-xs text-navy-400">
                  {operatorHasShift ? `${activeMachine?.name} - zmiana ${activeShift?.shift_type}` : profile?.role ?? 'asystent'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="ml-auto rounded-lg px-2 py-1 text-navy-400 hover:bg-navy-700 hover:text-white">
                x
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-brand/20 bg-brand/10 p-3 text-sm text-amber-100">{pageHint}</div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {messages.slice(-6).map((m, i) => (
              <div key={i} className={cn('rounded-xl px-3 py-2 text-sm', m.from === 'bot' ? 'bg-navy-900 text-navy-100' : 'ml-8 bg-brand text-navy-950 font-semibold')}>
                {m.text}
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-navy-700 p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {quickActions.map(a => (
                <button key={a.label} onClick={() => send(a.text)} className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-xs font-bold text-navy-200 hover:border-brand hover:text-brand">
                  {a.label}
                </button>
              ))}
            </div>
            <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Zapytaj kontrolera..." className="input py-2" />
              <button className="btn-primary px-3 py-2" type="submit">OK</button>
            </form>
          </div>
        </div>
      )}

      {!open && (
        <div className={cn(
          'max-w-64 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-lg transition-opacity',
          focused ? 'border-red-400/60 bg-red-950/95 text-red-100' : 'border-navy-700 bg-navy-800 text-navy-200'
        )}>
          {notice}
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'group relative h-20 w-20 overflow-visible rounded-3xl transition-transform hover:scale-105 focus:outline-none',
          focused && 'ring-2 ring-red-400/70'
        )}
        aria-label="Otworz kontrolera raportu"
      >
        <RobotIcon active={focused} />
      </button>
    </div>
  )
}

function RobotIcon({ active, small = false }: { active: boolean; small?: boolean }) {
  const scale = small ? 'scale-75' : 'scale-100'
  return (
    <span className={cn('relative block h-20 w-20 shrink-0', scale)}>
      <span className="absolute bottom-0 left-1/2 h-3 w-14 -translate-x-1/2 rounded-full bg-black/30 blur-[2px]" />
      <span className="absolute left-1/2 top-1 h-4 w-px -translate-x-1/2 bg-brand" />
      <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-brand shadow-md shadow-brand/60" />
      <span className={cn(
        'absolute left-1/2 top-5 h-12 w-16 -translate-x-1/2 rounded-2xl border bg-[linear-gradient(145deg,#243b63,#0f1a2e_62%,#070d1a)] shadow-xl shadow-black/40',
        active ? 'border-red-400 shadow-red-500/20' : 'border-brand/50'
      )}>
        <span className={cn('absolute inset-x-3 top-2 h-6 rounded-xl border', active ? 'border-red-300/30 bg-red-950' : 'border-cyan-300/20 bg-navy-950')} />
        <span className={cn('absolute left-5 top-4 h-3 w-3 rounded-full shadow-md', active ? 'bg-red-300 shadow-red-300/80' : 'bg-cyan-300 shadow-cyan-300/80')} />
        <span className={cn('absolute right-5 top-4 h-3 w-3 rounded-full shadow-md', active ? 'bg-red-300 shadow-red-300/80' : 'bg-cyan-300 shadow-cyan-300/80')} />
        <span className={cn('absolute left-1/2 top-8 h-1.5 -translate-x-1/2 rounded-full', active ? 'w-9 bg-red-300' : 'w-6 bg-brand')} />
      </span>
      <span className="absolute bottom-5 left-1/2 h-9 w-12 -translate-x-1/2 rounded-xl border border-brand/30 bg-[linear-gradient(180deg,#1a2d4a,#0f1a2e)] shadow-lg shadow-black/30">
        <span className="absolute left-3 top-2 h-2 w-2 rounded-full bg-brand/70" />
        <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-brand/70" />
        <span className="absolute bottom-2 left-1/2 h-1 w-7 -translate-x-1/2 rounded bg-navy-700" />
      </span>
    </span>
  )
}
