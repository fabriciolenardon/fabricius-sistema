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
import FranquiciaLayout from './pages/franquicia/FranquiciaLayout'
import FranquiciaDashboard from './pages/franquicia/FranquiciaDashboard'
import FranquiciaCtaCte from './pages/franquicia/FranquiciaCtaCte'
import FranquiciaRemitos from './pages/franquicia/FranquiciaRemitos'
import FranquiciaPrecios from './pages/franquicia/FranquiciaPrecios'

function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (requiredRole && profile?.rol !== requiredRole) return <Navigate to="/" replace />
  return children
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
  const { profile, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.rol === 'admin') return <Navigate to="/admin/dashboard" replace />
  return <Navigate to="/franquicia/dashboard" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminLayout /></ProtectedRoute>}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="deposito" element={<Deposito />} />
        <Route path="precios" element={<Precios />} />
        <Route path="clientes" element={<Clientes />} />
        <Route path="cheques" element={<Cheques />} />
        <Route path="sueldos" element={<Sueldos />} />
        <Route path="gastos" element={<Gastos />} />
        <Route path="cierre" element={<Cierre />} />
      </Route>
      <Route path="/franquicia" element={<ProtectedRoute requiredRole="franquicia"><FranquiciaLayout /></ProtectedRoute>}>
        <Route path="dashboard" element={<FranquiciaDashboard />} />
        <Route path="ctacte" element={<FranquiciaCtaCte />} />
        <Route path="remitos" element={<FranquiciaRemitos />} />
        <Route path="precios" element={<FranquiciaPrecios />} />
      </Route>
    </Routes>
  )
}