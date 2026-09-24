import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCheck, MessageCircle, Plus, Search, Send, LockKeyhole, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useChatInbox } from '@/hooks/useMessenger'
import { chatContacts, chatMarkRead, chatMessages, chatSend } from '@/lib/messenger'
import type { ChatContact, ChatConversation } from '@/lib/messenger'
import { cn, ROLE_LABELS } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'
import ChatPushSettings from '@/components/shared/ChatPushSettings'
import './Messages.css'

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase() }
function time(value: string) { return new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) }
function date(value: string) { return new Date(value).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) }
function searchText(value: string) { return value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l') }

function Avatar({ name }: { name: string }) {
  const tone = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 4
  return <span className={`messenger-avatar messenger-avatar--${tone}`} aria-hidden="true">{initials(name)}</span>
}

function Conversation({ userId, contact, conversation, draft, requestId, setDraft, onSent, onBack }: {
  userId: string; contact: ChatContact; conversation?: ChatConversation
  draft: string; requestId: string; setDraft: (value: string) => void
  onSent: (requestId: string) => void; onBack: () => void
}) {
  const qc = useQueryClient()
  const [sentConversation, setSentConversation] = useState<string>()
  const conversationId = conversation?.id ?? sentConversation
  const [atBottom, setAtBottom] = useState(true)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const [readError, setReadError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const readThrough = useRef(0)
  const pending = useRef(false)
  useEffect(() => {
    const field = composer.current
    if (field) { field.style.height = 'auto'; field.style.height = `${Math.min(field.scrollHeight, 128)}px` }
  }, [draft])
  const history = useInfiniteQuery({
    queryKey: ['chat', userId, 'messages', conversationId],
    queryFn: ({ pageParam }) => chatMessages(conversationId!, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: last => last.length === 50 ? last[last.length - 1].seq : undefined,
    enabled: !!conversationId, refetchInterval: 10000, staleTime: 0, retry: 1,
  })
  const messages = [...new Map((history.data?.pages.flat() ?? []).map(m => [m.id, m])).values()].sort((a, b) => a.seq - b.seq)
  const lastSeq = history.data?.pages[0]?.[0]?.seq ?? 0

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  useEffect(() => {
    if (atBottom && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [lastSeq, atBottom])
  useEffect(() => {
    if (!conversationId || !lastSeq || !visible || !atBottom || !conversation?.unread_count || readThrough.current >= lastSeq) return
    readThrough.current = lastSeq
    let disposed = false
    chatMarkRead(conversationId, lastSeq).then(() => {
      if (!disposed) setReadError('')
      void qc.invalidateQueries({ queryKey: ['chat', userId, 'inbox'] })
    }).catch(() => {
      readThrough.current = 0
      if (!disposed) setReadError('Nie udało się potwierdzić odczytu.')
    })
    return () => { disposed = true }
  }, [conversationId, lastSeq, visible, atBottom, conversation?.unread_count, qc, userId, history.dataUpdatedAt])

  const send = useMutation({
    mutationFn: ({ body, id }: { body: string; id: string }) => chatSend(contact.id, body, id),
    onSuccess: (message, variables) => {
      setSentConversation(message.conversation_id)
      onSent(variables.id)
      setAtBottom(true)
      void qc.invalidateQueries({ queryKey: ['chat', userId] })
      composer.current?.focus()
    },
    onSettled: () => { pending.current = false },
  })
  function submit() {
    const body = draft.trim()
    if (!body || pending.current || send.isPending || conversation?.can_send === false) return
    pending.current = true
    send.mutate({ body, id: requestId })
  }
  async function older() {
    const element = scroller.current
    const height = element?.scrollHeight ?? 0
    const top = element?.scrollTop ?? 0
    setAtBottom(false)
    await history.fetchNextPage()
    requestAnimationFrame(() => { if (element) element.scrollTop = top + element.scrollHeight - height })
  }
  return (
    <section aria-label={`Rozmowa z ${contact.full_name}`} className="messenger-conversation">
      <header className="messenger-chat-header">
        <button type="button" onClick={onBack} aria-label="Wróć do rozmów" className="messenger-icon-button md:hidden"><ArrowLeft size={20} /></button>
        <Avatar name={contact.full_name} />
        <div className="min-w-0 flex-1"><h2 className="messenger-person-name">{contact.full_name}</h2><p className="messenger-person-role">{ROLE_LABELS[contact.role]}</p></div>
        <span className="messenger-private" title="Rozmowę widzą tylko jej uczestnicy w aplikacji"><LockKeyhole size={14} /><span>Prywatna rozmowa</span></span>
      </header>
      <div ref={scroller} onScroll={e => {
        const el = e.currentTarget
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
      }} className="messenger-history" role="log" aria-label="Historia wiadomości" aria-live="polite">
        {history.hasNextPage && <button className="mx-auto mb-4 block rounded-full border border-navy-600 px-4 py-2 text-xs text-navy-200 disabled:opacity-50" disabled={history.isFetchingNextPage} onClick={() => void older()}>Wczytaj starsze wiadomości</button>}
        {conversationId && history.isPending && <p className="text-center text-sm text-navy-400">Ładowanie wiadomości…</p>}
        {history.isError && <div role="alert" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{history.error.message} <button className="underline" onClick={() => void history.refetch()}>Ponów</button></div>}
        {!messages.length && !history.isError && (!conversationId || !history.isPending) && <div className="py-12 text-center text-navy-400"><MessageCircle className="mx-auto mb-3 text-brand" size={36} /><p>Napisz pierwszą wiadomość.</p><p className="mt-2 text-xs">Zobaczysz ją tutaj razem z odpowiedzią.</p></div>}
        {messages.map((message, index) => {
          const mine = message.sender_id === userId
          const read = mine && message.seq <= Number(conversation?.other_read_seq ?? 0)
          return <div key={message.id}>
            {(index === 0 || date(messages[index - 1].created_at) !== date(message.created_at)) && <div className="messenger-day"><span>{date(message.created_at)}</span></div>}
            <div className={cn('messenger-message-row', mine && 'messenger-message-row--mine')}>
              <div className={cn('messenger-bubble', mine && 'messenger-bubble--mine')}>
                <p className="messenger-message-body">{message.body}</p>
                <div className="messenger-message-meta">
                  <time dateTime={message.created_at}>{time(message.created_at)}</time>
                  {mine && <span className={cn('inline-flex items-center gap-1', read && 'messenger-read')} title={read ? 'Odczytano' : 'Wysłano'}>{read ? <CheckCheck size={15} /> : <Check size={15} />}{read ? 'Odczytano' : 'Wysłano'}</span>}
                </div>
              </div>
            </div>
          </div>
        })}
      </div>
      {!atBottom && <button onClick={() => setAtBottom(true)} className="mx-auto mb-2 rounded-full bg-brand px-4 py-2 text-xs font-bold text-navy-950">Przejdź do najnowszych wiadomości ↓</button>}
      <form onSubmit={e => { e.preventDefault(); submit() }} className="messenger-composer">
        {send.isError && <p role="alert" className="mb-2 text-sm text-red-300">{send.error.message} Kliknij Wyślij, aby ponowić.</p>}
        {readError && <p role="status" className="mb-2 text-xs text-amber-300">{readError}</p>}
        {conversation?.can_send === false && <p className="mb-2 text-sm text-amber-300">Konto tej osoby jest nieaktywne. Historia rozmowy pozostaje dostępna.</p>}
        <div className="messenger-compose-box">
          <textarea ref={composer} value={draft} onChange={e => { setDraft(e.target.value); if (send.isError) send.reset() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
            aria-label="Treść wiadomości" placeholder="Napisz wiadomość…" rows={1} maxLength={4000}
            disabled={send.isPending || conversation?.can_send === false}
            className="messenger-textarea" />
          <button type="submit" disabled={!draft.trim() || send.isPending || conversation?.can_send === false} className="messenger-send" aria-label="Wyślij wiadomość" title="Wyślij wiadomość"><Send size={19} /><span className="hidden sm:inline">{send.isPending ? 'Wysyłanie…' : 'Wyślij'}</span></button>
        </div>
        <div className="messenger-compose-hint"><span className="hidden sm:inline">Enter — wyślij <span className="mx-2">·</span> Shift+Enter — nowy wiersz</span><span className="sm:hidden">Enter — wyślij wiadomość</span><span>{draft.length > 0 ? `${draft.length}/4000` : ''}</span></div>
      </form>
    </section>
  )
}

function Messenger({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams()
  const inbox = useChatInbox()
  const contacts = useQuery({ queryKey: ['chat', userId, 'contacts'], queryFn: chatContacts, staleTime: 30000, retry: 1 })
  const [selected, setSelected] = useState<ChatContact | null>(null)
  const [findPerson, setFindPerson] = useState(false)
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { body: string; id: string }>>({})
  const conversation = inbox.data?.find(c => c.other_id === selected?.id)
  const currentContact = selected ? (contacts.data?.find(c => c.id === selected.id) ?? selected) : null
  useEffect(() => {
    const person = params.get('person')
    const account = params.get('account')
    if (!person || (account && account !== userId)) return
    const contact = contacts.data?.find(c => c.id === person)
    const existing = inbox.data?.find(c => c.other_id === person)
    if (contact || existing) {
      setSelected(contact ?? { id: existing!.other_id, full_name: existing!.full_name, role: existing!.role })
      setFindPerson(false)
      setParams({}, { replace: true })
    }
  }, [params, setParams, contacts.data, inbox.data, userId])
  const term = searchText(search)
  const matches = (person: ChatContact) => searchText(`${person.full_name} ${ROLE_LABELS[person.role]}`).includes(term)
  const unreadConversations = (inbox.data ?? []).filter(c => Number(c.unread_count) > 0).length
  function choose(person: ChatContact) { setSelected(person); setFindPerson(false); setSearch('') }
  return <div className={cn('messenger', selected && 'messenger--open')}>
    <div className="messenger-page-heading">
      <div><div className="messenger-eyebrow">KOMUNIKACJA ZESPOŁU</div><h1>Wiadomości</h1></div>
      <p>Dobry kontakt.<br /><strong>Sprawniejsza zmiana.</strong></p>
    </div>
    <div className="messenger-shell">
      <aside aria-label="Lista rozmów" className={cn('messenger-sidebar', selected ? 'hidden md:flex' : 'flex')}>
        <div className="messenger-sidebar-header">
          <div className="messenger-list-heading"><div><h2>{findPerson ? 'Nowa rozmowa' : 'Twoje rozmowy'}</h2><p>{findPerson ? 'Wybierz osobę z zespołu' : unreadConversations > 0 ? `Nieprzeczytane rozmowy: ${unreadConversations}` : 'Wszystkie rozmowy w jednym miejscu'}</p></div><button onClick={() => { setFindPerson(v => !v); setSelected(null); setSearch('') }} className="messenger-new-button" aria-label={findPerson ? 'Pokaż rozmowy' : 'Nowa rozmowa'} title={findPerson ? 'Pokaż rozmowy' : 'Nowa rozmowa'}>{findPerson ? <ArrowLeft size={20} /> : <Plus size={20} />}</button></div>
          <label className="messenger-search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} aria-label="Szukaj osoby" placeholder="Szukaj osoby lub roli…" /></label>
        </div>
        <div className="messenger-list">
          {(inbox.isError || contacts.isError) && <div role="alert" className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{inbox.error?.message ?? contacts.error?.message}<button className="mt-2 block underline" onClick={() => { void inbox.refetch(); void contacts.refetch() }}>Spróbuj ponownie</button></div>}
          {(findPerson ? contacts.isPending : inbox.isPending) && <p className="p-4 text-sm text-navy-400">Ładowanie…</p>}
          {findPerson ? (contacts.data ?? []).filter(matches).map(person => <button key={person.id} onClick={() => choose(person)} className="messenger-list-item"><Avatar name={person.full_name} /><span className="min-w-0 flex-1"><span className="messenger-contact-name">{person.full_name}</span><span className="messenger-contact-role">{ROLE_LABELS[person.role]}</span></span><ArrowUpRight size={16} className="messenger-contact-arrow" /></button>)
            : (inbox.data ?? []).filter(c => matches({ id: c.other_id, full_name: c.full_name, role: c.role })).map(c => <button key={c.id} onClick={() => choose({ id: c.other_id, full_name: c.full_name, role: c.role })} aria-current={selected?.id === c.other_id ? 'true' : undefined} className={cn('messenger-list-item', selected?.id === c.other_id && 'messenger-list-item--selected', Number(c.unread_count) > 0 && 'messenger-list-item--unread')}>
              <Avatar name={c.full_name} /><span className="min-w-0 flex-1"><span className="messenger-list-line"><span className="messenger-contact-name">{c.full_name}</span><span className="messenger-list-date">{new Date(c.last_message_at).toDateString() === new Date().toDateString() ? time(c.last_message_at) : new Date(c.last_message_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}</span></span><span className="messenger-contact-role">{ROLE_LABELS[c.role]}</span><span className="messenger-list-line mt-1.5"><span className="messenger-preview">{c.last_sender_id === userId ? 'Ty: ' : ''}{c.last_body}</span>{Number(c.unread_count) > 0 && <span className="messenger-unread" aria-label={`${c.unread_count} nieprzeczytanych`}>{c.unread_count > 99 ? '99+' : c.unread_count}</span>}</span></span>
            </button>)}
          {!findPerson && inbox.data?.length === 0 && <div className="p-6 text-center text-sm text-navy-400"><p>Tu pojawią się Twoje rozmowy.</p><button onClick={() => setFindPerson(true)} className="mt-4 text-brand underline">Wybierz osobę i napisz</button></div>}
          {findPerson && contacts.data && !contacts.data.some(matches) && <p className="p-6 text-sm text-navy-400">Nie znaleziono osób.</p>}
          {!findPerson && search && inbox.data && !inbox.data.some(c => matches({ id: c.other_id, full_name: c.full_name, role: c.role })) && <div className="p-6 text-sm text-navy-400">Brak takich rozmów. <button className="text-brand underline" onClick={() => setFindPerson(true)}>Szukaj wśród osób</button></div>}
        </div>
        <ChatPushSettings userId={userId} />
        <div className="messenger-sidebar-footer"><LockKeyhole size={13} />Rozmowy tylko dla uczestników</div>
      </aside>
      {currentContact ? <Conversation key={`${userId}:${currentContact.id}`} userId={userId} contact={currentContact} conversation={conversation}
        draft={drafts[currentContact.id]?.body ?? ''} requestId={drafts[currentContact.id]?.id ?? ''}
        setDraft={value => setDrafts(prev => ({ ...prev, [currentContact.id]: { body: value, id: crypto.randomUUID() } }))}
        onSent={id => setDrafts(prev => prev[currentContact.id]?.id === id ? { ...prev, [currentContact.id]: { body: '', id: '' } } : prev)}
        onBack={() => setSelected(null)} />
        : <div className="messenger-welcome hidden md:flex"><div className="messenger-welcome-icon"><MessageCircle size={48} strokeWidth={1.3} /></div><span className="messenger-eyebrow">BLIŻEJ ZESPOŁU</span><h2>Rozmowa zaczyna się<br />od jednej wiadomości.</h2><p>Zapytaj operatora, skontaktuj się z kierownikiem<br className="hidden lg:block" /> lub przekaż ważną informację zespołowi.</p><button onClick={() => setFindPerson(true)} className="messenger-start-button"><Plus size={18} />Nowa rozmowa</button><span className="messenger-welcome-note"><LockKeyhole size={13} />Widoczna tylko dla Ciebie i rozmówcy</span></div>}
    </div>
  </div>
}

export default function Messages() {
  const profile = useAuthStore(s => s.profile)
  return profile ? <Messenger key={profile.id} userId={profile.id} /> : null
}
