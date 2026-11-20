/** Last production day completed at 06:00 in Poland. */
export function getLastCompletedProductionDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  const date = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (Number(get('hour')) < 6 ? 2 : 1))
  return date.toISOString().slice(0, 10)
}
