import { useState } from 'react'
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
  const { user, profile, refreshProfile } = useAuthStore()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!user?.id) {
      setError('Brak aktywnej sesji operatora')
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

    setSaving(true)
    try {
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
      if (profile) {
        useAuthStore.setState({ profile: { ...profile, must_change_password: false } })
      }
      void refreshProfile()
      setNewPassword('')
      setConfirmPassword('')
      setSuccess('Haslo zostalo zmienione. Uzyj nowego hasla przy kolejnym logowaniu.')
      const nextPath =
        profile?.role === 'admin' ? '/admin' :
        profile?.role === 'manager' ? '/manager' :
        profile?.role === 'specialist' ? '/specialist' :
        '/operator'
      window.location.replace(nextPath)
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

      <form onSubmit={handleSubmit} className="card space-y-4" autoComplete="off">
        <div>
          <label className="label">Nowe haslo</label>
          <input
            type="password"
            name="ml_access_code_new"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            autoComplete="one-time-code"
            data-lpignore="true"
            data-1p-ignore="true"
            className="input"
          />
          <div className="mt-1 text-xs text-navy-500">Minimum 8 znakow.</div>
        </div>

        <div>
          <label className="label">Powtorz nowe haslo</label>
          <input
            type="password"
            name="ml_access_code_confirm"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="one-time-code"
            data-lpignore="true"
            data-1p-ignore="true"
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
