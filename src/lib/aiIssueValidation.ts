import { supabase } from './supabase'
import { localHeuristicCheck, type ReportIssueType, type HeuristicCheckResult } from './issueReports'

export interface IssueCheckResult extends HeuristicCheckResult {
  stationMismatch: boolean
  mismatchMessage: string | null
  category: string | null
  problemName: string | null
  standardizedDescription: string | null
  effect: string | null
  validatedBy: 'ai' | 'heuristic'
}

interface CheckIssueParams {
  reportType: ReportIssueType
  station: string
  stationLabel: string
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
      validatedBy: 'ai'
    }
  } catch {
    return toHeuristicResult(params.text)
  }
}
