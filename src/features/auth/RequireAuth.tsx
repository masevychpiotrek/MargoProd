import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

interface Props {
  children: React.ReactNode
  roles?: string | string[]
}

const LOADING_SCREEN = (
  <div style={{ display:'flex', minHeight:'100vh', background:'#07080D', alignItems:'center', justifyContent:'center' }}>
    <style>{`
      @keyframes rl-ring { 0%,100%{opacity:.15;transform:scale(.95)} 50%{opacity:.5;transform:scale(1.15)} }
      @keyframes rl-glow { 0%,100%{opacity:.6} 50%{opacity:1} }
      @keyframes rl-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      .rl-r1{animation:rl-ring 2s ease-in-out infinite}
      .rl-r2{animation:rl-ring 2s ease-in-out infinite .2s}
      .rl-r3{animation:rl-ring 2s ease-in-out infinite .4s}
      .rl-logo{animation:rl-glow 2s ease-in-out infinite}
      .rl-text{animation:rl-fade .8s ease forwards .3s;opacity:0}
    `}</style>
    <div style={{ textAlign:'center' }}>
      <div style={{ position:'relative', width:100, height:100, margin:'0 auto 20px' }}>
        <div className="rl-r3" style={{ position:'absolute', inset:-20, borderRadius:'50%', border:'1px solid #c9a84c' }} />
        <div className="rl-r2" style={{ position:'absolute', inset:-10, borderRadius:'50%', border:'1px solid #c9a84c' }} />
        <div className="rl-r1" style={{ position:'absolute', inset:0, borderRadius:'50%', border:'1.5px solid #c9a84c' }} />
        <div className="rl-logo" style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="60" height="60" viewBox="0 0 22 22" fill="none">
            <path d="M11 2 L19.5 7 L19.5 15 L11 20 L2.5 15 L2.5 7 Z" stroke="#c9a84c" strokeWidth="1.2" fill="none"/>
            <path d="M11 2 L11 20 M2.5 7 L19.5 15 M19.5 7 L2.5 15" stroke="#c9a84c" strokeWidth=".5" opacity=".3"/>
            <circle cx="11" cy="11" r="2.5" fill="#c9a84c"/>
          </svg>
        </div>
      </div>
      <div className="rl-text">
        <div style={{ color:'#fff', fontWeight:700, fontSize:16, letterSpacing:'.05em', marginBottom:4 }}>MargoLine</div>
        <div style={{ color:'#c9a84c', fontSize:11, letterSpacing:'.12em', opacity:.7 }}>ŁADOWANIE...</div>
      </div>
    </div>
  </div>
)

export function RequireAuth({ children, roles }: Props) {
  const { user, profile, isLoading, isInitialized, initialize } = useAuthStore()
  const location = useLocation()

  useEffect(() => {
    if (!isInitialized) initialize()
  }, [isInitialized, initialize])

  // Czekaj aż inicjalizacja się skończy
  if (!isInitialized || isLoading) return LOADING_SCREEN

  // Nie zalogowany
  if (!user || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Sprawdź rolę
  if (roles) {
    const allowed = Array.isArray(roles) ? roles : [roles]
    if (!allowed.includes(profile.role)) {
      if (profile.role === 'admin')   return <Navigate to="/admin"    replace />
      if (profile.role === 'manager') return <Navigate to="/manager"  replace />
      if (profile.role === 'specialist') return <Navigate to="/specialist" replace />
      return <Navigate to="/operator" replace />
    }
  }

  return <>{children}</>
}

export function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading, isInitialized, initialize } = useAuthStore()

  useEffect(() => {
    if (!isInitialized) initialize()
  }, [isInitialized, initialize])

  if (!isInitialized || isLoading) return LOADING_SCREEN

  if (user && profile) {
    if (profile.role === 'admin')   return <Navigate to="/admin"    replace />
    if (profile.role === 'manager') return <Navigate to="/manager"  replace />
    if (profile.role === 'specialist') return <Navigate to="/specialist" replace />
    return <Navigate to="/operator" replace />
  }

  return <>{children}</>
}
