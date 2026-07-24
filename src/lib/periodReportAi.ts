import { supabase } from '@/lib/supabase'

export type PeriodAiSeverity = 'critical' | 'high' | 'medium' | 'positive'
export type PeriodAiOwner = 'Produkcja' | 'UR' | 'Jakosc' | 'Technolog' | 'Kierownik'

export type PeriodAiRawIssue = {
  id: string
  date: string
  shift: string | null
  hour: string | null
  machineId: string
  machineName: string
  kind: 'performance' | 'reject' | 'note' | 'failure'
  source: string
  title: string
  description: string
  station: string | null
  action: string | null
  status: string | null
  severity: string | null
}

export type PeriodAiEvidence = {
  id: string
  kind: PeriodAiRawIssue['kind']
  source: string
  machineId: string
  machineName: string
  shift: string | null
  hour: string | null
  title: string
  description: string
  station: string | null
  action: string | null
  status: string | null
  severity: string | null
  occurrences: number
  firstDate: string
  lastDate: string
}

export type PeriodAiMetrics = {
  range: { from: string; to: string; machineLabel: string }
  totals: {
    production: number
    target: number
    realizationPct: number
    reject: number
    rejectPct: number
    runtimeMin: number
    lossMin: number
    hourlyReports: number
    manualFailures: number
    systemAlerts: number
  }
  machines: Array<{
    id: string
    name: string
    production: number
    target: number
    realizationPct: number
    rejectPct: number
    runtimeMin: number
  }>
  days: Array<{
    date: string
    production: number
    target: number
    realizationPct: number
    rejectPct: number
  }>
}

export type PeriodAiFinding = {
  severity: PeriodAiSeverity
  title: string
  analysis: string
  businessImpact: string
  recommendation: string
  evidenceIds: string[]
  machines: string[]
  evidenceCount: number
}

export type PeriodAiProblemGroup = {
  category: string
  label: string
  summary: string
  trend: 'recurring' | 'isolated' | 'growing' | 'stable' | 'unknown'
  evidenceIds: string[]
  machines: string[]
  occurrences: number
}

export type PeriodAiRootCause = {
  cause: string
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  evidenceIds: string[]
  machines: string[]
}

export type PeriodAiAction = {
  priority: 1 | 2 | 3
  owner: PeriodAiOwner
  action: string
  why: string
  evidenceIds: string[]
  machines: string[]
}

export type PeriodAiAnalysis = {
  executiveSummary: string
  executiveEvidenceIds: string[]
  managementAssessment: string
  managementEvidenceIds: string[]
  findings: PeriodAiFinding[]
  problemGroups: PeriodAiProblemGroup[]
  rootCauses: PeriodAiRootCause[]
  actions: PeriodAiAction[]
  dataQuality: {
    level: 'high' | 'medium' | 'low'
    assessment: string
    gaps: string[]
  }
  generatedAt: string
  model: string
}

export type PreparedPeriodAiData = {
  evidence: PeriodAiEvidence[]
  duplicatesRemoved: number
  lowValueRemoved: number
  truncated: number
}

const GENERIC_ENTRIES = new Set([
  '-', '--', '.', 'ok', 'brak', 'brak uwag', 'bez uwag', 'nic', 'test',
  'awaria', 'problem', 'postoj', 'przestoj', 'niska wydajnosc', 'duzy odrzut',
  'nie dziala', 'maszyna stoi', 'regulacja'
])

function normalized(value: string) {
  return value
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function isLowValue(item: PeriodAiRawIssue) {
  const description = normalized(item.description)
  if (!description || description.length < 8) return true
  return GENERIC_ENTRIES.has(description)
}

function issuePriority(item: PeriodAiEvidence) {
  const kind = item.kind === 'failure' ? 40 : item.kind === 'reject' ? 30 : item.kind === 'performance' ? 20 : 10
  const unresolved = item.status && !normalized(item.status).includes('rozwiaz') ? 8 : 0
  const recurring = Math.min(item.occurrences, 10)
  return kind + unresolved + recurring
}

export function preparePeriodAiEvidence(rawItems: PeriodAiRawIssue[], maxItems = 300): PreparedPeriodAiData {
  const unique = new Map<string, PeriodAiEvidence>()
  let duplicatesRemoved = 0
  let lowValueRemoved = 0

  rawItems.forEach(item => {
    if (isLowValue(item)) {
      lowValueRemoved += 1
      return
    }

    const key = [
      item.machineId,
      item.kind,
      normalized(item.title),
      normalized(item.station ?? ''),
      normalized(item.description)
    ].join('|')

    const existing = unique.get(key)
    if (existing) {
      existing.occurrences += 1
      if (item.date < existing.firstDate) existing.firstDate = item.date
      if (item.date > existing.lastDate) existing.lastDate = item.date
      if (!existing.action && item.action) existing.action = item.action
      if (item.status) existing.status = item.status
      duplicatesRemoved += 1
      return
    }

    unique.set(key, {
      id: '',
      kind: item.kind,
      source: item.source,
      machineId: item.machineId,
      machineName: item.machineName,
      shift: item.shift,
      hour: item.hour,
      title: item.title.trim(),
      description: item.description.trim(),
      station: item.station?.trim() || null,
      action: item.action?.trim() || null,
      status: item.status?.trim() || null,
      severity: item.severity?.trim() || null,
      occurrences: 1,
      firstDate: item.date,
      lastDate: item.date
    })
  })

  const sorted = [...unique.values()].sort((a, b) =>
    issuePriority(b) - issuePriority(a) ||
    b.lastDate.localeCompare(a.lastDate)
  )
  const truncated = Math.max(0, sorted.length - maxItems)
  const evidence = sorted.slice(0, maxItems).map((item, index) => ({
    ...item,
    id: `E${String(index + 1).padStart(3, '0')}`
  }))

  return { evidence, duplicatesRemoved, lowValueRemoved, truncated }
}

function plainText(value: unknown, maxLength = 1200) {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function narrativeText(value: unknown, maxLength = 1200) {
  const cleaned = plainText(value, maxLength)
  if (!cleaned) return ''
  return cleaned
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => !/\d/.test(sentence))
    .join(' ')
    .trim()
}

function narrativeArray(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return []
  return value.map(item => narrativeText(item, 300)).filter(Boolean).slice(0, maxItems)
}

function normalizeAnalysis(raw: unknown, evidence: PeriodAiEvidence[], model: string): PeriodAiAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('AI zwróciło nieprawidłowy format analizy.')
  const source = raw as Record<string, unknown>
  const evidenceMap = new Map(evidence.map(item => [item.id, item]))

  const refs = (value: unknown) => {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(item => String(item)).filter(id => evidenceMap.has(id)))].slice(0, 30)
  }
  const machinesFor = (ids: string[]) => [...new Set(ids.map(id => evidenceMap.get(id)?.machineName).filter((name): name is string => Boolean(name)))]
  const occurrencesFor = (ids: string[]) => ids.reduce((sum, id) => sum + (evidenceMap.get(id)?.occurrences ?? 0), 0)

  const findings = (Array.isArray(source.findings) ? source.findings : []).flatMap(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const evidenceIds = refs(row.evidenceIds)
    if (!evidenceIds.length) return []
    const severity = ['critical', 'high', 'medium', 'positive'].includes(String(row.severity))
      ? String(row.severity) as PeriodAiSeverity
      : 'medium'
    return [{
      severity,
      title: narrativeText(row.title, 180),
      analysis: narrativeText(row.analysis),
      businessImpact: narrativeText(row.businessImpact, 600),
      recommendation: narrativeText(row.recommendation, 700),
      evidenceIds,
      machines: machinesFor(evidenceIds),
      evidenceCount: occurrencesFor(evidenceIds)
    }].filter(entry => entry.title && entry.analysis)
  }).slice(0, 8)

  const problemGroups = (Array.isArray(source.problemGroups) ? source.problemGroups : []).flatMap(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const evidenceIds = refs(row.evidenceIds)
    if (!evidenceIds.length) return []
    const trendValue = String(row.trend)
    const trend = ['recurring', 'isolated', 'growing', 'stable', 'unknown'].includes(trendValue)
      ? trendValue as PeriodAiProblemGroup['trend']
      : 'unknown'
    return [{
      category: plainText(row.category, 80) || 'other',
      label: narrativeText(row.label, 160) || 'Inne',
      summary: narrativeText(row.summary, 800),
      trend,
      evidenceIds,
      machines: machinesFor(evidenceIds),
      occurrences: occurrencesFor(evidenceIds)
    }]
  }).slice(0, 12)

  const rootCauses = (Array.isArray(source.rootCauses) ? source.rootCauses : []).flatMap(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const evidenceIds = refs(row.evidenceIds)
    if (!evidenceIds.length) return []
    const confidenceValue = String(row.confidence)
    const confidence = ['high', 'medium', 'low'].includes(confidenceValue)
      ? confidenceValue as PeriodAiRootCause['confidence']
      : 'low'
    return [{
      cause: narrativeText(row.cause, 220),
      reasoning: narrativeText(row.reasoning, 800),
      confidence,
      evidenceIds,
      machines: machinesFor(evidenceIds)
    }].filter(entry => entry.cause && entry.reasoning)
  }).slice(0, 6)

  const actions = (Array.isArray(source.actions) ? source.actions : []).flatMap(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const evidenceIds = refs(row.evidenceIds)
    if (!evidenceIds.length) return []
    const priorityValue = Number(row.priority)
    const priority = ([1, 2, 3].includes(priorityValue) ? priorityValue : 3) as 1 | 2 | 3
    const ownerValue = String(row.owner)
    const owner = ['Produkcja', 'UR', 'Jakosc', 'Technolog', 'Kierownik'].includes(ownerValue)
      ? ownerValue as PeriodAiOwner
      : 'Kierownik'
    return [{
      priority,
      owner,
      action: narrativeText(row.action, 700),
      why: narrativeText(row.why, 600),
      evidenceIds,
      machines: machinesFor(evidenceIds)
    }].filter(entry => entry.action && entry.why)
  }).sort((a, b) => a.priority - b.priority).slice(0, 10)

  const qualityRaw = source.dataQuality && typeof source.dataQuality === 'object'
    ? source.dataQuality as Record<string, unknown>
    : {}
  const qualityLevel = String(qualityRaw.level)
  const executiveEvidenceIds = refs(source.executiveEvidenceIds)
  const managementEvidenceIds = refs(source.managementEvidenceIds)

  return {
    executiveSummary: executiveEvidenceIds.length ? narrativeText(source.executiveSummary, 1800) : '',
    executiveEvidenceIds,
    managementAssessment: managementEvidenceIds.length ? narrativeText(source.managementAssessment, 1600) : '',
    managementEvidenceIds,
    findings,
    problemGroups,
    rootCauses,
    actions,
    dataQuality: {
      level: ['high', 'medium', 'low'].includes(qualityLevel) ? qualityLevel as 'high' | 'medium' | 'low' : 'low',
      assessment: narrativeText(qualityRaw.assessment, 800),
      gaps: narrativeArray(qualityRaw.gaps, 8)
    },
    generatedAt: new Date().toISOString(),
    model
  }
}

export async function requestPeriodAiAnalysis(params: {
  metrics: PeriodAiMetrics
  prepared: PreparedPeriodAiData
}) {
  if (!params.prepared.evidence.length) {
    throw new Error('Brak wartościowych wpisów operatorów do analizy AI.')
  }

  const { data, error } = await supabase.functions.invoke('analyze-period-report', {
    body: {
      metrics: params.metrics,
      evidence: params.prepared.evidence,
      preprocessing: {
        duplicatesRemoved: params.prepared.duplicatesRemoved,
        lowValueRemoved: params.prepared.lowValueRemoved,
        truncated: params.prepared.truncated
      }
    }
  })

  if (error) throw new Error(error.message || 'Nie udało się uruchomić analizy AI.')
  if (data?.error) throw new Error(String(data.error))
  return normalizeAnalysis(data?.analysis, params.prepared.evidence, String(data?.model ?? 'Claude'))
}
