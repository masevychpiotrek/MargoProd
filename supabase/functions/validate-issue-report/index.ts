import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = new Set(['operator', 'syringe_operator', 'manager', 'admin'])
const RATE_LIMIT_PER_HOUR = 8

const DOWNTIME_CATEGORIES = [
  'awaria_mechaniczna', 'awaria_elektryczna_czujnik', 'problem_pneumatyczny', 'problem_z_robotem',
  'problem_z_kamera', 'problem_z_podaniem_komponentu', 'problem_z_transportem', 'problem_ze_zgrzewaniem',
  'problem_z_cieciem', 'problem_z_nawijaniem_drenu', 'problem_z_ustawieniami_procesu', 'regulacja',
  'przezbrojenie', 'brak_materialu', 'brak_obsady', 'oczekiwanie_na_ur',
  'oczekiwanie_na_decyzje_jakosc_technolog', 'inna_przyczyna'
]

const REJECT_CATEGORIES = [
  'odrzut_jakosciowy', 'falszywy_odrzut', 'problem_z_kamera', 'problem_z_czujnikiem',
  'nieprawidlowe_podanie_komponentu', 'brak_komponentu', 'nieprawidlowy_montaz_komponentu',
  'problem_ze_zgrzewem', 'problem_z_dlugoscia_drenu', 'problem_z_pozycjonowaniem_komponentu',
  'problem_z_filtrem_odpowietrznika', 'problem_z_oslonka_igly', 'problem_z_komora',
  'problem_z_luer_lockiem', 'problem_z_rolka', 'uszkodzenie_mechaniczne_wyrobu',
  'zabrudzenie_cialo_obce', 'problem_materialowy', 'problem_po_regulacji', 'problem_po_przezbrojeniu',
  'inna_przyczyna'
]

const BANNED_GENERIC_PHRASES = [
  'awaria', 'problem', 'nie dziala', 'maszyna stoi', 'regulacja', 'odrzut', 'duzy odrzut',
  'niska wydajnosc', 'cos nie dziala', 'cos nie podaje', 'blad', 'stop', 'przestoj'
]

const VALID_STATION_NUMBERS = new Set([
  ...Array.from({ length: 57 }, (_, i) => i + 1),
  76, 77
])

function normalizeStationValue(raw: unknown): string | null {
  const text = String(raw ?? '')
  const match = text.match(/\d+/)
  if (!match) return null
  const n = Number(match[0])
  if (!VALID_STATION_NUMBERS.has(n)) return null
  return `st_${n}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration')
    if (!token) return json({ error: 'Brak sesji operatora.' })

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
      return json({ error: 'Brak uprawnien do kontroli opisu zgloszenia.' })
    }

    if (!anthropicKey) {
      return json({ error: 'AI niedostepne: brak konfiguracji klucza.' })
    }

    const body = await req.json().catch(() => ({}))
    const reportType = body.reportType === 'reject' ? 'reject' : 'downtime'
    const rawStations = Array.isArray(body.stations) ? body.stations : []
    const stations = rawStations
      .map((s: Record<string, unknown>) => ({
        value: String(s?.value ?? ''),
        label: String(s?.label ?? ''),
        pct: Number(s?.pct ?? 0)
      }))
      .filter((s: { value: string }) => s.value)
    const stationsLabel = stations.map(s => `${s.label} (${s.pct}%)`).join(', ')
    const machineName = String(body.machineName ?? '')
    const text = String(body.text ?? '').trim()
    const priorOccurrencesThisShift = Number.isFinite(Number(body.priorOccurrencesThisShift))
      ? Number(body.priorOccurrencesThisShift) : 0

    if (!text) return json({ error: 'Brak opisu do sprawdzenia.' })
    if (stations.length === 0) return json({ error: 'Brak wybranej stacji.' })

    // Prosty rate-limit: max RATE_LIMIT_PER_HOUR wywolan / operator / godzine
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', callerId)
      .eq('action', 'ai_issue_validation')
      .gte('created_at', oneHourAgo)

    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json({ error: 'rate_limited' })
    }

    const categories = reportType === 'downtime' ? DOWNTIME_CATEGORIES : REJECT_CATEGORIES

    const prompt = `Jestes kontrolerem jakosci zgloszen na hali produkcyjnej (branza medyczna, produkcja strzykawek/automatow).
Operator zglasza przyczyne ${reportType === 'downtime' ? 'niskiej wydajnosci' : 'nadmiernego odrzutu'} na maszynie "${machineName}".
Wybrane stacje/obszary wraz z orientacyjnym procentowym udzialem w problemie: ${stationsLabel}.
${stations.length > 1 ? 'Operator wskazal WIECEJ NIZ JEDNA stacje - problem moze dotyczyc kilku obszarow jednoczesnie.' : ''}
${priorOccurrencesThisShift > 0 ? `Uwaga: to ${priorOccurrencesThisShift + 1}. zgloszenie z tych stacji/obszarow w biezacej zmianie.` : ''}

OPIS OPERATORA:
"${text}"

ZASADY OCENY:
1. Opis NIE MOZE byc ogolnikowy. Zakazane, zbyt ogolne wpisy (przyklady, nie wyczerpujace): ${BANNED_GENERIC_PHRASES.join(', ')}.
2. Dobry opis musi wskazywac: czego dotyczyl problem, jaki komponent/element automatu byl zaangazowany, jaki byl skutek (zatrzymanie/spadek wydajnosci/zwiekszony odrzut), oraz czy wystepowal stale/okresowo/jednorazowo.
3. Jesli opis jest zbyt ogolny lub nie pozwala okreslic co sie wydarzylo - ustaw ok=false i w "message" zwroc DOKLADNIE ten tekst (po polsku, bez zmian):
"Opis jest zbyt ogolny. Wskaz konkretnie, co sie wydarzylo, na jakiej stacji, jaki element nie zadzialal prawidlowo oraz jaki byl skutek. Przyklad: 'Stacja 52 - nieprawidlowe podanie filtra odpowietrznika, automat zatrzymywal sie okresowo, konieczna byla regulacja podajnika.'"
4. Jesli opis jest wystarczajaco konkretny, ustaw ok=true, message=null.
5. Sprawdz zgodnosc stacji z opisem: czy tresc opisu (np. wspomniane podzespoly: kamera, robot, zgrzew, filtr, dren, luer-lock, igla, komora) pasuje do CO NAJMNIEJ JEDNEJ z wybranych stacji/obszarow (${stationsLabel}). Jesli opis WYRAZNIE nie pasuje do zadnej z wybranych stacji, ustaw stationMismatch=true i napisz krotkie ostrzezenie po polsku w "mismatchMessage" (np. "Opis moze nie pasowac do wybranych stacji. Sprawdz, czy wybor jest prawidlowy."). Jesli pasuje do co najmniej jednej lub nie da sie jednoznacznie ocenic, stationMismatch=false, mismatchMessage=null.
6. Wybierz najbardziej pasujaca kategorie problemu z tej listy (zwroc DOKLADNIE jedna z wartosci, bez zmian): ${categories.join(', ')}.
7. Zaproponuj krotka standaryzowana nazwe problemu (problemName, kilka slow, po polsku, bez ogolnikow).
8. Zaproponuj uporzadkowany, zwiezly opis zdarzenia (standardizedDescription, 1-2 zdania, oparty TYLKO na faktach z opisu operatora - nie dodawaj informacji ktorych operator nie podal).
9. Okresl skutek (effect) jednym krotkim zdaniem/fraza po polsku (np. "zatrzymanie automatu", "spadek wydajnosci", "nadmierny odrzut").
10. WAZNE - przeszukaj tresc opisu pod katem KONKRETNYCH numerow stacji wspomnianych wprost (np. "stacja 11", "st.53", "st 8", "stacji 48", "na 21"). Uwzglednij TYLKO numery z zakresu 1-57, 76 lub 77 (to jedyne istniejace stacje). Zwroc te numery w polu "detectedStations" jako liste stringow w formacie "st_N" (np. ["st_11","st_53","st_8"]) - dla KAZDEGO numeru stacji wspomnianego w opisie, niezaleznie od tego czy zostal juz wybrany przez operatora czy nie. Jesli opis nie wspomina zadnego numeru stacji wprost, zwroc pusta liste [].

Zwroc WYLACZNIE poprawny JSON (bez markdown, bez dodatkowego tekstu) w formacie:
{"ok": boolean, "message": string|null, "stationMismatch": boolean, "mismatchMessage": string|null, "category": string, "problemName": string, "standardizedDescription": string, "effect": string, "detectedStations": string[]}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) return json({ error: `AI validation failed: ${response.status}` })

    const data = await response.json() as { content: { type: string; text?: string }[] }
    const raw = data.content.map(c => c.text || '').join('').trim()
      .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return json({ error: 'AI zwrocilo nieprawidlowa odpowiedz.' })
    }

    const result = parsed as Record<string, unknown>
    if (typeof result.ok !== 'boolean') return json({ error: 'AI zwrocilo nieprawidlowa odpowiedz.' })

    const selectedValues = new Set(stations.map(s => s.value))
    const detectedRaw = Array.isArray(result.detectedStations) ? result.detectedStations : []
    const detectedValues = [...new Set(
      detectedRaw.map(normalizeStationValue).filter((v): v is string => v !== null)
    )]
    const additionalStationsFound = detectedValues
      .filter(v => !selectedValues.has(v))
      .map(v => ({ value: v, label: `Stacja ${v.replace('st_', '')}` }))

    void admin.from('audit_logs').insert({
      user_id: callerId,
      action: 'ai_issue_validation',
      table_name: 'hourly_reports',
      new_values: { reportType, stations: stations.map(s => s.value), ok: result.ok }
    })

    return json({
      ok: result.ok,
      message: typeof result.message === 'string' ? result.message : null,
      stationMismatch: Boolean(result.stationMismatch),
      mismatchMessage: typeof result.mismatchMessage === 'string' ? result.mismatchMessage : null,
      category: typeof result.category === 'string' ? result.category : categories[categories.length - 1],
      problemName: typeof result.problemName === 'string' ? result.problemName : '',
      standardizedDescription: typeof result.standardizedDescription === 'string' ? result.standardizedDescription : text,
      effect: typeof result.effect === 'string' ? result.effect : '',
      additionalStationsFound
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie sprawdzic opisu.'
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
