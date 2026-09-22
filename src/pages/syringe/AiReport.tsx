import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { rejectPercent, syringeProductionDate } from '@/lib/syringeMetrics'
import { cn } from '@/lib/utils'
import type { SaMachine, ShiftType } from '@/types/database'

// ─── Types ───────────────────────────────────────────────────────────────────

const SHIFTS: ShiftType[] = ['I', 'II']

type ShiftSummary = {
  good: number; reject: number; sessions: number
  runtime: number; downtime: number
  target: number | null; rejectTargetPct: number | null
  notes: string[]
  operators: string[]
}

type LineDayRow = {
  machineId: string; machineName: string
  shifts: Record<ShiftType, ShiftSummary>
  total: ShiftSummary
}

type ShiftEvent = { machine: string; hour: string; text: string; operator: string }

type SessionRow = {
  id: string; machine_id: string; shift_type: ShiftType; session_date: string
  started_at: string; total_good: number | null; total_reject: number | null
  plan_qty: number | null
  total_runtime_min: number | null; total_downtime_min: number | null
  summary_notes: string | null
  machine?: { id: string; name: string }
  assortment?: { shift_target_qty: number | null; reject_target_pct: number } | null
  operator?: { full_name: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayIso() { return syringeProductionDate() }
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function emptySummary(): ShiftSummary {
  return { good: 0, reject: 0, sessions: 0, runtime: 0, downtime: 0, target: null, rejectTargetPct: null, notes: [], operators: [] }
}
function mins(value: number) {
  const rounded = Math.max(0, Math.round(value || 0))
  if (!rounded) return '-'
  const h = Math.floor(rounded / 60), m = rounded % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`
}
function pieces(value: number) { return value.toLocaleString('pl-PL') }

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char] ?? char))
}

function safePolishedText(original: string, candidate: string | undefined) {
  const cleaned = candidate?.trim()
  if (!cleaned) return original
  if (cleaned.length > original.length * 2 + 80) return original
  return cleaned
}

// ─── Email HTML builder (identyczny styl co Raport dnia — IS PRO) ────────────

function buildEmailHtml(params: {
  date: string
  rows: LineDayRow[]
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  shiftsHtml: string
  attentionHtml?: string
}) {
  const { date, rows, totals, shiftTotals, shiftsHtml, attentionHtml } = params
  const K = {
    navy: '#142238', navyMid: '#1B2E4A',
    blue: '#2563EB', blueDk: '#1D4ED8', blueLt: '#EFF6FF', blueBr: '#BFDBFE', blueTx: '#1E3A8A',
    teal: '#0D9488', tealLt: '#F0FDFA', tealBr: '#99F6E4', tealTx: '#134E4A',
    red: '#DC2626', redLt: '#FEF2F2',
    amber: '#D97706', amberLt: '#FFFBEB',
    green: '#16A34A',
    gray1: '#F8FAFC', gray2: '#E2E8F0', gray3: '#64748B', gray4: '#94A3B8',
    white: '#FFFFFF',
    s1bg: '#EEF2FF', s1tx: '#3730A3', s1ac: '#4F46E5',
    s2bg: '#F0FDFA', s2tx: '#134E4A', s2ac: '#0D9488',
    s3bg: '#FFF7ED', s3tx: '#7C2D12', s3ac: '#EA580C',
  }
  const tt = totals.good, to = totals.reject
  const rejectPctVal = rejectPercent(tt, to).toFixed(2) + '%'
  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const dateLong = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const generatedAt = new Date().toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  function fmtCell(s: ShiftSummary) {
    if (!s.good && !s.sessions) return `<span style="color:${K.gray3};font-size:11px;${F}">Zmiana nieprodukcyjna</span><br><span style="color:${K.gray4};font-size:10px;${F}">brak sesji w systemie</span>`
    const rawRejectPct = rejectPercent(s.good, s.reject)
    const rj = rawRejectPct.toFixed(1)
    const rjColor = rawRejectPct > 5 ? K.red : rawRejectPct > 2 ? K.amber : K.green
    const targetLine = s.target ? `<br><span style="color:${K.gray3};font-size:10px;${F}">cel: ${pieces(s.target)} (${Math.round(s.good / s.target * 100)}%)</span>` : ''
    return `<span style="font-size:15px;font-weight:bold;color:${K.navy};${F}">${pieces(s.good)} szt.</span>`
      + `<br><span style="color:${K.gray3};font-size:11px;${F}">odrzut: </span>`
      + `<span style="color:${K.red};font-size:11px;font-weight:bold;${F}">${pieces(s.reject)} szt.</span>`
      + `<br><span style="color:${rjColor};font-size:11px;font-weight:bold;${F}">${rj}% odrzutu</span>`
      + targetLine
  }

  function buildKpiBanner() {
    const rawRejectPct = rejectPercent(tt, to)
    const rj = rawRejectPct.toFixed(2)
    const rjColor = rawRejectPct > 5 ? K.red : rawRejectPct > 2 ? K.amber : K.green
    const totalTarget = rows.reduce((s, r) => s + (r.total.target ?? 0), 0)
    const targetPct = totalTarget > 0 ? Math.round(tt / totalTarget * 100) : null
    const kpis = [
      { label: 'Produkcja dobra', value: `${pieces(tt)} szt.`, color: K.navy, sub: 'łącznie zmiana I i II' },
      { label: 'Braki łącznie', value: `${pieces(to)} szt.`, color: K.red, sub: `${rejectPctVal} produkcji` },
      { label: '% odrzutu', value: `${rj}%`, color: rjColor, sub: 'wskaźnik jakości' },
      { label: 'Realizacja celu', value: targetPct !== null ? `${targetPct}%` : '—', color: K.blue, sub: totalTarget > 0 ? `cel: ${pieces(totalTarget)} szt.` : 'brak celu' },
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

  function buildPerformanceChart() {
    const chartRows = rows
      .filter(row => row.total.sessions > 0 || row.total.good > 0 || (row.total.target ?? 0) > 0)
      .sort((a, b) => a.machineName.localeCompare(b.machineName))

    if (!chartRows.length) return ''

    const width = 720
    const height = 310
    const left = 74
    const right = 26
    const top = 28
    const bottom = 78
    const plotW = width - left - right
    const plotH = height - top - bottom
    const maxValue = Math.max(1, ...chartRows.flatMap(row => [row.total.good, row.total.target ?? 0]))
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(maxValue)) - 1))
    const yMax = Math.ceil(maxValue / magnitude) * magnitude
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(yMax * t))
    const x = (index: number) => chartRows.length === 1
      ? left + plotW / 2
      : left + (index / (chartRows.length - 1)) * plotW
    const y = (value: number) => top + plotH - (value / yMax) * plotH
    const targetPoints = chartRows.map((row, index) => `${x(index).toFixed(1)},${y(row.total.target ?? 0).toFixed(1)}`).join(' ')
    const actualPoints = chartRows.map((row, index) => `${x(index).toFixed(1)},${y(row.total.good).toFixed(1)}`).join(' ')
    const label = (name: string) => {
      const clean = name.replace(/^Automat strzykawkowy\s*/i, '').replace(/^Linia\s*/i, '').trim()
      return clean.length > 13 ? `${clean.slice(0, 12)}…` : clean
    }
    const grid = yTicks.map(tick => {
      const yy = y(tick)
      return `<line x1="${left}" y1="${yy.toFixed(1)}" x2="${width - right}" y2="${yy.toFixed(1)}" stroke="${K.gray2}" stroke-width="1" />
        <text x="${left - 10}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${K.gray3}" style="${F}">${pieces(tick)}</text>`
    }).join('')
    const xLabels = chartRows.map((row, index) => {
      const xx = x(index)
      return `<text x="${xx.toFixed(1)}" y="${height - 44}" text-anchor="middle" font-size="10" fill="${K.gray3}" style="${F}">${escapeHtml(label(row.machineName))}</text>`
    }).join('')
    const actualDots = chartRows.map((row, index) => {
      const xx = x(index), yy = y(row.total.good)
      return `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4" fill="${K.green}" stroke="#fff" stroke-width="2" />
        <text x="${xx.toFixed(1)}" y="${(yy - 9).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="bold" fill="${K.green}" style="${F}">${pieces(row.total.good)}</text>`
    }).join('')
    const targetDots = chartRows.map((row, index) => {
      const xx = x(index), yy = y(row.total.target ?? 0)
      return `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.5" fill="#fff" stroke="${K.amber}" stroke-width="2" />`
    }).join('')
    const rowsHtml = chartRows.map(row => {
      const target = row.total.target ?? 0
      const pct = target > 0 ? Math.round(row.total.good / target * 100) : null
      const tone = pct === null ? K.gray3 : pct >= 100 ? K.green : pct >= 90 ? K.amber : K.red
      return `<tr>
        <td style="padding:8px 10px;border:1px solid ${K.gray2};font-size:12px;color:${K.navy};${F}">${escapeHtml(row.machineName)}</td>
        <td align="right" style="padding:8px 10px;border:1px solid ${K.gray2};font-size:12px;color:${K.gray3};${F}">${target ? pieces(target) : 'brak celu'}</td>
        <td align="right" style="padding:8px 10px;border:1px solid ${K.gray2};font-size:12px;font-weight:bold;color:${K.green};${F}">${pieces(row.total.good)}</td>
        <td align="right" style="padding:8px 10px;border:1px solid ${K.gray2};font-size:12px;font-weight:bold;color:${tone};${F}">${pct === null ? '—' : `${pct}%`}</td>
      </tr>`
    }).join('')

    return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr>
  <td style="background:${K.gray1};border:1px solid ${K.gray2};padding:14px 14px 10px;${F}">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px"><tr>
      <td style="font-size:12px;font-weight:bold;color:${K.navy};${F}">Wykres realizacji celu według linii</td>
      <td align="right" style="font-size:11px;color:${K.gray3};${F}">
        <span style="color:${K.amber};font-weight:bold">■ Cel</span>
        &nbsp;&nbsp;
        <span style="color:${K.green};font-weight:bold">■ Realizacja</span>
      </td>
    </tr></table>
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cel i realizacja produkcji na liniach strzykawkowych" style="display:block;max-width:720px;margin:0 auto;background:#fff;border:1px solid ${K.gray2}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" />
      ${grid}
      <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="${K.gray2}" stroke-width="1" />
      <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="${K.gray2}" stroke-width="1" />
      <polyline points="${targetPoints}" fill="none" stroke="${K.amber}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      <polyline points="${actualPoints}" fill="none" stroke="${K.green}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      ${targetDots}
      ${actualDots}
      ${xLabels}
    </svg>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:12px;background:#fff">
      <thead><tr>
        <th align="left" style="padding:8px 10px;background:${K.navy};color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;${F}">Linia</th>
        <th align="right" style="padding:8px 10px;background:${K.navy};color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;${F}">Cel</th>
        <th align="right" style="padding:8px 10px;background:${K.navy};color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;${F}">Realizacja</th>
        <th align="right" style="padding:8px 10px;background:${K.navy};color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;${F}">%</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </td>
</tr></table>`
  }

  const machineRows = rows.map((row, idx) => {
    const pal = emailPalette[idx % emailPalette.length]
    return `<tr>
  <td ${TD(pal.bg, pal.br, pal.tx, `font-weight:bold;font-size:13px`)}>${row.machineName}</td>
  <td align="center" ${TD(pal.bg, pal.br, pal.tx)}>${fmtCell(row.shifts.I)}</td>
  <td align="center" ${TD(pal.bg, pal.br, pal.tx)}>${fmtCell(row.shifts.II)}</td>
  <td align="center" style="background:${pal.ac};border:1px solid ${pal.ac};padding:10px 14px;color:#fff;font-weight:bold;font-size:16px;${F};text-align:center;vertical-align:middle">
    ${pieces(row.total.good)}<br><span style="font-size:10px;font-weight:normal;opacity:.85">szt.</span>
  </td>
</tr>`
  }).join('\n')

  const prodTable = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;${F}">
<thead><tr>
  <th width="28%" align="left" ${TH()}>Linia</th>
  <th width="22%" align="center" ${TH('text-align:center')}>Zmiana I</th>
  <th width="22%" align="center" ${TH('text-align:center')}>Zmiana II</th>
  <th width="28%" align="center" ${TH('text-align:center')}>ŁĄCZNIE</th>
</tr></thead>
<tbody>
${machineRows}
<tr style="border-top:2px solid ${K.gray2}">
  <td ${TD(K.gray1, K.gray2, K.navy, 'font-weight:bold;font-size:13px')}>Łącznie</td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}>
    <strong style="font-size:14px">${pieces(shiftTotals.I.good)}</strong><br>
    <span style="font-size:11px;color:${K.red}">odrz. ${pieces(shiftTotals.I.reject)}</span>
  </td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}>
    <strong style="font-size:14px">${pieces(shiftTotals.II.good)}</strong><br>
    <span style="font-size:11px;color:${K.red}">odrz. ${pieces(shiftTotals.II.reject)}</span>
  </td>
  <td align="center" style="background:${K.blue};border:1px solid ${K.blue};padding:10px 14px;color:#fff;font-weight:bold;font-size:17px;${F};text-align:center">
    ${pieces(tt)}<br><span style="font-size:10px;font-weight:normal;opacity:.85">szt.</span>
  </td>
</tr>
</tbody></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px"><tr>
  <td style="padding:11px 16px;background:${K.blueLt};border:1px solid ${K.blueBr};border-left:4px solid ${K.blue};${F};font-size:13px;color:${K.navy}">
    Łączna produkcja: <strong>${pieces(tt)} szt.</strong>
    &nbsp;&bull;&nbsp;
    Braki: <strong style="color:${K.red}">${pieces(to)} szt.</strong>
    &nbsp;&bull;&nbsp;
    Wskaźnik odrzutu: <strong style="color:${rejectPercent(tt, to) > 5 ? K.red : K.green}">${rejectPctVal}</strong>
  </td>
</tr></table>`

  // Konwersja narracji AI (klasy shift-bar/mc-box/...) na style inline pod e-mail
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
        const sc = cls.includes('s1') ? 's1' : cls.includes('s2') ? 's2' : 's3'
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

  return `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${F};color:${K.navy};margin:0;padding:0;background:#ffffff">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td style="padding:0">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${K.white};border-bottom:1px solid ${K.gray2}">

  <!-- HEADER -->
  <tr><td style="background:#1E3A5F;padding:0">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:18px 28px;vertical-align:middle">
        <p style="margin:0;font-size:10px;font-weight:bold;color:#93C5FD;text-transform:uppercase;letter-spacing:1.2px;${F}">Margomed S.A.</p>
        <p style="margin:4px 0 0;font-size:17px;font-weight:bold;color:#fff;${F}">Linie strzykawkowe</p>
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
      W za&#322;&#261;czeniu przekazuj&#281; raport z wynik&#243;w produkcyjnych oraz zestawienie kluczowych zdarze&#324; na liniach strzykawkowych z dnia <strong>${dateFormatted}&nbsp;r.</strong>
    </p>

    ${buildKpiBanner()}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px"><tr>
      <td style="border-bottom:2px solid ${K.blue};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.blue};${F}">1.&nbsp;&nbsp;Cel i realizacja wed&#322;ug linii</span>
      </td>
    </tr></table>
    ${buildPerformanceChart()}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px"><tr>
      <td style="border-bottom:2px solid ${K.blue};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.blue};${F}">2.&nbsp;&nbsp;Wyniki produkcyjne wed&#322;ug zmian</span>
      </td>
    </tr></table>
    ${prodTable}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px"><tr>
      <td style="border-bottom:2px solid ${K.blue};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.blue};${F}">3.&nbsp;&nbsp;Przebieg zmian i istotne zdarzenia</span>
      </td>
    </tr></table>
    ${emailShifts}

    ${attentionHtml ? `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px"><tr>
      <td style="border-bottom:2px solid ${K.amber};padding-bottom:7px">
        <span style="font-size:13px;font-weight:bold;color:${K.amber};${F}">4.&nbsp;&nbsp;Zalecenia na nast&#281;pn&#261; zmian&#281;</span>
      </td>
    </tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>
      <td style="background:${K.amberLt};border:1px solid #FDE68A;border-left:4px solid ${K.amber};padding:14px 18px;${F};font-size:13px;color:${K.navy};line-height:1.8">
        ${attentionHtml}
      </td>
    </tr></table>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr>
      <td style="border-top:1px solid ${K.gray2};padding-top:16px">
        <p style="margin:0 0 6px;font-size:13px;color:${K.navy};${F}">W przypadku dodatkowych pyta&#324; lub w&#261;tpliwo&#347;ci pozostaj&#281; do dyspozycji.</p>
        <p style="margin:0;font-size:13px;color:${K.navy};${F}">Z powa&#380;aniem,<br><strong>Kierownik Linii Strzykawkowych</strong></p>
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

// ─── Fallback bez AI (surowe zdarzenia w tym samym formacie HTML) ─────────────

function buildSystemReportHtml(eventsByShift: Record<ShiftType, ShiftEvent[]>, shiftTotals: Record<ShiftType, ShiftSummary>, rows: LineDayRow[]): string {
  return SHIFTS.map((shift, shiftIndex) => {
    const shiftClass = shiftIndex === 0 ? 's1' : shiftIndex === 1 ? 's2' : 's3'
    const st = shiftTotals[shift]
    const eventsByMachine = new Map<string, ShiftEvent[]>()
    eventsByShift[shift].forEach(event => {
      const name = event.machine || '-'
      eventsByMachine.set(name, [...(eventsByMachine.get(name) ?? []), event])
    })
    const machineBlocks = rows.map((row, index) => {
      const events = eventsByMachine.get(row.machineName) ?? []
      const machineClass = index % 2 === 0 ? 'm3' : 'm4'
      const s = row.shifts[shift]
      const summaryLine = `<p class="times">Produkcja: <strong>${pieces(s.good)} szt.</strong> | Braki: <strong>${pieces(s.reject)} szt.</strong> | Czas pracy: <strong>${mins(s.runtime)}</strong></p>`
      if (!events.length) {
        return `<div class="mc-box ${machineClass}">
  <div class="mc-name">${escapeHtml(row.machineName)}</div>
  <div class="mc-body">
    ${summaryLine}
    <em style="color:#6B7280">Brak istotnych zdarzeń do raportowania.</em>
  </div>
</div>`
      }
      const list = `<ul>${events.map(e => `<li><strong>${escapeHtml(e.hour)}</strong>: ${escapeHtml(e.text)}</li>`).join('')}</ul>`
      return `<div class="mc-box ${machineClass}">
  <div class="mc-name">${escapeHtml(row.machineName)}</div>
  <div class="mc-body">
    ${summaryLine}
    <p class="sub-h">W trakcie zmiany odnotowano:</p>
    ${list}
  </div>
</div>`
    }).join('\n')
    return `<div class="shift-bar ${shiftClass}">Zmiana ${shift} - produkcja łącznie ${pieces(st.good)} szt., braki łącznie ${pieces(st.reject)} szt.</div>
${machineBlocks}`
  }).join('\n')
}

// ─── Wywołania AI (ten sam model i mechanizm co "Raport dnia" IS PRO) ─────────

async function generateShiftNarrativeWithAi(apiKey: string, eventsByShift: Record<ShiftType, ShiftEvent[]>, shiftTotals: Record<ShiftType, ShiftSummary>, rows: LineDayRow[]): Promise<string> {
  const shiftData = SHIFTS.map(shift => {
    const st = shiftTotals[shift]
    const byMachine = new Map<string, ShiftEvent[]>()
    eventsByShift[shift].forEach(e => byMachine.set(e.machine, [...(byMachine.get(e.machine) ?? []), e]))
    const machines = rows.map(r => {
      const s = r.shifts[shift]
      return {
        name: r.machineName,
        good: s.good, reject: s.reject,
        rejectPct: (s.good + s.reject) > 0 ? (s.reject / (s.good + s.reject) * 100).toFixed(1) + '%' : '0%',
        target: s.target,
        notes: (byMachine.get(r.machineName) ?? []).map(e => `[${e.hour}] ${e.text}`)
      }
    })
    return { shift, totalGood: st.good, totalReject: st.reject, machines }
  })

  const prompt = `Jesteś autorem raportu zmianowego linii strzykawkowych. Napisz profesjonalną narrację na podstawie danych poniżej.

WAŻNE ZASADY:
- Pisz tylko o tym co jest w danych — zero domysłów
- Jeśli notes jest pusta i produkcja spełnia cel (target) → "Zmiana przebiegła bez zakłóceń."
- Jeśli notes zawiera zdarzenie: jeden fakt = jedno zdanie lub punkt listy
- Powtarzające się problemy między wpisami → "(zdarzenie powtarzające się)"
- Odrzut > 5% → wymuś wzmiankę w narracji
- Braki liczone są jako różnica licznika automatu drukującego i montującego — jeśli w notatce jest o tym mowa, zachowaj to sformułowanie
- Każda notatka jest już poprawna gramatycznie — nie zmieniaj liczb, nazw linii, godzin

HTML KLASY (używaj dokładnie tak):
<div class="shift-bar s1"> — dla Zmiany I (s2=II), treść: "Zmiana X — produkcja: N szt., braki: N szt."
<div class="mc-box m3"> — linia (naprzemiennie m3, m4)
<div class="mc-name"> — nazwa linii (CAPS)
<div class="mc-body"> — treść
<p class="sub-h"> — podsekcja np. "W trakcie zmiany odnotowano:" / "Podjęte działania:"
<p class="times"> — statystyki produkcji linii
<ul><li> — lista faktów / działań
<em style="color:#6B7280"> — gdy brak zdarzeń

STRUKTURA każdej linii:
1. <p class="times">Produkcja: <strong>N szt.</strong> | Braki: <strong>N szt. (X%)</strong></p>
2. Jedno zdanie otwierające (prawidłowa / zakłócona)
3. Jeśli są zdarzenia: <p class="sub-h">W trakcie zmiany odnotowano:</p> + lista faktów
4. Jedno zdanie zamykające

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
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 7000, messages: [{ role: 'user', content: prompt }] })
  })

  if (!response.ok) throw new Error(`AI narrative failed: ${response.status}`)
  const data = await response.json() as { content: { type: string; text?: string }[] }
  let html = data.content.map(c => c.text || '').join('').trim()
  html = html.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim()
  return html
}

async function generateAttentionSectionWithAi(apiKey: string, eventsByShift: Record<ShiftType, ShiftEvent[]>, rows: LineDayRow[]): Promise<string> {
  const allEvents = SHIFTS.flatMap(shift => eventsByShift[shift].map(e => ({ shift, machine: e.machine, hour: e.hour, text: e.text })))
  if (!allEvents.length) return ''

  const machineStats = rows.map(r => ({
    name: r.machineName,
    totalGood: r.total.good, totalReject: r.total.reject,
    rejectPct: (r.total.good + r.total.reject) > 0 ? (r.total.reject / (r.total.good + r.total.reject) * 100).toFixed(1) + '%' : '0%',
    shiftBreakdown: SHIFTS.map(s => ({ shift: s, good: r.shifts[s].good, reject: r.shifts[s].reject, events: eventsByShift[s].filter(e => e.machine === r.machineName).map(e => e.text) }))
  }))

  const prompt = `Na podstawie danych z całego dnia produkcyjnego na liniach strzykawkowych napisz krótką sekcję "Zalecenia na następną zmianę".

ZASADY:
- Tylko jeśli są realne problemy (odrzut > 5%, awaria, zgłoszenie jakościowe, powtarzające się zdarzenia, niezrealizowany cel zmiany)
- Maksymalnie 5 konkretnych punktów
- Każdy punkt: linia + konkretny problem + sugerowane działanie
- Jeśli dzień był bez problemów — zwróć pusty string ""
- Zero ogólników ("sprawdzić maszynę") — konkretnie co i gdzie
- Tylko HTML <ul><li><strong>LINIA:</strong> opis</li></ul>

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
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, messages: [{ role: 'user', content: prompt }] })
  })

  if (!response.ok) return ''
  const data = await response.json() as { content: { type: string; text?: string }[] }
  const raw = data.content.map(c => c.text || '').join('').trim().replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '').trim()
  return raw === '""' || raw === '' ? '' : raw
}

async function polishEventsWithAi(apiKey: string, eventsByShift: Record<ShiftType, ShiftEvent[]>): Promise<Record<ShiftType, ShiftEvent[]>> {
  const items = SHIFTS.flatMap(shift => eventsByShift[shift].map((event, index) => ({ id: `${shift}-${index}`, text: event.text }))).filter(item => item.text.trim())
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
      model: 'claude-haiku-4-5-20251001', max_tokens: 3000,
      messages: [{
        role: 'user', content: `Popraw tylko pisownie, interpunkcje i czytelnosc ponizszych komentarzy operatorow.

ZASADY BEZWZGLEDNE:
- Nie dodawaj faktow.
- Nie usuwaj faktow.
- Nie zmieniaj godzin, liczb, nazw linii, nazwisk ani skrotow technicznych.
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
  const raw = data.content.map(item => item.text || '').join('').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const polished = JSON.parse(raw) as { id: string; text: string }[]
  const byId = new Map(polished.map(item => [item.id, item.text?.trim()]))
  return {
    I: eventsByShift.I.map((event, index) => ({ ...event, text: safePolishedText(event.text, byId.get(`I-${index}`)) })),
    II: eventsByShift.II.map((event, index) => ({ ...event, text: safePolishedText(event.text, byId.get(`II-${index}`)) })),
    III: eventsByShift.III,
  }
}

// ─── API Key Modal (współdzieli ten sam klucz co "Raport dnia" IS PRO) ────────

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
            <a href="https://console.anthropic.com" target="_blank" rel="noopener" className="text-brand hover:underline">console.anthropic.com</a>
            {' '}→ API Keys
          </p>
        </div>
        <button onClick={() => key.trim() && onSave(key.trim())} disabled={!key.trim()} className="btn-primary w-full py-3 font-bold disabled:opacity-50">
          Zapisz i wygeneruj raport
        </button>
      </div>
    </div>
  )
}

// ─── Report Modal ─────────────────────────────────────────────────────────────

type NoProductionGap = { machineId: string; machineName: string; shift: ShiftType }

interface ReportModalProps {
  date: string
  rows: LineDayRow[]
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  eventsByShift: Record<ShiftType, ShiftEvent[]>
  onClose: () => void
}

function ReportModal({ date, rows, totals, shiftTotals, eventsByShift, onClose }: ReportModalProps) {
  const gaps: NoProductionGap[] = rows.flatMap(row =>
    SHIFTS.filter(s => !row.shifts[s].good && row.shifts[s].notes.length === 0).map(s => ({ machineId: row.machineId, machineName: row.machineName, shift: s }))
  )

  const [step, setStep] = useState<'preflight' | 'loading' | 'done' | 'error'>(gaps.length > 0 ? 'preflight' : 'loading')
  const [gapReasons, setGapReasons] = useState<Record<string, string>>({})
  const [emailHtml, setEmailHtml] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('margoline_api_key') || '')
  const [copied, setCopied] = useState(false)
  const generated = useRef(false)

  useEffect(() => {
    if (gaps.length > 0) return
    if (generated.current) return
    generated.current = true
    generate({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function gapKey(g: NoProductionGap) { return `${g.machineId}__${g.shift}` }

  async function startGenerate() {
    if (generated.current) return
    generated.current = true
    generate(gapReasons)
  }

  const allGapsFilled = gaps.every(g => gapReasons[gapKey(g)]?.trim())

  async function generate(reasons: Record<string, string>) {
    setStep('loading')
    try {
      const key = apiKey.trim()
      let reportEvents = eventsByShift
      let shiftsHtml: string
      let attentionHtml = ''

      const eventsWithGaps: Record<ShiftType, ShiftEvent[]> = { ...reportEvents }
      gaps.forEach(g => {
        const reason = reasons[gapKey(g)]?.trim()
        if (!reason) return
        eventsWithGaps[g.shift] = [...(eventsWithGaps[g.shift] ?? []), { machine: g.machineName, hour: 'cała zmiana', text: `Zmiana nieprodukcyjna — ${reason}`, operator: 'kierownik' }]
      })

      if (key) {
        try { reportEvents = await polishEventsWithAi(key, eventsWithGaps) } catch (err) { reportEvents = eventsWithGaps; console.warn('AI polish skipped', err) }
        try { shiftsHtml = await generateShiftNarrativeWithAi(key, reportEvents, shiftTotals, rows) }
        catch (err) { console.warn('AI narrative failed, falling back to template', err); shiftsHtml = buildSystemReportHtml(reportEvents, shiftTotals, rows) }
        try { attentionHtml = await generateAttentionSectionWithAi(key, reportEvents, rows) } catch (err) { console.warn('AI attention section skipped', err) }
      } else {
        shiftsHtml = buildSystemReportHtml(eventsWithGaps, shiftTotals, rows)
      }

      const html = buildEmailHtml({ date, rows, totals, shiftTotals, shiftsHtml, attentionHtml })
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
      navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000) }).catch(fallback)
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

  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
      <div className="relative w-full max-w-2xl my-8 bg-navy-800 border border-navy-600 rounded-2xl shadow-2xl">

        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-700">
          <div>
            <h2 className="text-white font-bold text-base flex items-center gap-2"><span>✉️</span> Raport email — Linie strzykawkowe</h2>
            <p className="text-navy-400 text-xs mt-0.5 capitalize">{dateFormatted}</p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white transition-colors text-xl">✕</button>
        </div>

        <div className="p-6">
          {step === 'preflight' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <span className="font-bold">Wymagane wyjaśnienie</span> — wykryto {gaps.length} {gaps.length === 1 ? 'pozycję' : 'pozycje'} bez produkcji na zmianie I/II. Przed wygenerowaniem raportu opisz przyczynę dla każdej linii.
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto">
                {gaps.map(g => {
                  const filled = !!gapReasons[gapKey(g)]?.trim()
                  return (
                    <div key={gapKey(g)} className={cn('rounded-xl border p-4', filled ? 'border-navy-600 bg-navy-900' : 'border-red-500/40 bg-red-500/5')}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-navy-400 uppercase tracking-wider">Zmiana {g.shift}</span>
                        <span className="text-white font-bold text-sm">{g.machineName}</span>
                        <span className={cn('ml-auto text-xs font-bold', filled ? 'text-green-400' : 'text-red-400')}>{filled ? '✓' : '* wymagane'}</span>
                      </div>
                      <input
                        type="text"
                        className={cn('input text-sm', !filled && 'border-red-500/50 focus:border-red-400')}
                        placeholder="np. planowy postój techniczny, brak zlecenia, święto zakładu..."
                        value={gapReasons[gapKey(g)] ?? ''}
                        onChange={e => setGapReasons(prev => ({ ...prev, [gapKey(g)]: e.target.value }))}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={startGenerate} disabled={!allGapsFilled} className="btn-primary flex-1 py-3 font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                  {allGapsFilled ? 'Generuj raport' : `Uzupełnij wszystkie pola (${gaps.filter(g => !gapReasons[gapKey(g)]?.trim()).length} brakujących)`}
                </button>
                <button onClick={onClose} className="btn-secondary px-5 py-3">Anuluj</button>
              </div>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-12">
              <svg className="animate-spin h-12 w-12 text-brand" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div className="text-center">
                <p className="text-white font-semibold">System generuje raport...</p>
                <p className="text-navy-400 text-sm mt-1">Układam zapisane dane bez dopisywania faktów</p>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                <div className="font-bold mb-1">Błąd generowania</div>
                {errorMsg}
              </div>
              <div className="rounded-xl border border-navy-600 bg-navy-900 p-4">
                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wider text-navy-400">Klucz API</span>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="input mt-1" placeholder="Wklej poprawny klucz" autoComplete="off" />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={clearApiKey} className="btn-secondary px-3 py-2 text-xs">Wyczysc klucz</button>
                  <button onClick={saveApiKeyAndRetry} disabled={!apiKey.trim()} className="btn-primary px-3 py-2 text-xs disabled:opacity-50">Zapisz klucz i sprobuj ponownie</button>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={onClose} className="btn-secondary flex-1">Zamknij</button>
                <button onClick={() => { generated.current = false; generate(gapReasons) }} className="btn-primary flex-1">Spróbuj ponownie</button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300 flex items-center gap-2">
                <span>✓</span> Raport gotowy — wklej do nowej wiadomości w Outlooku
              </div>
              <div className="rounded-xl border border-navy-600 overflow-hidden bg-white" style={{ height: 320 }}>
                <iframe srcDoc={emailHtml} title="Podgląd" className="w-full h-full" sandbox="allow-same-origin" />
              </div>
              <button
                onClick={copyToClipboard}
                className={cn('w-full py-3.5 rounded-xl font-bold text-sm transition-all', copied ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20')}
              >
                {copied ? '✓ Skopiowano! Wklej w Outlook (Ctrl+V)' : '📋 Kopiuj do schowka'}
              </button>
              <div className="grid grid-cols-1 gap-3">
                <button onClick={openInWindow} className="btn-secondary py-2.5 text-sm">🔍 Podgląd w nowym oknie</button>
              </div>
              <p className="text-navy-500 text-xs text-center">Otwórz Outlooka → Nowa wiadomość → Ctrl+V</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SyringeAiReport({ embedded = false }: { embedded?: boolean } = {}) {
  const [date, setDate] = useState(todayIso)
  const [machines, setMachines] = useState<SaMachine[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [entryEvents, setEntryEvents] = useState<{ machine: string; hour: string; text: string; operator: string; shift: ShiftType }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalState, setModalState] = useState<'closed' | 'apikey' | 'report'>('closed')

  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadSeq.current
    setLoading(true); setError('')

    const [mRes, sRes] = await Promise.all([
      supabase.from('sa_machines').select('*').eq('is_active', true).is('deleted_at', null).order('sort_order'),
      supabase.from('sa_sessions')
        .select('*, machine:sa_machines(id,name), assortment:sa_assortments(shift_target_qty,reject_target_pct), operator:profiles!sa_sessions_operator_id_fkey(full_name)')
        .eq('session_date', date)
    ])
    if (requestId !== loadSeq.current) return
    if (mRes.error || sRes.error) {
      setError(mRes.error?.message || sRes.error?.message || 'Błąd ładowania')
      setLoading(false)
      return
    }
    const machineList = (mRes.data ?? []) as SaMachine[]
    const sessionList = (sRes.data ?? []) as SessionRow[]
    setMachines(machineList)
    setSessions(sessionList)

    const sessionIds = sessionList.map(s => s.id)
    if (sessionIds.length === 0) {
      setEntryEvents([])
      setLoading(false)
      return
    }

    const sessionMeta = new Map(sessionList.map(s => [s.id, { machine: s.machine?.name ?? 'Nieznana linia', shift: s.shift_type, operator: s.operator?.full_name ?? '-' }]))

    const [peRes, dtRes, frRes, qiRes, hoRes] = await Promise.all([
      supabase.from('sa_production_entries').select('session_id, recorded_at, notes, reject_qty, produced_qty').in('session_id', sessionIds).eq('is_cancelled', false).not('notes', 'is', null),
      supabase.from('sa_downtime_events').select('session_id, started_at, description, actions_taken, category:sa_downtime_categories(name)').in('session_id', sessionIds),
      supabase.from('sa_failure_reports').select('session_id, reported_at, component_name, symptoms, priority').in('session_id', sessionIds),
      supabase.from('sa_quality_issues').select('session_id, detected_at, description, affected_qty').in('session_id', sessionIds),
      supabase.from('sa_handovers').select('session_id, created_at, active_issues, adjustments_made, unresolved_failures, quality_info, component_status, recommendations, comment').in('session_id', sessionIds),
    ])
    if (requestId !== loadSeq.current) return
    const eventError = peRes.error || dtRes.error || frRes.error || qiRes.error || hoRes.error
    if (eventError) {
      setEntryEvents([])
      setError(`Nie udało się odczytać pełnego przebiegu zmian: ${eventError.message}`)
      setLoading(false)
      return
    }

    const events: { machine: string; hour: string; text: string; operator: string; shift: ShiftType }[] = []

    ;(peRes.data ?? []).forEach((e: any) => {
      const meta = sessionMeta.get(e.session_id)
      if (!meta || !e.notes?.trim()) return
      const rejectNote = e.reject_qty > 0 ? ` (braki: ${e.reject_qty} szt.)` : ''
      events.push({ machine: meta.machine, hour: new Date(e.recorded_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }), text: `${e.notes.trim()}${rejectNote}`, operator: meta.operator, shift: meta.shift })
    })
    ;(dtRes.data ?? []).forEach((e: any) => {
      const meta = sessionMeta.get(e.session_id)
      if (!meta) return
      const catName = e.category?.name ?? 'Przestój'
      const text = [`${catName}${e.description ? `: ${e.description}` : ''}`, e.actions_taken ? `Działania: ${e.actions_taken}` : ''].filter(Boolean).join('. ')
      events.push({ machine: meta.machine, hour: new Date(e.started_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }), text, operator: meta.operator, shift: meta.shift })
    })
    ;(frRes.data ?? []).forEach((e: any) => {
      const meta = sessionMeta.get(e.session_id)
      if (!meta) return
      const text = `Awaria${e.component_name ? ` (${e.component_name})` : ''}: ${e.symptoms}${e.priority === 'critical' || e.priority === 'high' ? ' [priorytet wysoki]' : ''}`
      events.push({ machine: meta.machine, hour: new Date(e.reported_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }), text, operator: meta.operator, shift: meta.shift })
    })
    ;(qiRes.data ?? []).forEach((e: any) => {
      const meta = sessionMeta.get(e.session_id)
      if (!meta) return
      const text = `Problem jakości: ${e.description}${e.affected_qty ? ` (dot. ${e.affected_qty} szt.)` : ''}`
      events.push({ machine: meta.machine, hour: new Date(e.detected_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }), text, operator: meta.operator, shift: meta.shift })
    })
    ;(hoRes.data ?? []).forEach((e: any) => {
      const meta = sessionMeta.get(e.session_id)
      if (!meta) return
      const parts = [
        e.active_issues ? `Aktywne problemy: ${e.active_issues}` : '',
        e.adjustments_made ? `Regulacje: ${e.adjustments_made}` : '',
        e.unresolved_failures ? `Nierozwiązane awarie: ${e.unresolved_failures}` : '',
        e.quality_info ? `Jakość: ${e.quality_info}` : '',
        e.component_status ? `Komponenty: ${e.component_status}` : '',
        e.recommendations ? `Zalecenia: ${e.recommendations}` : '',
        e.comment ? `Komentarz: ${e.comment}` : ''
      ].filter(Boolean)
      if (!parts.length) return
      events.push({
        machine: meta.machine,
        hour: new Date(e.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }),
        text: `Zamknięcie zmiany. ${parts.join('. ')}`,
        operator: meta.operator,
        shift: meta.shift
      })
    })

    setEntryEvents(events)
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase.channel(`sa-ai-report-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_sessions' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_production_entries' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_handovers' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [date, load])

  const rows = useMemo<LineDayRow[]>(() => {
    const byMachine = new Map<string, LineDayRow>()
    machines.forEach(m => byMachine.set(m.id, { machineId: m.id, machineName: m.name, shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() }, total: emptySummary() }))
    sessions.forEach(s => {
      if (!SHIFTS.includes(s.shift_type)) return
      const row = byMachine.get(s.machine_id) ?? { machineId: s.machine_id, machineName: s.machine?.name ?? 'Nieznana linia', shifts: { I: emptySummary(), II: emptySummary(), III: emptySummary() }, total: emptySummary() }
      byMachine.set(s.machine_id, row)
      const shift = row.shifts[s.shift_type]
      shift.good += s.total_good ?? 0
      shift.reject += s.total_reject ?? 0
      shift.sessions += 1
      shift.runtime += s.total_runtime_min ?? 0
      shift.downtime += s.total_downtime_min ?? 0
      const target = s.plan_qty ?? s.assortment?.shift_target_qty
      if (target != null) shift.target = (shift.target ?? 0) + target
      if (s.assortment?.reject_target_pct != null) shift.rejectTargetPct = s.assortment.reject_target_pct
      if (s.operator?.full_name) shift.operators.push(s.operator.full_name)
      if (s.summary_notes?.trim()) shift.notes.push(s.summary_notes.trim())
    })
    byMachine.forEach(row => {
      row.total = emptySummary()
      SHIFTS.forEach(shiftType => {
        const s = row.shifts[shiftType]
        row.total.good += s.good; row.total.reject += s.reject; row.total.sessions += s.sessions
        row.total.runtime += s.runtime; row.total.downtime += s.downtime
        row.total.target = (row.total.target ?? 0) + (s.target ?? 0)
      })
    })
    return Array.from(byMachine.values()).sort((a, b) => a.machineName.localeCompare(b.machineName))
  }, [machines, sessions])

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.good += row.total.good; acc.reject += row.total.reject; acc.sessions += row.total.sessions
    acc.runtime += row.total.runtime; acc.downtime += row.total.downtime
    return acc
  }, emptySummary()), [rows])

  const shiftTotals = useMemo(() => {
    const result: Record<ShiftType, ShiftSummary> = { I: emptySummary(), II: emptySummary(), III: emptySummary() }
    rows.forEach(row => SHIFTS.forEach(s => {
      result[s].good += row.shifts[s].good; result[s].reject += row.shifts[s].reject; result[s].sessions += row.shifts[s].sessions
      result[s].runtime += row.shifts[s].runtime; result[s].downtime += row.shifts[s].downtime
    }))
    return result
  }, [rows])

  const eventsByShift = useMemo(() => {
    const result: Record<ShiftType, ShiftEvent[]> = { I: [], II: [], III: [] }
    entryEvents.forEach(e => { result[e.shift].push({ machine: e.machine, hour: e.hour, text: e.text, operator: e.operator }) })
    SHIFTS.forEach(s => result[s].sort((a, b) => a.hour.localeCompare(b.hour)))
    return result
  }, [entryEvents])

  function handleGenerateClick() {
    const hasKey = !!localStorage.getItem('margoline_api_key')
    setModalState(hasKey ? 'report' : 'apikey')
  }
  function handleApiKeySave(key: string) {
    localStorage.setItem('margoline_api_key', key)
    setModalState('report')
  }

  const dateForHeader = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const hasSessions = sessions.length > 0
  const canGenerate = machines.length > 0

  return (
    <>
      {modalState === 'apikey' && <ApiKeyModal onSave={handleApiKeySave} />}
      {modalState === 'report' && (
        <ReportModal date={date} rows={rows} totals={totals} shiftTotals={shiftTotals} eventsByShift={eventsByShift} onClose={() => setModalState('closed')} />
      )}

      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={embedded ? 'text-xl font-bold text-white' : 'text-2xl font-bold text-white'}>
              Raport email — linie strzykawkowe
            </h1>
            <p className="text-navy-400 mt-1 capitalize">{dateForHeader}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, -1))}>← Poprzedni</button>
            <input className="input w-[170px]" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, 1))}>Następny →</button>
            <button className="btn-secondary text-xs py-2 px-3" onClick={load}>{loading ? '...' : 'Odśwież'}</button>
            <button onClick={handleGenerateClick} disabled={loading || !canGenerate} className="btn-primary text-xs py-2 px-4 flex items-center gap-2 disabled:opacity-40">
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2 7l9 6 9-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Generuj email
            </button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
        {!loading && !hasSessions && !error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Brak zapisanych sesji w wybranym dniu. Raport nadal można wygenerować, ale system poprosi o opis dla każdej aktywnej linii na zmianie I i II.
          </div>
        )}

        {/* Tabela wyników wg linii i zmian */}
        <div className="rounded-2xl border border-navy-700 bg-navy-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-navy-400 uppercase tracking-wider border-b border-navy-700">
                <th className="px-4 py-3">Linia</th>
                <th className="px-4 py-3 text-center">Zmiana I</th>
                <th className="px-4 py-3 text-center">Zmiana II</th>
                <th className="px-4 py-3 text-center">Łącznie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {rows.map(row => (
                <tr key={row.machineId}>
                  <td className="px-4 py-3 font-bold text-white">{row.machineName}</td>
                  {SHIFTS.map(s => {
                    const sm = row.shifts[s]
                    const rj = (sm.good + sm.reject) > 0 ? (sm.reject / (sm.good + sm.reject) * 100).toFixed(1) : null
                    return (
                      <td key={s} className="px-4 py-3 text-center">
                        {sm.sessions === 0 ? <span className="text-navy-600 text-xs">brak sesji</span> : (
                          <>
                            <div className="text-white font-bold">{pieces(sm.good)}</div>
                            <div className="text-xs text-red-400">odrz. {pieces(sm.reject)}{rj ? ` (${rj}%)` : ''}</div>
                          </>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center font-bold text-brand">{pieces(row.total.good)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
