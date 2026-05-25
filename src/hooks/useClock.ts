import { useState, useEffect } from 'react'
import { useTestMode } from './useTestMode'

export function useClock() {
  const testMode = useTestMode()
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
    // W trybie testowym "minuta" = sekundy w bloku 3-minutowym
    minute: testMode ? Math.floor(now.getMinutes() % 3 * 60 + now.getSeconds()) : now.getMinutes(),
    second: now.getSeconds()
  }
}

// W trybie testowym blok minutowy: "14:03–14:04"
export function useCurrentHourBlock() {
  const testMode = useTestMode()
  const { now } = useClock()
  if (testMode) {
    const h = String(now.getHours()).padStart(2, '0')
    const blockStart = Math.floor(now.getMinutes() / 3) * 3
    const blockEnd = blockStart + 3
    const m1 = String(blockStart).padStart(2, '0')
    const m2 = String(blockEnd % 60).padStart(2, '0')
    return `${h}:${m1}–${h}:${m2}`
  }
  const hour = now.getHours()
  const hh = String(hour).padStart(2, '0')
  const hh2 = String((hour + 1) % 24).padStart(2, '0')
  return `${hh}:00–${hh2}:00`
}

// Countdown do końca minuty (tryb testowy) lub godziny
export function useHourCountdown() {
  const testMode = useTestMode()
  const { now } = useClock()

  if (testMode) {
    // Odliczanie do końca bieżącego bloku 3-minutowego
    const blockStart = Math.floor(now.getMinutes() / 3) * 3
    const endOfBlock = new Date(now)
    endOfBlock.setMinutes(blockStart + 3, 0, 0)
    const diff = Math.max(0, Math.floor((endOfBlock.getTime() - now.getTime()) / 1000))
    const mins = Math.floor(diff / 60)
    const secs = diff % 60
    return {
      seconds: diff,
      display: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      isUrgent: diff <= 20  // ostatnie 20 sekund
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
