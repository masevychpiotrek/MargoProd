import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { HourlyReport, Machine, Shift, ShiftType } from '@/types/database'

// ─── Types ───────────────────────────────────────────────────────────────────

const SHIFTS: ShiftType[] = ['I', 'II', 'III']

type ReportWithContext = Omit<HourlyReport, 'operator'> & {
  ready_min?: number
  alarm_min?: number
  operator?: { full_name: string } | { full_name: string }[] | null
  shift?: { shift_type: ShiftType; shift_date?: string } | { shift_type: ShiftType; shift_date?: string }[] | null
}

type ShiftSummary = {
  good: number; reject: number; reports: number
  runtime: number; ready: number; alarm: number; downtime: number
  notes: string[]
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function emptySummary(): ShiftSummary {
  return { good: 0, reject: 0, reports: 0, runtime: 0, ready: 0, alarm: 0, downtime: 0, notes: [] }
}
function reportDowntimeMinutes(report: ReportWithContext) {
  const downtime = report.downtime_min + report.failure_min
  const readyAndAlarm = (report.ready_min ?? 0) + (report.alarm_min ?? 0)
  return downtime === readyAndAlarm && report.failure_min === 0 ? 0 : downtime
}
function mins(value: number) {
  const rounded = Math.max(0, Math.round(value || 0))
  if (!rounded) return '-'
  const h = Math.floor(rounded / 60), m = rounded % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`
}
function pieces(value: number) { return value.toLocaleString('pl-PL') }
function pct(o: number, t: number) { return t ? ((o / t) * 100).toFixed(1) + '%' : '-' }
function timeLine(s: ShiftSummary) {
  return `praca ${mins(s.runtime)} | got. ${mins(s.ready)} | alarm/postój ${mins(s.alarm + s.downtime)}`
}
function noteText(report: ReportWithContext) {
  return [report.downtime_reason, report.notes].map(v => v?.trim()).filter(Boolean).join(' - ')
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
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  shiftsHtml: string
}) {
  const { date, rows, totals, shiftTotals, shiftsHtml } = params
  const K = {
    navy: '#1B2A4A', blue: '#4A7EC7', blueLt: '#EEF4FF', blueBr: '#C2D4F0', blueTx: '#1B3A6B',
    teal: '#1A7F6E', tealLt: '#EDFAF6', tealBr: '#A0D9CE', tealTx: '#0D5247',
    red: '#C0392B', gold: '#B8860B', gray1: '#F7F8FA', gray2: '#E4E8EE', gray3: '#6B7280',
    s1bg: '#EEF0FF', s1tx: '#3730A3', s2bg: '#EDFAF6', s2tx: '#0D5247', s3bg: '#FFF7ED', s3tx: '#92400E',
  }
  const tt = totals.good, to = totals.reject
  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })

  function TH(extra = '') {
    return `style="background:${K.blue};color:#fff;padding:10px 12px;font-size:12px;font-weight:bold;letter-spacing:.5px;font-family:Arial,sans-serif;${extra}"`
  }
  function TD(bg: string, br: string, tx: string, extra = '') {
    return `style="background:${bg};border:1px solid ${br};padding:10px 12px;color:${tx};font-family:Arial,sans-serif;vertical-align:middle;${extra}"`
  }
  function fmtCell(p: number, o: number) {
    if (!p && !o) return `<em style="color:${K.gray3};font-family:Arial,sans-serif">Brak produkcji</em>`
    return `<span style="font-size:14px;font-weight:bold;color:${K.navy};font-family:Arial,sans-serif">${pieces(p)} szt.</span>`
      + `<br><span style="color:${K.red};font-size:12px;font-family:Arial,sans-serif">odrzut: ${pieces(o)} szt.</span>`
      + `<br><span style="color:${K.gold};font-size:12px;font-weight:bold;font-family:Arial,sans-serif">${pct(o, p)}</span>`
  }

  const machineRows = rows.map((row, idx) => {
    const bg = idx % 2 === 0 ? K.blueLt : K.tealLt
    const br = idx % 2 === 0 ? K.blueBr : K.tealBr
    const tx = idx % 2 === 0 ? K.blueTx : K.tealTx
    const ac = idx % 2 === 0 ? K.blue : K.teal
    return `<tr>
  <td ${TD(bg, br, tx, 'font-weight:bold')}>${row.machineName}</td>
  <td align="center" ${TD(bg, br, tx)}>${fmtCell(row.shifts.I.good, row.shifts.I.reject)}</td>
  <td align="center" ${TD(bg, br, tx)}>${fmtCell(row.shifts.II.good, row.shifts.II.reject)}</td>
  <td align="center" ${TD(bg, br, tx)}>${fmtCell(row.shifts.III.good, row.shifts.III.reject)}</td>
  <td align="center" style="background:${ac};border:1px solid ${ac};padding:10px 12px;color:#fff;font-weight:bold;font-size:15px;font-family:Arial,sans-serif;text-align:center">${pieces(row.total.good)}<br><span style="font-size:11px;font-weight:normal;color:#fff">szt.</span></td>
</tr>`
  }).join('\n')

  const prodTable = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;font-family:Arial,sans-serif">
<thead><tr>
  <th width="20%" align="left" ${TH()}>AUTOMAT</th>
  <th width="20%" align="center" ${TH('text-align:center')}>ZMIANA I</th>
  <th width="20%" align="center" ${TH('text-align:center')}>ZMIANA II</th>
  <th width="20%" align="center" ${TH('text-align:center')}>ZMIANA III</th>
  <th width="20%" align="center" ${TH('text-align:center')}>\u0141\u0104CZNIE</th>
</tr></thead>
<tbody>
${machineRows}
<tr>
  <td ${TD(K.gray1, K.gray2, K.navy, 'font-weight:bold')}>\u0141\u0105cznie</td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}><strong>${pieces(shiftTotals.I.good)}</strong> szt.</td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}><strong>${pieces(shiftTotals.II.good)}</strong> szt.</td>
  <td align="center" ${TD(K.gray1, K.gray2, K.navy)}><strong>${pieces(shiftTotals.III.good)}</strong> szt.</td>
  <td align="center" style="background:${K.blue};border:1px solid ${K.blue};padding:10px 12px;color:#fff;font-weight:bold;font-size:15px;font-family:Arial,sans-serif;text-align:center">${pieces(tt)}<br><span style="font-size:11px;font-weight:normal;color:#fff">szt.</span></td>
</tr>
</tbody></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
<tr><td style="padding:10px 14px;background:${K.gray1};border-left:4px solid ${K.blue};font-family:Arial,sans-serif;font-size:13px;color:${K.navy}">
  \u0141\u0105czna produkcja: <strong>${pieces(tt)} szt.</strong> &nbsp;|&nbsp; \u0141\u0105czny odrzut: <strong style="color:${K.red}">${pieces(to)} szt. (${pct(to, tt)})</strong>
</td></tr></table>`

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
        const sc = cls.includes('s1') ? 's1' : cls.includes('s2') ? 's2' : 's3'
        const c = { s1: { bg: K.s1bg, tx: K.s1tx }, s2: { bg: K.s2bg, tx: K.s2tx }, s3: { bg: K.s3bg, tx: K.s3tx } }[sc]
        return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px"><tr><td style="background:${c.bg};color:${c.tx};padding:8px 16px;border-left:4px solid ${c.tx};font-size:13px;font-weight:bold;font-family:Arial,sans-serif">${kids()}</td></tr></table>`
      }
      if (cls.includes('mc-box')) {
        const isM3 = cls.includes('m3')
        const bg = isM3 ? K.blueLt : K.tealLt, br = isM3 ? K.blueBr : K.tealBr, ac = isM3 ? K.blue : K.teal
        return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px"><tr><td style="background:${bg};border:1px solid ${br};border-left:4px solid ${ac};padding:14px 16px;font-family:Arial,sans-serif">${kids()}</td></tr></table>`
      }
      if (cls.includes('mc-name')) {
        const col = curMC === 'm3' ? K.blue : K.teal
        return `<p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:${col};font-family:Arial,sans-serif">${kids()}</p>`
      }
      if (cls.includes('mc-body')) return `<div style="font-size:13px;color:${K.navy};line-height:1.75;font-family:Arial,sans-serif">${kids()}</div>`
      if (cls.includes('sub-h')) {
        const col = curMC === 'm3' ? K.blue : K.teal
        return `<p style="margin:10px 0 4px;font-size:12px;font-weight:bold;color:${col};text-transform:uppercase;letter-spacing:.4px;font-family:Arial,sans-serif">${kids()}</p>`
      }
      if (cls.includes('times')) return `<p style="margin-top:10px;padding-top:8px;border-top:1px dashed ${K.gray2};font-size:12px;color:${K.gray3};font-family:Arial,sans-serif">${kids()}</p>`
      if (tag === 'p') return `<p style="margin:0 0 5px;font-size:13px;color:${K.navy};line-height:1.75;font-family:Arial,sans-serif">${kids()}</p>`
      if (tag === 'ul') return `<ul style="margin:4px 0 8px 18px;padding:0;font-family:Arial,sans-serif">${kids()}</ul>`
      if (tag === 'li') return `<li style="margin-bottom:3px;font-size:13px;color:${K.navy};line-height:1.75;font-family:Arial,sans-serif">${kids()}</li>`
      if (tag === 'strong') return `<strong style="font-weight:bold;color:${K.navy};font-family:Arial,sans-serif">${kids()}</strong>`
      if (tag === 'em') { const es = el.getAttribute('style') || ''; return `<em style="color:${K.gray3};font-family:Arial,sans-serif;${es}">${kids()}</em>` }
      if (tag === 'span') { const es = el.getAttribute('style') || ''; return `<span style="font-family:Arial,sans-serif;${es}">${kids()}</span>` }
      if (tag === 'br') return '<br>'
      return kids()
    }
    return Array.from(tmp.childNodes).map(n => cn2(n, '')).join('')
  }

  const emailShifts = convertShiftsToEmail(shiftsHtml)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:${K.navy};margin:0;padding:0;background:#fff">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:${K.blue};padding:14px 20px">
    <p style="margin:0;font-size:15px;font-weight:bold;color:#fff;font-family:Arial,sans-serif">Wydzia\u0142 Monta\u017cu Automatycznego</p>
    <p style="margin:3px 0 0;font-size:12px;color:#E8F0FA;font-family:Arial,sans-serif">Raport produkcyjny &bull; ${dateFormatted} r.</p>
  </td></tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px 0 24px 0">
    <p style="font-size:14px;line-height:1.8;margin:0 0 20px;color:${K.navy};font-family:Arial,sans-serif">
      Szanowni Pa&nacute;stwo,<br>
      W za&lstrok;&aogon;czeniu przekazuj&eogon; raport z wynik&oacute;w produkcyjnych oraz zestawienie kluczowych zdarze&nacute; na Wydziale Monta&zdot;u Automatycznego z dnia <strong>${dateFormatted} r.</strong>
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px"><tr><td style="border-bottom:2px solid ${K.blue};padding-bottom:6px">
      <span style="font-size:14px;font-weight:bold;color:${K.blue};font-family:Arial,sans-serif">1. Wyniki produkcyjne</span>
    </td></tr></table>
    ${prodTable}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 12px 0"><tr><td style="border-bottom:2px solid ${K.blue};padding-bottom:6px">
      <span style="font-size:14px;font-weight:bold;color:${K.blue};font-family:Arial,sans-serif">2. Kluczowe zdarzenia</span>
    </td></tr></table>
    ${emailShifts}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px"><tr><td style="border-top:1px solid ${K.gray2};padding-top:12px">
      <p style="margin:0;font-size:13px;color:${K.gray3};font-family:Arial,sans-serif">W przypadku dodatkowych pyta&nacute; lub w&aogon;tpliwo&sacute;ci pozostaj&eogon; do dyspozycji.</p>
    </td></tr></table>
  </td></tr></table>
</td></tr></table>
</body></html>`
}

// ─── AI prompt ────────────────────────────────────────────────────────────────

function buildAiPrompt(
  eventsByShift: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]>,
  shiftTotals: Record<ShiftType, ShiftSummary>,
  machineNames: string[]
): string {
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
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  eventsByShift: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]>
  onClose: () => void
}

function ReportModal({ date, rows, totals, shiftTotals, eventsByShift, onClose }: ReportModalProps) {
  const [step, setStep] = useState<'loading' | 'done' | 'error'>('loading')
  const [emailHtml, setEmailHtml] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const generated = useRef(false)

  const apiKey = localStorage.getItem('margoline_api_key') || ''
  const machineNames = rows.map(r => r.machineName)

  useEffect(() => {
    if (generated.current) return
    generated.current = true
    generate()
  }, [])

  async function generate() {
    setStep('loading')
    try {
      const prompt = buildAiPrompt(eventsByShift, shiftTotals, machineNames)
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 5000,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(err.error?.message || `Błąd API: ${resp.status}`)
      }
      const data = await resp.json() as { content: { type: string; text?: string }[] }
      let shiftsHtml = data.content.map(c => c.text || '').join('').trim()
      while (shiftsHtml.startsWith('```')) { shiftsHtml = shiftsHtml.slice(shiftsHtml.indexOf('\n') + 1).trim() }
      while (shiftsHtml.endsWith('```')) { shiftsHtml = shiftsHtml.slice(0, shiftsHtml.lastIndexOf('\n')).trim() }
      const html = buildEmailHtml({ date, rows, totals, shiftTotals, shiftsHtml })
      setEmailHtml(html)
      setStep('done')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Nieznany błąd')
      setStep('error')
    }
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
                <p className="text-white font-semibold">AI redaguje raport...</p>
                <p className="text-navy-400 text-sm mt-1">Formatuję notatki operatorów</p>
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
              <div className="flex gap-3">
                <button onClick={onClose} className="btn-secondary flex-1">Zamknij</button>
                <button onClick={() => { generated.current = false; generate() }} className="btn-primary flex-1">
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
              <div className="grid grid-cols-2 gap-3">
                <button onClick={openInWindow} className="btn-secondary py-2.5 text-sm">
                  🔍 Podgląd w nowym oknie
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem('margoline_api_key')
                    onClose()
                  }}
                  className="btn-secondary py-2.5 text-sm text-navy-400"
                >
                  🔑 Zmień klucz API
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
      setReports((rRes.data ?? []) as ReportWithContext[])
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
        s.runtime += report.runtime_min; s.ready += report.ready_min ?? 0
        s.alarm += report.alarm_min ?? 0; s.downtime += reportDowntimeMinutes(report)
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
        row.total.notes.push(...shift.notes.map(note => `Zmiana ${shiftType}, ${note}`))
      })
    })
    return Array.from(byMachine.values()).sort((a, b) => a.machineName.localeCompare(b.machineName))
  }, [machineNameById, machines, reports, shiftSummaries])

  const totals = useMemo(() => rows.reduce((acc, row) => {
    acc.good += row.total.good; acc.reject += row.total.reject; acc.reports += row.total.reports
    acc.runtime += row.total.runtime; acc.ready += row.total.ready
    acc.alarm += row.total.alarm; acc.downtime += row.total.downtime
    return acc
  }, emptySummary()), [rows])

  const shiftTotals = useMemo(() => {
    const result: Record<ShiftType, ShiftSummary> = { I: emptySummary(), II: emptySummary(), III: emptySummary() }
    rows.forEach(row => SHIFTS.forEach(s => {
      result[s].good += row.shifts[s].good; result[s].reject += row.shifts[s].reject
      result[s].reports += row.shifts[s].reports; result[s].runtime += row.shifts[s].runtime
      result[s].ready += row.shifts[s].ready; result[s].alarm += row.shifts[s].alarm
      result[s].downtime += row.shifts[s].downtime
    }))
    return result
  }, [rows])

  const eventsByShift = useMemo(() => {
    const result: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]> =
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
    const key = localStorage.getItem('margoline_api_key')
    if (!key) {
      setModalState('apikey')
    } else {
      setModalState('report')
    }
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Produkcja łącznie', value: `${pieces(totals.good)} szt`, color: 'text-brand' },
            { label: 'Odrzut łącznie', value: `${pieces(totals.reject)} szt`, color: totals.reject ? 'text-red-400' : 'text-green-400' },
            { label: 'Wpisy', value: `${totals.reports}`, color: 'text-white' },
            { label: 'Czas pracy', value: mins(totals.runtime), color: 'text-green-400' },
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
              <div className="kpi-sub mt-2">{pieces(shiftTotals[shift].good)} szt | {shiftTotals[shift].reports} wpisów</div>
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
                        {row.shifts[s].reports ? (
                          <div>
                            <div className="font-mono text-lg font-bold text-white">{pieces(row.shifts[s].good)} szt</div>
                            <div className="mt-1 text-xs text-navy-400">
                              odrzut <span className="font-mono text-red-300">{pieces(row.shifts[s].reject)}</span> | wpisy {row.shifts[s].reports}
                            </div>
                            <div className="mt-2 rounded-lg bg-navy-900 px-2 py-1.5 text-xs leading-relaxed text-navy-300">
                              <span className="font-mono text-green-300">praca {mins(row.shifts[s].runtime)}</span><br />
                              got. {mins(row.shifts[s].ready)} | alarm {mins(row.shifts[s].alarm + row.shifts[s].downtime)}
                            </div>
                          </div>
                        ) : (
                          <span className="italic text-navy-500">Brak produkcji</span>
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
                    {pieces(shiftTotals[shift].good)} szt | odrzut {pieces(shiftTotals[shift].reject)} | praca {mins(shiftTotals[shift].runtime)}
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
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-[130px_1fr_110px_110px_120px] md:items-center">
                    <div className="font-mono text-sm font-bold text-white">{report.hour_block}</div>
                    <div>
                      <div className="font-bold text-white">{machineNameById[report.machine_id] ?? '-'}</div>
                      <div className="text-xs text-navy-500">Zmiana {shiftType} | {one(report.operator)?.full_name ?? '-'}</div>
                    </div>
                    <div className="font-mono font-bold text-green-300">{pieces(report.good_count)} szt</div>
                    <div className="font-mono text-red-300">odrz. {pieces(report.reject_count)}</div>
                    <div className="font-mono text-navy-300">praca {mins(report.runtime_min)}</div>
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
