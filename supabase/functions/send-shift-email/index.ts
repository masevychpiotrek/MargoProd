import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Widok kierownika/mistrza - generacja+wysylka maila zmianowego. Wywolywana albo
// recznie (JWT + rola manager/admin), albo przez pg_cron (naglowek x-cron-secret) -
// patrz plan: swirling-dreaming-avalanche. Deployowana BEZ --verify-jwt (tak jak
// receive-shift-email-reply), zeby cron mogl ja wywolac bez sesji uzytkownika -
// autoryzacja jest wiec w calosci wewnatrz funkcji, nie na bramce Supabase.
const ALLOWED_ROLES = new Set(['manager', 'admin'])
const RATE_LIMIT_PER_MINUTE = 1

const SHIFT_TYPES = ['I', 'II', 'III'] as const
type ShiftType = typeof SHIFT_TYPES[number]

// Musi byc zgodne z src/lib/utils.ts SHIFT_WINDOWS - Deno nie importuje z src/,
// wiec ta sama definicja jest tu celowo zduplikowana.
const SHIFT_WINDOWS: Record<ShiftType, { startHour: number; endHour: number }> = {
  I: { startHour: 6, endHour: 14 },
  II: { startHour: 14, endHour: 22 },
  III: { startHour: 22, endHour: 6 }
}

// Godziny (czas lokalny Europe/Warsaw) w ktorych cron ma faktycznie wyslac mail -
// 1h przed koncem kazdej zmiany. Cron odpala sie co godzine (patrz migracja 058) -
// ta funkcja sama decyduje, czy to "ta" godzina, zeby bylo odpornie na czas
// letni/zimowy bez zmiany wyrazenia cron.
const SEND_HOURS: Record<number, ShiftType> = { 13: 'I', 21: 'II', 5: 'III' }
const SEND_TOLERANCE_MIN = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration')

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const cronSecret = (Deno.env.get('CRON_SHARED_SECRET') ?? '').replace(/[^\x21-\x7E]/g, '')
    const isCronCall = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret

    const body = await req.json().catch(() => ({}))
    let shiftDate: string
    let shiftType: ShiftType
    let manual = false
    let callerId: string | null = null

    if (isCronCall) {
      // Wywolanie systemowe - liczymy aktualne okno Europe/Warsaw. Poza oknem
      // tolerancji 13:00/21:00/05:00 -> no-op (cron odpala sie co godzine).
      const now = new Date()
      const warsawParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(now)
      const get = (t: string) => warsawParts.find(p => p.type === t)?.value ?? ''
      const hour = Number(get('hour'))
      const minute = Number(get('minute'))
      const targetType = SEND_HOURS[hour]

      if (!targetType || minute > SEND_TOLERANCE_MIN) {
        return json({ skipped: true, reason: 'poza oknem wysylki', hour, minute })
      }

      shiftType = targetType
      // Zmiana III zaczyna sie dzien wczesniej (22:00) i konczy 06:00 nastepnego
      // dnia - o 05:00 lokalnie nalezy do shift_date=wczoraj.
      const warsawDate = `${get('year')}-${get('month')}-${get('day')}`
      shiftDate = shiftType === 'III' ? addDays(warsawDate, -1) : warsawDate

      // Idempotencja: jesli w tym oknie juz wyslano mail (np. cron odpalil sie
      // dwa razy w tej samej minucie tolerancji), nie wysylaj drugi raz.
      const { count } = await admin.from('shift_email_threads').select('id', { count: 'exact', head: true })
        .eq('shift_date', shiftDate).eq('shift_type', shiftType)
      if ((count ?? 0) > 0) {
        return json({ skipped: true, reason: 'juz wyslano dla tego okna' })
      }
    } else {
      // Wywolanie z UI - wymagana sesja managera/admina.
      const authHeader = req.headers.get('Authorization') ?? ''
      const token = authHeader.replace('Bearer ', '').trim()
      if (!token) return json({ error: 'Brak sesji kierownika.' })

      const { data: callerData, error: callerError } = await admin.auth.getUser(token)
      if (callerError || !callerData.user) return json({ error: 'Nie udalo sie potwierdzic sesji.' })
      callerId = callerData.user.id

      const { data: callerProfile } = await admin.from('profiles').select('role, is_active, deleted_at').eq('id', callerId).maybeSingle()
      if (!callerProfile || !ALLOWED_ROLES.has(callerProfile.role) || !callerProfile.is_active || callerProfile.deleted_at) {
        return json({ error: 'Brak uprawnien do wysylki maila zmianowego.' })
      }

      if (!body.shiftDate || !SHIFT_TYPES.includes(body.shiftType)) {
        return json({ error: 'Brak shiftDate/shiftType.' })
      }
      shiftDate = String(body.shiftDate)
      shiftType = body.shiftType as ShiftType
      manual = true
    }

    const preview = body.preview === true

    // Rate-limit reczna wysylke: 1/min per (shiftDate, shiftType).
    if (manual && !preview) {
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
      const { count } = await admin.from('shift_email_threads').select('id', { count: 'exact', head: true })
        .eq('shift_date', shiftDate).eq('shift_type', shiftType).gte('sent_at', oneMinuteAgo)
      if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
        return json({ error: 'Mail dla tej zmiany zostal juz wyslany w ciagu ostatniej minuty.' })
      }
    }

    // ─── Zbieranie odchylen ────────────────────────────────────────────────
    const { data: shifts } = await admin.from('shifts')
      .select('id, machine_id, machine:machines(name)')
      .eq('shift_date', shiftDate).eq('shift_type', shiftType)
    const shiftIds = (shifts ?? []).map((s: { id: string }) => s.id)

    type MachineJoin = { name: string } | { name: string }[] | null
    const machineNameByShiftId = new Map<string, string>()
    ;(shifts ?? []).forEach((s: { id: string; machine: MachineJoin }) => {
      const m = Array.isArray(s.machine) ? s.machine[0] : s.machine
      machineNameByShiftId.set(s.id, m?.name ?? 'Automat')
    })

    let deviations: {
      id: string; shift_id: string; hour_start: number; hour_block: string
      downtime_reason: string | null; reject_reason: string | null
    }[] = []
    if (shiftIds.length) {
      const { data } = await admin.from('hourly_reports')
        .select('id, shift_id, hour_start, hour_block, downtime_reason, reject_reason')
        .in('shift_id', shiftIds)
        .is('deleted_at', null)
        .order('hour_start')
      deviations = (data ?? []).filter(r => (r.downtime_reason?.trim()) || (r.reject_reason?.trim()))
    }

    // Grupowanie per automat, scalanie KOLEJNYCH godzin z IDENTYCZNYM tekstem
    // przyczyny w jeden wiersz z zakresem godzin - dopasowanie dokladne, nie
    // rozmyte (prostsze, deterministyczne - patrz plan).
    const byShift = new Map<string, typeof deviations>()
    deviations.forEach(d => {
      const arr = byShift.get(d.shift_id) ?? []
      arr.push(d)
      byShift.set(d.shift_id, arr)
    })

    type NumberedItem = {
      number: number; machine_id: string; machine_name: string
      hourly_report_ids: string[]; hour_range: string; summary_text: string
    }
    const numberedItems: NumberedItem[] = []
    let counter = 1

    // Sortuj automaty alfabetycznie dla stabilnej kolejnosci w mailu.
    const sortedShiftIds = [...byShift.keys()].sort((a, b) =>
      (machineNameByShiftId.get(a) ?? '').localeCompare(machineNameByShiftId.get(b) ?? '', 'pl')
    )

    sortedShiftIds.forEach(shiftId => {
      const machineId = (shifts ?? []).find((s: { id: string }) => s.id === shiftId)?.machine_id ?? ''
      const machineName = machineNameByShiftId.get(shiftId) ?? 'Automat'
      const rows = (byShift.get(shiftId) ?? []).sort((a, b) => a.hour_start - b.hour_start)

      let group: typeof rows = []
      const flush = () => {
        if (!group.length) return
        const text = reasonText(group[0])
        numberedItems.push({
          number: counter++,
          machine_id: machineId,
          machine_name: machineName,
          hourly_report_ids: group.map(r => r.id),
          hour_range: hourRange(group[0].hour_start, group[group.length - 1].hour_start),
          summary_text: text
        })
        group = []
      }

      rows.forEach((row, i) => {
        const prev = rows[i - 1]
        const sameReason = prev && reasonText(prev) === reasonText(row) && row.hour_start === prev.hour_start + 1
        if (!sameReason) flush()
        group.push(row)
      })
      flush()
    })

    // ─── Podglad ────────────────────────────────────────────────────────────
    const html = renderShiftEmailHtml(shiftDate, shiftType, numberedItems)
    if (preview) return json({ html })

    if (numberedItems.length === 0) {
      return json({ error: 'Brak odchylen do wyslania dla tej zmiany.' })
    }

    // ─── Odbiorcy ───────────────────────────────────────────────────────────
    const { data: recipientRows } = await admin.from('shift_notification_recipients')
      .select('email').eq('is_active', true)
    const recipients = (recipientRows ?? []).map(r => r.email as string)
    if (recipients.length === 0) {
      return json({ error: 'Brak aktywnych odbiorcow - dodaj adresy w ustawieniach maila zmianowego.' })
    }

    // ─── Wysylka Postmark ───────────────────────────────────────────────────
    const postmarkToken = (Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '').replace(/[^\x21-\x7E]/g, '')
    const fromAddress = Deno.env.get('POSTMARK_FROM_ADDRESS') ?? 'zmiana@margoline.app'
    const replyToAddress = Deno.env.get('POSTMARK_INBOUND_ADDRESS') ?? fromAddress
    if (!postmarkToken) return json({ error: 'AI/mail niedostepny: brak konfiguracji Postmark.' })

    const subject = `Zmiana ${shiftType} - ${formatDatePl(shiftDate)} - odchylenia do reakcji`
    const pmResponse = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Postmark-Server-Token': postmarkToken
      },
      body: JSON.stringify({
        From: fromAddress,
        To: recipients.join(','),
        ReplyTo: replyToAddress,
        Subject: subject,
        HtmlBody: html,
        MessageStream: 'outbound',
        Headers: [{ Name: 'X-Shift-Thread-Id', Value: `shift-${shiftDate}-${shiftType}` }]
      })
    })

    const pmData = await pmResponse.json().catch(() => ({}))
    // UWAGA: Postmark potrafi zwrocic HTTP 200 razem z ErrorCode != 0 w tresci
    // (np. konto zawieszone do zatwierdzenia, niepotwierdzony nadawca) - samo
    // sprawdzenie pmResponse.ok NIE wystarcza (ta sama pulapka co przy
    // translate-shift-summaries wczesniej w tej sesji: blad chowajacy sie w
    // body 200 OK). Trzeba jawnie sprawdzic ErrorCode.
    if (!pmResponse.ok || (typeof pmData?.ErrorCode === 'number' && pmData.ErrorCode !== 0)) {
      return json({ error: `Wysylka nie powiodla sie: ${pmData?.Message ?? pmResponse.status}` })
    }

    // Message-ID uzywany do dopasowania odpowiedzi to TEN, ktory faktycznie
    // nadal Postmark (nie da sie niezawodnie wymusic wlasnego RFC822
    // Message-ID przez API wysylkowe) - dzieki temu In-Reply-To z odpowiedzi
    // technika zawsze bedzie pasowac.
    const messageId: string = pmData.MessageID ? `<${pmData.MessageID}>` : `<shift-${shiftDate}-${shiftType}-${Date.now()}@margoline.app>`

    await admin.from('shift_email_threads').insert({
      shift_date: shiftDate,
      shift_type: shiftType,
      message_id: messageId,
      sent_manually: manual,
      sent_by: callerId,
      recipients,
      numbered_items: numberedItems
    })

    return json({ sent: true, recipients: recipients.length, items: numberedItems.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie wyslac maila zmianowego.'
    return json({ error: message })
  }
})

function reasonText(row: { downtime_reason: string | null; reject_reason: string | null }): string {
  return [row.downtime_reason?.trim(), row.reject_reason?.trim()].filter(Boolean).join(' | ')
}

function hourRange(startHour: number, endHour: number): string {
  const fmt = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
  return startHour === endHour ? `${fmt(startHour)}-${fmt(startHour + 1)}` : `${fmt(startHour)}-${fmt(endHour + 1)}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDatePl(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Branding navy/gold spojny z istniejacym mailem "Generuj email" w
// src/pages/manager/DayReport.tsx (naglowek #1E3A5F + odznaka "ML" #C9A84C).
function renderShiftEmailHtml(shiftDate: string, shiftType: ShiftType, items: {
  number: number; machine_name: string; hour_range: string; summary_text: string
}[]): string {
  const F = 'font-family:Arial,Helvetica,sans-serif'
  const NAVY = '#142238'
  const dateLong = new Date(`${shiftDate}T12:00:00`).toLocaleDateString('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const byMachine = new Map<string, typeof items>()
  items.forEach(it => {
    const arr = byMachine.get(it.machine_name) ?? []
    arr.push(it)
    byMachine.set(it.machine_name, arr)
  })

  const machineBlocks = [...byMachine.entries()].map(([machine, rows]) => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
      <tr><td style="padding:8px 12px;background:${NAVY};color:#C9A84C;font-weight:bold;font-size:12px;letter-spacing:.4px;${F}">${escapeHtml(machine)}</td></tr>
      ${rows.map(r => `
      <tr><td style="padding:10px 14px;border:1px solid #E2E8F0;border-top:none;${F}">
        <span style="display:inline-block;min-width:22px;font-weight:bold;color:${NAVY};${F}">${r.number}.</span>
        <span style="color:#64748B;font-size:11px;${F}">${escapeHtml(r.hour_range)}</span><br>
        <span style="color:${NAVY};font-size:13px;${F}">${escapeHtml(r.summary_text)}</span>
      </td></tr>`).join('')}
    </table>`).join('')

  return `<!DOCTYPE html><html><body style="${F};color:${NAVY};margin:0;padding:0;background:#ffffff">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto">
  <tr><td style="background:#1E3A5F;padding:0">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:18px 28px;vertical-align:middle">
        <p style="margin:0;font-size:10px;font-weight:bold;color:#93C5FD;text-transform:uppercase;letter-spacing:1.2px;${F}">Margomed S.A.</p>
        <p style="margin:4px 0 0;font-size:17px;font-weight:bold;color:#fff;${F}">Mail zmianowy dla technik&oacute;w</p>
        <p style="margin:4px 0 0;font-size:12px;color:#BAD4F5;${F}">Zmiana ${shiftType} &bull; ${dateLong}</p>
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
  <tr><td style="padding:24px 28px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px"><tr>
      <td style="padding:12px 16px;background:#FFFBEB;border:1px solid #FDE68A;border-left:4px solid #D97706;${F};font-size:13px;color:${NAVY};line-height:1.7">
        Odpowiedz w tym w&#261;tku, podaj&#261;c <strong>numer i podj&#281;te dzia&#322;anie</strong> dla ka&#380;dej pozycji, na kt&oacute;r&#261; reagujesz (np. <em>"2: wymieniono czujnik na stacji 12"</em>). Masz na to oko&#322;o godziny.
      </td>
    </tr></table>
    ${items.length ? machineBlocks : '<p style="' + F + ';font-size:13px;color:#64748B">Brak odchylen w tej zmianie.</p>'}
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
