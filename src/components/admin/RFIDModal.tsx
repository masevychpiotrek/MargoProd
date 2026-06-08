import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type RFIDModalProps = {
  userId: string
  userName: string
  currentRfid: string | null
  onClose: () => void
  onSaved: (rfid: string | null) => void
}

type ScanStatus = 'idle' | 'scanning' | 'saving' | 'saved' | 'error'

function cleanUid(value: string) {
  return value.replace(/\s/g, '').trim()
}

export default function RFIDModal({ userId, userName, currentRfid, onClose, onSaved }: RFIDModalProps) {
  const [scannedUid, setScannedUid] = useState('')
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const bufferRef = useRef('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (status !== 'scanning') return

    const resetBufferSoon = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        bufferRef.current = ''
      }, 700)
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setStatus('idle')
        bufferRef.current = ''
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const uid = cleanUid(bufferRef.current)
        bufferRef.current = ''
        if (uid) {
          setScannedUid(uid)
          setStatus('idle')
        }
        return
      }

      if (event.key.length !== 1) return
      event.preventDefault()
      event.stopPropagation()
      bufferRef.current += event.key
      resetBufferSoon()
    }

    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [status])

  const startScan = () => {
    bufferRef.current = ''
    setScannedUid('')
    setErrorMsg('')
    setStatus('scanning')
  }

  const saveRfid = async () => {
    const uid = cleanUid(scannedUid)
    if (!uid) return
    setStatus('saving')
    setErrorMsg('')

    const { data: existing, error: existingError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('rfid_uid', uid)
      .neq('id', userId)
      .is('deleted_at', null)
      .maybeSingle()

    if (existingError) {
      setErrorMsg(existingError.message)
      setStatus('error')
      return
    }

    if (existing) {
      setErrorMsg(`Ten identyfikator jest juz przypisany do: ${existing.full_name}`)
      setStatus('error')
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({ rfid_uid: uid })
      .eq('id', userId)

    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
      return
    }

    setScannedUid(uid)
    setStatus('saved')
    onSaved(uid)
  }

  const removeRfid = async () => {
    setStatus('saving')
    setErrorMsg('')

    const { error } = await supabase
      .from('profiles')
      .update({ rfid_uid: null })
      .eq('id', userId)

    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
      return
    }

    setScannedUid('')
    setStatus('saved')
    onSaved(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.86)', backdropFilter: 'blur(8px)' }}>
      <div className="card w-full max-w-md">
        <div className="card-header">
          <div>
            <div className="card-title">Karta RFID</div>
            <div className="card-sub">{userName}</div>
          </div>
          <button className="btn-secondary text-xs py-1.5 px-3" onClick={onClose}>Zamknij</button>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-navy-700 bg-navy-900 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-500">Aktualny identyfikator</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              {currentRfid ? (
                <>
                  <div className="font-mono text-sm font-bold text-green-400">{currentRfid}</div>
                  <button className="btn-danger text-xs py-1.5 px-3" onClick={removeRfid} disabled={status === 'saving'}>
                    Usun
                  </button>
                </>
              ) : (
                <div className="text-sm italic text-navy-500">Brak przypisanej karty</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-navy-700 bg-navy-900 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-navy-500">
              {currentRfid ? 'Zmien karte' : 'Przypisz karte'}
            </div>

            {status === 'scanning' ? (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-center">
                <div className="mx-auto mb-3 h-12 w-12 rounded-full border border-amber-500/50 bg-amber-500/15 animate-pulse" />
                <div className="font-bold text-amber-300">Przyloz karte do czytnika</div>
                <div className="mt-1 text-xs text-navy-400">Odczyt zostanie przechwycony automatycznie</div>
              </div>
            ) : scannedUid ? (
              <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                <div className="text-xs font-bold uppercase tracking-wider text-blue-300">Odczytano UID</div>
                <div className="mt-1 font-mono text-sm font-bold text-white">{scannedUid}</div>
              </div>
            ) : (
              <button className="btn-secondary mt-4 w-full py-3" onClick={startScan}>
                Skanuj karte
              </button>
            )}

            {scannedUid && status !== 'saved' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="btn-primary py-2.5" onClick={saveRfid} disabled={status === 'saving'}>
                  {status === 'saving' ? 'Zapisywanie...' : 'Zapisz RFID'}
                </button>
                <button className="btn-secondary py-2.5" onClick={startScan} disabled={status === 'saving'}>
                  Skanuj ponownie
                </button>
              </div>
            )}
          </div>

          {status === 'saved' && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
              Karta RFID zostala zapisana.
            </div>
          )}
          {status === 'error' && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {errorMsg || 'Nie udalo sie zapisac RFID.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
