// ============================================================
// AUDITORÍA — pantalla admin para ver el log de cambios
// ============================================================
// Lista quién hizo qué y cuándo. Filtros por usuario, módulo,
// acción y fechas. Permite expandir cada registro para ver
// los snapshots JSON (antes/después).
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'

const fmtFechaHora = d => d ? new Date(d).toLocaleString('es-AR') : '—'

const MODULOS = ['todos', 'caja', 'precios', 'ofertas', 'facturacion', 'deposito', 'arqueo', 'desposte', 'otros']
const ACCIONES = ['todas', 'insert', 'update', 'delete', 'login', 'custom']

const COLOR_ACCION = {
  insert: '#7dff7d',
  update: '#ffd17a',
  delete: '#ff8b8b',
  login: '#7a9dff',
  custom: 'var(--muted)',
}

const ICON_ACCION = {
  insert: '➕',
  update: '✏️',
  delete: '🗑️',
  login: '🔑',
  custom: '⚙️',
}

export default function Auditoria() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroModulo, setFiltroModulo] = useState('todos')
  const [filtroAccion, setFiltroAccion] = useState('todas')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [expandido, setExpandido] = useState(null)

  useEffect(() => { cargar() }, [filtroDesde, filtroHasta])

  async function cargar() {
    setLoading(true)
    let q = supabase.from('auditoria_log').select('*').order('fecha', { ascending: false }).limit(500)
    if (filtroDesde) q = q.gte('fecha', filtroDesde)
    if (filtroHasta) q = q.lte('fecha', filtroHasta + 'T23:59:59')
    const { data } = await q
    setLogs(data || [])
    setLoading(false)
  }

  const filtrados = useMemo(() => {
    return logs.filter(l => {
      if (filtroModulo !== 'todos' && l.modulo !== filtroModulo) return false
      if (filtroAccion !== 'todas' && l.accion !== filtroAccion) return false
      if (filtroUsuario) {
        const q = filtroUsuario.toLowerCase()
        if (!(l.usuario_nombre || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [logs, filtroModulo, filtroAccion, filtroUsuario])

  const pag = usePaginacion(filtrados, 20)

  const usuariosUnicos = useMemo(() => {
    return Array.from(new Set(logs.map(l => l.usuario_nombre).filter(Boolean))).sort()
  }, [logs])

  const inp = {
    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: "'DM Sans',sans-serif",
  }

  return (
    <div>
      <div className="page-title">🔍 AUDITORÍA</div>
      <div className="page-sub">Quién hizo qué y cuándo · Últimos 500 registros</div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, marginTop: 12 }}>
        <select value={filtroModulo} onChange={e => setFiltroModulo(e.target.value)} style={inp}>
          {MODULOS.map(m => <option key={m} value={m}>📁 {m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
        </select>
        <select value={filtroAccion} onChange={e => setFiltroAccion(e.target.value)} style={inp}>
          {ACCIONES.map(a => <option key={a} value={a}>{a === 'todas' ? '🎯 Todas' : `${ICON_ACCION[a] || '⚙️'} ${a}`}</option>)}
        </select>
        <input list="usuarios-auditoria" value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
          placeholder="Filtrar por usuario..." style={{ ...inp, minWidth: 180 }} />
        <datalist id="usuarios-auditoria">
          {usuariosUnicos.map(u => <option key={u} value={u} />)}
        </datalist>
        <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={inp} />
        <span style={{ color: 'var(--muted)' }}>→</span>
        <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={inp} />
        <button onClick={cargar} style={{ ...inp, cursor: 'pointer', fontWeight: 700 }}>🔄 Recargar</button>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          Mostrando <strong style={{ color: 'var(--text)' }}>{filtrados.length}</strong> de {logs.length}
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Cargando registros...</p>
      ) : filtrados.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
          Sin registros con esos filtros.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Fecha y hora</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Usuario</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Acción</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Módulo</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Descripción</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {pag.items.map(l => (
                <>
                  <tr key={l.id} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => setExpandido(expandido === l.id ? null : l.id)}>
                    <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 11 }}>{fmtFechaHora(l.fecha)}</td>
                    <td style={{ padding: '8px 6px' }}>
                      <div style={{ fontWeight: 600 }}>{l.usuario_nombre || '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{l.usuario_rol || '—'}</div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                      <span style={{ background: (COLOR_ACCION[l.accion] || '#aaa') + '22', color: COLOR_ACCION[l.accion] || '#aaa', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                        {ICON_ACCION[l.accion] || '⚙️'} {l.accion}
                      </span>
                    </td>
                    <td style={{ padding: '8px 6px', color: 'var(--muted)' }}>
                      📁 {l.modulo || '—'}
                      {l.entidad && <div style={{ fontSize: 10 }}>{l.entidad}{l.entidad_id ? ` #${l.entidad_id}` : ''}</div>}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{l.descripcion || '—'}</td>
                    <td style={{ textAlign: 'center', padding: '8px 6px', color: 'var(--muted)' }}>
                      {(l.valores_antes || l.valores_despues) ? (expandido === l.id ? '▼' : '▶') : ''}
                    </td>
                  </tr>
                  {expandido === l.id && (l.valores_antes || l.valores_despues) && (
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td colSpan={6} style={{ padding: 10 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: l.valores_antes && l.valores_despues ? '1fr 1fr' : '1fr', gap: 10 }}>
                          {l.valores_antes && (
                            <div>
                              <div style={{ fontSize: 10, color: '#ff8b8b', fontWeight: 700, marginBottom: 4 }}>⬅ ANTES</div>
                              <pre style={{ fontSize: 10, background: 'var(--bg)', padding: 8, borderRadius: 6, overflowX: 'auto', maxHeight: 200, color: 'var(--muted)' }}>
                                {JSON.stringify(l.valores_antes, null, 2)}
                              </pre>
                            </div>
                          )}
                          {l.valores_despues && (
                            <div>
                              <div style={{ fontSize: 10, color: '#7dff7d', fontWeight: 700, marginBottom: 4 }}>➡ DESPUÉS</div>
                              <pre style={{ fontSize: 10, background: 'var(--bg)', padding: 8, borderRadius: 6, overflowX: 'auto', maxHeight: 200, color: 'var(--muted)' }}>
                                {JSON.stringify(l.valores_despues, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          <div style={{ padding: 10 }}>
            <Paginador {...pag.controles} label="registros" />
          </div>
        </div>
      )}
    </div>
  )
}
