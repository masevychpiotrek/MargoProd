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
  const has = (...words: string[]) => words.some(w => q.includes(w))

  if (has('pomoc', 'help', 'umiesz', 'potrafisz', 'co robisz')) {
    return 'Moge pilnowac logiki raportu, przypominac zasady zmian, tlumaczyc bledy, podpowiadac co kliknac i lapac podejrzane ruchy kursora. Z baza nie klocę sie bez dowodow.'
  }
  if (has('raport', 'wynik')) {
    return 'Raport wpisujesz za konkretny przedzial z listy, nawet jesli robisz to pozniej. Liczniki podajesz jako stan calkowity, nie sam przyrost.'
  }
  if (has('czas', 'godzin', 'minut', '01:00', '60')) {
    return 'Czasy w raporcie powinny dac razem 01:00: praca + gotowosc + alarm. Przy zakonczeniu zlecenia wpisujesz realny czas od ostatniego raportu.'
  }
  if (has('zmian', 'start', 'rozpocz')) {
    return hasShift
      ? 'Masz juz aktywna zmiane. Drugi raz tej samej zmiany na tej maszynie nie uruchomisz.'
      : 'Zmiane uruchamiasz raz dla maszyny, daty i typu zmiany. Jak juz istnieje, system ja zablokuje.'
  }
  if (has('licznik', 'narast', 'spad', 'mniejsz')) {
    return 'Liczniki sa narastajace. Nowy wpis nie moze byc mniejszy od poprzedniego, bo wtedy przyrost wyszedlby ujemny.'
  }
  if (has('zlecen', 'order', 'produkc')) {
    return 'Zlecenie mozesz wybrac istniejace albo utworzyc nowe. Gdy startujesz nowe, poprzednie aktywne powinno zostac zapauzowane.'
  }
  if (has('target', 'norm', 'wydajn', 'efektyw')) {
    return 'Target liczymy wzgledem maszyny. Jesli wynik jest ponizej targetu, najlepiej dopisac konkretna przyczyne: material, alarm, przezbrojenie, jakosc albo brak obsady.'
  }
  if (has('blad', 'error', 'nie dziala', 'problem', 'glupot')) {
    return 'Najpierw sprawdz trzy rzeczy: czy wybrano dobra zmiane, czy przedzial godziny nie byl juz wpisany i czy liczniki nie cofnely sie wzgledem poprzedniego raportu.'
  }
  if (has('alarm', 'awaria', 'przestoj', 'stoi')) {
    return 'Jesli maszyna stala, wpisz czas w gotowosci albo alarmie. Gdy postoj ma znaczenie, dodaj zdarzenie przestojowe z kategoria i opisem.'
  }
  if (has('noc', 'nocna', 'iii', '22', '23')) {
    return 'Zmiana nocna idzie w kolejnosci 22, 23, 00, 01, 02, 03, 04, 05. Nie sortuj jej w glowie po numerach, bo 00 jest po 23.'
  }
  if (has('usun', 'cofn', 'poprawic', 'edytowac')) {
    return 'Jesli raport trzeba poprawic po zapisie, najlepiej zrobic to przez widok historii albo panel kierownika, zeby zostal slad kto i co zmienil.'
  }
  if (has('czesc', 'hej', 'siema', 'dzieki')) {
    return 'No czesc. Ja tu chodze, patrze i udaje, ze mam kontrole nad chaosem. Technicznie: mam.'
  }
  return 'Nietypowe pytanie. Podaj mi ekran, maszyne albo komunikat bledu, a odpowiem konkretniej. Ogolna zasada: najpierw zmiana, potem zlecenie, potem raport za przedzial.'
}

function compactPosition() {
  return {
    x: Math.max(12, window.innerWidth - 94),
    y: Math.max(84, window.innerHeight - 118)
  }
}

function edgeTarget() {
  const margin = 96
  const right = Math.max(margin, window.innerWidth - 132)
  const left = window.innerWidth >= 768 ? 336 : margin
  const bottom = Math.max(120, window.innerHeight - 160)
  const top = 116
  const spots = [
    { x: right, y: top + Math.random() * Math.max(1, window.innerHeight * 0.28) },
    { x: right, y: bottom },
    { x: left + Math.random() * 80, y: bottom },
    { x: right - Math.random() * 160, y: bottom }
  ]
  return spots[Math.floor(Math.random() * spots.length)]
}

function keepOffWorkArea(point: { x: number; y: number }) {
  if (window.innerWidth < 768) return compactPosition()
  const contentLeft = 320
  const inWorkArea =
    point.x > contentLeft + 180 &&
    point.x < window.innerWidth - 260 &&
    point.y > 118 &&
    point.y < window.innerHeight - 190

  if (!inWorkArea) {
    return {
      x: Math.max(contentLeft + 24, Math.min(window.innerWidth - 112, point.x)),
      y: Math.max(96, Math.min(window.innerHeight - 128, point.y))
    }
  }

  return edgeTarget()
}

export default function RobotAssistant() {
  const location = useLocation()
  const { activeShift, activeMachine } = useShiftStore()
  const { profile } = useAuthStore()
  const operatorHasShift = profile?.role === 'operator' && !!activeShift
  const [isCompact, setIsCompact] = useState(() => window.innerWidth < 768)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [pos, setPos] = useState(() => ({
    x: Math.max(96, window.innerWidth - 140),
    y: Math.max(120, window.innerHeight - 160)
  }))
  const [mouse, setMouse] = useState({ x: 0, y: 0, near: false, caught: false })
  const [quip, setQuip] = useState('Pilnuje produkcji.')
  const [overdue, setOverdue] = useState(false)
  const [idle, setIdle] = useState(0)
  const posRef = useRef({ x: Math.max(96, window.innerWidth - 140), y: Math.max(120, window.innerHeight - 160) })
  const targetRef = useRef(edgeTarget())
  const mouseRef = useRef({ x: 0, y: 0, near: false, caught: false })
  const openRef = useRef(false)
  const catchTimer = useRef<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { from: 'bot', text: 'Czuwam. Kliknij mnie, gdy operator robi cos podejrzanego albo gdy trzeba szybko przypomniec zasady.' }
  ])

  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    const quips = [
      'Ej, kursor ucieka!',
      'Mam go na radarze.',
      'Chodz tu, maly pikselu.',
      'Kliknij mnie, pogadamy.',
      'Nie wpisuj glupot, ja patrze.'
    ]

    const onMove = (event: PointerEvent) => {
      if (isCompact) return
      const current = posRef.current
      const robotX = current.x + 48
      const robotY = current.y + 54
      const dx = event.clientX - robotX
      const dy = event.clientY - robotY
      const distance = Math.hypot(dx, dy)
      const near = distance < 170
      const caught = distance < 62

      const nextMouse = { x: dx, y: dy, near, caught }
      mouseRef.current = nextMouse
      setMouse(nextMouse)

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
  }, [isCompact])

  useEffect(() => {
    const lines = [
      'Raport sam sie nie wpisze. Ja tylko dramatyzuje.',
      'Wyciagam tekturowa maczete do ciecia wymowek.',
      'Spokojnie, to rekwizyt BHP. Ale raport ma byc.',
      'Tik-tak. Liczniki czekaja, ja tez.',
      'Operatorze, wynik na stol. Kultura musi byc.'
    ]
    const onOverdue = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean }>).detail
      const active = !!detail?.active
      setOverdue(active)
      if (active) setQuip(lines[Math.floor(Math.random() * lines.length)])
    }
    window.addEventListener('margoprod:report-overdue', onOverdue)
    return () => window.removeEventListener('margoprod:report-overdue', onOverdue)
  }, [])

  useEffect(() => {
    const pickTarget = () => {
      if (isCompact) {
        targetRef.current = compactPosition()
        return
      }
      targetRef.current = edgeTarget()
    }

    const moveId = window.setInterval(() => {
      setIdle(v => v + 1)
      setPos(prev => {
        if (isCompact) {
          const next = compactPosition()
          posRef.current = next
          return next
        }
        if (openRef.current) return prev
        const target = mouseRef.current.near
          ? keepOffWorkArea({
              x: prev.x + mouseRef.current.x * 0.025,
              y: prev.y + mouseRef.current.y * 0.025
            })
          : targetRef.current
        const next = keepOffWorkArea({
          x: prev.x + (target.x - prev.x) * 0.045,
          y: prev.y + (target.y - prev.y) * 0.045
        })
        if (Math.hypot(targetRef.current.x - next.x, targetRef.current.y - next.y) < 18 && !mouseRef.current.near) pickTarget()
        posRef.current = next
        return next
      })
    }, 70)

    const targetId = window.setInterval(pickTarget, 4200)
    const resize = () => {
      const compact = window.innerWidth < 768
      setIsCompact(compact)
      const next = compact
        ? compactPosition()
        : keepOffWorkArea({
            x: Math.min(posRef.current.x, window.innerWidth - 80),
            y: Math.min(posRef.current.y, window.innerHeight - 80)
          })
      setPos(next)
      posRef.current = next
    }
    window.addEventListener('resize', resize)
    resize()
    return () => {
      window.clearInterval(moveId)
      window.clearInterval(targetId)
      window.removeEventListener('resize', resize)
    }
  }, [isCompact])

  const pageHint = useMemo(
    () => getPageHint(location.pathname, operatorHasShift),
    [location.pathname, operatorHasShift]
  )

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
    { label: 'Zmiana', text: 'Czy moge zaczac zmiane drugi raz?' },
    { label: 'Awaria', text: 'Co wpisac przy awarii?' },
    { label: 'Target', text: 'Co jesli wynik jest pod targetem?' },
    { label: 'Pomoc', text: 'Co potrafisz?' }
  ]

  const eyeX = Math.max(-3, Math.min(3, mouse.x / 36))
  const eyeY = Math.max(-2, Math.min(2, mouse.y / 46))
  const idleDriftX = isCompact ? 0 : Math.sin(idle / 15) * 7 + Math.sin(idle / 39) * 4
  const idleHop = isCompact ? Math.abs(Math.sin(idle / 12)) * 2 : Math.abs(Math.sin(idle / 8)) * 5
  const idleSway = isCompact ? 0 : Math.sin(idle / 11) * 3
  const leanX = mouse.near ? Math.max(-10, Math.min(10, mouse.x / 24)) : idleDriftX
  const leanY = mouse.near ? Math.max(-6, Math.min(6, mouse.y / 34)) : -idleHop
  const leftArm = overdue ? -35 : mouse.near ? -52 : -18 + Math.sin(idle / 7) * 10
  const rightArm = overdue ? -72 : mouse.near ? 52 : 18 + Math.cos(idle / 7) * 10
  const leftFoot = Math.sin(idle / 5) * 10
  const rightFoot = Math.cos(idle / 5) * 10
  const bodyTilt = overdue ? Math.sin(idle / 3) * 4 : mouse.caught ? 5 : mouse.near ? Math.max(-5, Math.min(5, mouse.x / 70)) : idleSway
  const panelWidth = isCompact ? window.innerWidth - 24 : Math.min(380, window.innerWidth - 32)
  const panelHeight = isCompact ? Math.min(520, window.innerHeight - 96) : Math.min(560, window.innerHeight - 32)
  const panelLeft = isCompact ? 12 : Math.min(Math.max(16, pos.x - 300), window.innerWidth - panelWidth - 16)
  const panelTop = isCompact ? Math.max(12, window.innerHeight - panelHeight - 88) : Math.min(Math.max(16, pos.y - 24), window.innerHeight - panelHeight - 16)

  return (
    <div
      className="fixed z-50 flex flex-col items-end gap-2 sm:gap-3 transition-[left,top] duration-75 ease-linear"
      style={{ left: pos.x, top: pos.y }}
    >
      {open && (
        <div
          className="fixed flex flex-col overflow-hidden rounded-2xl border border-brand/30 bg-navy-800 shadow-2xl shadow-black/40 animate-fade-in"
          style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: panelHeight }}
        >
          <div className="shrink-0 border-b border-navy-700 bg-navy-900/70 p-3 sm:p-4">
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
                  {operatorHasShift ? `${activeMachine?.name} - zmiana ${activeShift?.shift_type}` : profile?.role ?? 'asystent'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="ml-auto rounded-lg px-2 py-1 text-navy-400 hover:bg-navy-700 hover:text-white">
                x
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-brand/20 bg-brand/10 p-3 text-sm text-amber-100">{pageHint}</div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
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
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Zapytaj robota..." className="input py-2" />
              <button className="btn-primary px-3 py-2" type="submit">OK</button>
            </form>
          </div>
        </div>
      )}

      {!open && !isCompact && (
        <div className={cn(
          'pointer-events-none max-w-56 rounded-2xl border px-3 py-2 text-xs font-bold shadow-lg transition-all',
          overdue ? 'translate-y-0 opacity-100 border-red-400/50 bg-red-950/90 text-red-100' :
          mouse.near ? 'translate-y-0 opacity-100 border-brand/40 bg-navy-800 text-amber-100' : 'translate-y-2 opacity-0 border-navy-700 bg-navy-800 text-navy-300'
        )}>
          {quip}
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        onPointerEnter={() => setQuip('Ha! Myslales, ze mnie ominiesz?')}
        className={cn(
          'group relative h-20 w-20 overflow-visible rounded-3xl transition-all hover:scale-105 focus:outline-none sm:h-24 sm:w-24',
          overdue ? 'animate-pulse' : mouse.caught ? 'scale-105' : ''
        )}
        style={{ transform: `translate(${leanX}px, ${leanY}px) rotate(${bodyTilt}deg) ${mouse.caught ? 'scale(1.05)' : ''}` }}
        aria-label="Otworz asystenta"
      >
        <span
          className="absolute bottom-4 left-5 h-2 w-10 origin-right rounded-full bg-brand/80 shadow-md shadow-black/30 transition-transform before:absolute before:-left-1 before:-top-1 before:h-4 before:w-4 before:rounded-full before:bg-navy-800 before:border before:border-brand/40"
          style={{ transform: `rotate(${leftArm}deg)` }}
        />
        <span
          className="absolute bottom-4 right-5 h-2 w-10 origin-left rounded-full bg-brand/80 shadow-md shadow-black/30 transition-transform before:absolute before:-right-1 before:-top-1 before:h-4 before:w-4 before:rounded-full before:bg-navy-800 before:border before:border-brand/40"
          style={{ transform: `rotate(${rightArm}deg)` }}
        />
        {overdue && (
          <span
            className="absolute -right-8 top-0 h-3 w-16 origin-left rounded-r-full border border-red-200/70 bg-[linear-gradient(90deg,#d1d5db,#f8fafc_45%,#ef4444)] shadow-lg shadow-red-500/20"
            style={{ transform: `rotate(${-36 + Math.sin(idle / 3) * 7}deg)` }}
            title="Tekturowa maczeta BHP do cięcia wymówek"
          >
            <span className="absolute -left-4 top-0 h-3 w-5 rounded bg-brand" />
            <span className="absolute right-2 top-1 h-1 w-2 rounded-full bg-red-400" />
          </span>
        )}
        {mouse.near && (
          <span
            className="pointer-events-none fixed h-8 w-8 rounded-full border-2 border-dashed border-brand/70 transition-transform"
            style={{
              left: `${pos.x + 48 + mouse.x - 16}px`,
              top: `${pos.y + 54 + mouse.y - 16}px`,
              transform: mouse.caught ? 'scale(0.7)' : 'scale(1)'
            }}
          />
        )}

        <span className="absolute bottom-0 left-1/2 h-3 w-16 -translate-x-1/2 rounded-full bg-black/30 blur-[2px]" style={{ transform: `translateX(-50%) scale(${1 + idleHop / 18}, ${1 - idleHop / 22})` }} />

        <span className="absolute inset-x-2 bottom-2 top-2 rounded-[1.35rem] bg-brand/10 blur-xl" />

        <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-brand" />
        <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1 rounded-full bg-brand shadow-md shadow-brand/60" />

        <span className={cn(
          'absolute left-1/2 top-3 h-12 w-16 -translate-x-1/2 rounded-2xl border bg-[linear-gradient(145deg,#243b63,#0f1a2e_62%,#070d1a)] shadow-xl shadow-black/40 transition-colors',
          overdue ? 'border-red-400 shadow-red-500/20' : mouse.caught ? 'border-green-400' : mouse.near ? 'border-brand' : 'border-brand/50'
        )}>
          <span className={cn('absolute inset-x-3 top-2 h-6 rounded-xl border', overdue ? 'bg-red-950 border-red-300/30' : 'bg-navy-950 border-cyan-300/20')} />
          <span className={cn('absolute left-5 top-4 h-3 w-3 rounded-full shadow-md', overdue ? 'bg-red-300 shadow-red-300/80' : 'bg-cyan-300 shadow-cyan-300/80')}>
            <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-navy-950" style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }} />
          </span>
          <span className={cn('absolute right-5 top-4 h-3 w-3 rounded-full shadow-md', overdue ? 'bg-red-300 shadow-red-300/80' : 'bg-cyan-300 shadow-cyan-300/80')}>
            <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-navy-950" style={{ transform: `translate(${eyeX}px, ${eyeY}px)` }} />
          </span>
          <span className={cn('absolute left-1/2 top-8 block h-1.5 -translate-x-1/2 rounded-full transition-all', overdue ? 'w-9 bg-red-300' : mouse.caught ? 'w-4 bg-brand' : mouse.near ? 'w-8 bg-brand' : 'w-6 bg-brand')} />
          <span className="absolute -left-1 top-5 h-3 w-1.5 rounded-l bg-brand/70" />
          <span className="absolute -right-1 top-5 h-3 w-1.5 rounded-r bg-brand/70" />
        </span>

        <span className="absolute bottom-5 left-1/2 h-9 w-12 -translate-x-1/2 rounded-xl border border-brand/30 bg-[linear-gradient(180deg,#1a2d4a,#0f1a2e)] shadow-lg shadow-black/30">
          <span className="absolute left-3 top-2 h-2 w-2 rounded-full bg-brand/70" />
          <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-brand/70" />
          <span className="absolute bottom-2 left-1/2 h-1 w-7 -translate-x-1/2 rounded bg-navy-700" />
        </span>
        <span className="absolute bottom-1 left-8 h-5 w-3 rounded-b bg-brand/80 transition-transform after:absolute after:-bottom-1 after:-left-1 after:h-1.5 after:w-5 after:rounded-full after:bg-brand" style={{ transform: `rotate(${leftFoot}deg)` }} />
        <span className="absolute bottom-1 right-8 h-5 w-3 rounded-b bg-brand/80 transition-transform after:absolute after:-bottom-1 after:-right-1 after:h-1.5 after:w-5 after:rounded-full after:bg-brand" style={{ transform: `rotate(${rightFoot}deg)` }} />
        {!open && <span className="absolute left-3 top-2 h-3 w-3 rounded-full bg-green-400 ring-4 ring-navy-900" />}
      </button>
    </div>
  )
}
