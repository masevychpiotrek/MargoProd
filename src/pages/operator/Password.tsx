import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, logAudit } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

const REQUEST_TIMEOUT_MS = 15000

function withTimeout<T>(promise: PromiseLike<T>, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS)
  })

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timeoutId))
}

export default function OperatorPassword() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile } = useAuthStore()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!user?.email) {
      setError('Brak aktywnej sesji operatora')
      return
    }
    if (!currentPassword) {
      setError('Wpisz obecne haslo')
      return
    }
    if (newPassword.length < 8) {
      setError('Nowe haslo musi miec minimum 8 znakow')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Nowe haslo i potwierdzenie nie sa takie same')
      return
    }
    if (currentPassword === newPassword) {
      setError('Nowe haslo musi byc inne niz obecne')
      return
    }

    setSaving(true)
    try {
      const { error: verifyError } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword
        }),
        'Logowanie kontrolne trwa zbyt dlugo. Sprawdz internet i sprobuj ponownie.'
      )
      if (verifyError) {
        setError('Obecne haslo jest nieprawidlowe')
        return
      }

      const { error: updateError } = await withTimeout(
        supabase.auth.updateUser({ password: newPassword }),
        'Zmiana hasla trwa zbyt dlugo. Sprobuj ponownie za chwile.'
      )
      if (updateError) {
        setError(updateError.message)
        return
      }

      const { error: profileError } = await withTimeout(
        supabase
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', user.id),
        'Haslo zmienione, ale system zbyt dlugo zdejmowal blokade pierwszego logowania.'
      )
      if (profileError) {
        setError('Haslo zmienione, ale nie udalo sie zdjac blokady pierwszego logowania. Skontaktuj sie z administratorem.')
        return
      }

      void logAudit('password_change')
      await withTimeout(
        refreshProfile(),
        'Haslo zmienione, ale odswiezenie profilu trwa zbyt dlugo. Odswiez strone i zaloguj sie nowym haslem.'
      )
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess('Haslo zostalo zmienione. Uzyj nowego hasla przy kolejnym logowaniu.')
      setTimeout(() => {
        if (profile?.role === 'admin') navigate('/admin', { replace: true })
        else if (profile?.role === 'manager') navigate('/manager', { replace: true })
        else if (profile?.role === 'specialist') navigate('/specialist', { replace: true })
        else navigate('/operator', { replace: true })
      }, 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udalo sie zmienic hasla. Sprobuj ponownie.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Zmien haslo</h1>
        <p className="mt-1 text-navy-400">
          {profile?.must_change_password
            ? 'System wymaga ustawienia nowego hasla przed dalsza praca.'
            : 'Aktualizacja hasla do konta.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="label">Obecne haslo</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className="input"
          />
        </div>

        <div>
          <label className="label">Nowe haslo</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className="input"
          />
          <div className="mt-1 text-xs text-navy-500">Minimum 8 znakow.</div>
        </div>

        <div>
          <label className="label">Powtorz nowe haslo</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className="input"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">
            {success}
          </div>
        )}

        <button type="submit" disabled={saving} className="btn-primary w-full py-3 disabled:opacity-50">
          {saving ? 'Zapisywanie...' : 'Zmien haslo'}
        </button>
      </form>
    </div>
  )
}
