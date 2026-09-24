import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { chatPushEnabled, disableChatPush, enableChatPush, pushSupport } from '@/lib/chatPush'

export default function ChatPushSettings({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const support = pushSupport()
  useEffect(() => {
    let active = true
    const refresh = () => { void chatPushEnabled(userId).then(value => { if (active) setEnabled(value) }).catch(() => undefined) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [userId])
  async function toggle() {
    setBusy(true); setError('')
    try {
      if (enabled) { await disableChatPush(); setEnabled(false) }
      else { await enableChatPush(userId); setEnabled(true) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zmienić powiadomień.') }
    finally { setBusy(false) }
  }
  return <div className="messenger-push-settings">
    <div className="flex items-center gap-2"><Bell size={15} /><strong>Powiadomienia push</strong></div>
    <p>{support === 'unsupported' ? 'Na iPhonie dodaj aplikację do ekranu początkowego i otwórz z ikony. W innych przeglądarkach sprawdź obsługę powiadomień.'
      : support === 'unconfigured' ? 'Administrator przygotowuje uruchomienie powiadomień.'
      : enabled ? 'Włączone na tym urządzeniu — także poza aplikacją.' : 'Dowiedz się o wiadomości, nawet gdy zamkniesz aplikację.'}</p>
    {support === 'supported' && <button type="button" onClick={() => void toggle()} disabled={busy} className="messenger-push-button" aria-pressed={enabled}>
      {enabled ? <BellOff size={14} /> : <Bell size={14} />}{busy ? 'Chwileczkę…' : enabled ? 'Wyłącz powiadomienia' : 'Włącz powiadomienia'}
    </button>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>
}
