import { useState, useEffect } from 'react'

// TRYB TESTOWY — zmień na false w produkcji
const TEST_MODE = localStorage.getItem('margoline-test-mode') === '1'

export function useClock() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return {
    now,
    time: now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timeShort: now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }),
    dateISO: now.toISOString().split('T')[0],
    hour: now.getHours(),
    // W trybie testowym "godzina" = minuta (każda minuta = nowa godzina)
    minute: TEST_MODE ? now.getSeconds() : now.getMinutes(),
    second: now.getSeconds()
  }
}

// W trybie testowym blok minutowy: "14:03–14:04"
export function useCurrentHourBlock() {
  const { now } = useClock()
  if (TEST_MODE) {
    const h = String(now.getHours()).padStart(2, '0')
    const m1 = String(now.getMinutes()).padStart(2, '0')
    const m2 = String((now.getMinutes() + 1) % 60).padStart(2, '0')
    return `${h}:${m1}–${h}:${m2}`
  }
  const { hour } = useClock()
  const hh = String(hour).padStart(2, '0')
  const hh2 = String((hour + 1) % 24).padStart(2, '0')
  return `${hh}:00–${hh2}:00`
}

// Countdown do końca minuty (tryb testowy) lub godziny
export function useHourCountdown() {
  const { now } = useClock()

  if (TEST_MODE) {
    // Odliczanie do końca bieżącej minuty
    const endOfMinute = new Date(now)
    endOfMinute.setSeconds(59, 0)
    const diff = Math.max(0, Math.floor((endOfMinute.getTime() - now.getTime()) / 1000))
    const mins = Math.floor(diff / 60)
    const secs = diff % 60
    return {
      seconds: diff,
      display: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      isUrgent: diff <= 10  // ostatnie 10 sekund
    }
  }

  const endOfHour = new Date(now)
  endOfHour.setMinutes(59, 59, 0)
  const diff = Math.max(0, Math.floor((endOfHour.getTime() - now.getTime()) / 1000))
  const mins = Math.floor(diff / 60)
  const secs = diff % 60
  return {
    seconds: diff,
    display: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    isUrgent: diff <= 300
  }
}
