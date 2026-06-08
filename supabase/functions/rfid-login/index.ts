import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'

type ProfileRow = {
  id: string
  full_name: string
  role: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase service configuration')
    }

    const { rfid_uid } = await req.json().catch(() => ({ rfid_uid: '' }))
    const cleanUid = String(rfid_uid ?? '').replace(/\s/g, '')

    if (!cleanUid) {
      return json({ error: 'RFID_REQUIRED' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, full_name, role')
      .eq('rfid_uid', cleanUid)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle<ProfileRow>()

    if (profileError) throw profileError
    if (!profile) return json({ error: 'RFID_NOT_FOUND' }, 404)

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id)
    if (userError) throw userError
    const email = userData.user?.email?.toLowerCase()
    if (!email) return json({ error: 'USER_EMAIL_MISSING' }, 404)

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    if (linkError) throw linkError

    const tokenHash = linkData.properties?.hashed_token
    if (!tokenHash) throw new Error('Magic link token was not generated')

    return json({
      email,
      token_hash: tokenHash,
      full_name: profile.full_name,
      role: profile.role,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown RFID login error'
    return json({ error: message }, 500)
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
