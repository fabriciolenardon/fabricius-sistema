// ============================================================
// ARQUEO DE CAJA
// ============================================================
// Permite al cajero contar físicamente los billetes/monedas al cierre
// del día y compararlos con el efectivo esperado (suma de ventas en
// efectivo del día). Guarda el arqueo en la tabla arqueos_caja con
// la diferencia (sobrante, faltante o cuadrado).
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const fmt$ = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const hoyISO = () => new Date().toISOString().split('T')[0]

// Denominaciones argentinas en orden descendente
const DENOMINACIONES = [
  { valor: 20000, label: '$20.000', tipo: 'billete' },
  { valor: 10000, label: '$10.000', tipo: 'billete' },
  { valor: 2000,  label: '$2.000',  tipo: 'billete' },
  { valor: 1000,  label: '$1.000',  tipo: 'billete' },
  { valor: 500,   label: '$500',    tipo: 'billete' },
  { valor: 200,   label: '$200',    tipo: 'billete' },
  { valor: 100,   label: '$100',    tipo: 'billete' },
  { valor: 50,    label: '$50',     tipo: 'billete' },
  { valor: 10,    label: '$10',     tipo: 'moneda' },
  { valor: 5,     label: '$5',      tipo: 'moneda' },
  { valor: 1,     label: '$1',      tipo: 'moneda' },
]

export default function ArqueoCaja() {
  const [conteo, setConteo] = useState({}) // { 1000: 5, 500: 12, ... }
  const [efectivoEsperado, setEfectivoEsperado] = useState(0)
  const [ventasHoy, setVentasHoy] = useState(0)
  const [notas, setNotas] = useState('')
  const [cajero, setCajero] = useState('')
  const [historial, setHistorial] = useState([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const fecha = hoyISO()
    const [{ data: ventas }, { data: arqueos }] = await Promise.all([
      supabase.from('ventas_minoristas').select('efectivo').eq('origen', 'caja').eq('fecha', fecha),
      supabase.from('arqueos_caja').select('*').order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(20),
    ])
    const totalEf = (ventas || []).reduce((s, v) => s + (Number(v.efectivo) || 0), 0)
    setEfectivoEsperado(totalEf)
    setVentasHoy((ventas || []).length)
    setHistorial(arqueos || [])
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4000)
  }

  function setCantidad(valor, cant) {
    setConteo(c => ({ ...c, [valor]: cant }))
  }

  // === Cálculos en vivo ===
  const totalContado = useMemo(() => {
    return DENOMINACIONES.reduce((s, d) => s + (parseInt(conteo[d.valor]) || 0) * d.valor, 0)
  }, [conteo])

  const diferencia = totalContado - efectivoEsperado

  async function guardarArqueo() {
    if (totalContado === 0 && efectivoEsperado === 0) {
      showMsg('Cargá al menos un billete o esperá ventas registradas', 'error')
      return
    }
    if (!confirm(
      `📋 GUARDAR ARQUEO\n\n` +
      `Total contado: $${Math.round(totalContado).toLocaleString('es-AR')}\n` +
      `Efectivo esperado: $${Math.round(efectivoEsperado).toLocaleString('es-AR')}\n` +
      `Diferencia: ${diferencia >= 0 ? '+' : ''}$${Math.round(diferencia).toLocaleString('es-AR')}\n\n` +
      `¿Guardar?`
    )) return

    setGuardando(true)
    const { error } = await supabase.from('arqueos_caja').insert({
      fecha: hoyISO(),
      hora: new Date().toTimeString().slice(0, 8),
      billetes: conteo,
      total_contado: totalContado,
      efectivo_esperado: efectivoEsperado,
      diferencia,
      notas: notas || null,
      cajero: cajero || null,
    })
    setGuardando(false)
    if (error) {
      showMsg('❌ Error: ' + error.message, 'error')
      return
    }
    showMsg('✅ Arqueo guardado', 'success')
    setConteo({})
    setNotas('')
    await cargar()
  }

  function limpiarConteo() {
    if (!confirm('¿Limpiar el conteo actual?')) return
    setConteo({})
    setNotas('')
  }

  // === Estilos ===
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }
  const colorDif = diferencia === 0 ? '#7dff7d' : diferencia > 0 ? '#ffd17a' : '#ff8b8b'

  return (
    <div>
      {msg && (
        <div style={{
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600,
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>

        {/* CONTEO DE BILLETES */}
        <div className="card">
          <div className="card-title">💵 Conteo físico de la caja</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            Cargá cuántos billetes/monedas tenés de cada denominación.
          </p>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Denominación</th>
                <th style={{ width: 90, textAlign: 'center', padding: '6px 4px' }}>Cantidad</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {DENOMINACIONES.map(d => {
                const cant = parseInt(conteo[d.valor]) || 0
                const subt = cant * d.valor
                return (
                  <tr key={d.valor} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px' }}>
                      <span style={{ color: d.tipo === 'moneda' ? 'var(--muted)' : 'var(--text)', fontWeight: 600 }}>{d.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>{d.tipo}</span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                      <input type="number" min="0" step="1"
                        value={conteo[d.valor] || ''}
                        onChange={e => setCantidad(d.valor, e.target.value)}
                        placeholder="0"
                        style={{ width: 70, textAlign: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 6px', fontSize: 13 }}
                      />
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 4px', fontWeight: subt > 0 ? 600 : 400, color: subt > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                      {subt > 0 ? fmt$(subt) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--gold)' }}>
                <td colSpan={2} style={{ padding: '10px 4px', fontWeight: 700, fontSize: 14 }}>TOTAL CONTADO</td>
                <td style={{ textAlign: 'right', padding: '10px 4px', fontWeight: 800, fontSize: 20, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totalContado)}</td>
              </tr>
            </tfoot>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={limpiarConteo} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              ✕ Limpiar
            </button>
          </div>
        </div>

        {/* RESULTADO */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">📊 Resultado del arqueo</div>

            <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>EFECTIVO ESPERADO (del sistema hoy)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(efectivoEsperado)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ventasHoy} ventas en efectivo registradas hoy</div>
            </div>

            <div style={{ padding: '10px 12px', background: 'rgba(255,209,122,0.05)', borderRadius: 8, marginBottom: 10, border: '1px solid #6a5a2a' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>TOTAL CONTADO (físico)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totalContado)}</div>
            </div>

            <div style={{ padding: '14px 16px', background: diferencia === 0 ? 'rgba(125,255,125,0.06)' : diferencia > 0 ? 'rgba(255,209,122,0.06)' : 'rgba(255,107,107,0.06)', borderRadius: 8, border: `2px solid ${colorDif}` }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>DIFERENCIA</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: colorDif, fontFamily: "'Bebas Neue',cursive" }}>
                {diferencia === 0
                  ? '✅ Caja cuadrada'
                  : diferencia > 0
                    ? `⚠️ Sobrante: +${fmt$(diferencia)}`
                    : `❌ Faltante: ${fmt$(diferencia)}`}
              </div>
              {diferencia !== 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {diferencia > 0 ? 'Hay más plata de la esperada — revisá si te dieron de más o pagaron sin registrar' : 'Falta plata — revisá errores de vuelto o ventas sin registrar'}
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>CAJERO</label>
              <input value={cajero} onChange={e => setCajero(e.target.value)} placeholder="Nombre del cajero"
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: 10 }} />

              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>NOTAS (opcional)</label>
              <textarea value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej: faltó $500 por error de vuelto en venta #45"
                rows={3}
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <button onClick={guardarArqueo} disabled={guardando}
              style={{ marginTop: 12, width: '100%', padding: '12px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 14, opacity: guardando ? 0.6 : 1 }}>
              {guardando ? 'Guardando...' : '💾 Guardar arqueo'}
            </button>
          </div>
        </div>
      </div>

      {/* HISTORIAL */}
      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-title">📋 Arqueos anteriores</div>
        {loading && <p style={{ color: 'var(--muted)' }}>Cargando...</p>}
        {!loading && historial.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no hay arqueos guardados.</p>
        )}
        {!loading && historial.length > 0 && (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Hora</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Cajero</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Esperado</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Contado</th>
                <th style={{ textAlign: 'right', padding: '6px 4px' }}>Diferencia</th>
                <th style={{ textAlign: 'left', padding: '6px 4px' }}>Notas</th>
              </tr>
            </thead>
            <tbody>
              {historial.map(a => {
                const dif = Number(a.diferencia) || 0
                const c = dif === 0 ? '#7dff7d' : dif > 0 ? '#ffd17a' : '#ff8b8b'
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 4px' }}>{a.fecha}</td>
                    <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{a.hora}</td>
                    <td style={{ padding: '6px 4px' }}>{a.cajero || '—'}</td>
                    <td style={{ textAlign: 'right', padding: '6px 4px' }}>{fmt$(a.efectivo_esperado)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>{fmt$(a.total_contado)}</td>
                    <td style={{ textAlign: 'right', padding: '6px 4px', color: c, fontWeight: 700 }}>
                      {dif === 0 ? '✅ $0' : (dif > 0 ? '+' : '') + fmt$(dif)}
                    </td>
                    <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--muted)', maxWidth: 300 }}>{a.notas || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
