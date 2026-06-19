import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PRODUCTION_DAY_HOURS, cn, compareProductionHours, getProductionDate } from '@/lib/utils'
import type { HourlyReport, Machine, Shift, ShiftType } from '@/types/database'

// ─── Types ───────────────────────────────────────────────────────────────────

const SHIFTS: ShiftType[] = ['I', 'II', 'III']

type ReportWithContext = Omit<HourlyReport, 'operator'> & {
  ready_min?: number
  alarm_min?: number
  reject_reason?: string | null
  operator?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: ShiftType; shift_date?: string } | { shift_type: ShiftType; shift_date?: string }[] | null
}

type ShiftSummary = {
  good: number; reject: number; reports: number
  runtime: number; ready: number; alarm: number; downtime: number
  notes: string[]
  hasSummary: boolean
}

type MachineDayRow = {
  machineId: string; machineName: string
  shifts: Record<ShiftType, ShiftSummary>
  total: ShiftSummary
}

type ShiftWithSummary = Shift & {
  summary_good_count?: number | null
  summary_reject_count?: number | null
  summary_runtime_min?: number | null
  summary_ready_min?: number | null
  summary_alarm_min?: number | null
  summary_downtime_min?: number | null
  summary_notes?: string | null
}

type ShiftEvent = { machine: string; hour: string; text: string; operator: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}
function todayIso() { return getProductionDate() }
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function emptySummary(): ShiftSummary {
  return { good: 0, reject: 0, reports: 0, runtime: 0, ready: 0, alarm: 0, downtime: 0, notes: [], hasSummary: false }
}
function mins(value: number) {
  const rounded = Math.max(0, Math.round(value || 0))
  if (!rounded) return '-'
  const h = Math.floor(rounded / 60), m = rounded % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`
}
function pieces(value: number) { return value.toLocaleString('pl-PL') }
function timeLine(s: ShiftSummary) {
  if (!s.hasSummary) return 'brak rozliczenia czasu'
  return `praca ${mins(s.runtime)} | got. ${mins(s.ready)} | alarm/postój ${mins(s.alarm + s.downtime)}`
}
function noteText(report: ReportWithContext) {
  return [
    report.downtime_reason?.trim() ? report.downtime_reason.trim() : '',
    report.reject_reason?.trim() ? `Uzasadnienie odrzutu: ${report.reject_reason.trim()}` : '',
    report.notes?.trim() ? `Informacja uzupełniająca: ${report.notes.trim()}` : ''
  ].filter(Boolean).join('. ')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] ?? char))
}

function lockedTokens(value: string) {
  return (value.match(/\bst\.?\s*\d+\b|\b\d{1,2}:\d{2}\b|\b\d+(?:[,.]\d+)?\b/gi) ?? [])
    .map(token => token.toLowerCase().replace(/\s+/g, '').replace(',', '.'))
}

function safePolishedText(original: string, candidate: string | undefined) {
  const cleaned = candidate?.trim()
  if (!cleaned) return original
  const originalTokens = lockedTokens(original).join('|')
  const candidateTokens = lockedTokens(cleaned).join('|')
  if (originalTokens !== candidateTokens) return original
  if (cleaned.length > original.length * 2 + 80) return original
  return cleaned
}

function hasClosingSummary(shift: ShiftWithSummary) {
  return [
    shift.summary_good_count,
    shift.summary_reject_count,
    shift.summary_runtime_min,
    shift.summary_ready_min,
    shift.summary_alarm_min,
    shift.summary_downtime_min
  ].some(value => value !== null && value !== undefined)
}

function applyClosingSummary(target: ShiftSummary, shift: ShiftWithSummary) {
  target.hasSummary = true
  target.good = shift.summary_good_count ?? target.good
  target.reject = shift.summary_reject_count ?? target.reject
  target.runtime = shift.summary_runtime_min ?? target.runtime
  target.ready = shift.summary_ready_min ?? target.ready
  target.alarm = shift.summary_alarm_min ?? target.alarm
  target.downtime = shift.summary_downtime_min ?? target.downtime
  const note = shift.summary_notes?.trim()
  if (note) target.notes.push(`Podsumowanie zmiany: ${note}`)
}

// ─── Email HTML builder ───────────────────────────────────────────────────────

function buildEmailHtml(params: {
  date: string
  rows: MachineDayRow[]
  reports: ReportWithContext[]
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  shiftsHtml: string
  attentionHtml?: string
}) {
  const { date, rows, reports, totals, shiftTotals, shiftsHtml, attentionHtml } = params
  const K = {
    navy:   '#142238', navyMid: '#1B2E4A',
    blue:   '#2563EB', blueDk:  '#1D4ED8', blueLt: '#EFF6FF', blueBr: '#BFDBFE', blueTx: '#1E3A8A',
    teal:   '#0D9488', tealLt:  '#F0FDFA', tealBr: '#99F6E4', tealTx: '#134E4A',
    red:    '#DC2626', redLt:   '#FEF2F2',
    amber:  '#D97706', amberLt: '#FFFBEB',
    green:  '#16A34A',
    gray1:  '#F8FAFC', gray2:   '#E2E8F0', gray3:  '#64748B', gray4: '#94A3B8',
    white:  '#FFFFFF',
    s1bg: '#EEF2FF', s1tx: '#3730A3', s1ac: '#4F46E5',
    s2bg: '#F0FDFA', s2tx: '#134E4A', s2ac: '#0D9488',
    s3bg: '#FFF7ED', s3tx: '#7C2D12', s3ac: '#EA580C',
  }
  const tt = totals.good, to = totals.reject
  const rejectPctVal = tt > 0 ? ((to / tt) * 100).toFixed(2) + '%' : '0,00%'
  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
  const dateLong = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
  const generatedAt = new Date().toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  const F = 'font-family:Arial,Helvetica,sans-serif'
  const emailPalette = [
    { bg: K.blueLt, br: K.blueBr, tx: K.blueTx, ac: K.blue },
    { bg: K.tealLt, br: K.tealBr, tx: K.tealTx, ac: K.teal },
    { bg: '#FFF7ED', br: '#FED7AA', tx: '#7C2D12', ac: '#EA580C' },
    { bg: '#F5F3FF', br: '#DDD6FE', tx: '#4C1D95', ac: '#7C3AED' },
  ]

  function TH(extra = '') {
    return `style="background:${K.navy};color:#fff;padding:10px 14px;font-size:11px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;${F};${extra}"`
  }
  function TD(bg: string, br: string, tx: string, extra = '') {
    return `style="background:${bg};border:1px solid ${br};padding:10px 14px;color:${tx};${F};vertical-align:middle;${extra}"`
  }
  function fmtCell(p: number, o: number) {
    if (!p && !o) return `<span style="color:${K.gray3};font-size:11px;${F}">Zmiana nieprodukcyjna</span><br><span style="color:${K.gray4};font-size:10px;${F}">brak wpisów w systemie</span>`
    const rj = p > 0 ? ((o / p) * 100).toFixed(1) : '0.0'
    const rjColor = parseFloat(rj) > 5 ? K.red : parseFloat(rj) > 2 ? K.amber : K.green
    return `<span style="font-size:15px;font-weight:bold;color:${K.navy};${F}">${pieces(p)} szt.</span>`
      + `<br><span style="color:${K.gray3};font-size:11px;${F}">odrzut: </span>`
      + `<span style="color:${K.red};font-size:11px;font-weight:bold;${F}">${pieces(o)} szt.</span>`
      + `<br><span style="color:${rjColor};font-size:11px;font-weight:bold;${F}">${rj}% odrzutu</span>`
  }

  function buildKpiBanner() {
    const rj = tt > 0 ? ((to / tt) * 100).toFixed(2) : '0.00'
    const rjColor = parseFloat(rj) > 5 ? K.red : parseFloat(rj) > 2 ? K.amber : K.green
    const totalReports = rows.reduce((s, r) => s + r.total.reports, 0)
    const kpis = [
      { label: 'Produkcja dobra',  value: `${pieces(tt)} szt.`, color: K.navy,   sub: 'łącznie wszystkie zmiany' },
      { label: 'Odrzut łącznie',   value: `${pieces(to)} szt.`, color: K.red,    sub: `${rejectPctVal} produkcji` },
      { label: '% odrzutu',        value: `${rj}%`,              color: rjColor,  sub: 'wskaźnik jakości' },
      { label: 'Wpisy godzinowe',  value: `${totalReports}`,     color: K.blue,   sub: 'raportów operatorów' },
    ]
    const cells = kpis.map(k =>
      `<td width="25%" style="padding:0 5px 0 0;vertical-align:top">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:${K.gray1};border:1px solid ${K.gray2};border-top:3px solid ${k.color};padding:12px 14px;${F}">
            <p style="margin:0 0 4px;font-size:10px;font-weight:bold;color:${K.gray3};text-transform:uppercase;letter-spacing:.5px;${F}">${k.label}</p>
            <p style="margin:0 0 2px;font-size:18px;font-weight:bold;color:${k.color};${F}">${k.value}</p>
            <p style="margin:0;font-size:10px;color:${K.gray4};${F}">${k.sub}</p>
          </td></tr>
        </table>
      </td>`
    ).join('')
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr>${cells}<td style="padding:0"></td></tr></table>`
  }

  function buildHourlyGrowthChart() {
    const machineIds = Array.from(new Set(reports.map(r => r.machine_id)))
    if (!machineIds.length) return ''
    const visibleHours = PRODUCTION_DAY_HOURS.filter(h => reports.some(r => r.hour_start === h))
    if (!visibleHours.length) return ''

    const machineMeta = machineIds.map((id, i) => ({
      id, name: rows.find(r => r.machineId === id)?.machineName ?? 'Nieznany automat',
      ...emailPalette[i % emailPalette.length]
    }))
    const maxValue = Math.max(1, ...visibleHours.flatMap(h =>
      machineIds.map(id => reports.filter(r => r.machine_id === id && r.hour_start === h).reduce((s, r) => s + r.good_count, 0))
    ))

    const thead = `<th align="left" style="background:${K.navy};color:#fff;padding:8px 12px;font-size:11px;font-weight:bold;letter-spacing:.5px;${F};border:1px solid ${K.navy};white-space:nowrap">GODZINA</th>`
      + machineMeta.map(m => `<th align="center" style="background:${m.ac};color:#fff;padding:8px 12px;font-size:11px;font-weight:bold;${F};border:1px solid ${m.ac}">${escapeHtml(m.name)}</th>`).join('')

    const tbody = visibleHours.map((h, idx) => {
      const rep = reports.filter(r => r.hour_start === h)
      const label = rep[0]?.hour_block ?? `${String(h).padStart(2,'0')}:00-${String((h+1)%24).padStart(2,'0')}:00`
      const cells = machineMeta.map(m => {
        const good = reports.filter(r => r.machine_id === m.id && r.hour_start === h).reduce((s, r) => s + r.good_count, 0)
        const rej  = reports.filter(r => r.machine_id === m.id && r.hour_start === h).reduce((s, r) => s + r.reject_count, 0)
        const fill = good > 0 ? Math.max(4, Math.round(good / maxValue * 100)) : 0
        return `<td align="center" style="background:${m.bg};border:1px solid ${m.br};padding:8px 10px;${F}">
  <div style="font-size:13px;font-weight:bold;color:${m.tx};${F}">${good > 0 ? `${pieces(good)} szt.` : '–'}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:5px;border-collapse:collapse"><tr>
    <td height="5" style="height:5px;background:${K.gray2};line-height:5px;font-size:1px">
      <table width="${fill}%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td height="5" style="height:5px;background:${m.ac};line-height:5px;font-size:1px">&nbsp;</td></tr></table>
    </td>
  </tr></table>
  <div style="margin-top:3px;font-size:10px;color:${rej > 0 ? K.red : K.gray4};${F}">${rej > 0 ? `odrz. ${pieces(rej)}` : '–'}</div>
</td>`
      }).join('')
      return `<tr>
  <td style="background:${idx % 2 === 0 ? K.gray1 : K.white};border:1px solid ${K.gray2};padding:8px 12px;color:${K.navy};font-size:11px;font-weight:bold;${F};white-space:nowrap">${escapeHtml(label)}</td>
  ${cells}
</tr>`
    }).join('')

    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 10px"><tr>
  <td style="border-bottom:2px solid ${K.blue};padding-bottom:7px">
    <span style="font-size:13px;font-weight:bold;color:${K.blue};${F}">2.&nbsp;&nbsp;Przyrost godzinowy per automat</span>
  </td>
</tr></table>
<p style="margin:0 0 10px;color:${K.gray3};font-size:11px;${F}">Zestawienie wygenerowane automatycznie z danych systemu MargoLine.</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${F}">
<thead><tr>${thead}</tr></thead>
<tbody>${tbody}</tbody>
</table>`
  }

  const machineRows = rows.map((row, idx) => {
    const pal = emailPalette[idx % emailPalette.length]
    return `<tr>
  <td ${TD(pal.bg, pal.br, pal.tx, `font-weight:bold;font-size:13px`)}>${row.machineName}</td>
  <td align="center" ${TD(pal.bg, pal.br, pal.tx)}>${fmtCell(row.shifts.I.good,   row.shifts.I.reject)}</td>
  <td align="center" ${TD(pal.bg, pal.br, pal.tx)}>${fmtCell(row.shifts.II.good,  row.shifts.II.reject)}</td>
  <td align="center" ${TD(pal.bg, pal.br, pal.tx)}>${fmtCell(row.shifts.III.good, row.shifts.III.reject)}</td>
  <td align="center" style="background:${pal.ac};border:1px solid ${pal.ac};padding:10px 14px;color:#fff;font-weight:bold;font-size:16px;${F};text-align:center;vertical-align:middle">
    ${pieces(row.total.good)}<br><span style="font-size:10px;font-weight:normal;opacity:.85">szt.</span>
  </td>
</tr>`
  }).join('\n')

  const prodTable = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;${F}">
<thead><tr>
  <th width="22%" align="left"  ${TH()}>Automat</th>
  <th width="18%" align="center" ${TH('text-align:center')}>Zmiana I</th>
  <th width="18%" align="center" ${TH('text-align:center')}>Zmiana II</th>
  <th width="18%" align="center" ${TH('text-align:center')}>Zmiana III</th>
  <th width="24%" align="center" ${TH('text-align:center')}>\u0141\u0104CZNIE</th>
</tr></thead>
<tbody>
${machineRows}
<tr style="border-top:2px solid ${K.gray2}">
  <td ${TD(K.gray1, K.gray2, K.navy, 'font-weight:bold;font-size:13px')}>\u0141\u0105cznie</td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}>
    <strong style="font-size:14px">${pieces(shiftTotals.I.good)}</strong><br>
    <span style="font-size:11px;color:${K.red}">odrz. ${pieces(shiftTotals.I.reject)}</span>
  </td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}>
    <strong style="font-size:14px">${pieces(shiftTotals.II.good)}</strong><br>
    <span style="font-size:11px;color:${K.red}">odrz. ${pieces(shiftTotals.II.reject)}</span>
  </td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}>
    <strong style="font-size:14px">${pieces(shiftTotals.III.good)}</strong><br>
    <span style="font-size:11px;color:${K.red}">odrz. ${pieces(shiftTotals.III.reject)}</span>
  </td>
  <td align="center" style="background:${K.blue};border:1px solid ${K.blue};padding:10px 14px;color:#fff;font-weight:bold;font-size:17px;${F};text-align:center">
    ${pieces(tt)}<br><span style="font-size:10px;font-weight:normal;opacity:.85">szt.</span>
  </td>
</tr>
</tbody></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr>
  <td style="padding:11px 16px;background:${K.blueLt};border:1px solid ${K.blueBr};border-left:4px solid ${K.blue};${F};font-size:13px;color:${K.navy}">
    \u0141\u0105czna produkcja: <strong>${pieces(tt)} szt.</strong>
    &nbsp;&bull;&nbsp;
    Odrzut: <strong style="color:${K.red}">${pieces(to)} szt.</strong>
    &nbsp;&bull;&nbsp;
    Wska\u017anik odrzutu: <strong style="color:${to / Math.max(tt, 1) * 100 > 5 ? K.red : K.green}">${rejectPctVal}</strong>
  </td>
</tr></table>`

  // Convert shifts HTML to email-safe inline styles
  function convertShiftsToEmail(html: string): string {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    function cn2(node: ChildNode, mc: string): string {
      if (node.nodeType === 3) return (node as Text).textContent || ''
      if (node.nodeType !== 1) return ''
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      const cls = el.className || ''
      const curMC = cls.includes('mc-box') ? (cls.includes('m3') ? 'm3' : 'm4') : mc
      const kids = () => Array.from(el.childNodes).map(c => cn2(c, curMC)).join('')
      if (cls.includes('shift-bar')) {
        const sc  = cls.includes('s1') ? 's1' : cls.includes('s2') ? 's2' : 's3'
        const cfg = { s1: { bg: K.s1bg, tx: K.s1tx, ac: K.s1ac }, s2: { bg: K.s2bg, tx: K.s2tx, ac: K.s2ac }, s3: { bg: K.s3bg, tx: K.s3tx, ac: K.s3ac } }[sc]
        return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 10px"><tr><td style="background:${cfg.bg};border:1px solid ${cfg.ac};border-left:5px solid ${cfg.ac};padding:10px 18px;${F}"><span style="font-size:13px;font-weight:bold;color:${cfg.tx};${F};text-transform:uppercase;letter-spacing:.4px">${kids()}</span></td></tr></table>`
      }
      if (cls.includes('mc-box')) {
        const isM3 = cls.includes('m3')
        const bg = isM3 ? K.blueLt : K.tealLt, br = isM3 ? K.blueBr : K.tealBr, ac = isM3 ? K.blue : K.teal
        return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px"><tr><td style="background:${bg};border:1px solid ${br};border-left:4px solid ${ac};padding:14px 18px;${F}">${kids()}</td></tr></table>`
      }
      if (cls.includes('mc-name')) {
        const ac = curMC === 'm3' ? K.blue : K.teal
        const br = curMC === 'm3' ? K.blueBr : K.tealBr
        return `<p style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid ${br};font-size:13px;font-weight:bold;color:${ac};${F};text-transform:uppercase;letter-spacing:.3px">${kids()}</p>`
      }
      if (cls.includes('mc-body')) return `<div style="font-size:13px;color:${K.navy};line-height:1.8;${F}">${kids()}</div>`
      if (cls.includes('sub-h')) {
        const ac = curMC === 'm3' ? K.blue : K.teal
        return `<p style="margin:12px 0 4px;font-size:11px;font-weight:bold;color:${ac};text-transform:uppercase;letter-spacing:.5px;${F}">${kids()}</p>`
      }
      if (cls.includes('times')) return `<p style="margin:12px 0 0;padding:8px 12px;background:${K.gray1};border:1px solid ${K.gray2};font-size:11px;color:${K.gray3};${F}">${kids()}</p>`
      if (tag === 'p') return `<p style="margin:0 0 6px;font-size:13px;color:${K.navy};line-height:1.8;${F}">${kids()}</p>`
      if (tag === 'ul') return `<ul style="margin:4px 0 10px 20px;padding:0;${F}">${kids()}</ul>`
      if (tag === 'li') return `<li style="margin-bottom:4px;font-size:13px;color:${K.navy};line-height:1.8;${F}">${kids()}</li>`
      if (tag === 'strong') return `<strong style="font-weight:bold;color:${K.navy};${F}">${kids()}</strong>`
      if (tag === 'em') { const es = el.getAttribute('style') || ''; return `<em style="color:${K.gray3};${F};${es}">${kids()}</em>` }
      if (tag === 'span') { const es = el.getAttribute('style') || ''; return `<span style="${F};${es}">${kids()}</span>` }
      if (tag === 'br') return '<br>'
      return kids()
    }
    return Array.from(tmp.childNodes).map(n => cn2(n, '')).join('')
  }

  const emailShifts = convertShiftsToEmail(shiftsHtml)
  const hourlyGrowthChart = buildHourlyGrowthChart()
  const sectionNo = (n: number) => {
    let offset = 0
    if (!hourlyGrowthChart) offset++
    if (!attentionHtml && n >= 4) offset++
    return n - offset
  }

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${F};color:${K.navy};margin:0;padding:0;background:#ffffff">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td style="padding:0">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${K.white};border-bottom:1px solid ${K.gray2}">

  <!-- HEADER -->
  <tr><td style="background:#1E3A5F;padding:0">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:18px 28px;vertical-align:middle">
        <p style="margin:0;font-size:10px;font-weight:bold;color:#93C5FD;text-transform:uppercase;letter-spacing:1.2px;${F}">Margomed S.A.</p>
        <p style="margin:4px 0 0;font-size:17px;font-weight:bold;color:#fff;${F}">Wydzia&#322; Monta&#380;u Automatycznego</p>
        <p style="margin:4px 0 0;font-size:12px;color:#BAD4F5;${F}">Raport produkcyjny &bull; ${dateLong}</p>
      </td>
      <td align="right" style="padding:18px 28px;vertical-align:middle;white-space:nowrap">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="34" height="34" align="center" valign="middle" style="background:#0F172A;border:1px solid #C9A84C;color:#C9A84C;font-size:11px;font-weight:bold;${F}">ML</td>
          <td style="padding-left:8px;text-align:left">
            <p style="margin:0;font-size:10px;color:#93C5FD;${F}">System</p>
            <p style="margin:2px 0 0;font-size:12px;font-weight:bold;color:#fff;${F}">MargoLine</p>
          </td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>

  <!-- BODY -->
  <tr><td style="padding:24px 28px 32px">

    <p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:${K.navy};${F}">
      Szanowni Pa&#324;stwo,<br>
      W za&#322;&#261;czeniu przekazuj&#281; raport z wynik&#243;w produkcyjnych oraz zestawienie kluczowych zdarze&#324; na Wydziale Monta&#380;u Automatycznego z dnia <strong>${dateFormatted}&nbsp;r.</strong>
    </p>

    ${buildKpiBanner()}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px"><tr>
      <td style="border-bottom:2px solid ${K.blue};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.blue};${F}">1.&nbsp;&nbsp;Wyniki produkcyjne wed&#322;ug zmian</span>
      </td>
    </tr></table>
    ${prodTable}

    ${hourlyGrowthChart}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px"><tr>
      <td style="border-bottom:2px solid ${K.blue};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.blue};${F}">${sectionNo(3)}.&nbsp;&nbsp;Przebieg zmian i istotne zdarzenia</span>
      </td>
    </tr></table>
    ${emailShifts}

    ${attentionHtml ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px"><tr>
      <td style="border-bottom:2px solid ${K.amber};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.amber};${F}">${sectionNo(4)}.&nbsp;&nbsp;Zalecenia na nast&#281;pn&#261; zmian&#281;</span>
      </td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
      <td style="background:${K.amberLt ?? '#FFFBEB'};border:1px solid #FDE68A;border-left:4px solid ${K.amber};padding:14px 18px;${F};font-size:13px;color:${K.navy};line-height:1.8">
        ${attentionHtml}
      </td>
    </tr></table>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr>
      <td style="border-top:1px solid ${K.gray2};padding-top:16px">
        <p style="margin:0 0 6px;font-size:13px;color:${K.navy};${F}">W przypadku dodatkowych pyta&#324; lub w&#261;tpliwo&#347;ci pozostaj&#281; do dyspozycji.</p>
        <p style="margin:0;font-size:13px;color:${K.navy};${F}">Z powa&#380;aniem,<br><strong>Kierownik Wydzia&#322;u</strong></p>
      </td>
    </tr></table>

  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:${K.gray1};border-top:1px solid ${K.gray2};padding:12px 28px">
    <p style="margin:0;font-size:10px;color:${K.gray4};${F}">Wygenerowano automatycznie przez system MargoLine &bull; ${generatedAt} &bull; Dane za dzie&#324; ${dateFormatted}</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}


// ─── System report content ────────────────────────────────────────────────────

function uniqueList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function eventText(event: ShiftEvent) {
  return event.text.toLowerCase()
}

function textSentences(value: string) {
  return value
    .split(/(?:\.\s+|\n+|;\s+)/)
    .map(sentence => sentence.trim().replace(/[.。]+$/, ''))
    .filter(Boolean)
}

function isActionText(value: string) {
  const text = value.toLowerCase()
  const actionWords = [
    'czyszcz', 'wyczyszcz', 'regul', 'sprawdz', 'sprawdzon',
    'uruchom', 'wymien', 'ustaw', 'popraw', 'usun', 'usuni',
    'zatrzym', 'zglos', 'zgĹ‚os', 'wezw', 'kontrol', 'skoryg',
    'przezbro', 'napraw', 'odblok', 'kalibr'
  ]
  return actionWords.some(word => text.includes(word))
}

function eventIssueText(event: ShiftEvent) {
  const sentences = textSentences(event.text)
  return sentences.filter(sentence => !isActionText(sentence)).join('. ')
}

function eventActionText(event: ShiftEvent) {
  const sentences = textSentences(event.text)
  return sentences.filter(isActionText).join('. ')
}

function uniqueActionItems(events: ShiftEvent[]) {
  const seen = new Set<string>()
  return events
    .map(event => ({ ...event, text: eventActionText(event) }))
    .filter(event => event.text)
    .filter(event => {
      const key = `${event.hour}|${event.text.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function extractStations(events: ShiftEvent[]) {
  return uniqueList(events.flatMap(event => event.text.match(/\bst\.?\s*\d+\b/gi) ?? []))
}

function actionEvents(events: ShiftEvent[]) {
  const actionWords = ['czyszcz', 'regul', 'sprawdz', 'uruchom', 'wymien', 'ustaw', 'popraw', 'usun', 'zatrzym', 'zgłos', 'zglos', 'wezw', 'kontrol']
  return events.filter(event => actionWords.some(word => eventText(event).includes(word)))
}

function issueLabels(events: ShiftEvent[]) {
  const labels: string[] = []
  events.forEach(event => {
    const text = eventText(event)
    if (text.includes('odrzut') || text.includes('brak') || text.includes('uszkodz')) labels.push('jakość / odrzut')
    if (text.includes('zaci') || text.includes('blok') || text.includes('zakleszcz')) labels.push('zacięcia lub blokowanie pracy')
    if (text.includes('alarm') || text.includes('awari')) labels.push('alarm / awaria')
    if (text.includes('niska') || text.includes('slaba') || text.includes('słaba') || text.includes('wydajno')) labels.push('niska wydajność')
    if (text.includes('szkol')) labels.push('szkolenie / wsparcie operatora')
  })
  return uniqueList(labels)
}

function goalForEvents(events: ShiftEvent[]) {
  const labels = issueLabels(events)
  if (!labels.length) return 'Utrzymanie ciągłości procesu oraz ograniczenie ryzyka ponownego wystąpienia zakłócenia.'
  if (labels.includes('jakość / odrzut')) return 'Ograniczenie odrzutu, stabilizacja jakości oraz zabezpieczenie dalszej produkcji.'
  if (labels.includes('zacięcia lub blokowanie pracy')) return 'Przywrócenie płynnej pracy automatu i ograniczenie kolejnych zatrzymań procesu.'
  if (labels.includes('alarm / awaria')) return 'Usunięcie przyczyny alarmu oraz bezpieczne wznowienie pracy automatu.'
  if (labels.includes('niska wydajność')) return 'Ograniczenie strat produkcyjnych i poprawa stabilności tempa pracy.'
  return 'Utrzymanie stabilnej pracy automatu w trakcie zmiany.'
}

function effectForEvents(events: ShiftEvent[]) {
  const stations = extractStations(events)
  const labels = issueLabels(events)
  if (events.length > 1 && stations.length) return `Zakłócenie wymaga dalszej obserwacji, ponieważ w zapisach powtarza się odniesienie do: ${escapeHtml(stations.join(', '))}.`
  if (events.length > 1 && labels.length) return 'Zdarzenie pojawiało się w kilku wpisach, dlatego należy traktować je jako czynnik mający wpływ na wynik zmiany.'
  return 'Na podstawie dostępnych wpisów nie stwierdzono jednoznacznego potwierdzenia ponownego wystąpienia tego samego zakłócenia.'
}

function handoverForEvents(events: ShiftEvent[]) {
  const stations = extractStations(events)
  const labels = issueLabels(events)
  if (!events.length) return 'Brak dodatkowych zaleceń wynikających z zapisów zmiany.'
  if (stations.length) return `Objąć obserwacją ${escapeHtml(stations.join(', '))} podczas uruchomienia kolejnej zmiany.`
  if (labels.length) return `Przekazać do dalszej kontroli obszar: ${escapeHtml(labels.join(', '))}.`
  return 'Zweryfikować na kolejnej zmianie, czy opisane zakłócenie nie występuje ponownie.'
}

function buildMachineNarrative(machine: string, events: ShiftEvent[], index: number, summary?: ShiftSummary) {
  const machineClass = index % 2 === 0 ? 'm3' : 'm4'
  const summaryLine = summary
    ? `<p class="times">Produkcja: <strong>${pieces(summary.good)} szt.</strong> | Odrzut: <strong>${pieces(summary.reject)} szt.</strong> | Czas pracy: <strong>${mins(summary.runtime)}</strong></p>`
    : ''
  if (!events.length) {
    return `<div class="mc-box ${machineClass}">
  <div class="mc-name">${escapeHtml(machine)}</div>
  <div class="mc-body">
    ${summaryLine}
    <em style="color:#6B7280">Brak istotnych zdarzeń do raportowania.</em>
  </div>
</div>`
  }

  const actionItems = uniqueActionItems(actionEvents(events))
  const issueItems = events
    .map(event => ({ ...event, text: eventIssueText(event) }))
    .filter(event => event.text)
  const labels = issueLabels(issueItems.length ? issueItems : events)
  const chronology = issueItems.length
    ? `<ul>${issueItems.map(event => {
      return `<li><strong>${escapeHtml(event.hour)}</strong>: ${escapeHtml(event.text)}</li>`
    }).join('')}</ul>`
    : '<p>Wpisy z tej zmiany dotyczyły głównie działań operacyjnych; nie odnotowano odrębnego opisu przebiegu zakłócenia.</p>'
  const actionList = actionItems.length
    ? `<ul>${actionItems.map(event => `<li><strong>${escapeHtml(event.hour)}</strong>: ${escapeHtml(event.text)}</li>`).join('')}</ul>`
    : '<p>W zapisach zmiany nie wskazano jednoznacznie szczegółowego opisu działań operacyjnych.</p>'
  const opening = labels.length
    ? `Na automacie odnotowano zakłócenia dotyczące obszaru: ${escapeHtml(labels.join(', '))}.`
    : 'W zapisach zmiany odnotowano informacje wymagające uwzględnienia w ocenie przebiegu produkcji.'
  return `<div class="mc-box ${machineClass}">
  <div class="mc-name">${escapeHtml(machine)}</div>
  <div class="mc-body">
    ${summaryLine}
    <p>${opening}</p>
    <p class="sub-h">Przebieg zmiany:</p>
    ${chronology}
    <p class="sub-h">Działania operacyjne:</p>
    ${actionList}
    <p class="sub-h">Cel działań:</p>
    <p>${goalForEvents(events)}</p>
    <p class="sub-h">Ocena wpływu:</p>
    <p>${effectForEvents(events)}</p>
    <p class="sub-h">Dalsza kontrola:</p>
    <p>${handoverForEvents(events)}</p>
  </div>
</div>`
}

function buildSystemReportHtml(
  eventsByShift: Record<ShiftType, ShiftEvent[]>,
  shiftTotals: Record<ShiftType, ShiftSummary>,
  machineNames: string[],
  rows: MachineDayRow[] = []
): string {
  return SHIFTS.map((shift, shiftIndex) => {
    const shiftClass = shiftIndex === 0 ? 's1' : shiftIndex === 1 ? 's2' : 's3'
    const st = shiftTotals[shift]
    const eventsByMachine = new Map<string, ShiftEvent[]>()
    eventsByShift[shift].forEach(event => {
      const name = event.machine || '-'
      eventsByMachine.set(name, [...(eventsByMachine.get(name) ?? []), event])
    })

    const knownMachines = rows.length ? rows.map(row => row.machineName) : machineNames.length ? machineNames : Array.from(eventsByMachine.keys())
    const allMachines = Array.from(new Set([...knownMachines, ...eventsByMachine.keys()]))
    const machineBlocks = allMachines
      .map((machine, index) => {
        const row = rows.find(item => item.machineName === machine)
        return buildMachineNarrative(machine, eventsByMachine.get(machine) ?? [], index, row?.shifts[shift])
      })
      .join('\n')

    return `<div class="shift-bar ${shiftClass}">Zmiana ${shift} - produkcja łącznie ${pieces(st.good)} szt., odrzut łącznie ${pieces(st.reject)} szt.</div>
${machineBlocks}`
  }).join('\n')

  const notesBlock = SHIFTS.map(shift => {
    const events = eventsByShift[shift]
    const byMachine: Record<string, string[]> = {}
    events.forEach(e => {
      if (!byMachine[e.machine]) byMachine[e.machine] = []
      byMachine[e.machine].push(`[${e.hour}] ${e.text} (op: ${e.operator})`)
    })
    const st = shiftTotals[shift]
    const parts = machineNames.map(name => {
      const notes = byMachine[name] || []
      return `${name}:\n${notes.length ? notes.join('\n') : '(brak zdarzeń)'}`
    }).join('\n\n')
    return `ZMIANA ${shift} — produkcja: ${pieces(st.good)} szt., odrzut: ${pieces(st.reject)}, czas pracy: ${mins(st.runtime)}\n${parts}`
  }).join('\n\n---\n\n')

  return `Przepisujesz surowe notatki operatorów na profesjonalny raport zmianowy. Poprawiasz tylko ortografię i interpunkcję — treść zostaje. Nic nie dodajesz, nic nie pomijasz.

ZASADY:
- Produkcja >= 18000 szt. per automat na zmianę → "Produkcja przebiegała prawidłowo."
- Jeden fakt = jedno zdanie lub punkt listy
- Słownictwo: stacja (st.10), transfer, zacięcie, automat
- Powtarzające się zdarzenia → jeden punkt z "(powtarzające się)"

STRUKTURA każdego automatu:
1. Zdanie otwierające (prawidłowa / zakłócona / awaryjna)
2. Opóźniony start → "Start automatu o godz. HH:MM — [przyczyna]."
3. "W trakcie zmiany odnotowano:" → lista faktów
4. "Podjęte działania:" → lista działań
5. Zdanie zamykające
6. Czasy — tylko jeśli podane w notatce

ZWRÓĆ TYLKO HTML zaczynając od pierwszego <div class="shift-bar ..."> — zero tekstu przed ani po.

Format:
<div class="shift-bar s1">Zmiana I</div>
<div class="mc-box m3">
  <div class="mc-name">NAZWA_MASZYNY</div>
  <div class="mc-body">
    <p>[zdanie otwierające]</p>
    <p class="sub-h">W trakcie zmiany odnotowano:</p>
    <ul><li>[fakt]</li></ul>
    <p class="sub-h">Podjęte działania:</p>
    <ul><li>[działanie]</li></ul>
    <p>[zdanie zamykające]</p>
    <p class="times">Czas pracy: <strong>Xh XXmin</strong> | Gotowość: <strong>XXmin</strong> | Alarm: <strong>XXmin</strong></p>
  </div>
</div>
[kolejne maszyny — m3, m4, m5... naprzemiennie]
<div class="shift-bar s2">Zmiana II</div>
[analogicznie]
<div class="shift-bar s3">Zmiana III</div>
[analogicznie]

Brak zdarzeń: <em style="color:#6B7280">Brak zdarzeń do odnotowania.</em>
Pomiń sekcje sub-h jeśli brak danych. Times tylko jeśli w notatce.

===== DANE =====
${notesBlock}`
}

async function generateShiftNarrativeWithAi(
  apiKey: string,
  eventsByShift: Record<ShiftType, ShiftEvent[]>,
  shiftTotals: Record<ShiftType, ShiftSummary>,
  rows: MachineDayRow[]
): Promise<string> {
  const shiftData = SHIFTS.map(shift => {
    const st = shiftTotals[shift]
    const byMachine = new Map<string, ShiftEvent[]>()
    eventsByShift[shift].forEach(e => byMachine.set(e.machine, [...(byMachine.get(e.machine) ?? []), e]))
    const machines = rows.map(r => {
      const s = r.shifts[shift]
      return {
        name: r.machineName,
        good: s.good,
        reject: s.reject,
        rejectPct: s.good > 0 ? ((s.reject / s.good) * 100).toFixed(1) + '%' : '0%',
        notes: (byMachine.get(r.machineName) ?? []).map(e => `[${e.hour}] ${e.text}`)
      }
    })
    return { shift, totalGood: st.good, totalReject: st.reject, machines }
  })

  const prompt = `Jesteś autorem raportu zmianowego wydziału produkcyjnego. Napisz profesjonalną narrację na podstawie danych poniżej.

WAŻNE ZASADY:
- Pisz tylko o tym co jest w danych — zero domysłów
- Jeśli notes jest pusta i produkcja ≥ 15000 szt → "Zmiana przebiegła bez zakłóceń."
- Jeśli notes zawiera zdarzenie: jeden fakt = jedno zdanie lub punkt listy
- Powtarzające się problemy między godz. → "(zdarzenie powtarzające się)"
- Odrzut > 5% → wymuś wzmiankę w narracji
- Każda notatka jest już poprawna gramatycznie — nie zmieniaj liczb, nazw stacji, godzin

HTML KLASY (używaj dokładnie tak):
<div class="shift-bar s1"> — dla Zmiany I (s2=II, s3=III), treść: "Zmiana X — produkcja: N szt., odrzut: N szt."
<div class="mc-box m3"> — automat (naprzemiennie m3, m4, m5, m6)
<div class="mc-name"> — nazwa automatu (CAPS)
<div class="mc-body"> — treść
<p class="sub-h"> — podsekcja np. "W trakcie zmiany odnotowano:" / "Podjęte działania:"
<p class="times"> — statystyki produkcji automatu
<ul><li> — lista faktów / działań
<em style="color:#6B7280"> — gdy brak zdarzeń

STRUKTURA każdego automatu:
1. <p class="times">Produkcja: <strong>N szt.</strong> | Odrzut: <strong>N szt. (X%)</strong></p>
2. Jedno zdanie otwierające (prawidłowa / zakłócona)
3. Jeśli są zdarzenia: <p class="sub-h">W trakcie zmiany odnotowano:</p> + lista faktów
4. Jeśli są działania operatora: <p class="sub-h">Podjęte działania:</p> + lista
5. Jedno zdanie zamykające

ZWRÓĆ TYLKO HTML — zacznij od pierwszego <div class="shift-bar

DANE:
${JSON.stringify(shiftData, null, 2)}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 7000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!response.ok) throw new Error(`AI narrative failed: ${response.status}`)
  const data = await response.json() as { content: { type: string; text?: string }[] }
  let html = data.content.map(c => c.text || '').join('').trim()
  html = html.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim()
  return html
}

async function generateAttentionSectionWithAi(
  apiKey: string,
  eventsByShift: Record<ShiftType, ShiftEvent[]>,
  rows: MachineDayRow[]
): Promise<string> {
  const allEvents = SHIFTS.flatMap(shift =>
    eventsByShift[shift].map(e => ({ shift, machine: e.machine, hour: e.hour, text: e.text }))
  )
  if (!allEvents.length) return ''

  const machineStats = rows.map(r => ({
    name: r.machineName,
    totalGood: r.total.good,
    totalReject: r.total.reject,
    rejectPct: r.total.good > 0 ? ((r.total.reject / r.total.good) * 100).toFixed(1) + '%' : '0%',
    shiftBreakdown: SHIFTS.map(s => ({
      shift: s,
      good: r.shifts[s].good,
      reject: r.shifts[s].reject,
      events: eventsByShift[s].filter(e => e.machine === r.machineName).map(e => e.text)
    }))
  }))

  const prompt = `Na podstawie danych z całego dnia produkcyjnego napisz krótką sekcję "Zalecenia na następną zmianę".

ZASADY:
- Tylko jeśli są realne problemy (odrzut > 5%, awaria, powtarzające się zdarzenia, niska produkcja)
- Maksymalnie 5 konkretnych punktów
- Każdy punkt: automat + konkretny problem + sugerowane działanie
- Jeśli dzień był bez problemów — zwróć pusty string ""
- Zero ogólników ("sprawdzić maszynę") — konkretnie co i gdzie
- Tylko HTML <ul><li><strong>AUTOMAT:</strong> opis</li></ul>

DANE DNIA:
${JSON.stringify(machineStats, null, 2)}

ZDARZENIA WSZYSTKICH ZMIAN:
${JSON.stringify(allEvents, null, 2)}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!response.ok) return ''
  const data = await response.json() as { content: { type: string; text?: string }[] }
  const raw = data.content.map(c => c.text || '').join('').trim()
    .replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim()
  return raw === '""' || raw === '' ? '' : raw
}

async function polishEventsWithAi(
  apiKey: string,
  eventsByShift: Record<ShiftType, ShiftEvent[]>
): Promise<Record<ShiftType, ShiftEvent[]>> {
  const items = SHIFTS.flatMap(shift =>
    eventsByShift[shift].map((event, index) => ({
      id: `${shift}-${index}`,
      text: event.text
    }))
  ).filter(item => item.text.trim())

  if (!items.length) return eventsByShift

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `Popraw tylko pisownie, interpunkcje i czytelnosc ponizszych komentarzy operatorow.

ZASADY BEZWZGLEDNE:
- Nie dodawaj faktow.
- Nie usuwaj faktow.
- Nie zmieniaj godzin, liczb, nazw stacji, nazw maszyn, nazwisk ani skrotow technicznych.
- Nie zamieniaj komentarza na wnioski.
- Zwroc tylko JSON w formacie: [{"id":"...","text":"..."}].
- Kazdy id musi wrocic dokladnie raz.

DANE:
${JSON.stringify(items)}`
      }]
    })
  })

  if (!response.ok) throw new Error(`AI polish failed: ${response.status}`)
  const data = await response.json() as { content: { type: string; text?: string }[] }
  const raw = data.content.map(item => item.text || '').join('').trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const polished = JSON.parse(raw) as { id: string; text: string }[]
  const byId = new Map(polished.map(item => [item.id, item.text?.trim()]))

  return {
    I: eventsByShift.I.map((event, index) => ({ ...event, text: safePolishedText(event.text, byId.get(`I-${index}`)) })),
    II: eventsByShift.II.map((event, index) => ({ ...event, text: safePolishedText(event.text, byId.get(`II-${index}`)) })),
    III: eventsByShift.III.map((event, index) => ({ ...event, text: safePolishedText(event.text, byId.get(`III-${index}`)) })),
  }
}

// ─── API Key Modal ────────────────────────────────────────────────────────────

function ApiKeyModal({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-navy-800 border border-navy-600 rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/20 flex items-center justify-center text-xl">🔑</div>
          <div>
            <h2 className="text-white font-bold">Klucz API Anthropic</h2>
            <p className="text-navy-400 text-xs">Jednorazowa konfiguracja — zostanie zapamiętany</p>
          </div>
        </div>
        <div>
          <input
            type="password"
            className="input font-mono text-xs"
            placeholder="sk-ant-api03-..."
            value={key}
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && key.trim() && onSave(key.trim())}
            autoFocus
          />
          <p className="text-navy-500 text-xs mt-2">
            Pobierz na{' '}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener" className="text-brand hover:underline">
              console.anthropic.com
            </a>
            {' '}→ API Keys
          </p>
        </div>
        <button
          onClick={() => key.trim() && onSave(key.trim())}
          disabled={!key.trim()}
          className="btn-primary w-full py-3 font-bold disabled:opacity-50"
        >
          Zapisz i wygeneruj raport
        </button>
      </div>
    </div>
  )
}

// ─── Report Modal ─────────────────────────────────────────────────────────────

interface ReportModalProps {
  date: string
  rows: MachineDayRow[]
  reports: ReportWithContext[]
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  eventsByShift: Record<ShiftType, ShiftEvent[]>
  onClose: () => void
}

type NoProductionGap = { machineId: string; machineName: string; shift: ShiftType }

function ReportModal({ date, rows, reports, totals, shiftTotals, eventsByShift, onClose }: ReportModalProps) {
  const gaps: NoProductionGap[] = rows.flatMap(row =>
    SHIFTS.filter(s => !row.shifts[s].good && !row.shifts[s].reports).map(s => ({
      machineId: row.machineId, machineName: row.machineName, shift: s
    }))
  )

  const [step, setStep] = useState<'preflight' | 'loading' | 'done' | 'error'>(
    gaps.length > 0 ? 'preflight' : 'loading'
  )
  const [gapReasons, setGapReasons] = useState<Record<string, string>>({})
  const [emailHtml, setEmailHtml] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('margoline_api_key') || '')
  const [copied, setCopied] = useState(false)
  const generated = useRef(false)

  const machineNames = rows.map(r => r.machineName)

  useEffect(() => {
    if (gaps.length > 0) return
    if (generated.current) return
    generated.current = true
    generate({})
  }, [])

  function gapKey(g: NoProductionGap) { return `${g.machineId}__${g.shift}` }

  function startGenerate() {
    if (generated.current) return
    generated.current = true
    generate(gapReasons)
  }

  async function generate(reasons: Record<string, string>) {
    setStep('loading')
    try {
      const key = apiKey.trim()
      let reportEvents = eventsByShift
      let shiftsHtml: string
      let attentionHtml = ''

      // Wstrzyknij powody braków produkcji jako zdarzenia systemowe
      const eventsWithGaps: Record<ShiftType, ShiftEvent[]> = { ...reportEvents }
      gaps.forEach(g => {
        const reason = reasons[gapKey(g)]?.trim()
        if (!reason) return
        eventsWithGaps[g.shift] = [
          ...(eventsWithGaps[g.shift] ?? []),
          { machine: g.machineName, hour: 'cała zmiana', text: `Zmiana nieprodukcyjna — ${reason}`, operator: 'kierownik' }
        ]
      })

      if (key) {
        try {
          reportEvents = await polishEventsWithAi(key, eventsWithGaps)
        } catch (err) {
          reportEvents = eventsWithGaps
          console.warn('AI polish skipped', err)
        }
        try {
          shiftsHtml = await generateShiftNarrativeWithAi(key, reportEvents, shiftTotals, rows)
        } catch (err) {
          console.warn('AI narrative failed, falling back to template', err)
          shiftsHtml = buildSystemReportHtml(reportEvents, shiftTotals, machineNames, rows)
        }
        try {
          attentionHtml = await generateAttentionSectionWithAi(key, reportEvents, rows)
        } catch (err) {
          console.warn('AI attention section skipped', err)
        }
      } else {
        shiftsHtml = buildSystemReportHtml(eventsWithGaps, shiftTotals, machineNames, rows)
      }

      const html = buildEmailHtml({ date, rows, reports, totals, shiftTotals, shiftsHtml, attentionHtml })
      setEmailHtml(html)
      setStep('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Nieznany błąd')
      setStep('error')
    }
  }

  function saveApiKeyAndRetry() {
    const key = apiKey.trim()
    if (!key) return
    localStorage.setItem('margoline_api_key', key)
    generated.current = false
    generate(gapReasons)
  }

  function clearApiKey() {
    localStorage.removeItem('margoline_api_key')
    setApiKey('')
    setErrorMsg('')
  }

  function copyToClipboard() {
    const blob = new Blob([emailHtml], { type: 'text/html' })
    if (window.ClipboardItem && navigator.clipboard?.write) {
      navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000) })
        .catch(fallback)
    } else { fallback() }
    function fallback() {
      const el = document.createElement('div')
      el.contentEditable = 'true'
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      el.innerHTML = emailHtml
      document.body.appendChild(el)
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel?.removeAllRanges(); sel?.addRange(range)
      document.execCommand('copy')
      sel?.removeAllRanges()
      document.body.removeChild(el)
      setCopied(true); setTimeout(() => setCopied(false), 3000)
    }
  }

  function openInWindow() {
    const w = window.open('', '_blank', 'width=900,height=700,scrollbars=yes')
    if (w) { w.document.write(emailHtml); w.document.close() }
  }

  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
      <div className="relative w-full max-w-2xl my-8 bg-navy-800 border border-navy-600 rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-700">
          <div>
            <h2 className="text-white font-bold text-base flex items-center gap-2">
              <span>✉️</span> Raport email
            </h2>
            <p className="text-navy-400 text-xs mt-0.5 capitalize">{dateFormatted}</p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white transition-colors text-xl">✕</button>
        </div>

        <div className="p-6">

          {/* PREFLIGHT — powody braków produkcji */}
          {step === 'preflight' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                Wykryto {gaps.length} {gaps.length === 1 ? 'zmianę' : 'zmiany'} bez produkcji. Możesz wpisać powód — AI uwzględni go w raporcie.
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {gaps.map(g => (
                  <div key={gapKey(g)} className="rounded-xl border border-navy-600 bg-navy-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-navy-400 uppercase tracking-wider">Zmiana {g.shift}</span>
                      <span className="text-white font-bold text-sm">{g.machineName}</span>
                      <span className="ml-auto text-xs text-navy-500">0 szt.</span>
                    </div>
                    <input
                      type="text"
                      className="input text-sm"
                      placeholder="np. planowy postój techniczny, brak zlecenia, święto..."
                      value={gapReasons[gapKey(g)] ?? ''}
                      onChange={e => setGapReasons(prev => ({ ...prev, [gapKey(g)]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={startGenerate} className="btn-primary flex-1 py-3 font-bold">
                  Generuj raport
                </button>
                <button onClick={onClose} className="btn-secondary px-5 py-3">Anuluj</button>
              </div>
            </div>
          )}

          {/* LOADING */}
          {step === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-12">
              <div className="relative">
                <svg className="animate-spin h-12 w-12 text-brand" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">System generuje raport...</p>
                <p className="text-navy-400 text-sm mt-1">Układam zapisane dane bez dopisywania faktów</p>
              </div>
            </div>
          )}

          {/* ERROR */}
          {step === 'error' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                <div className="font-bold mb-1">Błąd generowania</div>
                {errorMsg}
              </div>
              <div className="rounded-xl border border-navy-600 bg-navy-900 p-4">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wider text-navy-400">Klucz API</span>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    className="input mt-1"
                    placeholder="Wklej poprawny klucz"
                    autoComplete="off"
                  />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={clearApiKey} className="btn-secondary px-3 py-2 text-xs">Wyczysc klucz</button>
                  <button onClick={saveApiKeyAndRetry} disabled={!apiKey.trim()} className="btn-primary px-3 py-2 text-xs disabled:opacity-50">
                    Zapisz klucz i sprobuj ponownie
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={onClose} className="btn-secondary flex-1">Zamknij</button>
                <button onClick={() => { generated.current = false; generate(gapReasons) }} className="btn-primary flex-1">
                  Spróbuj ponownie
                </button>
              </div>
            </div>
          )}

          {/* DONE */}
          {step === 'done' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300 flex items-center gap-2">
                <span>✓</span> Raport gotowy — wklej do nowej wiadomości w Outlooku
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-navy-600 overflow-hidden bg-white" style={{ height: 320 }}>
                <iframe srcDoc={emailHtml} title="Podgląd" className="w-full h-full" sandbox="allow-same-origin" />
              </div>

              {/* Główny przycisk */}
              <button
                onClick={copyToClipboard}
                className={cn(
                  'w-full py-3.5 rounded-xl font-bold text-sm transition-all',
                  copied
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20'
                )}
              >
                {copied ? '✓ Skopiowano! Wklej w Outlook (Ctrl+V)' : '📋 Kopiuj do schowka'}
              </button>

              {/* Dodatkowe opcje */}
              <div className="grid grid-cols-1 gap-3">
                <button onClick={openInWindow} className="btn-secondary py-2.5 text-sm">
                  🔍 Podgląd w nowym oknie
                </button>
              </div>

              <p className="text-navy-500 text-xs text-center">
                Otwórz Outlooka → Nowa wiadomość → Ctrl+V
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManagerDayReport() {
  const [date, setDate] = useState(todayIso)
  const [machines, setMachines] = useState<Machine[]>([])
  const [reports, setReports] = useState<ReportWithContext[]>([])
  const [shiftSummaries, setShiftSummaries] = useState<ShiftWithSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalState, setModalState] = useState<'closed' | 'apikey' | 'report'>('closed')
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadSeq.current
    setLoading(true); setError('')
    const [mRes, rRes, sRes] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase.from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .eq('report_date', date).is('deleted_at', null)
        .order('machine_id').order('hour_start'),
      supabase.from('shifts')
        .select('*')
        .eq('shift_date', date)
    ])
    if (requestId !== loadSeq.current) return
    if (mRes.error || rRes.error || sRes.error) {
      setError(mRes.error?.message || rRes.error?.message || 'Błąd ładowania')
    } else {
      setMachines((mRes.data ?? []) as Machine[])
      setReports(
        ((rRes.data ?? []) as ReportWithContext[]).sort((a, b) =>
          a.machine_id.localeCompare(b.machine_id) ||
          compareProductionHours(a.hour_start, b.hour_start)
        )
      )
      setShiftSummaries((sRes.data ?? []) as ShiftWithSummary[])
    }
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase.channel(`day-report-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .subscribe()
    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
      supabase.removeChannel(channel)
    }
  }, [date, load])

  const machineNameById = useMemo(
    () => Object.fromEntries(machines.map(m => [m.id, m.name])),
    [machines]
  )

  const rows = useMemo(() => {
    const byMachine = new Map<string, MachineDayRow>()
    machines.forEach(m => byMachine.set(m.id, {
      machineId: m.id, machineName: m.name,
      shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() },
      total: emptySummary()
    }))
    reports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type
      if (!shiftType || !SHIFTS.includes(shiftType)) return
      const row = byMachine.get(report.machine_id) ?? {
        machineId: report.machine_id,
        machineName: machineNameById[report.machine_id] ?? 'Nieznana maszyna',
        shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() },
        total: emptySummary()
      }
      byMachine.set(report.machine_id, row)
      const shift = row.shifts[shiftType]
      ;[shift, row.total].forEach(s => {
        s.good += report.good_count; s.reject += report.reject_count; s.reports += 1
      })
      const note = noteText(report)
      if (note) {
        const entry = `${report.hour_block}: ${note}`
        shift.notes.push(entry)
        row.total.notes.push(`Zmiana ${shiftType}, ${entry}`)
      }
    })
    shiftSummaries.filter(hasClosingSummary).forEach(summary => {
      const shiftType = summary.shift_type
      if (!SHIFTS.includes(shiftType)) return
      const row = byMachine.get(summary.machine_id) ?? {
        machineId: summary.machine_id,
        machineName: machineNameById[summary.machine_id] ?? 'Nieznana maszyna',
        shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() },
        total: emptySummary()
      }
      byMachine.set(summary.machine_id, row)
      applyClosingSummary(row.shifts[shiftType], summary)
    })
    byMachine.forEach(row => {
      row.total = emptySummary()
      SHIFTS.forEach(shiftType => {
        const shift = row.shifts[shiftType]
        row.total.good += shift.good
        row.total.reject += shift.reject
        row.total.reports += shift.reports
        row.total.runtime += shift.runtime
        row.total.ready += shift.ready
        row.total.alarm += shift.alarm
        row.total.downtime += shift.downtime
        row.total.hasSummary = row.total.hasSummary || shift.hasSummary
        row.total.notes.push(...shift.notes.map(note => `Zmiana ${shiftType}, ${note}`))
      })
    })
    return Array.from(byMachine.values()).sort((a, b) => a.machineName.localeCompare(b.machineName))
  }, [machineNameById, machines, reports, shiftSummaries])

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.good += row.total.good; acc.reject += row.total.reject; acc.reports += row.total.reports
    acc.runtime += row.total.runtime; acc.ready += row.total.ready
    acc.alarm += row.total.alarm; acc.downtime += row.total.downtime
    acc.hasSummary = acc.hasSummary || row.total.hasSummary
    return acc
  }, emptySummary()), [rows])

  const shiftTotals = useMemo(() => {
    const result: Record<ShiftType, ShiftSummary> = { I: emptySummary(), II: emptySummary(), III: emptySummary() }
    rows.forEach(row => SHIFTS.forEach(s => {
      result[s].good += row.shifts[s].good; result[s].reject += row.shifts[s].reject
      result[s].reports += row.shifts[s].reports; result[s].runtime += row.shifts[s].runtime
      result[s].ready += row.shifts[s].ready; result[s].alarm += row.shifts[s].alarm
      result[s].downtime += row.shifts[s].downtime
      result[s].hasSummary = result[s].hasSummary || row.shifts[s].hasSummary
    }))
    return result
  }, [rows])

  const summaryStats = useMemo(() => {
    let closed = 0
    let missing = 0
    rows.forEach(row => SHIFTS.forEach(shift => {
      const item = row.shifts[shift]
      if (!item.reports && !item.hasSummary) return
      if (item.hasSummary) closed += 1
      else missing += 1
    }))
    return { closed, missing }
  }, [rows])

  const eventsByShift = useMemo(() => {
    const result: Record<ShiftType, ShiftEvent[]> =
      { I: [], II: [], III: [] }
    reports.forEach(report => {
      const shiftType = one(report.shift)?.shift_type
      const text = noteText(report)
      if (!shiftType || !SHIFTS.includes(shiftType) || !text) return
      result[shiftType].push({
        machine: machineNameById[report.machine_id] ?? '-',
        hour: report.hour_block, text,
        operator: one(report.operator)?.full_name ?? '-'
      })
    })
    shiftSummaries.forEach(summary => {
      const text = summary.summary_notes?.trim()
      if (!text || !SHIFTS.includes(summary.shift_type)) return
      result[summary.shift_type].push({
        machine: machineNameById[summary.machine_id] ?? '-',
        hour: 'koniec zmiany',
        text,
        operator: '-'
      })
    })
    return result
  }, [machineNameById, reports, shiftSummaries])

  function handleGenerateClick() {
    setModalState('report')
  }

  function handleApiKeySave(key: string) {
    localStorage.setItem('margoline_api_key', key)
    setModalState('report')
  }

  return (
    <>
      {modalState === 'apikey' && (
        <ApiKeyModal onSave={handleApiKeySave} />
      )}
      {modalState === 'report' && (
        <ReportModal
          date={date}
          rows={rows}
          reports={reports}
          totals={totals}
          shiftTotals={shiftTotals}
          eventsByShift={eventsByShift}
          onClose={() => setModalState('closed')}
        />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Raport dnia</h1>
            <p className="text-navy-400 mt-1">Produkcja, odrzut i przebieg zmian w jednym widoku</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, -1))}>← Poprzedni</button>
            <input className="input w-[170px]" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, 1))}>Następny →</button>
            <button className="btn-secondary text-xs py-2 px-3" onClick={load}>{loading ? '...' : 'Odśwież'}</button>
            <button
              onClick={handleGenerateClick}
              disabled={loading || reports.length === 0}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-2 disabled:opacity-40"
            >
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M2 7l9 6 9-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Generuj email
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: 'Produkcja łącznie', value: `${pieces(totals.good)} szt`, color: 'text-brand' },
            { label: 'Odrzut łącznie', value: `${pieces(totals.reject)} szt`, color: totals.reject ? 'text-red-400' : 'text-green-400' },
            { label: 'Wpisy', value: `${totals.reports}`, color: 'text-white' },
            { label: 'Rozliczone zmiany', value: `${summaryStats.closed}`, color: summaryStats.missing ? 'text-amber-400' : 'text-green-400' },
            { label: 'Czas pracy', value: totals.hasSummary ? mins(totals.runtime) : '-', color: 'text-green-400' },
            { label: 'Alarm + postój', value: mins(totals.alarm + totals.downtime), color: totals.alarm + totals.downtime ? 'text-amber-400' : 'text-green-400' },
          ].map(item => (
            <div key={item.label} className="kpi-card">
              <div className="kpi-label">{item.label}</div>
              <div className={cn('kpi-value text-xl', item.color)}>{loading ? '...' : item.value}</div>
              <div className="kpi-sub">{date}</div>
            </div>
          ))}
        </div>

        {/* Czasy zmian */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {SHIFTS.map(shift => (
            <div key={shift} className="kpi-card">
              <div className="kpi-label">Czasy — zmiana {shift}</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Praca', val: shiftTotals[shift].runtime, color: 'text-green-400' },
                  { label: 'Gotowość', val: shiftTotals[shift].ready, color: 'text-cyan-300' },
                  { label: 'Alarm/postój', val: shiftTotals[shift].alarm + shiftTotals[shift].downtime, color: 'text-amber-400' },
                ].map(({ label, val, color }) => (
                  <div key={label}>
                    <div className="text-xs text-navy-500">{label}</div>
                    <div className={cn('font-mono text-lg font-bold', color)}>{loading ? '...' : mins(val)}</div>
                  </div>
                ))}
              </div>
              <div className="kpi-sub mt-2">
                {pieces(shiftTotals[shift].good)} szt | {shiftTotals[shift].reports} wpisow | {shiftTotals[shift].hasSummary ? 'rozliczone' : 'brak rozliczenia'}
              </div>
            </div>
          ))}
        </div>

        {/* Tabela produkcji */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Produkcja według zmian</div>
              <div className="card-sub">Każda maszyna osobno, trzy zmiany i suma dnia</div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  <th className="text-left py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">Automat</th>
                  {SHIFTS.map(s => (
                    <th key={s} className="text-center py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">Zmiana {s}</th>
                  ))}
                  <th className="text-center py-2 px-3 text-xs font-bold text-navy-400 uppercase tracking-wider">Łącznie</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-navy-500">Brak danych dla wybranego dnia</td></tr>
                )}
                {rows.map(row => (
                  <tr key={row.machineId} className="border-b border-navy-800">
                    <td className="py-3 px-3 font-bold text-white">{row.machineName}</td>
                    {SHIFTS.map(s => (
                      <td key={s} className="py-3 px-3 text-center">
                        {row.shifts[s].reports || row.shifts[s].hasSummary ? (
                          <div>
                            <div className="font-mono text-lg font-bold text-white">{pieces(row.shifts[s].good)} szt</div>
                            <div className="mt-1 text-xs text-navy-400">
                              odrzut <span className="font-mono text-red-300">{pieces(row.shifts[s].reject)}</span> | wpisy {row.shifts[s].reports}
                            </div>
                            <div className="mt-2 rounded-lg bg-navy-900 px-2 py-1.5 text-xs leading-relaxed text-navy-300">
                              {row.shifts[s].hasSummary ? (
                                <>
                                  <span className="font-mono text-green-300">praca {mins(row.shifts[s].runtime)}</span><br />
                                  got. {mins(row.shifts[s].ready)} | alarm {mins(row.shifts[s].alarm + row.shifts[s].downtime)}
                                </>
                              ) : (
                                <span className="text-amber-300">brak rozliczenia czasu</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center">
                            <div className="text-xs text-navy-500 italic">Zmiana nieprodukcyjna</div>
                            <div className="text-xs text-navy-600 mt-0.5">brak wpisów</div>
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="py-3 px-3 text-center bg-brand/10">
                      <div className="font-mono text-xl font-bold text-brand">{pieces(row.total.good)} szt</div>
                      <div className="mt-1 text-xs text-navy-300">odrzut {pieces(row.total.reject)} | wpisy {row.total.reports}</div>
                      <div className="mt-2 rounded-lg bg-navy-900/70 px-2 py-1.5 text-xs leading-relaxed text-navy-200">{timeLine(row.total)}</div>
                    </td>
                  </tr>
                ))}
                {rows.length > 0 && (
                  <tr className="bg-navy-800/70">
                    <td className="py-3 px-3 font-bold text-white">Łącznie</td>
                    {SHIFTS.map(s => (
                      <td key={s} className="py-3 px-3 text-center">
                        <div className="font-mono text-lg font-bold text-white">{pieces(shiftTotals[s].good)} szt</div>
                        <div className="mt-1 text-xs text-navy-400">odrzut {pieces(shiftTotals[s].reject)}</div>
                        <div className="mt-2 text-xs text-navy-300">{timeLine(shiftTotals[s])}</div>
                      </td>
                    ))}
                    <td className="py-3 px-3 text-center bg-brand/20">
                      <div className="font-mono text-xl font-bold text-brand">{pieces(totals.good)} szt</div>
                      <div className="mt-1 text-xs text-navy-300">odrzut {pieces(totals.reject)}</div>
                      <div className="mt-2 text-xs text-navy-200">{timeLine(totals)}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Zdarzenia per zmiana */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {SHIFTS.map(shift => (
            <div key={shift} className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Zmiana {shift}</div>
                  <div className="card-sub">
                    {pieces(shiftTotals[shift].good)} szt | odrzut {pieces(shiftTotals[shift].reject)} | {shiftTotals[shift].hasSummary ? `praca ${mins(shiftTotals[shift].runtime)}` : 'brak rozliczenia'}
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                {eventsByShift[shift].length === 0 && (
                  <div className="rounded-xl border border-navy-700 bg-navy-900 p-4 text-sm italic text-navy-500">
                    Brak zdarzeń do odnotowania.
                  </div>
                )}
                {eventsByShift[shift].map((event, index) => (
                  <div key={`${event.machine}-${event.hour}-${index}`} className="rounded-xl border border-navy-700 bg-navy-900 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-white">{event.machine}</div>
                      <div className="font-mono text-xs text-navy-400">{event.hour}</div>
                    </div>
                    <div className="mt-1 text-xs text-navy-500">{event.operator}</div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-navy-200">{event.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Pełny przebieg dnia */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Pełny przebieg dnia</div>
              <div className="card-sub">Wszystkie wpisy godzinowe</div>
            </div>
          </div>
          <div className="space-y-2">
            {reports.length === 0 && <div className="py-8 text-center text-navy-500">Brak wpisów w wybranym dniu</div>}
            {reports.map(report => {
              const shiftType = one(report.shift)?.shift_type ?? '-'
              const text = noteText(report)
              return (
                <div key={report.id} className="rounded-xl border border-navy-700 bg-navy-900 p-3">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-[130px_1fr_110px_110px] md:items-center">
                    <div className="font-mono text-sm font-bold text-white">{report.hour_block}</div>
                    <div>
                      <div className="font-bold text-white">{machineNameById[report.machine_id] ?? '-'}</div>
                      <div className="text-xs text-navy-500">Zmiana {shiftType} | {one(report.operator)?.full_name ?? '-'}</div>
                    </div>
                    <div className="font-mono font-bold text-green-300">{pieces(report.good_count)} szt</div>
                    <div className="font-mono text-red-300">odrz. {pieces(report.reject_count)}</div>
                  </div>
                  {text && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-navy-800 px-3 py-2 text-sm leading-relaxed text-navy-200">{text}</p>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
