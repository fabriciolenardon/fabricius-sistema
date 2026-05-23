import Ventas from './pages/admin/Ventas'
import Caja from './pages/admin/Caja'
import Etiquetas from './pages/admin/Etiquetas'
import Franquicias from './pages/admin/Franquicias'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import AdminLayout from './pages/admin/AdminLayout'
import Dashboard from './pages/admin/Dashboard'
import Deposito from './pages/admin/Deposito'
import Clientes from './pages/admin/Clientes'
import Sueldos from './pages/admin/Sueldos'
import Gastos from './pages/admin/Gastos'
import Cheques from './pages/admin/Cheques'
import Cierre from './pages/admin/Cierre'
import Precios from './pages/admin/Precios'
import Facturacion from './pages/admin/Facturacion'
import Auditoria from './pages/admin/Auditoria'
import DashboardEjecutivo from './pages/admin/DashboardEjecutivo'
import FranquiciaLayout from './pages/franquicia/FranquiciaLayout'
import FranquiciaDashboard from './pages/franquicia/FranquiciaDashboard'
import FranquiciaCtaCte from './pages/franquicia/FranquiciaCtaCte'
import FranquiciaRemitos from './pages/franquicia/FranquiciaRemitos'
import FranquiciaPrecios from './pages/franquicia/FranquiciaPrecios'
import ClienteLayout from './pages/cliente/ClienteLayout'
import ClienteDashboard from './pages/cliente/ClienteDashboard'
import ClienteCtaCte from './pages/cliente/ClienteCtaCte'
import ClienteRemitos from './pages/cliente/ClienteRemitos'
import ClientePrecios from './pages/cliente/ClientePrecios'
import ClienteNuevoPedido from './pages/cliente/ClienteNuevoPedido'
import ClientePedidos from './pages/cliente/ClientePedidos'
import Pedidos from './pages/admin/Pedidos'
import AsistenteIA from './components/AsistenteIA'
import PerfilPendiente from './components/PerfilPendiente'
import CajeroLayout from './pages/cajero/CajeroLayout'
import DesposteLayout from './pages/desposte/DesposteLayout'
import DesposteCapones from './pages/desposte/DesposteCapones'
import DesposteMediaRes from './pages/desposte/DesposteMediaRes'

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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/perfil-pendiente" element={<PerfilPendienteRoute />} />
        <Route path="/" element={<RootRedirect />} />
        <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminLayout /></ProtectedRoute>}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="deposito" element={<Deposito />} />
          <Route path="precios" element={<Precios />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="pedidos" element={<Pedidos />} />
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
          <Route path="ejecutivo" element={<DashboardEjecutivo />} />
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
        </Route>
      </Routes>
      {user && profile && profile.rol !== 'cajero' && profile.rol !== 'desposte' && <AsistenteIA />}
    </>
  )
}
