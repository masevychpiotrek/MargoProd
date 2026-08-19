import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Webhook Postmark Inbound - odbiera odpowiedzi technikow na mail zmianowy i
// parsuje "numer: dzialanie" per linia. MUSI byc wdrozona z --no-verify-jwt
// (Postmark nie wysyla sesji Supabase) - bezpieczenstwo przez Basic Auth
// skonfigurowane w adresie webhooka w panelu Postmark (user:pass@host/...),
// sprawdzane tutaj recznie. Patrz plan: swirling-dreaming-avalanche.
const SHIFT_TYPES = ['I', 'II', 'III'] as const
type ShiftType = typeof SHIFT_TYPES[number]

type NumberedItem = {
  number: number; machine_id: string; machine_name: string
  hourly_report_ids: string[]; hour_range: string; summary_text: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration')

    const expectedUser = Deno.env.get('POSTMARK_INBOUND_USER') ?? ''
    const expectedPass = Deno.env.get('POSTMARK_INBOUND_PASS') ?? ''
    if (expectedUser && expectedPass) {
      const auth = req.headers.get('Authorization') ?? ''
      const [scheme, encoded] = auth.split(' ')
      const decoded = scheme === 'Basic' && encoded ? atob(encoded) : ''
      if (decoded !== `${expectedUser}:${expectedPass}`) {
        return json({ error: 'unauthorized' }, 401)
      }
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const payload = await req.json().catch(() => null)
    if (!payload) return json({ ok: true }) // nic do sparsowania - zwroc 200, nie retry'uj

    const headers: { Name: string; Value: string }[] = payload.Headers ?? []
    const headerValue = (name: string) => headers.find(h => h.Name.toLowerCase() === name.toLowerCase())?.Value ?? ''
    const inReplyTo = headerValue('In-Reply-To')
    const references = headerValue('References')
    const subject: string = payload.Subject ?? ''
    const fromEmail: string = (payload.FromFull?.Email ?? payload.From ?? '').toLowerCase().trim()
    const strippedReply: string = (payload.StrippedTextReply ?? payload.TextBody ?? '').trim()
    const receivedAt = payload.Date ? new Date(payload.Date) : new Date()

    if (!fromEmail || !strippedReply) return json({ ok: true, skipped: 'brak nadawcy/tresci' })

    // ─── Dopasowanie watku ──────────────────────────────────────────────────
    const candidateIds = [inReplyTo, ...references.split(/\s+/)].map(s => s.trim()).filter(Boolean)
    let thread: { id: string; sent_at: string; shift_date: string; shift_type: ShiftType; numbered_items: NumberedItem[] } | null = null
    let matchedVia: 'reply' | 'subject_fallback' = 'reply'

    // Petla .eq() zamiast jednego .in(candidateIds) - candidateIds ma co najwyzej
    // 2-3 elementy (In-Reply-To + References), wiec koszt pomijalny, a unika sie
    // jakichkolwiek niejasnosci wokol kodowania '<'/'>'/'@' w skladni listy in.().
    for (const candidate of [...new Set(candidateIds)]) {
      const { data } = await admin.from('shift_email_threads')
        .select('id, sent_at, shift_date, shift_type, numbered_items')
        .eq('message_id', candidate)
        .maybeSingle()
      if (data) { thread = data as typeof thread; break }
    }

    if (!thread) {
      // Forward / brak naglowkow - dopasuj po temacie ("Zmiana {typ} - {data}")
      // wsrod watkow wyslanych w ostatnich 4h, plus okno czasu odbioru.
      matchedVia = 'subject_fallback'
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      const { data: recentThreads } = await admin.from('shift_email_threads')
        .select('id, sent_at, shift_date, shift_type, numbered_items')
        .gte('sent_at', fourHoursAgo)
        .order('sent_at', { ascending: false })

      const strippedSubject = subject.replace(/^\s*(re|fwd?|odp)\s*:\s*/i, '').trim()
      thread = (recentThreads ?? []).find(t => {
        const expectedSubjectFragment = `Zmiana ${t.shift_type} - ${formatDatePl(t.shift_date)}`
        return strippedSubject.includes(expectedSubjectFragment)
          && receivedAt.getTime() >= new Date(t.sent_at).getTime()
          && receivedAt.getTime() <= new Date(t.sent_at).getTime() + 3 * 60 * 60 * 1000
      }) as typeof thread ?? null
    }

    if (!thread) {
      console.error('receive-shift-email-reply: brak dopasowania watku', { fromEmail, subject, inReplyTo, references })
      return json({ ok: true, skipped: 'brak dopasowania watku' })
    }

    const isLate = receivedAt.getTime() - new Date(thread.sent_at).getTime() > 60 * 60 * 1000

    // Best-effort dopasowanie do konta w systemie (po adresie e-mail) - nie
    // blokujace, profiles nie ma kolumny email wiec sprawdzamy auth.users.
    let technicianId: string | null = null
    try {
      const { data: authUsers } = await admin.auth.admin.listUsers()
      technicianId = authUsers?.users.find(u => (u.email ?? '').toLowerCase() === fromEmail)?.id ?? null
    } catch {
      // brak dopasowania nie blokuje zapisu odpowiedzi
    }

    const { data: report, error: reportError } = await admin.from('technician_shift_reports').insert({
      thread_id: thread.id,
      shift_date: thread.shift_date,
      shift_type: thread.shift_type,
      technician_email: fromEmail,
      technician_id: technicianId,
      raw_content: strippedReply,
      subject,
      received_at: receivedAt.toISOString(),
      is_late: isLate,
      matched_via: matchedVia
    }).select('id').single()

    if (reportError || !report) {
      console.error('receive-shift-email-reply: insert technician_shift_reports failed', reportError)
      return json({ ok: true, skipped: 'blad zapisu' })
    }

    // ─── Parsowanie "numer: dzialanie" linia po linii ──────────────────────
    const lines = strippedReply.split(/\r?\n/)
    const NUMBER_LINE = /^\s*(\d+)[:\-.]?\s*(.*)$/
    type ParsedItem = { number: number; text: string }
    const parsedItems: ParsedItem[] = []
    let current: ParsedItem | null = null

    lines.forEach(line => {
      const m = line.match(NUMBER_LINE)
      if (m) {
        if (current) parsedItems.push(current)
        current = { number: Number(m[1]), text: m[2].trim() }
      } else if (current && line.trim()) {
        current.text += (current.text ? ' ' : '') + line.trim()
      }
    })
    if (current) parsedItems.push(current)

    const itemsByNumber = new Map(thread.numbered_items.map(i => [i.number, i]))

    if (parsedItems.length > 0) {
      for (const p of parsedItems) {
        const matchedItem = itemsByNumber.get(p.number)
        await admin.from('technician_action_items').insert({
          report_id: report.id,
          item_number: p.number,
          action_text: p.text || '(brak tresci)',
          matched_problem_ids: matchedItem?.hourly_report_ids ?? null,
          matched_by: matchedItem ? 'number' : null,
          needs_review: !matchedItem
        })
      }
      return json({ ok: true, thread_id: thread.id, items: parsedItems.length })
    }

    // ─── Fallback AI: technik nie numerowal wcale ──────────────────────────
    const anthropicKey = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '')
    if (!anthropicKey || thread.numbered_items.length === 0) {
      await admin.from('technician_action_items').insert({
        report_id: report.id,
        item_number: null,
        action_text: strippedReply,
        matched_problem_ids: null,
        matched_by: null,
        needs_review: true
      })
      return json({ ok: true, thread_id: thread.id, items: 1, ai: false })
    }

    const itemsContext = thread.numbered_items
      .map(i => `${i.number}. [${i.machine_name}, ${i.hour_range}] ${i.summary_text}`)
      .join('\n')

    const prompt = `Jestes asystentem lacza odpowiedzi technika (bez numeracji) z pozycjami z maila zmianowego.

POZYCJE Z MAILA:
${itemsContext}

ODPOWIEDZ TECHNIKA (bez numeracji):
"""${strippedReply}"""

Dopasuj odpowiedz do JEDNEJ pozycji po nazwie automatu/slowach kluczowych/godzinie, jesli to mozliwe. NIE zgaduj na sile - jesli nie masz solidnej podstawy, zwroc null. Zwroc WYLACZNIE poprawny JSON: {"itemNumber": liczba_lub_null}`

    let itemNumber: number | null = null
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] })
      })
      if (response.ok) {
        const data = await response.json() as { content: { type: string; text?: string }[] }
        const raw = data.content.map(c => c.text || '').join('').trim()
          .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
        const parsed = JSON.parse(raw)
        if (typeof parsed.itemNumber === 'number') itemNumber = parsed.itemNumber
      }
    } catch {
      // brak dopasowania AI nie blokuje zapisu - trafia do "niedopasowane"
    }

    const matchedItem = itemNumber !== null ? itemsByNumber.get(itemNumber) : undefined
    await admin.from('technician_action_items').insert({
      report_id: report.id,
      item_number: matchedItem ? itemNumber : null,
      action_text: strippedReply,
      matched_problem_ids: matchedItem?.hourly_report_ids ?? null,
      matched_by: matchedItem ? 'ai' : null,
      needs_review: true // AI-owe dopasowanie ZAWSZE wymaga potwierdzenia czlowieka
    })

    return json({ ok: true, thread_id: thread.id, items: 1, ai: true })
  } catch (error) {
    console.error('receive-shift-email-reply: unexpected error', error)
    // Zwroc 200 mimo bledu - Postmark retry'uje agresywnie nieudane webhooki,
    // a bez tego jeden zly mail moglby zapetlic retry.
    return json({ ok: true, error: error instanceof Error ? error.message : 'unknown' })
  }
})

function formatDatePl(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
