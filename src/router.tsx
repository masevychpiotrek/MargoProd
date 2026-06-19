import { createBrowserRouter, RouterProvider, Navigate, Outlet, useRouteError } from 'react-router-dom'
import { RequireAuth, PublicOnly } from '@/features/auth/RequireAuth'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/Login'

// Lazy loaded pages
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
const OperatorDashboard  = lazy(() => import('@/pages/operator/Dashboard'))
const OperatorShift      = lazy(() => import('@/pages/operator/Shift'))
const OperatorReport     = lazy(() => import('@/pages/operator/Report'))
const OperatorHistory    = lazy(() => import('@/pages/operator/History'))
const OperatorFailure    = lazy(() => import('@/pages/operator/Failure'))
const OperatorTasks      = lazy(() => import('@/pages/operator/Tasks'))
const OperatorPassword   = lazy(() => import('@/pages/operator/Password'))
const ManagerDashboard   = lazy(() => import('@/pages/manager/Dashboard'))
const ManagerDayReport   = lazy(() => import('@/pages/manager/DayReport'))
const ManagerExport      = lazy(() => import('@/pages/manager/Export'))
const ViewerDemo         = lazy(() => import('@/pages/viewer/Demo'))
const ExecutiveDashboard = lazy(() => import('@/pages/executive/Dashboard'))
const AdminDashboard     = lazy(() => import('@/pages/admin/Dashboard'))
const AdminUsers         = lazy(() => import('@/pages/admin/Users'))
const AdminAudit         = lazy(() => import('@/pages/admin/Audit'))
const AdminMachines      = lazy(() => import('@/pages/admin/Machines'))
const AdminTargets       = lazy(() => import('@/pages/admin/Targets'))
const AdminSchedules     = lazy(() => import('@/pages/admin/Schedules'))
const AdminReset         = lazy(() => import('@/pages/admin/Reset'))
const SpecialistDashboard = lazy(() => import('@/pages/Specialist/Dashboard'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin h-8 w-8 text-brand" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span className="text-navy-300 text-sm">Ładowanie...</span>
      </div>
    </div>
  )
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

function isDynamicImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('error loading dynamically imported module')
}

async function clearAppCaches() {
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map(key => caches.delete(key)))
  }
}

function AppErrorBoundary() {
  const error = useRouteError()
  const dynamicImportError = isDynamicImportError(error)
  const [refreshing, setRefreshing] = useState(dynamicImportError)
  const message = useMemo(() => {
    if (error instanceof Error) return error.message
    return String(error ?? 'Nieznany blad aplikacji')
  }, [error])

  useEffect(() => {
    if (!dynamicImportError) return
    const alreadyReloaded = sessionStorage.getItem('margoline-chunk-reload')
    if (alreadyReloaded) {
      setRefreshing(false)
      return
    }
    sessionStorage.setItem('margoline-chunk-reload', '1')
    clearAppCaches().finally(() => window.location.reload())
  }, [dynamicImportError])

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-navy-700 bg-navy-800 p-6 shadow-2xl">
        <div className="text-sm font-bold uppercase tracking-wider text-brand">MargoLine MES</div>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {dynamicImportError ? 'Aktualizuje aplikacje' : 'Blad aplikacji'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-navy-300">
          {dynamicImportError
            ? 'Przegladarka ma stara wersje plikow po wdrozeniu. Czyszcze pamiec aplikacji i odswiezam widok.'
            : 'Cos poszlo nie tak podczas ladowania widoku. Odswiez strone i sprobuj ponownie.'}
        </p>
        {!refreshing && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {message}
          </div>
        )}
        <button
          type="button"
          onClick={() => clearAppCaches().finally(() => window.location.reload())}
          className="btn-primary mt-5 w-full py-3"
        >
          {refreshing ? 'Odswiezanie...' : 'Odswiez aplikacje'}
        </button>
      </div>
    </div>
  )
}


function RoleRedirect() {
  const { profile } = useAuthStore()
  if (profile?.role === 'admin')      return <Navigate to="/admin" replace />
  if (profile?.role === 'manager')    return <Navigate to="/manager" replace />
  if (profile?.role === 'viewer')     return <Navigate to="/demo" replace />
  if (profile?.role === 'executive')  return <Navigate to="/executive" replace />
  if (profile?.role === 'specialist') return <Navigate to="/specialist" replace />
  return <Navigate to="/operator" replace />
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: <PublicOnly><LoginPage /></PublicOnly>,
    errorElement: <AppErrorBoundary />
  },
  {
    path: '/',
    errorElement: <AppErrorBoundary />,
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <RoleRedirect /> },
      { path: 'password', element: <RequireAuth><Wrap><OperatorPassword /></Wrap></RequireAuth> },
      { path: 'demo', element: <RequireAuth roles={['viewer', 'admin']}><Wrap><ViewerDemo /></Wrap></RequireAuth> },
      { path: 'executive', element: <RequireAuth roles={['executive', 'admin']}><Wrap><ExecutiveDashboard /></Wrap></RequireAuth> },
      { path: 'executive/charts', element: <RequireAuth roles={['executive', 'admin']}><Wrap><ExecutiveDashboard /></Wrap></RequireAuth> },
      { path: 'executive/machines', element: <RequireAuth roles={['executive', 'admin']}><Wrap><ExecutiveDashboard /></Wrap></RequireAuth> },
      { path: 'executive/details', element: <RequireAuth roles={['executive', 'admin']}><Wrap><ExecutiveDashboard /></Wrap></RequireAuth> },

      // ── OPERATOR ──
      {
        path: 'operator',
        element: <RequireAuth roles='operator'><Outlet /></RequireAuth>,
        children: [
          { index: true, element: <Wrap><OperatorDashboard /></Wrap> },
          { path: 'shift',    element: <Wrap><OperatorShift /></Wrap> },
          { path: 'report',   element: <Wrap><OperatorReport /></Wrap> },
          { path: 'failure',  element: <Wrap><OperatorFailure /></Wrap> },
          { path: 'tasks',    element: <Wrap><OperatorTasks /></Wrap> },
          { path: 'password', element: <Wrap><OperatorPassword /></Wrap> },
          { path: 'history',  element: <Wrap><OperatorHistory /></Wrap> }
        ]
      },

      // ── MANAGER ──
      {
        path: 'manager',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><ManagerDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'manager/monthly',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><ManagerDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'manager/operators',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><ManagerDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'manager/forecast',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><ManagerDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'manager/day-report',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><ManagerDayReport /></Wrap></RequireAuth>
      },
      {
        path: 'manager/failures',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><SpecialistDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'manager/export',
        element: <RequireAuth roles={['manager', 'admin', 'viewer']}><Wrap><ManagerExport /></Wrap></RequireAuth>
      },
      // ── SPECIALIST ──
      {
        path: 'specialist',
        element: <RequireAuth roles={['specialist', 'admin']}><Wrap><SpecialistDashboard /></Wrap></RequireAuth>
      },

      // ── ADMIN ──
      {
        path: 'admin',
        element: <RequireAuth roles="admin"><Wrap><AdminDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'admin/users',
        element: <RequireAuth roles="admin"><Wrap><AdminUsers /></Wrap></RequireAuth>
      },
      {
        path: 'admin/audit',
        element: <RequireAuth roles="admin"><Wrap><AdminAudit /></Wrap></RequireAuth>
      },
      {
        path: 'admin/machines',
        element: <RequireAuth roles="admin"><Wrap><AdminMachines /></Wrap></RequireAuth>
      },
      {
        path: 'admin/targets',
        element: <RequireAuth roles="admin"><Wrap><AdminTargets /></Wrap></RequireAuth>
      },
      {
        path: 'admin/schedules',
        element: <RequireAuth roles="admin"><Wrap><AdminSchedules /></Wrap></RequireAuth>
      },
      {
        path: 'admin/reset',
        element: <RequireAuth roles="admin"><Wrap><AdminReset /></Wrap></RequireAuth>
      },

      { path: 'unauthorized', element: (
        <div className="flex items-center justify-center h-64 flex-col gap-4">
          <div className="text-5xl">🚫</div>
          <h2 className="text-xl font-bold text-white">Brak uprawnień</h2>
          <p className="text-navy-300">Nie masz dostępu do tej sekcji.</p>
        </div>
      )}
    ]
  },
  { path: '*', element: <Navigate to="/" replace /> }
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}
