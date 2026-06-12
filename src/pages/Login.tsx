import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'
import LoadingScreen from '@/components/shared/LoadingScreen'

const schema = z.object({
  email: z.string().email('Podaj prawidlowy adres e-mail'),
  password: z.string().min(1, 'Haslo jest wymagane')
})

type FormData = z.infer<typeof schema>
type LoginMode = 'password' | 'rfid'

const HexLogo = () => (
  <svg width="32" height="32" viewBox="0 0 22 22" fill="none">
    <path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z" stroke="#c9a84c" strokeWidth="1.5" fill="none"/>
    <path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15" stroke="#c9a84c" strokeWidth="0.75" opacity="0.25"/>
    <circle cx="11" cy="11" r="2.5" fill="#c9a84c"/>
  </svg>
)

function shouldSkipIntro() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 1024px), (pointer: coarse)').matches
}

function initials(name?: string) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?'
}

function mapRfidError(message: string) {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('rfid_not_found') ||
    normalized.includes('not found') ||
    normalized.includes('404') ||
    normalized.includes('nieznany')
  ) {
    return 'Odmowa dostepu. Identyfikator nie jest przypisany do konta.'
  }
  return message || 'Odmowa dostepu.'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn, signInWithRfid } = useAuthStore()
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('password')
  const [rfidCode, setRfidCode] = useState('')
  const [rfidName, setRfidName] = useState('')
  const [rfidStatus, setRfidStatus] = useState<'idle' | 'reading' | 'found' | 'error'>('idle')
  const [rfidError, setRfidError] = useState('')
  const rfidInputRef = useRef<HTMLInputElement | null>(null)
  const scannerBufferRef = useRef('')
  const scannerTimerRef = useRef<number | null>(null)
  const [showForm, setShowForm] = useState(() =>
    shouldSkipIntro() || !!sessionStorage.getItem('ml-intro-shown')
  )

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  const resetRfid = () => {
    setRfidCode('')
    setRfidName('')
    setRfidError('')
    setRfidStatus('idle')
    scannerBufferRef.current = ''
    if (scannerTimerRef.current) {
      window.clearTimeout(scannerTimerRef.current)
      scannerTimerRef.current = null
    }
  }

  const onSubmit = async (data: FormData) => {
    if (submitting) return
    setSubmitting(true)
    setServerError(null)
    try {
      const { error } = await signIn(data.email, data.password)
      if (error) {
        setServerError(error)
        return
      }
      navigate('/', { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRfidLookup = useCallback(async (rawCode = rfidCode) => {
    const code = rawCode.trim()
    if (!code || submitting || rfidStatus === 'reading') return
    setRfidStatus('reading')
    setRfidError('')
    setRfidName('')
    sessionStorage.setItem('ml-rfid-welcome-until', String(Date.now() + 2200))

    try {
      const { error, fullName } = await signInWithRfid(code)
      if (error) {
        sessionStorage.removeItem('ml-rfid-welcome-until')
        setRfidStatus('error')
        setRfidError(mapRfidError(error))
        setRfidCode('')
        scannerBufferRef.current = ''
        window.setTimeout(() => resetRfid(), 1900)
        window.setTimeout(() => rfidInputRef.current?.focus(), 2000)
        return
      }

      setRfidName(fullName || '')
      setRfidStatus('found')
      window.setTimeout(() => {
        sessionStorage.removeItem('ml-rfid-welcome-until')
        navigate('/', { replace: true })
      }, 1600)
    } catch (e) {
      sessionStorage.removeItem('ml-rfid-welcome-until')
      setRfidStatus('error')
      setRfidError(mapRfidError(e instanceof Error ? e.message : 'Blad odczytu RFID.'))
      setRfidCode('')
      scannerBufferRef.current = ''
      window.setTimeout(() => resetRfid(), 1900)
      window.setTimeout(() => rfidInputRef.current?.focus(), 2000)
    }
  }, [navigate, rfidCode, rfidStatus, signInWithRfid, submitting])

  useEffect(() => {
    if (loginMode !== 'rfid' || rfidStatus === 'found') return
    const timer = window.setTimeout(() => rfidInputRef.current?.focus(), 100)
    return () => window.clearTimeout(timer)
  }, [loginMode, rfidStatus])

  useEffect(() => {
    if (loginMode !== 'rfid') return

    const clearScannerBufferSoon = () => {
      if (scannerTimerRef.current) window.clearTimeout(scannerTimerRef.current)
      scannerTimerRef.current = window.setTimeout(() => {
        scannerBufferRef.current = ''
        setRfidCode('')
      }, 700)
    }

    const handleScannerKey = (event: KeyboardEvent) => {
      if (rfidStatus === 'reading' || rfidStatus === 'found') {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const code = scannerBufferRef.current.trim() || rfidCode.trim()
        scannerBufferRef.current = ''
        setRfidCode('')
        void handleRfidLookup(code)
        return
      }

      if (event.key.length !== 1) return
      event.preventDefault()
      event.stopPropagation()
      scannerBufferRef.current += event.key
      setRfidCode(scannerBufferRef.current)
      clearScannerBufferSoon()
    }

    window.addEventListener('keydown', handleScannerKey, true)
    return () => window.removeEventListener('keydown', handleScannerKey, true)
  }, [handleRfidLookup, loginMode, rfidCode, rfidStatus])

  useEffect(() => {
    return () => {
      if (scannerTimerRef.current) window.clearTimeout(scannerTimerRef.current)
    }
  }, [])

  if (!showForm) {
    return <LoadingScreen onLogin={() => {
      sessionStorage.setItem('ml-intro-shown', '1')
      setShowForm(true)
    }} />
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: 'radial-gradient(ellipse at 50% 0%, rgba(201,168,76,0.13) 0%, #0d1117 55%)',
      backgroundColor: '#0d1117'
    }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(201,168,76,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(201,168,76,0.04) 1px, transparent 1px)',
        backgroundSize: '32px 32px'
      }} />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg" style={{
            background: '#161c26',
            border: '1.5px solid rgba(201,168,76,0.4)',
            boxShadow: '0 0 32px rgba(201,168,76,0.12)'
          }}>
            <HexLogo />
          </div>
          <div className="flex items-center justify-center gap-2 mb-1">
            <h1 className="text-3xl font-bold text-white tracking-tight">MargoLine</h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{
              background: 'rgba(201,168,76,0.15)',
              color: '#c9a84c',
              border: '1px solid rgba(201,168,76,0.3)'
            }}>BETA</span>
          </div>
          <p className="text-sm" style={{ color: '#6b7f99' }}>System Monitorowania Produkcji</p>
          <p
            className="mt-3 text-[11px] font-semibold uppercase"
            style={{
              color: '#c9a84c',
              letterSpacing: '0.28em',
              fontFamily: 'Georgia, Cambria, serif',
              textShadow: '0 0 20px rgba(201,168,76,0.18)'
            }}
          >
            From years. For years. Quality.
          </p>
        </div>

        <div className="rounded-2xl p-8 shadow-2xl" style={{
          background: 'rgba(22,28,38,0.9)',
          border: '1px solid rgba(201,168,76,0.15)',
          backdropFilter: 'blur(12px)'
        }}>
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Logowanie</h2>
            <p className="text-sm mt-1" style={{ color: '#6b7f99' }}>
              {loginMode === 'rfid' ? 'Przyloz identyfikator, aby wejsc do systemu' : 'Wpisz e-mail i haslo, aby kontynuowac'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5 rounded-xl p-1" style={{ background: '#0d1117', border: '1px solid #263145' }}>
            <button
              type="button"
              onClick={() => {
                setLoginMode('password')
                resetRfid()
              }}
              className="rounded-lg py-2 text-sm font-bold transition-all"
              style={{
                background: loginMode === 'password' ? 'rgba(201,168,76,0.18)' : 'transparent',
                color: loginMode === 'password' ? '#f3d77a' : '#8899bb',
                border: loginMode === 'password' ? '1px solid rgba(201,168,76,0.35)' : '1px solid transparent'
              }}
            >
              Haslo
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginMode('rfid')
                resetRfid()
              }}
              className="rounded-lg py-2 text-sm font-bold transition-all"
              style={{
                background: loginMode === 'rfid' ? 'rgba(201,168,76,0.18)' : 'transparent',
                color: loginMode === 'rfid' ? '#f3d77a' : '#8899bb',
                border: loginMode === 'rfid' ? '1px solid rgba(201,168,76,0.35)' : '1px solid transparent'
              }}
            >
              RFID
            </button>
          </div>

          {loginMode === 'rfid' && (
            <div className="overflow-hidden rounded-2xl p-6 text-center" style={{
              background: 'linear-gradient(180deg, rgba(201,168,76,0.10), rgba(13,17,23,0.45))',
              border: '1px solid rgba(201,168,76,0.25)'
            }}>
              <div className="relative mx-auto mb-5 flex h-32 w-32 items-center justify-center">
                <div className="absolute inset-0 rounded-full transition-all duration-300" style={{
                  background: rfidStatus === 'error'
                    ? 'radial-gradient(circle, rgba(239,68,68,0.28), transparent 68%)'
                    : rfidStatus === 'found'
                      ? 'radial-gradient(circle, rgba(34,197,94,0.25), transparent 68%)'
                      : 'radial-gradient(circle, rgba(201,168,76,0.18), transparent 68%)'
                }} />
                {rfidStatus !== 'found' && (
                  <div className="absolute inset-2 rounded-full animate-ping" style={{
                    border: `1px solid ${rfidStatus === 'error' ? 'rgba(248,113,113,0.65)' : 'rgba(201,168,76,0.30)'}`
                  }} />
                )}
                <div className="absolute inset-5 rounded-full transition-all duration-300" style={{
                  border: `1px solid ${rfidStatus === 'error' ? 'rgba(248,113,113,0.45)' : rfidStatus === 'found' ? 'rgba(74,222,128,0.42)' : 'rgba(201,168,76,0.22)'}`
                }} />
                <div className="absolute inset-x-4 h-px animate-pulse" style={{
                  background: rfidStatus === 'error'
                    ? 'linear-gradient(90deg, transparent, rgba(248,113,113,0.95), transparent)'
                    : rfidStatus === 'found'
                      ? 'linear-gradient(90deg, transparent, rgba(74,222,128,0.95), transparent)'
                      : 'linear-gradient(90deg, transparent, rgba(201,168,76,0.85), transparent)'
                }} />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full shadow-2xl" style={{
                  background: rfidStatus === 'error'
                    ? 'linear-gradient(135deg, rgba(239,68,68,0.34), rgba(13,17,23,0.95))'
                    : rfidStatus === 'found'
                      ? 'linear-gradient(135deg, rgba(34,197,94,0.28), rgba(13,17,23,0.95))'
                      : 'linear-gradient(135deg, rgba(201,168,76,0.18), rgba(13,17,23,0.95))',
                  border: `1px solid ${rfidStatus === 'error' ? 'rgba(248,113,113,0.70)' : rfidStatus === 'found' ? 'rgba(74,222,128,0.55)' : 'rgba(201,168,76,0.45)'}`,
                  color: rfidStatus === 'error' ? '#f87171' : rfidStatus === 'found' ? '#4ade80' : '#c9a84c',
                  boxShadow: rfidStatus === 'error' ? '0 0 42px rgba(239,68,68,0.26)' : rfidStatus === 'found' ? '0 0 38px rgba(34,197,94,0.18)' : '0 0 38px rgba(201,168,76,0.14)'
                }}>
                  {rfidStatus === 'found' ? (
                    <span className="text-2xl font-black tracking-wide">{initials(rfidName)}</span>
                  ) : rfidStatus === 'error' ? (
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6"/>
                    </svg>
                  ) : (
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                      <path d="M7 8.5a7 7 0 010 7M4.5 6a10.5 10.5 0 010 12M17 8.5a7 7 0 010 7M19.5 6a10.5 10.5 0 010 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                      <rect x="9" y="6" width="6" height="12" rx="2" stroke="currentColor" strokeWidth="1.6"/>
                    </svg>
                  )}
                </div>
              </div>
              <div className="text-2xl font-black text-white">
                {rfidStatus === 'error' ? 'Odmowa dostepu' : rfidStatus === 'found' ? `Witaj, ${rfidName || 'uzytkowniku'}` : rfidStatus === 'reading' ? 'Weryfikacja...' : 'Przyloz identyfikator'}
              </div>
              <div className="mt-2 text-sm" style={{ color: rfidStatus === 'error' ? '#f87171' : rfidStatus === 'found' ? '#4ade80' : '#8aa0c2' }}>
                {rfidStatus === 'error' ? 'Ten identyfikator nie ma dostepu do systemu' : rfidStatus === 'found' ? 'Dostep potwierdzony. Logowanie...' : 'System czeka na bezpieczny odczyt RFID'}
              </div>
              <input
                ref={rfidInputRef}
                value={rfidCode}
                onChange={e => setRfidCode(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleRfidLookup()
                  }
                }}
                className="sr-only"
                style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                aria-hidden="true"
                tabIndex={-1}
                autoComplete="off"
              />
              {rfidStatus !== 'found' && (
                <div className="mt-5 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.28em]" style={{ color: '#c9a84c' }}>
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: '#c9a84c' }} />
                  Oczekiwanie
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: '#c9a84c', animationDelay: '150ms' }} />
                </div>
              )}
              {rfidError && (
                <div className="mt-4 rounded-xl px-4 py-3 text-sm font-semibold text-red-200" style={{
                  background: 'rgba(239,68,68,0.14)',
                  border: '1px solid rgba(248,113,113,0.40)'
                }}>
                  {rfidError}
                </div>
              )}
            </div>
          )}

          {loginMode === 'password' && (
            <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#8899bb' }}>
                  Adres e-mail
                </label>
                <input
                  {...register('email')}
                  type="email"
                  autoComplete="email"
                  placeholder="twoje.imie@margomed.pl"
                  className="w-full rounded-xl px-4 py-3 text-white placeholder-navy-400 transition-all outline-none"
                  style={{ background: '#0d1117', border: '1px solid #263145' }}
                  onFocus={e => e.target.style.borderColor = '#c9a84c'}
                  onBlur={e => e.target.style.borderColor = '#263145'}
                />
                {errors.email && (
                  <p className="text-red-400 text-xs mt-1.5">{errors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#8899bb' }}>
                  Haslo
                </label>
                <input
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  className="w-full rounded-xl px-4 py-3 text-white placeholder-navy-400 transition-all outline-none"
                  style={{ background: '#0d1117', border: '1px solid #263145' }}
                  onFocus={e => e.target.style.borderColor = '#c9a84c'}
                  onBlur={e => e.target.style.borderColor = '#263145'}
                />
                {errors.password && (
                  <p className="text-red-400 text-xs mt-1.5">{errors.password.message}</p>
                )}
              </div>

              {serverError && (
                <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                  {serverError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full font-semibold py-3.5 rounded-xl transition-all mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'linear-gradient(135deg, #c9a84c, #9a7a2e)',
                  color: '#0d1117',
                  boxShadow: '0 4px 20px rgba(201,168,76,0.25)'
                }}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Logowanie...
                  </span>
                ) : 'Zaloguj sie'}
              </button>
            </form>
          )}

          {loginMode === 'password' && (
            <div className="mt-6 pt-5" style={{ borderTop: '1px solid #1e2736' }}>
              <p className="text-xs text-center" style={{ color: '#4a5568' }}>
                Domyslne haslo: <span className="font-mono" style={{ color: '#8899bb' }}>Margomed123</span>
              </p>
              <p className="text-xs text-center mt-1" style={{ color: '#374151' }}>
                Zmien haslo po pierwszym logowaniu w ustawieniach profilu
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#374151' }}>
          MargoLine beta - Margomed
        </p>
      </div>
    </div>
  )
}
