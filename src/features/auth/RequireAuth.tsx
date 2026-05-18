import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import type { UserRole } from '@/types/database'

interface RequireAuthProps {
  children: React.ReactNode
  roles?: UserRole | UserRole[]
}

export function RequireAuth({ children, roles }: RequireAuthProps) {
  const { user, profile, isInitialized } = useAuthStore()
  const location = useLocation()

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-navy-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <svg className="animate-spin h-10 w-10 text-brand" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-navy-300 text-sm">Ładowanie systemu...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (roles && profile) {
    const allowed = Array.isArray(roles) ? roles : [roles]
    if (!allowed.includes(profile.role)) {
      return <Navigate to="/unauthorized" replace />
    }
  }

  return <>{children}</>
}

export function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (user) return <Navigate to="/operator" replace />
  return <>{children}</>
}
