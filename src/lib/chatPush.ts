import { supabase } from '@/lib/supabase'

const PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined
const CACHE = 'margoline-push-preferences'
const OWNER = '/__chat_push_owner'
type Owner = { userId: string; enabled: boolean }

export function pushSupport() {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (!PUBLIC_KEY) return 'unconfigured'
  return 'supported'
}
async function readOwner(): Promise<Owner | null> {
  if (!('caches' in window)) return null
  const response = await (await caches.open(CACHE)).match(OWNER)
  return response ? response.json() : null
}
async function writeOwner(owner: Owner | null) {
  if (!('caches' in window)) return
  const cache = await caches.open(CACHE)
  if (owner) await cache.put(OWNER, new Response(JSON.stringify(owner), { headers: { 'Content-Type': 'application/json' } }))
  else await cache.delete(OWNER)
}
function decodeKey(value: string) {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
async function registration() {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Odśwież aplikację, aby uruchomić powiadomienia.')), 12000) }),
    ])
  } finally { clearTimeout(timer!) }
}
export async function chatPushEnabled(userId: string) {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return false
  const owner = await readOwner()
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub || !owner?.enabled || owner.userId !== userId) return false
  const { data, error } = await supabase.from('chat_push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle()
  if (error) return false
  return !!data
}

export async function enableChatPush(userId: string) {
  if (pushSupport() !== 'supported') throw new Error('Powiadomienia nie są jeszcze dostępne na tym urządzeniu.')
  // Invoke directly from the click, before awaiting any network or worker work.
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Zezwól na powiadomienia w ustawieniach przeglądarki dla tej aplikacji.')
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  const key = decodeKey(PUBLIC_KEY!)
  if (sub && sub.options.applicationServerKey && !new Uint8Array(sub.options.applicationServerKey).every((v, i) => v === key[i])) {
    await disableChatPush()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = sub.toJSON()
  const { error } = await supabase.rpc('chat_push_register', { p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth })
  if (error) throw new Error(error.code === 'PGRST202' ? 'Administrator musi jeszcze uruchomić powiadomienia na serwerze.' : error.message)
  await writeOwner({ userId, enabled: true })
}

export async function clearLocalChatPush() {
  await writeOwner(null)
  const reg = await navigator.serviceWorker?.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  const notifications = await reg?.getNotifications()
  notifications?.filter(n => n.tag.startsWith('chat-')).forEach(n => n.close())
}
export async function disableChatPush() {
  const reg = await navigator.serviceWorker?.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  // Clear local ownership first, even if the server is offline.
  await clearLocalChatPush()
  if (sub) {
    const { error } = await supabase.rpc('chat_push_unregister', { p_endpoint: sub.endpoint })
    if (error && error.code !== 'PGRST202') throw new Error('Powiadomienia wyłączono na urządzeniu. Serwer usunie wygasłą subskrypcję po odzyskaniu połączenia.')
  }
}
export async function reconcileChatPushOwner(userId: string) {
  const owner = await readOwner()
  if (owner && owner.userId !== userId) await clearLocalChatPush()
}
