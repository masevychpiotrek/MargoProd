import { supabase } from './supabase'
import { stationLabel } from './issueReports'
import type { FailureSeverity } from '@/types/database'

const REJECT_LIMIT_PCT = 5
const LOW_OUTPUT_THRESHOLD = 2000

type AlertType = 'high_reject' | 'low_output' | 'combined'

interface SyncProductionAlertParams {
  reportId: string
  shiftId: string
  machineId: string
  operatorId: string
  machineName: string
  operatorName: string
  shiftLabel: string
  reportDate: string
  hourBlock: string
  hourStart: number
  goodCount: number
  rejectCount: number
  target: number
  resultReason?: string | null
  rejectReason?: string | null
  notes?: string | null
  downtimeStation?: string | null
  downtimeCategory?: string | null
  downtimeProblemName?: string | null
  rejectStation?: string | null
  rejectCategory?: string | null
  rejectProblemName?: string | null
}

function rejectPct(good: number, reject: number) {
  const total = good + reject
  return total > 0 ? Math.round((reject / total) * 1000) / 10 : 0
}

function severityFor(alertType: AlertType, reject: number): FailureSeverity {
  if (alertType === 'combined') return 'critical'
  if (alertType === 'high_reject') return reject > 10 ? 'critical' : 'high'
  return 'high'
}

function titleFor(alertType: AlertType) {
  if (alertType === 'combined') return 'Duzy odrzut i niska wydajnosc'
  if (alertType === 'high_reject') return 'Duzy odrzut'
  return 'Niska wydajnosc'
}

function buildDescription(params: SyncProductionAlertParams, alertType: AlertType, reject: number, lowCount: number) {
  const lines = [
    `Automatyczne zgloszenie systemowe: ${titleFor(alertType).toLowerCase()}.`,
    `Zakres: ${params.reportDate}, zmiana ${params.shiftLabel}, ${params.hourBlock}.`,
    `Wynik: ${params.goodCount.toLocaleString('pl-PL')} szt dobrych przy celu godzinowym ${params.target.toLocaleString('pl-PL')} szt.`,
    `Odrzut: ${params.rejectCount.toLocaleString('pl-PL')} szt, ${reject.toLocaleString('pl-PL')}%.`
  ]

  if (reject > REJECT_LIMIT_PCT) {
    lines.push(`Poziom odrzutu przekroczyl prog krytyczny ${REJECT_LIMIT_PCT}%. Wymagana analiza przyczyny i potwierdzenie reakcji.`)
  }
  if (lowCount >= 2) {
    lines.push(`To ${lowCount}. wynik ponizej ${LOW_OUTPUT_THRESHOLD.toLocaleString('pl-PL')} szt w tej zmianie. Wymagana kontrola tempa pracy maszyny.`)
  }
  if (params.resultReason) lines.push(`Komentarz do wyniku: ${params.resultReason}`)
  if (params.downtimeCategory || params.downtimeProblemName) {
    lines.push(`Klasyfikacja niskiej wydajnosci: ${[params.downtimeProblemName, params.downtimeCategory].filter(Boolean).join(' / ')}`)
  }
  if (params.rejectReason) lines.push(`Komentarz do odrzutu: ${params.rejectReason}`)
  if (params.rejectCategory || params.rejectProblemName) {
    lines.push(`Klasyfikacja odrzutu: ${[params.rejectProblemName, params.rejectCategory].filter(Boolean).join(' / ')}`)
  }
  if (params.notes) lines.push(`Uwagi operatora: ${params.notes}`)

  return lines.join('\n')
}

function pickStation(params: SyncProductionAlertParams, alertType: AlertType) {
  if (alertType === 'combined') return params.rejectStation ?? params.downtimeStation ?? 'Automatyczna kontrola wyniku'
  if (alertType === 'high_reject') return params.rejectStation ?? 'Automatyczna kontrola wyniku'
  return params.downtimeStation ?? 'Automatyczna kontrola wyniku'
}

async function sendTeamsAutoAlert(params: SyncProductionAlertParams, alertType: AlertType, reject: number, lowCount: number) {
  const url = import.meta.env.VITE_TEAMS_WEBHOOK_URL
  if (!url) return

  const severity = severityFor(alertType, reject)
  const color = severity === 'critical' ? 'attention' : 'warning'
  const appUrl = `${window.location.origin}/specialist`
  const payload = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          { type: 'TextBlock', text: `Automatyczny alert - ${params.machineName}`, weight: 'Bolder', size: 'Large', color, wrap: true },
          { type: 'TextBlock', text: titleFor(alertType), weight: 'Bolder', color, wrap: true },
          {
            type: 'FactSet',
            facts: [
              { title: 'Data', value: params.reportDate },
              { title: 'Zmiana', value: params.shiftLabel },
              { title: 'Godzina', value: params.hourBlock },
              { title: 'Operator', value: params.operatorName },
              { title: 'Dobre', value: `${params.goodCount.toLocaleString('pl-PL')} szt` },
              { title: 'Odrzut', value: `${params.rejectCount.toLocaleString('pl-PL')} szt (${reject.toLocaleString('pl-PL')}%)` },
              { title: 'Niskie wyniki', value: `${lowCount} w tej zmianie` }
            ]
          },
          { type: 'TextBlock', text: buildDescription(params, alertType, reject, lowCount), wrap: true }
        ],
        actions: [{ type: 'Action.OpenUrl', title: 'Otworz panel specjalisty', url: appUrl }]
      }
    }]
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch {
    // Teams notification is non-critical; the database alert remains the source of truth.
  }
}

export async function syncProductionAlert(params: SyncProductionAlertParams) {
  const reject = rejectPct(params.goodCount, params.rejectCount)

  const { data: shiftReports } = await supabase
    .from('hourly_reports')
    .select('id, good_count, hour_start')
    .eq('shift_id', params.shiftId)
    .is('deleted_at', null)

  const lowCount = (shiftReports ?? []).filter(report => {
    const good = Number(report.good_count ?? 0)
    return good > 0 && good < LOW_OUTPUT_THRESHOLD
  }).length

  const highReject = reject > REJECT_LIMIT_PCT
  const repeatedLowOutput = params.goodCount > 0 && params.goodCount < LOW_OUTPUT_THRESHOLD && lowCount >= 2
  const alertType: AlertType | null = highReject && repeatedLowOutput
    ? 'combined'
    : highReject
      ? 'high_reject'
      : repeatedLowOutput
        ? 'low_output'
        : null

  const { data: existing } = await supabase
    .from('failure_reports')
    .select('id, status')
    .eq('hourly_report_id', params.reportId)
    .eq('auto_generated', true)
    .maybeSingle()

  if (!alertType) {
    if (existing && existing.status !== 'resolved') {
      await supabase
        .from('failure_reports')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution_notes: 'Alert zamkniety automatycznie po korekcie wyniku ponizej progow kontrolnych.',
          auto_metrics: {
            good_count: params.goodCount,
            reject_count: params.rejectCount,
            reject_pct: reject,
            low_output_count: lowCount,
            low_output_threshold: LOW_OUTPUT_THRESHOLD,
            reject_limit_pct: REJECT_LIMIT_PCT
          }
        })
        .eq('id', existing.id)
    }
    return
  }

  const severity = severityFor(alertType, reject)
  const description = buildDescription(params, alertType, reject, lowCount)
  const payload = {
    machine_id: params.machineId,
    shift_id: params.shiftId,
    reporter_id: params.operatorId,
    category: alertType === 'high_reject' ? 'quality_control' : 'process_issue',
    severity,
    status: 'new',
    station: stationLabel(pickStation(params, alertType)),
    description,
    photo_urls: [],
    auto_generated: true,
    hourly_report_id: params.reportId,
    auto_alert_type: alertType,
    auto_metrics: {
      good_count: params.goodCount,
      reject_count: params.rejectCount,
      target: params.target,
      reject_pct: reject,
      low_output_count: lowCount,
      low_output_threshold: LOW_OUTPUT_THRESHOLD,
      reject_limit_pct: REJECT_LIMIT_PCT,
      hour_start: params.hourStart,
      hour_block: params.hourBlock
    }
  }

  if (existing) {
    await supabase
      .from('failure_reports')
      .update({
        ...payload,
        status: existing.status === 'resolved' ? 'new' : existing.status,
        resolved_at: existing.status === 'resolved' ? null : undefined
      })
      .eq('id', existing.id)
    return
  }

  const { error } = await supabase.from('failure_reports').insert(payload)
  if (!error) await sendTeamsAutoAlert(params, alertType, reject, lowCount)
}
