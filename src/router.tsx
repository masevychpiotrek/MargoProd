import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import { RequireAuth, PublicOnly } from '@/features/auth/RequireAuth'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/Login'

// Lazy loaded pages
import { lazy, Suspense } from 'react'
import { useAuthStore } from '@/stores/authStore'
const OperatorDashboard  = lazy(() => import('@/pages/operator/Dashboard'))
const OperatorShift      = lazy(() => import('@/pages/operator/Shift'))
const OperatorReport     = lazy(() => import('@/pages/operator/Report'))
const OperatorHistory    = lazy(() => import('@/pages/operator/History'))
const ManagerDashboard   = lazy(() => import('@/pages/manager/Dashboard'))
const ManagerExport      = lazy(() => import('@/pages/manager/Export'))
const ManagerOrders      = lazy(() => import('@/pages/manager/Orders'))
const ManagerPlan        = lazy(() => import('@/pages/manager/ProductionPlan'))
const AdminDashboard     = lazy(() => import('@/pages/admin/Dashboard'))
const AdminUsers         = lazy(() => import('@/pages/admin/Users'))
const AdminAudit         = lazy(() => import('@/pages/admin/Audit'))
const AdminMachines      = lazy(() => import('@/pages/admin/Machines'))
const AdminTargets       = lazy(() => import('@/pages/admin/Targets'))
const AdminSchedules     = lazy(() => import('@/pages/admin/Schedules'))
const AdminOrders        = lazy(() => import('@/pages/admin/Orders'))
const AdminReset         = lazy(() => import('@/pages/admin/Reset'))

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


function RoleRedirect() {
  const { profile } = useAuthStore()
  if (profile?.role === 'admin') return <Navigate to="/admin" replace />
  if (profile?.role === 'manager') return <Navigate to="/manager" replace />
  return <Navigate to="/operator" replace />
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: <PublicOnly><LoginPage /></PublicOnly>
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <RoleRedirect /> },

      // ── OPERATOR ──
      {
        path: 'operator',
        element: <RequireAuth roles='operator'><Outlet /></RequireAuth>,
        children: [
          { index: true, element: <Wrap><OperatorDashboard /></Wrap> },
          { path: 'shift',   element: <Wrap><OperatorShift /></Wrap> },
          { path: 'report',  element: <Wrap><OperatorReport /></Wrap> },
          { path: 'history', element: <Wrap><OperatorHistory /></Wrap> }
        ]
      },

      // ── MANAGER ──
      {
        path: 'manager',
        element: <RequireAuth roles={['manager', 'admin']}><Wrap><ManagerDashboard /></Wrap></RequireAuth>
      },
      {
        path: 'manager/export',
        element: <RequireAuth roles={['manager', 'admin']}><Wrap><ManagerExport /></Wrap></RequireAuth>
      },
      {
        path: 'manager/orders',
        element: <RequireAuth roles={['manager', 'admin']}><Wrap><ManagerOrders /></Wrap></RequireAuth>
      },
      {
        path: 'manager/plan',
        element: <RequireAuth roles={['manager', 'admin']}><Wrap><ManagerPlan /></Wrap></RequireAuth>
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
        path: 'admin/orders',
        element: <RequireAuth roles="admin"><Wrap><AdminOrders /></Wrap></RequireAuth>
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
