export type PushJob = {
  job_id: string; lease_token: string; endpoint: string; p256dh: string; auth_key: string
  recipient_id: string; conversation_id: string; sender_id: string
}

export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && /^(fcm\.googleapis\.com|([a-z0-9-]+\.)?push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/.test(url.hostname)
  } catch { return false }
}

// No private message text or sender name is displayed on a shared lock screen.
export function pushPayload(job: PushJob) {
  return JSON.stringify({ type: 'chat-message', recipientId: job.recipient_id,
    conversationId: job.conversation_id, senderId: job.sender_id })
}

export async function deliverPush(job: PushJob, requestDetails: (payload: string) => { endpoint: string; headers: Record<string, string>; body?: Uint8Array },
  fetcher: typeof fetch = fetch): Promise<number> {
  if (!allowedPushEndpoint(job.endpoint)) return 410
  try {
    const details = requestDetails(pushPayload(job))
    if (details.endpoint !== job.endpoint) return 410
    const response = await fetcher(details.endpoint, {
      method: 'POST', headers: details.headers, body: details.body as BodyInit,
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })
    await response.body?.cancel()
    return response.status
  } catch { return 0 }
}
