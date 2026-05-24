import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useShiftStore } from '@/stores/shiftStore'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

interface ChatMessage {
  from: 'bot' | 'user'
  text: string
}

function getPageHint(pathname: string, hasShift: boolean) {
  if (pathname.includes('/operator/report')) {
    return 'Pilnuje raportu. Wpisuj stany licznikow narastajaco, a przedzial godziny wybieraj z listy zmiany.'
  }
  if (pathname.includes('/operator/shift')) {
    return hasShift
      ? 'Widze aktywna zmiane. Mozesz wpisac wynik godziny albo zakonczyc zmiane, gdy raporty sa gotowe.'
      : 'Najpierw wybierz maszyne, zmiane i zlecenie. Tej samej zmiany na tej maszynie nie da sie uruchomic drugi raz.'
  }
  if (pathname.includes('/operator/history')) return 'Tutaj sprawdzisz swoje zapisane raporty. Dobry trop, gdy cos trzeba porownac.'
  if (pathname.includes('/manager')) return 'Jestes w widoku kierownika. Patrz na odchylenia, alarmy i brakujace raporty.'
  if (pathname.includes('/admin')) return 'To strefa ustawien. Ostroznie z resetami i zmianami uzytkownikow.'
  return hasShift
    ? 'Zmiana dziala. Najwazniejsze: raportuj po kolei przedzialy godzinowe.'
    : 'Nie widze aktywnej zmiany. Zacznij od wyboru maszyny i zmiany.'
}

function answerFor(text: string, hasShift: boolean) {
  const q = text.toLowerCase()
  if (q.includes('raport') || q.includes('wynik')) {
    return 'Raport wpisujesz za konkretny przedzial z listy, nawet jesli robisz to pozniej. Liczniki podajesz jako stan calkowity, nie sam przyrost.'
  }
  if (q.includes('czas') || q.includes('godzin')) {
    return 'Czasy w raporcie powinny dac razem 01:00: praca + gotowosc + alarm. Przy zakonczeniu zlecenia wpisujesz realny czas od ostatniego raportu.'
  }
  if (q.includes('zmian')) {
    return hasShift
      ? 'Masz juz aktywna zmiane. Drugi raz tej samej zmiany na tej maszynie nie uruchomisz.'
      : 'Zmiane uruchamiasz raz dla maszyny, daty i typu zmiany. Jak juz istnieje, system ja zablokuje.'
  }
  if (q.includes('licznik')) {
    return 'Liczniki sa narastajace. Nowy wpis nie moze byc mniejszy od poprzedniego, bo wtedy przyrost wyszedlby ujemny.'
  }
  if (q.includes('zlecen')) {
    return 'Zlecenie mozesz wybrac istniejace albo utworzyc nowe. Gdy startujesz nowe, poprzednie aktywne powinno zostac zapauzowane.'
  }
  return 'Brzmi jak sprawa do sprawdzenia. Najprosciej: podaj mi, na jakim ekranie jestes i co kliknales, a podpowiem nastepny krok.'
}

export default function RobotAssistant() {
  const location = useLocation()
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [mouse, setMouse] = useState({ x: 0, y: 0, near: false, caught: false })
  const [quip, setQuip] = useState('Pilnuje produkcji.')
  const [idle, setIdle] = useState(0)
  const catchTimer = useRef<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { from: 'bot', text: 'Czuwam. Kliknij mnie, gdy operator robi cos podejrzanego albo gdy trzeba szybko przypomniec zasady.' }
  ])

  useEffect(() => {
    const quips = [
      'Ej, kursor ucieka!',
      'Mam go na radarze.',
      'Chodz tu, maly pikselu.',
      'Kliknij mnie, pogadamy.',
      'Nie wpisuj glupot, ja patrze.'
    ]

    const onMove = (event: PointerEvent) => {
      const robotX = window.innerWidth - 68
      const robotY = window.innerHeight - 68
      const dx = event.clientX - robotX
      const dy = event.clientY - robotY
      const distance = Math.hypot(dx, dy)
      const near = distance < 170
      const caught = distance < 62

      setMouse({ x: dx, y: dy, near, caught })

      if (near && !catchTimer.current) {
        setQuip(quips[Math.floor(Math.random() * quips.length)])
        catchTimer.current = window.setTimeout(() => {
          catchTimer.current = null
        }, 1300)
      }
      if (caught) setQuip('Zlapalem! Teraz raportuj ladnie.')
    }

    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (catchTimer.current) window.clearTimeout(catchTimer.current)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setIdle(v => v + 1), 90)
    return () => window.clearInterval(id)
  }, [])

  const pageHint = useMemo(
    () => getPageHint(location.pathname, Boolean(activeShift)),
    [location.pathname, activeShift]
  )

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    setMessages(prev => [
      ...prev,
      { from: 'user', text: clean },
      { from: 'bot', text: answerFor(clean, Boolean(activeShift)) }
    ])
    setInput('')
  }

  const quickActions = [
    { label: 'Raport', text: 'Jak wpisac raport?' },
    { label: 'Czasy', text: 'Jak wpisac czasy?' },
    { label: 'Zmiana', text: 'Czy moge zaczac zmiane drugi raz?' }
  ]

  const eyeX = Math.max(-3, Math.min(3, mouse.x / 36))
  const eyeY = Math.max(-2, Math.min(2, mouse.y / 46))
  const idleDriftX = Math.sin(idle / 15) * 7 + Math.sin(idle / 39) * 4
  const idleHop = Math.abs(Math.sin(idle / 8)) * 5
  const idleSway = Math.sin(idle / 11) * 3
  const leanX = mouse.near ? Math.max(-10, Math.min(10, mouse.x / 24)) : idleDriftX
  const leanY = mouse.near ? Math.max(-6, Math.min(6, mouse.y / 34)) : -idleHop
  const leftArm = mouse.near ? -52 : -18 + Math.sin(idle / 7) * 10
  const rightArm = mouse.near ? 52 : 18 + Math.cos(idle / 7) * 10
  const leftFoot = Math.sin(idle / 5) * 10
  const rightFoot = Math.cos(idle / 5) * 10
  const bodyTilt = mouse.caught ? 5 : mouse.near ? Math.max(-5, Math.min(5, mouse.x / 70)) : idleSway

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-brand/30 bg-navy-800 shadow-2xl shadow-black/40 animate-slide-in">
          <div className="border-b border-navy-700 bg-navy-900/70 p-4">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-14 shrink-0">
                <div className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-brand" />
                <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1 rounded-full bg-brand shadow shadow-brand/60" />
                <div className="absolute bottom-1 left-0 right-0 h-10 rounded-xl border border-brand/50 bg-navy-950">
                  <div className="mt-3 flex justify-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-300 shadow shadow-cyan-300/80 animate-pulse" />
                    <span className="h-2 w-2 rounded-full bg-cyan-300 shadow shadow-cyan-300/80 animate-pulse" />
                  </div>
                  <div className="mx-auto mt-2 h-1 w-5 rounded-full bg-brand" />
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">Robokontroler</div>
                <div className="truncate text-xs text-navy-400">
                  {activeMachine ? `${activeMachine.name} - zmiana ${activeShift?.shift_type}` : profile?.role ?? 'asystent'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="ml-auto rounded-lg px-2 py-1 text-navy-400 hover:bg-navy-700 hover:text-white">
                x
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-brand/20 bg-brand/10 p-3 text-sm text-amber-100">{pageHint}</div>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto p-4">
            {messages.slice(-6).map((m, i) => (
              <div key={i} className={cn('rounded-xl px-3 py-2 text-sm', m.from === 'bot' ? 'bg-navy-900 text-navy-100' : 'ml-8 bg-brand text-navy-950 font-semibold')}>
                {m.text}
              </div>
            ))}
          </div>

          <div className="border-t border-navy-700 p-3">
            <div className="mb-3 flex gap-2">
              {quickActions.map(a => (
                <button key={a.label} onClick={() => send(a.text)} className="rounded-lg border border-navy-600 bg-navy-900 px-3 py-1.5 text-xs font-bold text-navy-200 hover:border-brand hover:text-brand">
                  {a.label}
                </button>
              ))}
            </div>
            <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Zapytaj robota..." className="input py-2" />
              <button className="btn-primary px-3 py-2" type="submit">OK</button>
            </form>
          </div>
        </div>
      )}

      {!open && (
        <div className={cn(
          'pointer-events-none max-w-56 rounded-2xl border px-3 py-2 text-xs font-bold shadow-lg transition-all',
          mouse.near ? 'translate-y-0 opacity-100 border-brand/40 bg-navy-800 text-amber-100' : 'translate-y-2 opacity-0 border-navy-700 bg-navy-800 text-navy-300'
        )}>
          {quip}
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        onPointerEnter={() => setQuip('Ha! Myslales, ze mnie ominiesz?')}
        className={cn(
          'group relative h-24 w-24 overflow-visible rounded-3xl transition-all hover:scale-105 focus:outline-none',
          mouse.caught ? 'scale-105' : ''
        )}
        style={{ transform: `translate(${leanX}px, ${leanY}px) rotate(${bodyTilt}deg) ${mouse.caught ? 'scale(1.05)' : ''}` }}
        aria-label="Otworz asystenta"
      >
        <span
          className="absolute bottom-4 left-5 h-2 w-10 origin-right rounded-full bg-brand/80 shadow-md shadow-black/30 transition-transform"
          style={{ transform: `rotate(${leftArm}deg)` }}
        />
        <span
          className="absolute bottom-4 right-5 h-2 w-10 origin-left rounded-full bg-brand/80 shadow-md shadow-black/30 transition-transform"
          style={{ transform: `rotate(${rightArm}deg)` }}
        />
        {mouse.near && (
          <span
            className="pointer-events-none fixed h-8 w-8 rounded-full border-2 border-dashed border-brand/70 transition-transform"
            style={{
              left: `calc(100vw - 68px + ${mouse.x}px - 16px)`,
              top: `calc(100vh - 68px + ${mouse.y}px - 16px)`,
              transform: mouse.caught ? 'scale(0.7)' : 'scale(1)'
            }}
          />
        )}

        <span className="absolute bottom-0 left-1/2 h-3 w-16 -translate-x-1/2 rounded-full bg-black/30 blur-[2px]" style={{ transform: `translateX(-50%) scale(${1 + idleHop / 18}, ${1 - idleHop / 22})` }} />

        <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-brand" />
        <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1 rounded-full bg-brand shadow-md shadow-brand/60" />

        <span className={cn(
          'absolute left-1/2 top-3 h-12 w-16 -translate-x-1/2 rounded-2xl border bg-navy-800 shadow-xl shadow-black/40 transition-colors',
          mouse.caught ? 'border-green-400' : mouse.near ? 'border-brand' : 'border-brand/50'
        )}>
          <span className="absolute inset-x-3 top-2 h-6 rounded-xl bg-navy-950 border border-cyan-300/20" />
          <span className="absolute left-5 top-4 h-3 w-3 rounded-full bg-cyan-300 shadow-md shadow-cyan-300/80">
            <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-navy-950" style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }} />
          </span>
          <span className="absolute right-5 top-4 h-3 w-3 rounded-full bg-cyan-300 shadow-md shadow-cyan-300/80">
            <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-navy-950" style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }} />
          </span>
          <span className={cn('absolute left-1/2 top-8 block h-1.5 -translate-x-1/2 rounded-full bg-brand transition-all', mouse.caught ? 'w-4' : mouse.near ? 'w-8' : 'w-6')} />
          <span className="absolute -left-1 top-5 h-3 w-1.5 rounded-l bg-brand/70" />
          <span className="absolute -right-1 top-5 h-3 w-1.5 rounded-r bg-brand/70" />
        </span>

        <span className="absolute bottom-5 left-1/2 h-9 w-12 -translate-x-1/2 rounded-xl border border-brand/30 bg-navy-900 shadow-lg shadow-black/30">
          <span className="absolute left-3 top-2 h-2 w-2 rounded-full bg-brand/70" />
          <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-brand/70" />
          <span className="absolute bottom-2 left-1/2 h-1 w-7 -translate-x-1/2 rounded bg-navy-700" />
        </span>
        <span className="absolute bottom-1 left-8 h-5 w-3 rounded-b bg-brand/80 transition-transform" style={{ transform: `rotate(${leftFoot}deg)` }} />
        <span className="absolute bottom-1 right-8 h-5 w-3 rounded-b bg-brand/80 transition-transform" style={{ transform: `rotate(${rightFoot}deg)` }} />
        {!open && <span className="absolute left-3 top-2 h-3 w-3 rounded-full bg-green-400 ring-4 ring-navy-900" />}
      </button>
    </div>
  )
}
