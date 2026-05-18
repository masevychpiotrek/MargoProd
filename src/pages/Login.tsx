import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/stores/authStore'

const schema = z.object({
  email: z.string().email('Podaj prawidłowy adres e-mail'),
  password: z.string().min(1, 'Hasło jest wymagane')
})
type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const navigate = useNavigate()
  const { signIn, isLoading } = useAuthStore()
  const [serverError, setServerError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  })

  const onSubmit = async (data: FormData) => {
    setServerError(null)
    const { error } = await signIn(data.email, data.password)
    if (error) {
      setServerError(error)
      return
    }
    navigate('/operator')
  }

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-brand/5 to-transparent pointer-events-none" />

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand to-blue-400 mb-4 shadow-lg shadow-brand/25">
            <span className="text-2xl">🏭</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">MargoProd</h1>
          <p className="text-navy-200 mt-1 text-sm">System Monitorowania Produkcji</p>
        </div>

        {/* Card */}
        <div className="bg-navy-800 border border-navy-600 rounded-2xl p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Logowanie</h2>
            <p className="text-navy-200 text-sm mt-1">Wpisz e-mail i hasło aby kontynuować</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-navy-200 uppercase tracking-wider mb-2">
                Adres e-mail
              </label>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                placeholder="twoje.imie@margomed.pl"
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
              />
              {errors.email && (
                <p className="text-red-400 text-xs mt-1.5">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-navy-200 uppercase tracking-wider mb-2">
                Hasło
              </label>
              <input
                {...register('password')}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••"
                className="w-full bg-navy-900 border border-navy-600 rounded-xl px-4 py-3 text-white placeholder-navy-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all"
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
              className="w-full bg-brand hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-brand/20 mt-2"
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

          <div className="mt-6 pt-5 border-t border-navy-600">
            <p className="text-xs text-navy-400 text-center">
              Domyślne hasło: <span className="text-navy-200 font-mono">Margomed123</span>
            </p>
            <p className="text-xs text-navy-500 text-center mt-1">
              Zmień hasło po pierwszym logowaniu w ustawieniach profilu
            </p>
          </div>
        </div>

        <p className="text-center text-navy-500 text-xs mt-6">
          MargoProd MES v1.0 · Margomed
        </p>
      </div>
    </div>
  )
}
