import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { HourlyReport, Machine, ShiftType } from '@/types/database'

// ─── Types ──────────────────────────────────────────────────────────────────

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

type Kontekst = { material: string; settings: string; infra: string; other: string }

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  return `praca ${mins(s.runtime)} | got. ${mins(s.ready)} | alarm/postoj ${mins(s.alarm + s.downtime)}`
}
function noteText(report: ReportWithContext) {
  return [report.downtime_reason, report.notes].map(v => v?.trim()).filter(Boolean).join(' - ')
}

// ─── Email HTML Builder ──────────────────────────────────────────────────────

function buildEmailHtml(params: {
  date: string
  rows: MachineDayRow[]
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  shiftsHtml: string
  kontekst: Kontekst
}) {
  const { date, rows, totals, shiftTotals, shiftsHtml, kontekst } = params

  const K = {
    navy: '#1B2A4A', blue: '#4A7EC7', blueLt: '#EEF4FF', blueBr: '#C2D4F0', blueTx: '#1B3A6B',
    teal: '#1A7F6E', tealLt: '#EDFAF6', tealBr: '#A0D9CE', tealTx: '#0D5247',
    red: '#C0392B', gold: '#B8860B', gray1: '#F7F8FA', gray2: '#E4E8EE', gray3: '#6B7280',
    s1bg: '#EEF0FF', s1tx: '#3730A3', s2bg: '#EDFAF6', s2tx: '#0D5247', s3bg: '#FFF7ED', s3tx: '#92400E',
    amber: '#D97706', amberLt: '#FFF7ED',
  }

  const tt = totals.good, to = totals.reject
  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })

  function TH(extra = '') {
    return `style="background:${K.blue};color:#ffffff;padding:10px 12px;font-size:12px;font-weight:bold;letter-spacing:.5px;font-family:Arial,sans-serif;${extra}"`
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

  // Build production table rows from actual machines
  const machineRows = rows.map((row, idx) => {
    const isFirst = idx % 2 === 0
    const bg = isFirst ? K.blueLt : K.tealLt
    const br = isFirst ? K.blueBr : K.tealBr
    const tx = isFirst ? K.blueTx : K.tealTx
    const ac = isFirst ? K.blue : K.teal
    return `<tr>
  <td ${TD(bg, br, tx, 'font-weight:bold')}>${row.machineName}</td>
  <td align="center" ${TD(bg, br, tx)}>${fmtCell(row.shifts.I.good, row.shifts.I.reject)}</td>
  <td align="center" ${TD(bg, br, tx)}>${fmtCell(row.shifts.II.good, row.shifts.II.reject)}</td>
  <td align="center" ${TD(bg, br, tx)}>${fmtCell(row.shifts.III.good, row.shifts.III.reject)}</td>
  <td align="center" style="background:${ac};border:1px solid ${ac};padding:10px 12px;color:#fff;font-weight:bold;font-size:15px;font-family:Arial,sans-serif;text-align:center">${pieces(row.total.good)}<br><span style="font-size:11px;font-weight:normal;color:#fff;font-family:Arial,sans-serif">szt.</span></td>
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
  <td align="center" style="background:${K.blue};border:1px solid ${K.blue};padding:10px 12px;color:#fff;font-weight:bold;font-size:15px;font-family:Arial,sans-serif;text-align:center">${pieces(tt)}<br><span style="font-size:11px;font-weight:normal;color:#fff;font-family:Arial,sans-serif">szt.</span></td>
</tr>
</tbody></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
<tr><td style="padding:10px 14px;background:${K.gray1};border-left:4px solid ${K.blue};font-family:Arial,sans-serif;font-size:13px;color:${K.navy}">
  \u0141\u0105czna produkcja: <strong style="color:${K.navy};font-family:Arial,sans-serif">${pieces(tt)} szt.</strong>
  &nbsp;|&nbsp;
  \u0141\u0105czny odrzut: <strong style="color:${K.red};font-family:Arial,sans-serif">${pieces(to)} szt. (${pct(to, tt)})</strong>
</td></tr></table>`

  // Kontekst section
  const hasKontekst = kontekst.material || kontekst.settings || kontekst.infra || kontekst.other
  let kontekstHtml = ''
  if (hasKontekst) {
    const lines = [
      kontekst.material && `<li style="margin-bottom:4px;font-size:13px;color:#1B2A4A;font-family:Arial,sans-serif"><strong>Zmiana materia\u0142u/surowca:</strong> ${kontekst.material}</li>`,
      kontekst.settings && `<li style="margin-bottom:4px;font-size:13px;color:#1B2A4A;font-family:Arial,sans-serif"><strong>Zmiana ustawie\u0144/parametr\u00f3w:</strong> ${kontekst.settings}</li>`,
      kontekst.infra && `<li style="margin-bottom:4px;font-size:13px;color:#1B2A4A;font-family:Arial,sans-serif"><strong>Problemy infrastrukturalne:</strong> ${kontekst.infra}</li>`,
      kontekst.other && `<li style="margin-bottom:4px;font-size:13px;color:#1B2A4A;font-family:Arial,sans-serif"><strong>Inne:</strong> ${kontekst.other}</li>`,
    ].filter(Boolean).join('')
    kontekstHtml = `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 12px 0"><tr><td style="border-bottom:2px solid ${K.amber};padding-bottom:6px">
  <span style="font-size:14px;font-weight:bold;color:${K.amber};font-family:Arial,sans-serif">2. Kontekst dnia</span>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
<tr><td style="background:${K.amberLt};border-left:4px solid ${K.amber};padding:12px 16px;font-family:Arial,sans-serif">
  <ul style="margin:0;padding-left:18px">${lines}</ul>
</td></tr></table>`
  }

  // Convert shifts HTML (from AI or fallback) to email-safe inline styles
  function convertShiftsToEmail(html: string): string {
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    function convertNode(node: ChildNode, mc: string): string {
      if (node.nodeType === 3) return (node as Text).textContent || ''
      if (node.nodeType !== 1) return ''
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      const cls = el.className || ''
      const curMC = cls.includes('mc-box') ? (cls.includes('m3') ? 'm3' : 'm4') : mc
      const kids = () => Array.from(el.childNodes).map(c => convertNode(c, curMC)).join('')
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
    return Array.from(tmp.childNodes).map(n => convertNode(n, '')).join('')
  }

  const emailShifts = convertShiftsToEmail(shiftsHtml)
  const sectionNum = hasKontekst ? '3' : '2'

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:${K.navy};margin:0;padding:0;background:#ffffff">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:0">
  <tr><td style="background:${K.blue};padding:14px 20px">
    <p style="margin:0;font-size:15px;font-weight:bold;color:#ffffff;font-family:Arial,sans-serif">Wydzia\u0142 Monta\u017cu Automatycznego</p>
    <p style="margin:3px 0 0;font-size:12px;color:#E8F0FA;font-family:Arial,sans-serif">Raport produkcyjny &bull; ${dateFormatted} r.</p>
  </td></tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px 0 24px 0">
    <p style="font-size:14px;line-height:1.8;margin:0 0 20px;color:${K.navy};font-family:Arial,sans-serif">
      Szanowni Pa&nacute;stwo,<br>
      W za&lstrok;&aogon;czeniu przekazuj&eogon; raport z wynik&oacute;w produkcyjnych oraz zestawienie kluczowych zdarze&nacute; na Wydziale Monta&zdot;u Automatycznego z dnia <strong style="color:${K.navy};font-family:Arial,sans-serif">${dateFormatted} r.</strong>
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px"><tr><td style="border-bottom:2px solid ${K.blue};padding-bottom:6px">
      <span style="font-size:14px;font-weight:bold;color:${K.blue};font-family:Arial,sans-serif">1. Wyniki produkcyjne</span>
    </td></tr></table>
    ${prodTable}
    ${kontekstHtml}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 12px 0"><tr><td style="border-bottom:2px solid ${K.blue};padding-bottom:6px">
      <span style="font-size:14px;font-weight:bold;color:${K.blue};font-family:Arial,sans-serif">${sectionNum}. Kluczowe zdarzenia</span>
    </td></tr></table>
    ${emailShifts}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px"><tr><td style="border-top:1px solid ${K.gray2};padding-top:12px">
      <p style="margin:0;font-size:13px;color:${K.gray3};font-family:Arial,sans-serif">W przypadku dodatkowych pyta&nacute; lub w&aogon;tpliwo&sacute;ci pozostaj&eogon; do dyspozycji.</p>
    </td></tr></table>
  </td></tr></table>
</td></tr></table>
</body></html>`
}

// ─── AI Prompt Builder ───────────────────────────────────────────────────────

function buildAiPrompt(
  eventsByShift: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]>,
  shiftTotals: Record<ShiftType, ShiftSummary>,
  machineNames: string[]
): string {
  const machineList = machineNames.map((n, i) => {
    const cls = i % 2 === 0 ? 'm3' : 'm4'
    return `${n} (klasa CSS: ${cls})`
  }).join(', ')

  const notesBlock = SHIFTS.map(shift => {
    const events = eventsByShift[shift]
    const machineNotes: Record<string, string[]> = {}
    events.forEach(e => {
      if (!machineNotes[e.machine]) machineNotes[e.machine] = []
      machineNotes[e.machine].push(`[${e.hour}] ${e.text} (operator: ${e.operator})`)
    })
    const parts = machineNames.map(name => {
      const notes = machineNotes[name] || []
      return `${name}:\n${notes.length ? notes.join('\n') : '(brak zdarzen)'}`
    }).join('\n\n')
    const st = shiftTotals[shift]
    return `ZMIANA ${shift} (produkcja lacznie: ${pieces(st.good)} szt., odrzut: ${pieces(st.reject)} szt., czas pracy: ${mins(st.runtime)}):\n${parts}`
  }).join('\n\n---\n\n')

  return `Przepisujesz surowe notatki operatorów na profesjonalny raport zmianowy. Nie dodajesz nic od siebie — tylko poprawiasz ortografię, interpunkcję i układasz w strukturę. Każdy fakt z notatki musi znaleźć się w raporcie. Nic nie pomijasz, nic nie dodajesz.

MASZYNY W HALI: ${machineList}

ZASADY:
- Jeden fakt = jedno zdanie lub jeden punkt listy
- Popraw tylko ortografię i interpunkcję — treść zostaje
- Słownictwo: stacja (st.10), transfer, zacięcie, automat
- Jeśli coś się powtarza → jeden punkt z dopiskiem "(powtarzające się)"
- Produkcja zmiana >= 18000 szt. per automat → "Produkcja przebiegała prawidłowo."

STRUKTURA każdego automatu:
1. Jedno zdanie otwierające — prawidłowa / zakłócona / awaryjna
2. Opóźniony start → "Start automatu o godz. HH:MM — [przyczyna]."
3. "W trakcie zmiany odnotowano:" → lista faktów
4. "Podjęte działania:" → lista działań
5. "Postoje:" → jeśli godzina i przyczyna w notatkach
6. Jedno zdanie zamykające
7. Czasy jeśli podane

ZWRÓĆ TYLKO HTML od pierwszego <div class="shift-bar ..."> — zero tekstu przed ani po.

Format HTML (dla każdej zmiany i każdej maszyny):
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
    <p class="times">Czas pracy: <strong>X h XX min</strong> | Czas w gotowości: <strong>XX min</strong> | Czas w alarmie: <strong>X h XX min</strong></p>
  </div>
</div>
[kolejne maszyny z odpowiednią klasą m3/m4/m5...]
<div class="shift-bar s2">Zmiana II</div>
[analogicznie]
<div class="shift-bar s3">Zmiana III</div>
[analogicznie]

Brak notatek dla maszyny: <em style="color:#6B7280">Brak zdarzeń do odnotowania.</em>
Pomiń sub-h jeśli brak danych. Times tylko jeśli w notatce.

===== DANE DO PRZETWORZENIA =====
${notesBlock}`
}

// ─── Fallback HTML (bez AI) ──────────────────────────────────────────────────

function buildFallbackShiftsHtml(
  eventsByShift: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]>,
  machineNames: string[]
): string {
  const shiftCfg = [
    { shift: 'I' as ShiftType, cls: 's1', label: 'Zmiana I' },
    { shift: 'II' as ShiftType, cls: 's2', label: 'Zmiana II' },
    { shift: 'III' as ShiftType, cls: 's3', label: 'Zmiana III' },
  ]
  return shiftCfg.map(({ shift, cls, label }) => {
    const events = eventsByShift[shift]
    const machineCards = machineNames.map((name, idx) => {
      const mcCls = idx % 2 === 0 ? 'm3' : 'm4'
      const machineEvents = events.filter(e => e.machine === name)
      const body = machineEvents.length
        ? machineEvents.map(e => `<p><strong>${e.hour}</strong> — ${e.text}</p>`).join('')
        : '<em style="color:#6B7280">Brak zdarzeń do odnotowania.</em>'
      return `<div class="mc-box ${mcCls}"><div class="mc-name">${name}</div><div class="mc-body">${body}</div></div>`
    }).join('')
    return `<div class="shift-bar ${cls}">${label}</div>${machineCards}`
  }).join('')
}

// ─── Email Modal ─────────────────────────────────────────────────────────────

interface EmailModalProps {
  date: string
  rows: MachineDayRow[]
  totals: ShiftSummary
  shiftTotals: Record<ShiftType, ShiftSummary>
  eventsByShift: Record<ShiftType, { machine: string; hour: string; text: string; operator: string }[]>
  onClose: () => void
}

function EmailModal({ date, rows, totals, shiftTotals, eventsByShift, onClose }: EmailModalProps) {
  const [step, setStep] = useState<'form' | 'preview'>('form')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('margoline_api_key') || '')
  const [useAi, setUseAi] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [emailHtml, setEmailHtml] = useState('')
  const [copied, setCopied] = useState(false)
  const [kontekst, setKontekst] = useState<Kontekst>({ material: '', settings: '', infra: '', other: '' })

  const machineNames = rows.map(r => r.machineName)

  function setK(field: keyof Kontekst, val: string) {
    setKontekst(prev => ({ ...prev, [field]: val }))
  }

  async function generate() {
    setError('')
    setLoading(true)
    try {
      let shiftsHtml = ''
      if (useAi) {
        if (!apiKey.trim()) { setError('Wpisz klucz API Anthropic.'); setLoading(false); return }
        localStorage.setItem('margoline_api_key', apiKey.trim())
        const prompt = buildAiPrompt(eventsByShift, shiftTotals, machineNames)
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey.trim(),
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
        let full = data.content.map(c => c.text || '').join('').trim()
        // Usuń markdown backticks jeśli AI je doda
        while (full.startsWith('```')) { full = full.slice(full.indexOf('\n') + 1).trim() }
        while (full.endsWith('```')) { full = full.slice(0, full.lastIndexOf('\n')).trim() }
        shiftsHtml = full
      } else {
        shiftsHtml = buildFallbackShiftsHtml(eventsByShift, machineNames)
      }
      const html = buildEmailHtml({ date, rows, totals, shiftTotals, shiftsHtml, kontekst })
      setEmailHtml(html)
      setStep('preview')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd')
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard() {
    const blob = new Blob([emailHtml], { type: 'text/html' })
    if (window.ClipboardItem && navigator.clipboard?.write) {
      navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 3000)
      }).catch(fallbackCopy)
    } else { fallbackCopy() }
    function fallbackCopy() {
      const el = document.createElement('div')
      el.contentEditable = 'true'
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      el.innerHTML = emailHtml
      document.body.appendChild(el)
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel?.removeAllRanges()
      sel?.addRange(range)
      document.execCommand('copy')
      sel?.removeAllRanges()
      document.body.removeChild(el)
      setCopied(true); setTimeout(() => setCopied(false), 3000)
    }
  }

  function openPreviewWindow() {
    const w = window.open('', '_blank', 'width=900,height=700,scrollbars=yes')
    if (w) { w.document.write(emailHtml); w.document.close() }
  }

  const dateFormatted = new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const hasNotes = SHIFTS.some(s => eventsByShift[s].length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
      <div className="relative w-full max-w-2xl my-8 bg-navy-800 border border-navy-600 rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-700">
          <div>
            <h2 className="text-white font-bold text-base flex items-center gap-2">
              <span className="text-lg">✉️</span>
              {step === 'form' ? 'Generuj raport email' : 'Podgląd raportu'}
            </h2>
            <p className="text-navy-400 text-xs mt-0.5">{dateFormatted}</p>
          </div>
          <button onClick={onClose} className="text-navy-400 hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>

        {/* KROK 1: FORMULARZ */}
        {step === 'form' && (
          <div className="p-6 space-y-5">

            {/* Tryb */}
            <div className="flex gap-2">
              <button
                onClick={() => setUseAi(true)}
                className={cn('flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all', useAi
                  ? 'bg-brand text-white border-brand shadow-md shadow-brand/20'
                  : 'bg-navy-700 text-navy-300 border-navy-600 hover:bg-navy-600'
                )}
              >✨ Z pomocą AI</button>
              <button
                onClick={() => setUseAi(false)}
                className={cn('flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all', !useAi
                  ? 'bg-navy-600 text-white border-navy-500'
                  : 'bg-navy-700 text-navy-300 border-navy-600 hover:bg-navy-600'
                )}
              >Standardowy</button>
            </div>

            {/* API Key */}
            {useAi && (
              <div>
                <label className="label">Klucz API Anthropic</label>
                <input
                  type="password"
                  className="input font-mono text-xs"
                  placeholder="sk-ant-api03-..."
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                />
                <p className="text-navy-500 text-xs mt-1.5">
                  Klucz jest zapisywany lokalnie w przeglądarce. Pobierz go z{' '}
                  <a href="https://console.anthropic.com" target="_blank" rel="noopener" className="text-brand hover:underline">console.anthropic.com</a>.
                </p>
              </div>
            )}

            {/* Podsumowanie danych */}
            <div className="rounded-xl bg-navy-900 border border-navy-700 p-4">
              <div className="text-xs font-bold text-navy-400 uppercase tracking-wider mb-3">Dane z bazy</div>
              <div className="grid grid-cols-3 gap-3">
                {SHIFTS.map(s => (
                  <div key={s} className="text-center">
                    <div className="text-xs text-navy-500 mb-1">Zmiana {s}</div>
                    <div className="font-mono font-bold text-white text-sm">{pieces(shiftTotals[s].good)} szt.</div>
                    <div className="text-xs text-navy-500">{eventsByShift[s].length} zdarzeń</div>
                  </div>
                ))}
              </div>
              {!hasNotes && (
                <p className="text-amber-400 text-xs mt-3 text-center">
                  ⚠️ Brak notatek w żadnej zmianie — raport będzie zawierał tylko dane liczbowe.
                </p>
              )}
            </div>

            {/* Kontekst dnia */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">🔍 Kontekst dnia</div>
                <span className="text-xs text-navy-500">— opcjonalnie, wstawiany po wynikach</span>
              </div>
              <div className="space-y-3">
                {[
                  { field: 'material' as const, label: 'Zmiana materiału / surowca / partii', placeholder: 'np. Zmiana partii filtrów — nowa partia wykazuje inne parametry...' },
                  { field: 'settings' as const, label: 'Zmiana ustawień / parametrów / narzędzi', placeholder: 'np. Regulacja siłowników na st.51 na wszystkich zmianach...' },
                  { field: 'infra' as const, label: 'Problemy infrastrukturalne / zewnętrzne', placeholder: 'np. Problemy z ciśnieniem sprężonego powietrza...' },
                  { field: 'other' as const, label: 'Inne uwagi ogólne', placeholder: 'Zmiany organizacyjne, braki kadrowe, szkolenia...' },
                ].map(({ field, label, placeholder }) => (
                  <div key={field}>
                    <label className="text-xs text-navy-400 block mb-1">{label}</label>
                    <textarea
                      rows={2}
                      className="input resize-none text-xs py-2"
                      placeholder={placeholder}
                      value={kontekst[field]}
                      onChange={e => setK(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Błąd */}
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* Przycisk generuj */}
            <button
              onClick={generate}
              disabled={loading}
              className="btn-primary w-full py-3 text-sm font-bold disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  {useAi ? 'AI redaguje notatki...' : 'Generuję raport...'}
                </span>
              ) : (
                useAi ? '✨ Wygeneruj raport z AI' : 'Wygeneruj raport standardowy'
              )}
            </button>
          </div>
        )}

        {/* KROK 2: PODGLĄD */}
        {step === 'preview' && (
          <div className="p-6 space-y-4">
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300 flex items-center gap-2">
              <span>✓</span>
              <span>Raport wygenerowany — gotowy do wysłania w Outlooku.</span>
            </div>

            {/* Preview iframe */}
            <div className="rounded-xl border border-navy-600 overflow-hidden bg-white" style={{ height: 320 }}>
              <iframe
                srcDoc={emailHtml}
                title="Podgląd emaila"
                className="w-full h-full"
                sandbox="allow-same-origin"
              />
            </div>

            {/* Przyciski */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setStep('form')}
                className="btn-secondary py-2.5 text-sm"
              >← Wróć i edytuj</button>
              <button
                onClick={copyToClipboard}
                className={cn('py-2.5 text-sm font-bold rounded-xl border transition-all', copied
                  ? 'bg-green-500/20 text-green-400 border-green-500/30'
                  : 'bg-brand text-white border-brand hover:bg-brand-dark'
                )}
              >
                {copied ? '✓ Skopiowano!' : '📋 Kopiuj do schowka (Outlook)'}
              </button>
            </div>
            <button
              onClick={openPreviewWindow}
              className="btn-secondary w-full py-2.5 text-sm"
            >🔍 Otwórz podgląd w nowym oknie</button>

            <p className="text-navy-500 text-xs text-center">
              Skopiuj treść i wklej bezpośrednio do nowej wiadomości w Outlooku (Ctrl+V).
              Formatowanie i kolory zostaną zachowane.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManagerDayReport() {
  const [date, setDate] = useState(todayIso)
  const [machines, setMachines] = useState<Machine[]>([])
  const [reports, setReports] = useState<ReportWithContext[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showEmailModal, setShowEmailModal] = useState(false)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++loadSeq.current
    setLoading(true); setError('')
    const [mRes, rRes] = await Promise.all([
      supabase.from('machines').select('*').eq('is_active', true).order('code'),
      supabase.from('hourly_reports')
        .select('*, operator:profiles!operator_id(full_name), shift:shifts!shift_id(shift_type, shift_date)')
        .eq('report_date', date)
        .is('deleted_at', null)
        .order('machine_id')
        .order('hour_start')
    ])
    if (requestId !== loadSeq.current) return
    if (mRes.error || rRes.error) {
      setError(mRes.error?.message || rRes.error?.message || 'Nie udało się załadować raportu dnia.')
    } else {
      setMachines((mRes.data ?? []) as Machine[])
      setReports((rRes.data ?? []) as ReportWithContext[])
    }
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const channel = supabase.channel(`manager-day-report-${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_reports' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .subscribe()
    const onFocus = () => load()
    const onVisibility = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
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
        s.good += report.good_count
        s.reject += report.reject_count
        s.reports += 1
        s.runtime += report.runtime_min
        s.ready += report.ready_min ?? 0
        s.alarm += report.alarm_min ?? 0
        s.downtime += reportDowntimeMinutes(report)
      })
      const note = noteText(report)
      if (note) {
        const entry = `${report.hour_block}: ${note}`
        shift.notes.push(entry)
        row.total.notes.push(`Zmiana ${shiftType}, ${entry}`)
      }
    })
    return Array.from(byMachine.values()).sort((a, b) => a.machineName.localeCompare(b.machineName))
  }, [machineNameById, machines, reports])

  const totals = useMemo(() => reports.reduce((acc, r) => {
    acc.good += r.good_count; acc.reject += r.reject_count; acc.reports += 1
    acc.runtime += r.runtime_min; acc.ready += r.ready_min ?? 0
    acc.alarm += r.alarm_min ?? 0; acc.downtime += reportDowntimeMinutes(r)
    return acc
  }, emptySummary()), [reports])

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
        hour: report.hour_block,
        text,
        operator: one(report.operator)?.full_name ?? '-'
      })
    })
    return result
  }, [machineNameById, reports])

  return (
    <>
      {showEmailModal && (
        <EmailModal
          date={date}
          rows={rows}
          totals={totals}
          shiftTotals={shiftTotals}
          eventsByShift={eventsByShift}
          onClose={() => setShowEmailModal(false)}
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
            <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, -1))}>Poprzedni dzień</button>
            <input className="input w-[170px]" type="date" value={date} onChange={e => setDate(e.target.value)} />
            <button className="btn-secondary text-xs py-2 px-3" onClick={() => setDate(addDays(date, 1))}>Następny dzień</button>
            <button className="btn-secondary text-xs py-2 px-3" onClick={load}>{loading ? 'Odświeżam...' : 'Odśwież'}</button>
            <button
              className="btn-primary text-xs py-2 px-3 flex items-center gap-1.5"
              onClick={() => setShowEmailModal(true)}
              disabled={loading || reports.length === 0}
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

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Produkcja łącznie', value: `${pieces(totals.good)} szt`, color: 'text-brand' },
            { label: 'Odrzut łącznie', value: `${pieces(totals.reject)} szt`, color: totals.reject ? 'text-red-400' : 'text-green-400' },
            { label: 'Wpisy', value: `${totals.reports}`, color: 'text-white' },
            { label: 'Czas pracy', value: mins(totals.runtime), color: 'text-green-400' },
            { label: 'Alarm + postój', value: mins(totals.alarm + totals.downtime), color: totals.alarm + totals.downtime ? 'text-amber-400' : 'text-green-400' }
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
              <div className="kpi-label">Czasy - zmiana {shift}</div>
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
                              odrzut <span className="font-mono text-red-300">{pieces(row.shifts[s].reject)}</span>
                              {' '}| wpisy {row.shifts[s].reports}
                            </div>
                            <div className="mt-2 rounded-lg bg-navy-900 px-2 py-1.5 text-xs leading-relaxed text-navy-300">
                              <span className="font-mono text-green-300">praca {mins(row.shifts[s].runtime)}</span>
                              <br />
                              got. {mins(row.shifts[s].ready)} | alarm/postój {mins(row.shifts[s].alarm + row.shifts[s].downtime)}
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
              <div className="card-sub">Wszystkie wpisy godzinowe bez ucinania uwag</div>
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
