import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'
import LoadingScreen from '@/components/shared/LoadingScreen'
import { supabase } from '@/lib/supabase'

const schema = z.object({
  email: z.string().email('Podaj prawidłowy adres e-mail'),
  password: z.string().min(1, 'Hasło jest wymagane')
})
type FormData = z.infer<typeof schema>
type LoginMode = 'password' | 'rfid'
type RfidLookup = { email: string; full_name: string; role: string }

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

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn } = useAuthStore()
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loginMode, setLoginMode] = useState<LoginMode>('password')
  const [rfidCode, setRfidCode] = useState('')
  const [rfidUser, setRfidUser] = useState<RfidLookup | null>(null)
  const [rfidStatus, setRfidStatus] = useState<'idle' | 'reading' | 'found' | 'error'>('idle')
  const [rfidError, setRfidError] = useState('')
  const rfidInputRef = useRef<HTMLInputElement | null>(null)
  const [showForm, setShowForm] = useState(() =>
    shouldSkipIntro() || !!sessionStorage.getItem('ml-intro-shown')
  )

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  useEffect(() => {
    if (loginMode !== 'rfid') return
    const timer = window.setTimeout(() => rfidInputRef.current?.focus(), 100)
    return () => window.clearTimeout(timer)
  }, [loginMode, rfidStatus])

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

  const handleRfidLookup = async (rawCode = rfidCode) => {
    const code = rawCode.trim()
    if (!code || submitting) return
    setRfidStatus('reading')
    setRfidError('')
    setRfidUser(null)
    try {
      const { data, error } = await supabase.rpc('lookup_rfid_login', { p_rfid_uid: code })
      if (error) throw error
      const found = Array.isArray(data) ? data[0] as RfidLookup | undefined : undefined
      if (!found?.email) {
        setRfidStatus('error')
        setRfidError('Nieznany identyfikator RFID.')
        return
      }
      setValue('email', found.email, { shouldValidate: true })
      setRfidUser(found)
      setRfidStatus('found')
      window.setTimeout(() => {
        const password = document.querySelector<HTMLInputElement>('input[type="password"]')
        password?.focus()
      }, 100)
    } catch (e) {
      setRfidStatus('error')
      setRfidError(e instanceof Error ? e.message : 'Blad odczytu RFID.')
    }
  }

  // Najpierw animacja — po 14s pojawia się formularz
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
        </div>

        <div className="rounded-2xl p-8 shadow-2xl" style={{
          background: 'rgba(22,28,38,0.9)',
          border: '1px solid rgba(201,168,76,0.15)',
          backdropFilter: 'blur(12px)'
        }}>
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Logowanie</h2>
            <p className="text-sm mt-1" style={{ color: '#6b7f99' }}>Wpisz e-mail i hasło aby kontynuować</p>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-5 rounded-xl p-1" style={{ background: '#0d1117', border: '1px solid #263145' }}>
            <button
              type="button"
              onClick={() => setLoginMode('password')}
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
                setRfidCode('')
                setRfidError('')
                setRfidStatus('idle')
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
            <div className="mb-5 rounded-2xl p-5 text-center" style={{
              background: 'linear-gradient(180deg, rgba(201,168,76,0.10), rgba(13,17,23,0.45))',
              border: '1px solid rgba(201,168,76,0.25)'
            }}>
              <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center">
                <div className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(201,168,76,0.12)' }} />
                <div className="absolute inset-3 rounded-full" style={{ border: '1px solid rgba(201,168,76,0.25)' }} />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl" style={{
                  background: rfidStatus === 'found' ? 'rgba(34,197,94,0.16)' : '#111827',
                  border: `1px solid ${rfidStatus === 'found' ? 'rgba(34,197,94,0.45)' : 'rgba(201,168,76,0.35)'}`,
                  color: rfidStatus === 'found' ? '#4ade80' : '#c9a84c'
                }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="3" width="14" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/>
                    <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div className="font-bold text-white">
                {rfidStatus === 'found' ? 'Identyfikator rozpoznany' : 'Przyloz identyfikator RFID'}
              </div>
              <div className="mt-1 text-sm" style={{ color: rfidStatus === 'found' ? '#4ade80' : '#6b7f99' }}>
                {rfidUser ? `${rfidUser.full_name} - ${rfidUser.role}` : 'Czytnik wpisze kod automatycznie'}
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
                className="mt-4 w-full rounded-xl px-4 py-3 text-center font-mono text-white outline-none"
                style={{ background: '#0d1117', border: '1px solid #263145' }}
                placeholder="Oczekiwanie na tag..."
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => handleRfidLookup()}
                className="mt-3 w-full rounded-xl py-2.5 text-sm font-bold transition-all"
                style={{ background: 'rgba(201,168,76,0.16)', color: '#f3d77a', border: '1px solid rgba(201,168,76,0.25)' }}
              >
                Sprawdz identyfikator
              </button>
              {rfidError && <div className="mt-3 text-sm text-red-400">{rfidError}</div>}
            </div>
          )}

          <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#8899bb' }}>
                {loginMode === 'rfid' ? 'Konto rozpoznane z RFID' : 'Adres e-mail'}
              </label>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                readOnly={loginMode === 'rfid'}
                placeholder={loginMode === 'rfid' ? 'Najpierw przyloz identyfikator' : 'twoje.imie@margomed.pl'}
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
                Hasło
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
              ) : 'Zaloguj się'}
            </button>
          </form>

          <div className="mt-6 pt-5" style={{ borderTop: '1px solid #1e2736' }}>
            <p className="text-xs text-center" style={{ color: '#4a5568' }}>
              Domyślne hasło: <span className="font-mono" style={{ color: '#8899bb' }}>Margomed123</span>
            </p>
            <p className="text-xs text-center mt-1" style={{ color: '#374151' }}>
              Zmień hasło po pierwszym logowaniu w ustawieniach profilu
            </p>
          </div>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#374151' }}>
          MargoLine MES v1.0 · Margomed
        </p>
      </div>
    </div>
  )
}
