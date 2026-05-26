import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'
import LoadingScreen from '@/components/shared/LoadingScreen'

const schema = z.object({
  email: z.string().email('Podaj prawidłowy adres e-mail'),
  password: z.string().min(1, 'Hasło jest wymagane')
})
type FormData = z.infer<typeof schema>

const HexLogo = () => (
  <svg width="32" height="32" viewBox="0 0 22 22" fill="none">
    <path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z" stroke="#c9a84c" strokeWidth="1.5" fill="none"/>
    <path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15" stroke="#c9a84c" strokeWidth="0.75" opacity="0.25"/>
    <circle cx="11" cy="11" r="2.5" fill="#c9a84c"/>
  </svg>
)

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn, isLoading } = useAuthStore()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(() => !!sessionStorage.getItem('ml-intro-shown'))

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    localStorage.removeItem('margoline-auth')
    const { error } = await signIn(data.email, data.password)
    if (error) {
      setServerError(error)
      return
    }
    navigate('/', { replace: true })
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

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                {serverError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full font-semibold py-3.5 rounded-xl transition-all mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #c9a84c, #9a7a2e)',
                color: '#0d1117',
                boxShadow: '0 4px 20px rgba(201,168,76,0.25)'
              }}
            >
              {isLoading ? (
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
