import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ROLE_LABELS, cn } from '@/lib/utils'
import type { Profile, UserRole } from '@/types/database'

interface UserRow extends Profile {
  email?: string
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

const ROLES: UserRole[] = ['operator', 'manager', 'specialist', 'admin']
const OPERATORS = [
  'Marcel Pełczyński','Miłosz Pełczyński','Patryk Grelak','Damian Wiącek',
  'Agnieszka Kowalik','Kacper Wojciechowski','Michał Broniek','Szymon Jaślikowski',
  'Iwona Cichosz','Fabian Szlendak','Jakub Chodun','Mateusz Hulak',
  'Konrad Wabik','Michał Caban','Jakub Wadowski'
]

export default function AdminUsers() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [resetUser, setResetUser] = useState<UserRow | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // New user form
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('operator')
  const [newPass, setNewPass] = useState('Margomed123')

  useEffect(() => { loadUsers() }, [])

  const loadUsers = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').is('deleted_at', null).order('full_name')
    if (data) setUsers(data as UserRow[])
    setLoading(false)
  }

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (u.email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const handleToggleActive = async (user: UserRow) => {
    await supabase.from('profiles').update({ is_active: !user.is_active }).eq('id', user.id)
    setMsg(user.is_active ? `Konto ${user.full_name} dezaktywowane` : `Konto ${user.full_name} aktywowane`)
    loadUsers()
    setTimeout(() => setMsg(''), 3000)
  }

  const handleRoleChange = async (user: UserRow, role: UserRole) => {
    await supabase.from('profiles').update({ role }).eq('id', user.id)
    setMsg(`Rola ${user.full_name} zmieniona na ${ROLE_LABELS[role]}`)
    loadUsers()
    setTimeout(() => setMsg(''), 3000)
  }

  const handleResetPassword = async () => {
    if (!resetUser || !newPassword.trim()) return
    setSaving(true)
    const { error } = await supabase.rpc('reset_user_password', {
      p_user_id: resetUser.id,
      p_password: newPassword
    })
    if (error) {
      // Fallback: use admin SQL
      await supabase.from('audit_logs').insert({
        user_id: resetUser.id,
        action: 'password_change',
        table_name: 'auth.users',
        record_id: resetUser.id
      })
      setMsg(`Hasło ${resetUser.full_name} zostało zaznaczone do resetu — wykonaj w SQL Editor`)
    } else {
      setMsg(`Hasło ${resetUser.full_name} zmienione pomyślnie`)
    }
    setResetUser(null)
    setNewPassword('')
    setSaving(false)
    setTimeout(() => setMsg(''), 4000)
  }

  const handleAddUser = async () => {
    const email = newEmail.trim().toLowerCase()
    if (!newName.trim() || !email || !newPass) return
    if (!isValidEmail(email)) {
      setMsg('Blad: wpisz poprawny adres e-mail, np. j.chargot@margomed.com')
      setTimeout(() => setMsg(''), 5000)
      return
    }
    setSaving(true)
    const { error } = await supabase.rpc('create_user_with_profile', {
      p_email: email,
      p_password: newPass,
      p_name: newName.trim(),
      p_role: newRole
    })
    if (error) {
      setMsg('Błąd: ' + error.message)
    } else {
      setMsg(`Użytkownik ${newName} został dodany`)
      setShowAdd(false)
      setNewName(''); setNewEmail(''); setNewPass('Margomed123'); setNewRole('operator')
      loadUsers()
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 4000)
  }

  const handleDeleteUser = async (user: UserRow) => {
    if (!confirm(`Usunąć użytkownika ${user.full_name}? Ta operacja jest nieodwracalna.`)) return
    await supabase.from('profiles').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', user.id)
    setMsg(`Użytkownik ${user.full_name} usunięty`)
    loadUsers()
    setTimeout(() => setMsg(''), 3000)
  }

  const roleColor = (role: UserRole) => ({
    admin:    'bg-purple-500/15 text-purple-400 border-purple-500/20',
    manager:  'bg-blue-500/15 text-blue-400 border-blue-500/20',
    specialist: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    operator: 'bg-green-500/15 text-green-400 border-green-500/20'
  }[role])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Użytkownicy</h1>
          <p className="text-navy-400 mt-1">{users.length} kont w systemie</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary px-5 py-2.5">
          + Dodaj użytkownika
        </button>
      </div>

      {/* Success message */}
      {msg && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">{msg}</div>
      )}

      {/* Search */}
      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Szukaj po nazwie lub emailu..."
        className="input w-full max-w-sm"
      />

      {/* Users table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-navy-700">
                {['Użytkownik','Rola','Status','Akcje'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-bold text-navy-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="text-center py-8 text-navy-500">Ładowanie...</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id} className="border-b border-navy-800 hover:bg-navy-800/40">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-brand/20 flex items-center justify-center text-brand text-sm font-bold flex-shrink-0">
                        {u.full_name.slice(0,2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-white text-sm">{u.full_name}</div>
                        <div className="text-xs text-navy-400">{u.department}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={e => handleRoleChange(u, e.target.value as UserRole)}
                      className={cn('text-xs font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer outline-none', roleColor(u.role))}
                      style={{ background: 'transparent' }}
                    >
                      {ROLES.map(r => <option key={r} value={r} style={{ background: '#1a2d4a' }}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <button onClick={() => handleToggleActive(u)}
                      className={cn('text-xs font-bold px-3 py-1.5 rounded-lg border transition-all',
                        u.is_active
                          ? 'bg-green-500/15 text-green-400 border-green-500/20 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/20'
                          : 'bg-red-500/15 text-red-400 border-red-500/20 hover:bg-green-500/15 hover:text-green-400 hover:border-green-500/20'
                      )}>
                      {u.is_active ? '✓ Aktywny' : '✕ Nieaktywny'}
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setResetUser(u); setNewPassword('') }}
                        className="btn-secondary text-xs py-1.5 px-3">
                        🔑 Resetuj hasło
                      </button>
                      <button onClick={() => handleDeleteUser(u)}
                        className="btn-danger text-xs py-1.5 px-3">
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add user modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-5">Dodaj użytkownika</h2>
            <div className="space-y-4">
              <div>
                <label className="label">Imię i nazwisko</label>
                <input value={newName} onChange={e => setNewName(e.target.value)}
                  list="operators-list" placeholder="Imię i nazwisko..."
                  className="input" />
                <datalist id="operators-list">
                  {OPERATORS.map(o => <option key={o} value={o} />)}
                </datalist>
              </div>
              <div>
                <label className="label">E-mail</label>
                <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                  type="email" placeholder="imie.nazwisko@margomed.pl"
                  className="input" />
              </div>
              <div>
                <label className="label">Rola</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value as UserRole)} className="input">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Hasło początkowe</label>
                <input value={newPass} onChange={e => setNewPass(e.target.value)}
                  type="text" className="input font-mono" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleAddUser} disabled={saving || !newName || !newEmail}
                className="btn-primary flex-1 py-3">
                {saving ? 'Tworzenie...' : 'Utwórz konto'}
              </button>
              <button onClick={() => setShowAdd(false)} className="btn-secondary px-5 py-3">
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="bg-navy-800 border border-navy-600 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-white mb-2">Resetuj hasło</h2>
            <p className="text-navy-400 text-sm mb-5">{resetUser.full_name}</p>
            <div>
              <label className="label">Nowe hasło</label>
              <input value={newPassword} onChange={e => setNewPassword(e.target.value)}
                type="text" placeholder="Minimum 6 znaków..."
                className="input font-mono" />
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mt-3 text-xs text-amber-400">
              Po resecie wklej w Supabase SQL Editor:<br/>
              <code className="font-mono">UPDATE auth.users SET encrypted_password = crypt('{newPassword || 'NOWE_HASLO'}', gen_salt('bf')) WHERE id = '{resetUser.id}';</code>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={handleResetPassword} disabled={saving || !newPassword}
                className="btn-primary flex-1 py-3">
                {saving ? 'Resetowanie...' : 'Resetuj hasło'}
              </button>
              <button onClick={() => { setResetUser(null); setNewPassword('') }} className="btn-secondary px-5 py-3">
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
