import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0'
import webpush from 'npm:web-push@3.6.7'
import { deliverPush, type PushJob } from './delivery.ts'

// Deploy --no-verify-jwt. Only the dedicated server secret may invoke this worker.
Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('CHAT_PUSH_SECRET')
  if (!secret || req.headers.get('x-chat-push-secret') !== secret) return new Response('Unauthorized', { status: 401 })
  const publicKey = Deno.env.get('WEB_PUSH_PUBLIC_KEY')
  const privateKey = Deno.env.get('WEB_PUSH_PRIVATE_KEY')
  const subject = Deno.env.get('WEB_PUSH_SUBJECT')
  if (!publicKey || !privateKey || !subject) return new Response('Push not configured', { status: 503 })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.rpc('chat_push_claim')
    if (error) throw error
    const jobs = (data ?? []) as PushJob[]
    let sent = 0
    // Bounded batches stay within the Edge execution window.
    for (let offset = 0; offset < jobs.length; offset += 5) {
      await Promise.all(jobs.slice(offset, offset + 5).map(async job => {
        // Re-check device ownership after claiming, before sending.
        const { data: subscription, error: subError } = await admin.from('chat_push_subscriptions')
          .select('user_id').eq('endpoint', job.endpoint).maybeSingle()
        let status = 0
        if (!subError && subscription?.user_id !== job.recipient_id) status = 410
        else if (!subError) status = await deliverPush(job, payload => webpush.generateRequestDetails({
          endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_key },
        }, payload, { vapidDetails: { subject, publicKey, privateKey }, TTL: 3600, urgency: 'normal' }))
        const { error: completeError } = await admin.rpc('chat_push_complete', { p_job: job.job_id, p_lease: job.lease_token, p_status: status })
        if (completeError) throw completeError
        if (status >= 200 && status < 300) sent++
      }))
    }
    return Response.json({ processed: jobs.length, sent })
  } catch {
    // Never log endpoints, auth keys, payloads or environment secrets.
    return new Response('Push worker failed; queued jobs will retry.', { status: 500 })
  }
})
