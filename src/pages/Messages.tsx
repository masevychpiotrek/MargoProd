import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCheck, MessageCircle, Plus, Search, Send } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useChatInbox } from '@/hooks/useMessenger'
import { chatContacts, chatMarkRead, chatMessages, chatSend } from '@/lib/messenger'
import type { ChatContact, ChatConversation } from '@/lib/messenger'
import { cn, ROLE_LABELS } from '@/lib/utils'

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase() }
function time(value: string) { return new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) }
function date(value: string) { return new Date(value).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }) }
function searchText(value: string) { return value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l') }

function Avatar({ name }: { name: string }) {
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-sm font-bold text-brand" aria-hidden="true">{initials(name)}</span>
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
    <section aria-label={`Rozmowa z ${contact.full_name}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-navy-950/40">
      <header className="flex items-center gap-3 border-b border-navy-700 bg-navy-800 p-4">
        <button type="button" onClick={onBack} aria-label="Wróć do rozmów" className="rounded-lg p-2 text-navy-300 hover:bg-navy-700 md:hidden"><ArrowLeft size={20} /></button>
        <Avatar name={contact.full_name} />
        <div className="min-w-0"><h2 className="truncate font-bold text-white">{contact.full_name}</h2><p className="text-xs text-navy-400">{ROLE_LABELS[contact.role]} · rozmowa prywatna</p></div>
      </header>
      <div ref={scroller} onScroll={e => {
        const el = e.currentTarget
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60)
      }} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" role="log" aria-label="Historia wiadomości" aria-live="polite">
        {history.hasNextPage && <button className="mx-auto mb-4 block rounded-full border border-navy-600 px-4 py-2 text-xs text-navy-200 disabled:opacity-50" disabled={history.isFetchingNextPage} onClick={() => void older()}>Wczytaj starsze wiadomości</button>}
        {conversationId && history.isPending && <p className="text-center text-sm text-navy-400">Ładowanie wiadomości…</p>}
        {history.isError && <div role="alert" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{history.error.message} <button className="underline" onClick={() => void history.refetch()}>Ponów</button></div>}
        {!messages.length && !history.isError && (!conversationId || !history.isPending) && <div className="py-12 text-center text-navy-400"><MessageCircle className="mx-auto mb-3 text-brand" size={36} /><p>Napisz pierwszą wiadomość.</p><p className="mt-2 text-xs">Zobaczysz ją tutaj razem z odpowiedzią.</p></div>}
        {messages.map((message, index) => {
          const mine = message.sender_id === userId
          const read = mine && message.seq <= Number(conversation?.other_read_seq ?? 0)
          return <div key={message.id}>
            {(index === 0 || date(messages[index - 1].created_at) !== date(message.created_at)) && <p className="my-5 text-center text-[11px] text-navy-400">{date(message.created_at)}</p>}
            <div className={cn('mb-3 flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[90%] rounded-2xl border px-4 py-3 sm:max-w-[75%]', mine ? 'rounded-br-sm border-brand/25 bg-brand/10' : 'rounded-bl-sm border-navy-600 bg-navy-800')}>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white [overflow-wrap:anywhere]">{message.body}</p>
                <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-navy-400">
                  <time dateTime={message.created_at}>{time(message.created_at)}</time>
                  {mine && <span className={cn('inline-flex items-center gap-1', read && 'text-brand')} title={read ? 'Odczytano' : 'Wysłano'}>{read ? <CheckCheck size={14} /> : <Check size={14} />}{read ? 'Odczytano' : 'Wysłano'}</span>}
                </div>
              </div>
            </div>
          </div>
        })}
      </div>
      {!atBottom && <button onClick={() => setAtBottom(true)} className="mx-auto mb-2 rounded-full bg-brand px-4 py-2 text-xs font-bold text-navy-950">Przejdź do najnowszych wiadomości ↓</button>}
      <form onSubmit={e => { e.preventDefault(); submit() }} className="border-t border-navy-700 bg-navy-800 p-3 sm:p-4">
        {send.isError && <p role="alert" className="mb-2 text-sm text-red-300">{send.error.message} Kliknij Wyślij, aby ponowić.</p>}
        {readError && <p role="status" className="mb-2 text-xs text-amber-300">{readError}</p>}
        {conversation?.can_send === false && <p className="mb-2 text-sm text-amber-300">Konto tej osoby jest nieaktywne. Historia rozmowy pozostaje dostępna.</p>}
        <div className="flex items-end gap-2">
          <textarea ref={composer} value={draft} onChange={e => { setDraft(e.target.value); if (send.isError) send.reset() }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
            aria-label="Treść wiadomości" placeholder="Napisz wiadomość…" rows={2} maxLength={4000}
            disabled={send.isPending || conversation?.can_send === false}
            className="input min-w-0 flex-1 resize-none disabled:opacity-50" />
          <button type="submit" disabled={!draft.trim() || send.isPending || conversation?.can_send === false} className="btn-primary flex h-12 shrink-0 items-center gap-2 px-4 disabled:opacity-40" aria-label="Wyślij wiadomość"><Send size={18} /><span className="hidden sm:inline">{send.isPending ? 'Wysyłanie…' : 'Wyślij'}</span></button>
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-navy-400"><span>Enter — wyślij · Shift+Enter — nowy wiersz</span><span>{draft.length}/4000</span></div>
      </form>
    </section>
  )
}

function Messenger({ userId }: { userId: string }) {
  const inbox = useChatInbox()
  const contacts = useQuery({ queryKey: ['chat', userId, 'contacts'], queryFn: chatContacts, staleTime: 30000, retry: 1 })
  const [selected, setSelected] = useState<ChatContact | null>(null)
  const [findPerson, setFindPerson] = useState(false)
  const [search, setSearch] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { body: string; id: string }>>({})
  const conversation = inbox.data?.find(c => c.other_id === selected?.id)
  const currentContact = selected ? (contacts.data?.find(c => c.id === selected.id) ?? selected) : null
  const term = searchText(search)
  const matches = (person: ChatContact) => searchText(`${person.full_name} ${ROLE_LABELS[person.role]}`).includes(term)
  function choose(person: ChatContact) { setSelected(person); setFindPerson(false); setSearch('') }
  return <div className="mx-auto max-w-7xl">
    <div className="mb-4 flex items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-white">Wiadomości</h1><p className="mt-1 text-sm text-navy-400">Porozmawiaj z operatorem, kierownikiem lub zespołem.</p></div></div>
    <div className="flex h-[calc(100dvh-190px)] min-h-[400px] overflow-hidden rounded-2xl border border-navy-700 bg-navy-800">
      <aside aria-label="Lista rozmów" className={cn('flex min-h-0 w-full shrink-0 flex-col border-r border-navy-700 md:w-80', selected ? 'hidden md:flex' : 'flex')}>
        <div className="border-b border-navy-700 p-4">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-white">{findPerson ? 'Nowa rozmowa' : 'Twoje rozmowy'}</h2><button onClick={() => { setFindPerson(v => !v); setSelected(null); setSearch('') }} className="rounded-lg bg-brand/15 p-2 text-brand" aria-label={findPerson ? 'Pokaż rozmowy' : 'Nowa rozmowa'}>{findPerson ? <ArrowLeft size={18} /> : <Plus size={18} />}</button></div>
          <label className="relative block"><Search className="absolute left-3 top-3 text-navy-400" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} aria-label="Szukaj osoby" placeholder="Szukaj osoby lub roli…" className="input w-full pl-9" /></label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(inbox.isError || contacts.isError) && <div role="alert" className="m-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{inbox.error?.message ?? contacts.error?.message}<button className="mt-2 block underline" onClick={() => { void inbox.refetch(); void contacts.refetch() }}>Spróbuj ponownie</button></div>}
          {(findPerson ? contacts.isPending : inbox.isPending) && <p className="p-4 text-sm text-navy-400">Ładowanie…</p>}
          {findPerson ? (contacts.data ?? []).filter(matches).map(person => <button key={person.id} onClick={() => choose(person)} className="flex w-full items-center gap-3 border-b border-navy-700/50 p-4 text-left hover:bg-navy-700/50"><Avatar name={person.full_name} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{person.full_name}</span><span className="text-xs text-navy-400">{ROLE_LABELS[person.role]}</span></span></button>)
            : (inbox.data ?? []).filter(c => matches({ id: c.other_id, full_name: c.full_name, role: c.role })).map(c => <button key={c.id} onClick={() => choose({ id: c.other_id, full_name: c.full_name, role: c.role })} className={cn('flex w-full items-center gap-3 border-b border-navy-700/50 p-4 text-left hover:bg-navy-700/50', selected?.id === c.other_id && 'bg-brand/10')}>
              <Avatar name={c.full_name} /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-white">{c.full_name}</span><span className="shrink-0 text-[10px] text-navy-400">{new Date(c.last_message_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' })}</span></span><span className="mt-1 block truncate text-xs text-navy-400">{c.last_sender_id === userId ? 'Ty: ' : ''}{c.last_body}</span></span>
              {Number(c.unread_count) > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-navy-950" aria-label={`${c.unread_count} nieprzeczytanych`}>{c.unread_count}</span>}
            </button>)}
          {!findPerson && inbox.data?.length === 0 && <div className="p-6 text-center text-sm text-navy-400"><p>Tu pojawią się Twoje rozmowy.</p><button onClick={() => setFindPerson(true)} className="mt-4 text-brand underline">Wybierz osobę i napisz</button></div>}
          {findPerson && contacts.data && !contacts.data.some(matches) && <p className="p-6 text-sm text-navy-400">Nie znaleziono osób.</p>}
          {!findPerson && search && inbox.data && !inbox.data.some(c => matches({ id: c.other_id, full_name: c.full_name, role: c.role })) && <div className="p-6 text-sm text-navy-400">Brak takich rozmów. <button className="text-brand underline" onClick={() => setFindPerson(true)}>Szukaj wśród osób</button></div>}
        </div>
      </aside>
      {currentContact ? <Conversation key={`${userId}:${currentContact.id}`} userId={userId} contact={currentContact} conversation={conversation}
        draft={drafts[currentContact.id]?.body ?? ''} requestId={drafts[currentContact.id]?.id ?? ''}
        setDraft={value => setDrafts(prev => ({ ...prev, [currentContact.id]: { body: value, id: crypto.randomUUID() } }))}
        onSent={id => setDrafts(prev => prev[currentContact.id]?.id === id ? { ...prev, [currentContact.id]: { body: '', id: '' } } : prev)}
        onBack={() => setSelected(null)} />
        : <div className="hidden flex-1 flex-col items-center justify-center px-8 text-center md:flex"><div className="mb-5 rounded-3xl bg-brand/10 p-6"><MessageCircle size={48} className="text-brand" /></div><h2 className="text-xl font-bold text-white">Jesteście w kontakcie</h2><p className="mt-3 max-w-sm text-sm leading-relaxed text-navy-400">Wybierz rozmowę lub rozpocznij nową. Wiadomości i historię widzisz tylko Ty i Twój rozmówca.</p><button onClick={() => setFindPerson(true)} className="btn-primary mt-6 flex items-center gap-2 px-5 py-3"><Plus size={18} />Nowa rozmowa</button></div>}
    </div>
  </div>
}

export default function Messages() {
  const profile = useAuthStore(s => s.profile)
  return profile ? <Messenger key={profile.id} userId={profile.id} /> : null
}
