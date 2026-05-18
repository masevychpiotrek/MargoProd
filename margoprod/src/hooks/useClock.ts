import { useState, useEffect } from 'react'

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
    minute: now.getMinutes(),
    second: now.getSeconds()
  }
}

// Current hour block: "08:00–09:00"
export function useCurrentHourBlock() {
  const { hour } = useClock()
  const hh = String(hour).padStart(2, '0')
  const hh2 = String((hour + 1) % 24).padStart(2, '0')
  return `${hh}:00–${hh2}:00`
}

// Countdown to end of current hour
export function useHourCountdown() {
  const { now } = useClock()
  const endOfHour = new Date(now)
  endOfHour.setMinutes(59, 59, 0)
  const diff = Math.max(0, Math.floor((endOfHour.getTime() - now.getTime()) / 1000))
  const mins = Math.floor(diff / 60)
  const secs = diff % 60
  return {
    seconds: diff,
    display: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    isUrgent: diff <= 300  // ostatnie 5 min
  }
}
