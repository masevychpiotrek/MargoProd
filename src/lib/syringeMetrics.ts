export function syringeProductionDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`)
  if (Number(get('hour')) < 6) date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export function syringeCurrentShift(now = new Date()): 'I' | 'II' | 'III' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23' }).format(now))
  return hour >= 6 && hour < 14 ? 'I' : hour >= 14 && hour < 22 ? 'II' : 'III'
}

export function syringeRange(type: 'day' | 'week' | 'month', anchor: string) {
  const from = new Date(`${anchor}T12:00:00Z`)
  const to = new Date(from)
  if (type === 'month') {
    from.setUTCDate(1)
    to.setUTCMonth(to.getUTCMonth() + 1, 0)
  } else if (type === 'week') {
    from.setUTCDate(from.getUTCDate() - (from.getUTCDay() + 6) % 7)
    to.setTime(from.getTime())
    to.setUTCDate(to.getUTCDate() + 6)
  }
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export function wholeQuantity(value: string) {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647
}

export function rejectPercent(good: number, reject: number) {
  return good + reject > 0 ? reject / (good + reject) * 100 : 0
}

export function syringeRate(qty: number, elapsedMs: number) {
  return elapsedMs >= 300000 ? Math.round(qty / (elapsedMs / 3600000)) : null
}

export function stoppedMinutes(events: { started_at: string; ended_at: string | null }[], startedAt: string, until: number) {
  const start = new Date(startedAt).getTime()
  const ranges = events.map(e => [Math.max(start, new Date(e.started_at).getTime()), Math.min(until, e.ended_at ? new Date(e.ended_at).getTime() : until)])
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  let end = start
  let duration = 0
  for (const [a, b] of ranges) {
    duration += Math.max(0, b - Math.max(a, end))
    end = Math.max(end, b)
  }
  return Math.round(duration / 60000)
}
