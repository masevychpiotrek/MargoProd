import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ALLOWED_ROLES = new Set(['operator', 'manager', 'specialist', 'viewer', 'admin'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration')
    if (!token) return json({ error: 'Brak sesji administratora.' })

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: callerData, error: callerError } = await admin.auth.getUser(token)
    if (callerError || !callerData.user) return json({ error: 'Nie udalo sie potwierdzic sesji administratora.' })

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('role, is_active, deleted_at')
      .eq('id', callerData.user.id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!callerProfile || callerProfile.role !== 'admin' || !callerProfile.is_active || callerProfile.deleted_at) {
      return json({ error: 'Tylko administrator moze tworzyc konta.' })
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const fullName = String(body.full_name ?? '').trim()
    const role = String(body.role ?? 'operator').trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Wpisz poprawny adres e-mail.' })
    }
    if (!fullName) return json({ error: 'Wpisz imie i nazwisko.' })
    if (password.length < 6) return json({ error: 'Haslo musi miec minimum 6 znakow.' })
    if (!ALLOWED_ROLES.has(role)) return json({ error: 'Nieprawidlowa rola uzytkownika.' })

    const metadata = { full_name: fullName, name: fullName, role }

    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: {
        provider: 'email',
        providers: ['email'],
      },
    })

    let userId = result.data.user?.id
    if (result.error || !userId) {
      const fallback = await admin.rpc('create_user_with_profile', {
        p_email: email,
        p_password: password,
        p_name: fullName,
        p_role: role,
      })

      if (fallback.error) {
        throw new Error(fallback.error.message || result.error?.message || 'Nie udalo sie utworzyc konta.')
      }

      userId = fallback.data as string
    }
    if (!userId) throw new Error('Supabase nie zwrocil ID uzytkownika.')

    const { error: profileSaveError } = await admin
      .from('profiles')
      .upsert({
        id: userId,
        full_name: fullName,
        role,
        is_active: true,
        must_change_password: true,
        deleted_at: null,
      }, { onConflict: 'id' })

    if (profileSaveError) throw profileSaveError

    return json({ id: userId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udalo sie utworzyc konta.'
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
