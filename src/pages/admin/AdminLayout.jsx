import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState } from 'react'

const navItems = [
  { to: '/admin/dashboard',   icon: '📊', label: 'Dashboard' },
  { to: '/admin/deposito',    icon: '🏭', label: 'Depósito' },
  { to: '/admin/precios',     icon: '💲', label: 'Precios' },
  { to: '/admin/clientes',    icon: '👥', label: 'Clientes' },
  { to: '/admin/franquicias', icon: '🏪', label: 'Franquicias' },
  { to: '/admin/cheques',     icon: '📄', label: 'Cheques' },
  { to: '/admin/sueldos',     icon: '💰', label: 'Sueldos' },
  { to: '/admin/gastos',      icon: '💸', label: 'Gastos' },
  { to: '/admin/cierre',      icon: '📋', label: 'Cierre' },
]

function ChatbotFlotante() {
  const [abierto, setAbierto] = useState(false)
  const [msgs, setMsgs] = useState([{ rol: 'ia', texto: '¡Hola Fabricio! 🥩 Soy tu asistente con acceso a todo el sistema. Preguntame sobre clientes, saldos, stock, precios, remitos o lo que necesites.' }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function enviar() {
    if (!input.trim() || loading) return
    const pregunta = input.trim()
    setInput('')
    setMsgs(m => [...m, { rol: 'user', texto: pregunta }])
    setLoading(true)
    try {
      const res = await fetch('/api/chat-sistema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...msgs.filter((_, i) => i > 0).map(m => ({ role: m.rol === 'user' ? 'user' : 'assistant', content: m.texto })),
            { role: 'user', content: pregunta }
          ]
        })
      })
      const data = await res.json()
      const respuesta = (data.choices?.[0]?.message?.content || 'No pude procesar tu consulta.')
        .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#/g, '').trim()
      setMsgs(m => [...m, { rol: 'ia', texto: respuesta }])
    } catch (err) {
      setMsgs(m => [...m, { rol: 'ia', texto: '❌ Error: ' + err.message }])
    }
    setLoading(false)
  }

  return (
    <>
      {abierto && (
        <div style={{
          position: 'fixed', bottom: 90, right: 24, width: 360, height: 480,
          background: 'var(--surface)', border: '1px solid var(--gold)',
          borderRadius: 16, zIndex: 1000, display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', borderRadius: '16px 16px 0 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🤖</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>Asistente Fabricius</div>
                <div style={{ fontSize: 10, color: 'var(--green)' }}>● Acceso total al sistema</div>
              </div>
            </div>
            <button onClick={() => setAbierto(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.rol === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '85%', padding: '8px 12px', borderRadius: 10,
                  background: m.rol === 'user' ? 'var(--gold)' : 'var(--surface2)',
                  color: m.rol === 'user' ? '#000' : 'var(--text)',
                  fontSize: 13, lineHeight: 1.5,
                  border: m.rol === 'ia' ? '1px solid var(--border)' : 'none',
                  whiteSpace: 'pre-wrap'
                }}>
                  {m.texto}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}>
                  Pensando... ⏳
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && enviar()}
              placeholder="Preguntame sobre clientes, stock, precios..."
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: 'none' }}
            />
            <button onClick={enviar} disabled={loading}
              style={{ padding: '8px 12px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              ➤
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setAbierto(!abierto)}
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 56, height: 56, borderRadius: '50%',
          background: abierto ? 'var(--surface2)' : 'var(--gold)',
          border: `2px solid ${abierto ? 'var(--gold)' : 'transparent'}`,
          cursor: 'pointer', zIndex: 1001,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          transition: 'all 0.2s'
        }}>
        {abierto ? '✕' : '🤖'}
      </button>
    </>
  )
}

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await signOut()
    navigate('/login')
  }

  const initiales = profile?.nombre?.split(' ').map(n => n[0]).slice(0, 2).join('') || 'U'

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 58,
        background: 'rgba(10,10,8,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)', zIndex: 200,
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14
      }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 20, color: 'var(--gold)', letterSpacing: 2, whiteSpace: 'nowrap' }}>
          🥩 FABRICIUS
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />
        <nav style={{ display: 'flex', gap: 2, flex: 1, overflowX: 'auto' }}>
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                textDecoration: 'none', transition: 'all 0.2s',
                border: '1px solid transparent',
                background: isActive ? 'var(--gold)' : 'transparent',
                color: isActive ? '#000' : 'var(--muted)',
              })}>
              <span>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '5px 14px 5px 8px' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000' }}>
              {initiales}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', lineHeight: 1.2 }}>{profile?.nombre}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Administrador</div>
            </div>
          </div>
          <button onClick={handleLogout}
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}
            onMouseOver={e => { e.target.style.borderColor = 'var(--red-light)'; e.target.style.color = 'var(--red-light)' }}
            onMouseOut={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--muted)' }}>
            Salir
          </button>
        </div>
      </header>
      <main style={{ paddingTop: 58, minHeight: '100vh' }}>
        <div style={{ padding: 28 }} className="fade-in">
          <Outlet />
        </div>
      </main>
      <ChatbotFlotante />
    </div>
  )
}
