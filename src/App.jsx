// ============================================================
// App.jsx — Router con lazy-loading para reducir el bundle inicial
// ============================================================
// Antes todos los componentes se importaban sincronicamente, lo que
// metia ~1,2 MB de JS en el primer load aunque el usuario solo
// vaya a su pantalla (un cajero no necesita Sueldos, una franquicia
// no necesita Deposito, etc.).
//
// Ahora:
// - Eager (sincrono): Login, RootRedirect, AdminLayout, Dashboard,
//   Deposito, Caja, Precios → las pantallas que el admin abre apenas
//   entra y que el cajero usa todo el dia.
// - Lazy (asincrono): el resto. Se descarga on-demand cuando el
//   usuario navega a esa ruta. Beneficios concretos:
//   * Portales cliente/franquicia/cajero/desposte → solo bajan para
//     el rol respectivo, no para todos.
//   * Pantallas pesadas (DashboardEjecutivo, Reportes, Facturacion,
//     Auditoria) → solo se cargan cuando se abren.
// ============================================================
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { lazy, Suspense } from 'react'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminLayout from './pages/admin/AdminLayout'
import Dashboard from './pages/admin/Dashboard'
import Deposito from './pages/admin/Deposito'
import Caja from './pages/admin/Caja'
import Precios from './pages/admin/Precios'
import AsistenteIA from './components/AsistenteIA'
import PerfilPendiente from './components/PerfilPendiente'

// Lazy: pantallas admin que NO se usan en cada sesion
const Clientes = lazy(() => import('./pages/admin/Clientes'))
const Sueldos = lazy(() => import('./pages/admin/Sueldos'))
const Gastos = lazy(() => import('./pages/admin/Gastos'))
const Cheques = lazy(() => import('./pages/admin/Cheques'))
const Cierre = lazy(() => import('./pages/admin/Cierre'))
const Facturacion = lazy(() => import('./pages/admin/Facturacion'))
const Auditoria = lazy(() => import('./pages/admin/Auditoria'))
const DashboardEjecutivo = lazy(() => import('./pages/admin/DashboardEjecutivo'))
const Ventas = lazy(() => import('./pages/admin/Ventas'))
const Etiquetas = lazy(() => import('./pages/admin/Etiquetas'))
const Franquicias = lazy(() => import('./pages/admin/Franquicias'))
const Pedidos = lazy(() => import('./pages/admin/Pedidos'))
const PedidosWhatsapp = lazy(() => import('./pages/admin/PedidosWhatsapp'))
const ConversacionesWhatsapp = lazy(() => import('./pages/admin/ConversacionesWhatsapp'))

// Lazy: portal franquicia (solo lo usa el rol franquicia)
const FranquiciaLayout = lazy(() => import('./pages/franquicia/FranquiciaLayout'))
const FranquiciaDashboard = lazy(() => import('./pages/franquicia/FranquiciaDashboard'))
const FranquiciaCtaCte = lazy(() => import('./pages/franquicia/FranquiciaCtaCte'))
const FranquiciaRemitos = lazy(() => import('./pages/franquicia/FranquiciaRemitos'))
const FranquiciaPrecios = lazy(() => import('./pages/franquicia/FranquiciaPrecios'))

// Lazy: portal cliente mayorista
const ClienteLayout = lazy(() => import('./pages/cliente/ClienteLayout'))
const ClienteDashboard = lazy(() => import('./pages/cliente/ClienteDashboard'))
const ClienteCtaCte = lazy(() => import('./pages/cliente/ClienteCtaCte'))
const ClienteRemitos = lazy(() => import('./pages/cliente/ClienteRemitos'))
const ClientePrecios = lazy(() => import('./pages/cliente/ClientePrecios'))
const ClienteNuevoPedido = lazy(() => import('./pages/cliente/ClienteNuevoPedido'))
const ClientePedidos = lazy(() => import('./pages/cliente/ClientePedidos'))

// Lazy: portales cajero y desposte (cada rol carga solo su layout)
const CajeroLayout = lazy(() => import('./pages/cajero/CajeroLayout'))
const DesposteLayout = lazy(() => import('./pages/desposte/DesposteLayout'))
const DesposteCapones = lazy(() => import('./pages/desposte/DesposteCapones'))
const DesposteMediaRes = lazy(() => import('./pages/desposte/DesposteMediaRes'))
const DesposteHistorial = lazy(() => import('./pages/desposte/DesposteHistorial'))

function SoloCEO({ children }) {
  const { user, profile, profileMissing, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (profileMissing) return <PerfilPendiente />
  if (profile?.rol !== 'admin') return <Navigate to="/" replace />
  if (user?.email !== 'fabriciolenardon@gmail.com') return <Navigate to="/admin/dashboard" replace />
  return children
}

function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, profileMissing, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (profileMissing) return <PerfilPendiente />
  if (requiredRole && profile?.rol !== requiredRole) return <Navigate to="/" replace />
  return children
}

function PerfilPendienteRoute() {
  const { user, profileMissing, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!profileMissing) return <Navigate to="/" replace />
  return <PerfilPendiente />
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--gold)', letterSpacing: 3 }}>CARNICERIAS FABRICIUS</div>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>Cargando sistema...</div>
    </div>
  )
}

function RootRedirect() {
  const { user, profile, profileMissing, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (profileMissing) return <Navigate to="/perfil-pendiente" replace />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.rol === 'admin') return <Navigate to="/admin/dashboard" replace />
  if (profile.rol === 'cliente_mayorista') return <Navigate to="/cliente/dashboard" replace />
  if (profile.rol === 'cajero') return <Navigate to="/cajero/caja" replace />
  if (profile.rol === 'desposte') return <Navigate to="/desposte/capones" replace />
  return <Navigate to="/franquicia/dashboard" replace />
}

export default function App() {
  const { user, profile } = useAuth()
  return (
    <>
      {/* Suspense fallback se muestra mientras se descarga un chunk lazy.
          LoadingScreen reusable mantiene el branding mientras carga. */}
      <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/perfil-pendiente" element={<PerfilPendienteRoute />} />
        <Route path="/" element={<RootRedirect />} />
        <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="deposito" element={<Deposito />} />
          <Route path="precios" element={<Precios />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="pedidos-whatsapp" element={<PedidosWhatsapp />} />
          <Route path="conversaciones" element={<ConversacionesWhatsapp />} />
          <Route path="cheques" element={<Cheques />} />
          <Route path="sueldos" element={<Sueldos />} />
          <Route path="gastos" element={<Gastos />} />
          <Route path="cierre" element={<Cierre />} />
          <Route path="franquicias" element={<Franquicias />} />
          <Route path="ventas" element={<Ventas />} />
          <Route path="caja" element={<Caja />} />
          <Route path="etiquetas" element={<Etiquetas />} />
          <Route path="facturacion" element={<Facturacion />} />
          <Route path="auditoria" element={<Auditoria />} />
          <Route path="ejecutivo" element={<SoloCEO><DashboardEjecutivo /></SoloCEO>} />
        </Route>
        <Route path="/franquicia" element={<ProtectedRoute requiredRole="franquicia"><FranquiciaLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<FranquiciaDashboard />} />
          <Route path="ctacte" element={<FranquiciaCtaCte />} />
          <Route path="remitos" element={<FranquiciaRemitos />} />
          <Route path="precios" element={<FranquiciaPrecios />} />
        </Route>
        <Route path="/cliente" element={<ProtectedRoute requiredRole="cliente_mayorista"><ClienteLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<ClienteDashboard />} />
          <Route path="ctacte" element={<ClienteCtaCte />} />
          <Route path="remitos" element={<ClienteRemitos />} />
          <Route path="precios" element={<ClientePrecios />} />
          <Route path="nuevo-pedido" element={<ClienteNuevoPedido />} />
          <Route path="pedidos" element={<ClientePedidos />} />
        </Route>
        <Route path="/cajero" element={<ProtectedRoute requiredRole="cajero"><CajeroLayout /></ProtectedRoute>}>
          <Route path="caja" element={<Caja />} />
        </Route>
        <Route path="/desposte" element={<ProtectedRoute requiredRole="desposte"><DesposteLayout /></ProtectedRoute>}>
          <Route path="capones" element={<DesposteCapones />} />
          <Route path="media-res" element={<DesposteMediaRes />} />
          <Route path="historial" element={<DesposteHistorial />} />
        </Route>
      </Routes>
      </Suspense>
      {user && profile && profile.rol !== 'cajero' && profile.rol !== 'desposte' && <AsistenteIA />}
    </>
  )
}
