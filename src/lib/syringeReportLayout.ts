type ReportMachine = { name: string; volume_ml?: number | null }

export function syringeReportLine(machine: ReportMachine) {
  const volume = machine.volume_ml ?? Number(machine.name.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i)?.[1]?.replace(',', '.'))
  const large = volume === 50 || volume === 100
  const small = [2, 5, 10, 20].includes(volume)
  const construction = large ? 'Strzykawka trzyczęściowa' : small ? 'Strzykawka dwuczęściowa' : ''
  return {
    machineName: machine.name,
    productLabel: construction ? `${construction} ${volume} ml` : machine.name,
    category: large ? 'Duże strzykawki — trzyczęściowe' : small ? 'Małe strzykawki — dwuczęściowe' : 'Pozostałe linie',
    categoryOrder: small ? 0 : large ? 1 : 2,
    volume: Number.isFinite(volume) && volume > 0 ? volume : Number.MAX_SAFE_INTEGER,
  }
}

export function compareSyringeReportLines(
  a: ReturnType<typeof syringeReportLine>, b: ReturnType<typeof syringeReportLine>,
) {
  return a.categoryOrder - b.categoryOrder || a.volume - b.volume
    || a.machineName.localeCompare(b.machineName, 'pl', { numeric: true })
}
