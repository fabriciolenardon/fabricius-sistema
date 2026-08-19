// ============================================================
// SOCIOS EDITOR — dar de alta y de baja a los dueños del negocio
// ============================================================
// Se usa en dos lugares:
//   1. Dashboard, la primera vez que entra una sucursal y todavía no cargó
//      a nadie (aparece como lo primero que ve, arriba de todo).
//   2. Gastos, para agregar o sacar un dueño cuando cambie la sociedad.
//
// El % es cuánto le toca a cada uno de la ganancia del mes; el tope es cuánto
// puede gastar por mes operativo (vacío = sin control).
// ============================================================
import { useState } from 'react'
import { comoLoLlamamos, guardarSocio, marcarPrincipal, desactivarSocio } from '../lib/socios'
import { fmtPrecio } from '../lib/formatos'

const VACIO = { nombre: '', apodo: '', porcentaje: '', tope_mensual: '' }

export default function SociosEditor({ socios, onCambio, compacto = false }) {
  const [form, setForm] = useState(VACIO)
  const [editando, setEditando] = useState(null)
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmar, setConfirmar] = useState(null)

  const sumaPct = socios.reduce((s, x) => s + (Number(x.porcentaje) || 0), 0)

  function aviso(texto, tipo = 'success') { setMsg({ texto, tipo }); setTimeout(() => setMsg(null), 4000) }

  async function guardar() {
    setGuardando(true)
    const { error } = await guardarSocio({ ...form, id: editando, orden: socios.length + 1 })
    setGuardando(false)
    if (error) { aviso('❌ ' + error.message, 'error'); return }
    setForm(VACIO); setEditando(null)
    aviso(editando ? '✅ Dueño actualizado' : '✅ Dueño agregado')
    onCambio?.()
  }

  async function quitar(s) {
    const { error } = await desactivarSocio(s.id)
    setConfirmar(null)
    if (error) { aviso('❌ ' + error.message, 'error'); return }
    aviso('🗑️ ' + s.nombre + ' ya no figura como dueño')
    onCambio?.()
  }

  async function hacerPrincipal(s) {
    const { error } = await marcarPrincipal(socios, s.id)
    if (error) { aviso('❌ ' + error.message, 'error'); return }
    aviso('👑 El sistema va a saludar a ' + comoLoLlamamos(s))
    onCambio?.()
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '9px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }
  const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }

  return (
    <div>
      {msg && (
        <div style={{ background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '9px 14px', marginBottom: 12, color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600, fontSize: 13 }}>
          {msg.texto}
        </div>
      )}

      {socios.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {socios.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {s.es_principal && <span title="El sistema lo saluda al entrar">👑 </span>}
                  {s.nombre}
                  {s.apodo && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}> · le decimos {s.apodo}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {Number(s.porcentaje) || 0}% de la ganancia
                  {s.tope_mensual ? ` · tope ${fmtPrecio(s.tope_mensual)}` : ' · sin tope'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!s.es_principal && (
                  <button onClick={() => hacerPrincipal(s)} title="Que el sistema lo salude a él"
                    style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12, color: 'var(--text2)' }}>👑</button>
                )}
                <button onClick={() => { setEditando(s.id); setForm({ nombre: s.nombre, apodo: s.apodo || '', porcentaje: s.porcentaje ?? '', tope_mensual: s.tope_mensual ?? '' }) }}
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12, color: 'var(--text2)' }}>✏️</button>
                {confirmar === s.id ? (
                  <>
                    <button onClick={() => quitar(s)} style={{ background: '#5a2a2a', border: '1px solid #7a3a3a', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12, color: '#ff9b9b', fontWeight: 700 }}>Confirmar</button>
                    <button onClick={() => setConfirmar(null)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>No</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmar(s.id)}
                    style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '5px 9px', cursor: 'pointer', fontSize: 12, color: '#ff6b6b' }}>🗑️</button>
                )}
              </div>
            </div>
          ))}
          {socios.length > 0 && Math.abs(sumaPct - 100) > 0.01 && (
            <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>
              ⚠️ Los porcentajes suman {sumaPct}%, no 100%. Se reparte igual, pero revisalo.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: compacto ? '1fr 1fr' : '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={lbl}>Nombre y apellido</label>
          <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
            placeholder="Ej: Pamela Tissera" style={inp} />
        </div>
        <div>
          <label style={lbl}>¿Cómo le decimos?</label>
          <input value={form.apodo} onChange={e => setForm(f => ({ ...f, apodo: e.target.value }))}
            placeholder="Ej: Pame" style={inp} />
        </div>
        <div>
          <label style={lbl}>% de la ganancia</label>
          <input value={form.porcentaje} onChange={e => setForm(f => ({ ...f, porcentaje: e.target.value }))}
            placeholder="Ej: 50" inputMode="decimal" style={inp} />
        </div>
        <div>
          <label style={lbl}>Tope de gastos $</label>
          <input value={form.tope_mensual} onChange={e => setForm(f => ({ ...f, tope_mensual: e.target.value }))}
            placeholder="Sin tope" inputMode="decimal" style={inp} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-gold" onClick={guardar} disabled={guardando || !form.nombre.trim()}
          style={{ opacity: guardando || !form.nombre.trim() ? 0.5 : 1 }}>
          {guardando ? '⏳ Guardando…' : editando ? '💾 Guardar cambios' : '➕ Agregar dueño'}
        </button>
        {editando && (
          <button className="btn btn-ghost" onClick={() => { setEditando(null); setForm(VACIO) }}>Cancelar</button>
        )}
      </div>
    </div>
  )
}
