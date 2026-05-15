import { useAuth } from '../context/AuthContext'

export default function PerfilPendiente() {
  const { signOut, user } = useAuth()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg)',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 36,
          textAlign: 'center',
        }}
      >
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', letterSpacing: 2, marginBottom: 16 }}>
          ACCESO PENDIENTE
        </div>
        <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
          Tu cuenta (<strong>{user?.email}</strong>) inició sesión correctamente, pero aún no tiene un perfil asignado en el sistema.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 24 }}>
          Contactá al administrador para que configure tu usuario en Supabase (tabla profiles).
        </p>
        <button
          type="button"
          onClick={() => signOut()}
          style={{
            width: '100%',
            padding: 12,
            background: 'linear-gradient(135deg, var(--gold), var(--amber))',
            border: 'none',
            borderRadius: 10,
            color: '#000',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}