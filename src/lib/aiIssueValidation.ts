import { supabase } from './supabase'
import { localHeuristicCheck, type ReportIssueType, type HeuristicCheckResult } from './issueReports'

export interface DetectedStation {
  value: string
  label: string
}

export interface IssueCheckResult extends HeuristicCheckResult {
  stationMismatch: boolean
  mismatchMessage: string | null
  category: string | null
  problemName: string | null
  standardizedDescription: string | null
  effect: string | null
  additionalStationsFound: DetectedStation[]
  // true gdy notatka operatora opisuje objaw, ale nie podaje przyczyny -
  // UI pokazuje wtedy opcjonalne pole "przyczyna (jesli znana)"
  askCause: boolean
  validatedBy: 'ai' | 'heuristic'
}

export interface CheckIssueStation {
  value: string
  label: string
  pct: number
}

interface CheckIssueParams {
  reportType: ReportIssueType
  stations: CheckIssueStation[]
  machineName: string
  text: string
  priorOccurrencesThisShift: number
}

function toHeuristicResult(text: string): IssueCheckResult {
  const heuristic = localHeuristicCheck(text)
  return {
    ...heuristic,
    stationMismatch: false,
    mismatchMessage: null,
    category: null,
    problemName: null,
    standardizedDescription: null,
    effect: null,
    additionalStationsFound: [],
    askCause: false,
    validatedBy: 'heuristic'
  }
}

export async function checkIssueDescription(params: CheckIssueParams): Promise<IssueCheckResult> {
  // Szybki lokalny pre-check — oszczedza wywolanie AI dla ewidentnych ogolnikow.
  const preCheck = localHeuristicCheck(params.text)
  if (!preCheck.ok) return toHeuristicResult(params.text)

  try {
    const { data, error } = await supabase.functions.invoke('validate-issue-report', {
      body: params
    })
    if (error || !data || typeof data.ok !== 'boolean') {
      return toHeuristicResult(params.text)
    }
    return {
      ok: data.ok,
      message: data.message ?? null,
      stationMismatch: Boolean(data.stationMismatch),
      mismatchMessage: data.mismatchMessage ?? null,
      category: data.category ?? null,
      problemName: data.problemName ?? null,
      standardizedDescription: data.standardizedDescription ?? null,
      effect: data.effect ?? null,
      additionalStationsFound: Array.isArray(data.additionalStationsFound) ? data.additionalStationsFound : [],
      askCause: Boolean(data.askCause),
      validatedBy: 'ai'
    }
  } catch {
    return toHeuristicResult(params.text)
  }
}
