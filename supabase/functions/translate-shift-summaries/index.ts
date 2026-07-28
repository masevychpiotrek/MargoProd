import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Widok kierownika - eksport statystyk zmianowych, nie operator.
const ALLOWED_ROLES = new Set(['manager', 'admin'])
// Wywolywane recznie przy kazdym eksporcie do Excela z arkuszem "Shift Summary" -
// nie automatycznie, wiec wystarczajacy margines.
const RATE_LIMIT_PER_HOUR = 30
const MAX_ITEMS = 500
const MAX_TOTAL_CHARS = 80_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    // Sekret bywa zapisany z niewidocznymi znakami (nowa linia, tabulator,
    // znaki spoza ASCII z wklejania) - fetch w Deno odrzuca taki naglowek
    // bledem "failed to parse header value". Czyscimy od razu.
    const anthropicKey = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '')
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration')
    if (!token) return json({ error: 'Brak sesji kierownika.' })

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: callerData, error: callerError } = await admin.auth.getUser(token)
    if (callerError || !callerData.user) return json({ error: 'Nie udalo sie potwierdzic sesji.' })
    const callerId = callerData.user.id

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('role, is_active, deleted_at')
      .eq('id', callerId)
      .maybeSingle()

    if (profileError) throw profileError
    if (!callerProfile || !ALLOWED_ROLES.has(callerProfile.role) || !callerProfile.is_active || callerProfile.deleted_at) {
      return json({ error: 'Brak uprawnien do tlumaczenia.' })
    }

    if (!anthropicKey) {
      return json({ error: 'AI niedostepne: brak konfiguracji klucza.' })
    }

    const body = await req.json().catch(() => ({}))
    const items = Array.isArray(body.items) ? body.items : []
    const cleanItems = (items as Array<Record<string, unknown>>)
      .filter(item => typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim())
      .map(item => ({ id: item.id as string, text: (item.text as string).trim() }))
      .slice(0, MAX_ITEMS)

    if (!cleanItems.length) return json({ translations: [] })

    const totalChars = cleanItems.reduce((sum, item) => sum + item.text.length, 0)
    if (totalChars > MAX_TOTAL_CHARS) {
      return json({ error: 'Zbyt duzo tekstu do przetlumaczenia jednorazowo. Zmniejsz zakres eksportu.' })
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', callerId)
      .eq('action', 'ai_translate_shift_summaries')
      .gte('created_at', oneHourAgo)

    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json({ error: 'rate_limited' })
    }

    const inputList = cleanItems.map(item => ({ id: item.id, text: item.text }))

    const prompt = `Jestes tlumaczem technicznym w zakladzie produkcyjnym (branza medyczna, automaty montazowe strzykawek/drenow/zestawow infuzyjnych).

Przetlumacz KAZDY z ponizszych tekstow z polskiego na angielski. To notatki operatorow o przebiegu zmiany produkcyjnej (przyczyny postojow, odrzutow, uwagi).

ZASADY:
1. Tlumacz WIERNIE - nie dodawaj, nie usuwaj i nie interpretuj informacji. Zadnych nowych faktow.
2. Zachowaj numery stacji (np. "stacja 15", "st 26"), nazwy maszyn/automatow i skroty techniczne bez zmian.
3. Zachowaj strukture ze znacznikami godzin i typow w nawiasach kwadratowych (np. "08:00-09:00 [Downtime]:") - tlumacz tylko tresc opisu po dwukropku.
4. Jesli fragment zawiera "[ZAKONCZENIE PRZEDWCZESNE]", przetlumacz na "[EARLY SHIFT END]".
5. Pisz naturalnym, technicznym angielskim zrozumialym dla inzyniera spoza Polski.
6. Zwroc TYLKO poprawny JSON, bez markdown: [{"id": "...", "text": "przetlumaczony tekst"}] - jeden wpis na kazdy otrzymany id, w tej samej kolejnosci.

TEKSTY DO PRZETLUMACZENIA:
${JSON.stringify(inputList)}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) return json({ error: `Translation failed: ${response.status}` })

    const data = await response.json() as { content: { type: string; text?: string }[] }
    const raw = data.content.map(c => c.text || '').join('').trim()
      .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return json({ error: 'AI zwrocilo nieprawidlowa odpowiedz.' })
    }
    if (!Array.isArray(parsed)) return json({ error: 'AI zwrocilo nieoczekiwany format.' })

    const translations = (parsed as Array<Record<string, unknown>>)
      .filter(item => typeof item.id === 'string' && typeof item.text === 'string')
      .map(item => ({ id: item.id as string, text: (item.text as string).trim() }))

    void admin.from('audit_logs').insert({
      user_id: callerId,
      action: 'ai_translate_shift_summaries',
      table_name: 'hourly_reports',
      new_values: { itemCount: cleanItems.length }
    })

    return json({ translations })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie przetlumaczyc tekstu.'
    return json({ error: message })
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}
