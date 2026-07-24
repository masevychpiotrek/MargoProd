import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Widok kierownika - diagnoza maszyn, nie operator.
const ALLOWED_ROLES = new Set(['manager', 'admin'])
// Wywolywane recznie przyciskiem "Generuj analize AI", rzadko - wystarczajacy margines.
const RATE_LIMIT_PER_HOUR = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    // Sekret bywa zapisany z niewidocznymi znakami (nowa linia, tabulator,
    // znaki spoza ASCII z wklejania) - fetch w Deno odrzuca taki naglowek
    // bledem "failed to parse header value". Czyscimy od razu, zanim to
    // znowu kogos zaskoczy (juz raz kosztowalo cala sesje debugowania).
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
      return json({ error: 'Brak uprawnien do generowania analizy.' })
    }

    if (!anthropicKey) {
      return json({ error: 'AI niedostepne: brak konfiguracji klucza.' })
    }

    const body = await req.json().catch(() => ({}))
    const machines = Array.isArray(body.machines) ? body.machines : []
    if (machines.length === 0) return json({ error: 'Brak maszyn do analizy.' })

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', callerId)
      .eq('action', 'ai_machine_diagnostics')
      .gte('created_at', oneHourAgo)

    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json({ error: 'rate_limited' })
    }

    const machineLines = machines.map((m: Record<string, unknown>, i: number) => {
      const name = String(m.machineName ?? `Maszyna ${i + 1}`)
      const id = String(m.machineId ?? '')
      const signals = Array.isArray(m.signals) ? m.signals : []
      const signalLines = signals.map((s: Record<string, unknown>) =>
        `  - ${String(s.type ?? '')}: ${JSON.stringify(s.detail ?? {})}`
      ).join('\n')
      return `Maszyna [id=${id}] "${name}":\n${signalLines || '  (brak sygnalow)'}`
    }).join('\n\n')

    const prompt = `Jestes inzynierem procesu na hali produkcyjnej (branza medyczna, automaty montazowe strzykawek/drenow).
Ponizej sa zagregowane SYGNALY wykryte regulami (nie surowe zgloszenia operatorow) dla kilku maszyn w wybranym okresie:

${machineLines}

Znaczenie typow sygnalow:
- repeated_defect: ta sama kategoria problemu powtorzyla sie N razy (category = nazwa kategorii, count = ile razy, examples = przykladowe nazwy problemow)
- high_reject: sredni odrzut % w okresie przekracza prog
- low_performance: srednia wydajnosc (tempo produkcji vs norma maszyny) ponizej progu
- low_availability: srednia dostepnosc (czas pracy vs cala zmiana - alarmy/postoje) ponizej progu
- missing_summary: brakuje rozliczenia czasu dla kilku zmian - dane sa niepelne

ZADANIE: Dla KAZDEJ maszyny z listy napisz JEDNO konkretne zdanie po polsku (maks. ok. 200 znakow): co konkretnie sie dzieje i co sprawdzic/zrobic. Badz konkretny (wskaz kategorie/liczby z sygnalow), NIE ogolnikowy. Nie wymyslaj faktow spoza podanych sygnalow. Jesli maszyna ma kilka sygnalow, polacz je w jedna spojna rekomendacje wskazujaca najwazniejszy problem.

Zwroc WYLACZNIE poprawny JSON (bez markdown, bez dodatkowego tekstu) w formacie:
[{"machineId": "...", "recommendation": "...", "severity": "high"|"medium"}]`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) return json({ error: `AI extraction failed: ${response.status}` })

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

    const results = (parsed as Array<Record<string, unknown>>)
      .filter(item => typeof item.machineId === 'string' && typeof item.recommendation === 'string')
      .map(item => ({
        machineId: item.machineId as string,
        recommendation: (item.recommendation as string).trim(),
        severity: item.severity === 'high' ? 'high' : 'medium'
      }))

    void admin.from('audit_logs').insert({
      user_id: callerId,
      action: 'ai_machine_diagnostics',
      table_name: 'machines',
      new_values: { machineCount: machines.length }
    })

    return json({ results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie wygenerowac analizy.'
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
