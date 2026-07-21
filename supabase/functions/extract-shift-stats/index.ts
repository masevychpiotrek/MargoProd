import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = new Set(['operator', 'syringe_operator', 'manager', 'admin'])
const MAX_ATTEMPTS = 5

function toBase64(bytes: Uint8Array): string {
  const chunkSize = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function toNumericValue(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    // .trim() jest krytyczny: sekret zapisany z koncowym znakiem nowej linii
    // (np. przy wklejaniu do CLI) przechodzi walidacje "czy istnieje", ale
    // fetch w Deno odrzuca taki naglowek bledem "failed to parse header value".
    const anthropicKey = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim()
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration')

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Body czytamy PRZED weryfikacja sesji, zeby znac photoId jak najwczesniej -
    // dzieki temu KAZDY blad (nawet "brak sesji") zostaje utrwalony na wierszu
    // zdjecia w bazie i jest widoczny w UI oraz diagnozowalny bez logow platformy.
    const body = await req.json().catch(() => ({}))
    const photoId = String(body.photoId ?? '')

    const failEarly = async (message: string) => {
      console.error(`extract-shift-stats early failure (photoId=${photoId || 'none'}): ${message}`)
      if (photoId) {
        await admin.from('shift_stat_photos')
          .update({ ocr_status: 'failed', ocr_error: message })
          .eq('id', photoId)
      }
      return json({ error: message })
    }

    if (!token) return await failEarly('Brak sesji operatora - odswiez strone i zaloguj sie ponownie.')

    const { data: callerData, error: callerError } = await admin.auth.getUser(token)
    if (callerError || !callerData.user) {
      return await failEarly(`Nie udalo sie potwierdzic sesji (${callerError?.message ?? 'brak uzytkownika'}). Odswiez strone i sprobuj ponownie.`)
    }
    const callerId = callerData.user.id

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('role, is_active, deleted_at')
      .eq('id', callerId)
      .maybeSingle()

    if (profileError) return await failEarly(`Blad odczytu profilu: ${profileError.message}`)
    if (!callerProfile || !ALLOWED_ROLES.has(callerProfile.role) || !callerProfile.is_active || callerProfile.deleted_at) {
      return await failEarly(`Brak uprawnien do odczytu zdjecia (rola: ${callerProfile?.role ?? 'brak profilu'}).`)
    }

    if (!anthropicKey) {
      return await failEarly('AI niedostepne: brak skonfigurowanego klucza ANTHROPIC_API_KEY na serwerze.')
    }

    if (!photoId) return json({ error: 'Brak identyfikatora zdjecia.' })

    const { data: photo, error: photoError } = await admin
      .from('shift_stat_photos')
      .select('id, photo_path, ocr_attempts, machine_id')
      .eq('id', photoId)
      .maybeSingle()
    if (photoError) return await failEarly(`Blad odczytu rekordu zdjecia: ${photoError.message}`)
    if (!photo) return json({ error: 'Nie znaleziono zdjecia.' })

    if (photo.ocr_attempts >= MAX_ATTEMPTS) {
      return json({ error: 'Osiagnieto limit prob odczytu tego zdjecia. Zglos to kierownikowi.' })
    }

    // Zapisz start proby OD RAZU, przed pobraniem zdjecia i wywolaniem AI -
    // jesli polaczenie zostanie przerwane (timeout sieci operatora, zabicie
    // funkcji przez platforme przy dlugim wywolaniu AI), wiersz nigdy nie
    // zostaje trwale w stanie 'pending' bez zadnego sladu proby.
    await admin.from('shift_stat_photos').update({
      ocr_attempts: photo.ocr_attempts + 1, ocr_status: 'pending', ocr_error: null
    }).eq('id', photoId)

    try {
      const { data: fileBlob, error: downloadError } = await admin.storage
        .from('shift-stats-photos')
        .download(photo.photo_path)
      if (downloadError || !fileBlob) {
        throw new Error('Nie udalo sie pobrac zdjecia ze storage.')
      }

      const bytes = new Uint8Array(await fileBlob.arrayBuffer())
      const base64 = toBase64(bytes)

      const prompt = `Odczytaj WSZYSTKIE widoczne pary etykieta/wartosc z tego zdjecia ekranu "Shift Statistics" panelu PLC automatu produkcyjnego. Obejmuje to m.in.: czasy (TIME IN RUN/STANDBY/ALARM), liczniki (GOOD, SCRAP), kazda pozycje stacji (np. "ST 15 DRIP CHAMBER RIGHT"), wskazniki procentowe (EFF % BATCH PROD), Total Machine cycles - kazda widoczna etykiete z jej wartoscia.

ZASADY:
1. Zwroc etykiete DOKLADNIE tak jak jest napisana na ekranie (zachowaj wielkie litery, numery stacji).
2. Zwroc wartosc dokladnie jak jest wyswietlona (np. "3H 52M 2S", "47", "63%").
3. Jesli fragment zdjecia jest nieczytelny, rozmazany lub zaslonietu - POMIN te pozycje zamiast zgadywac wartosc.
4. Nie dodawaj pozycji ktorych nie ma na zdjeciu.

Zwroc WYLACZNIE poprawny JSON (bez markdown, bez dodatkowego tekstu) w formacie:
[{"label": "...", "value": "..."}]`

      // Twardy limit czasu na wywolanie AI - bez tego dluga/wisząca odpowiedz
      // moglaby doprowadzic do zabicia calej funkcji przez platforme zanim
      // zdazymy zapisac jakikolwiek wynik do bazy.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45_000)
      let response: Response
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-5',
            max_tokens: 3000,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
                { type: 'text', text: prompt }
              ]
            }]
          }),
          signal: controller.signal
        })
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new Error('AI nie odpowiedzialo w wyznaczonym czasie. Sprobuj ponownie.')
        }
        throw fetchError
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) {
        throw new Error(`AI extraction failed: ${response.status}`)
      }

      const data = await response.json() as { content: { type: string; text?: string }[] }
      const raw = data.content.map(c => c.text || '').join('').trim()
        .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        await admin.from('shift_stat_photos').update({ raw_response: raw }).eq('id', photoId)
        throw new Error('AI zwrocilo nieprawidlowa odpowiedz.')
      }

      if (!Array.isArray(parsed)) {
        await admin.from('shift_stat_photos').update({ raw_response: raw }).eq('id', photoId)
        throw new Error('AI zwrocilo nieoczekiwany format.')
      }

      const items = (parsed as Array<Record<string, unknown>>)
        .filter(item => typeof item.label === 'string' && typeof item.value === 'string')
        .map(item => ({ label: (item.label as string).trim(), value: (item.value as string).trim() }))
        .filter(item => item.label && item.value)

      if (items.length === 0) {
        await admin.from('shift_stat_photos').update({ raw_response: raw }).eq('id', photoId)
        throw new Error('AI nie odczytalo zadnych danych ze zdjecia. Sprobuj ostrzejsze zdjecie.')
      }

      // Usun tylko NIEPOTWIERDZONE odczyty z poprzednich prob dla tego zdjecia -
      // zeby ponowna proba nie duplikowala wierszy, ale nie kasowala tego co
      // operator juz zweryfikowal i potwierdzil.
      await admin.from('shift_stat_readings').delete().eq('photo_id', photoId).eq('confirmed', false)

      const { error: insertError } = await admin.from('shift_stat_readings').insert(
        items.map((item, index) => ({
          photo_id: photoId,
          metric_label: item.label,
          metric_value: item.value,
          numeric_value: toNumericValue(item.value),
          sort_order: index
        }))
      )
      if (insertError) throw insertError

      await admin.from('shift_stat_photos').update({
        ocr_status: 'done', ocr_error: null, raw_response: raw
      }).eq('id', photoId)

      return json({ ok: true, count: items.length })
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : 'Nie udalo sie odczytac zdjecia.'
      await admin.from('shift_stat_photos').update({ ocr_status: 'failed', ocr_error: message }).eq('id', photoId)
      return json({ error: message })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie odczytac zdjecia.'
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
