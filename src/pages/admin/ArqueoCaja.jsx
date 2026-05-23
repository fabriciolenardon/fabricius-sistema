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
import Paginador, { usePaginacion } from '../../components/Paginador'

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
  const [debitoEsperado, setDebitoEsperado] = useState(0)
  const [transferenciaEsperada, setTransferenciaEsperada] = useState(0)
  const [ventasHoy, setVentasHoy] = useState(0)
  const [ventasEfectivo, setVentasEfectivo] = useState(0)
  const [ventasDebito, setVentasDebito] = useState(0)
  const [ventasTransferencia, setVentasTransferencia] = useState(0)
  const [debitoReal, setDebitoReal] = useState('')
  const [transferenciaReal, setTransferenciaReal] = useState('')
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
      supabase.from('ventas_minoristas').select('efectivo, debito, transferencia').eq('origen', 'caja').eq('fecha', fecha),
      supabase.from('arqueos_caja').select('*').order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(20),
    ])
    const arr = ventas || []
    const totalEf = arr.reduce((s, v) => s + (Number(v.efectivo) || 0), 0)
    const totalDb = arr.reduce((s, v) => s + (Number(v.debito) || 0), 0)
    const totalTr = arr.reduce((s, v) => s + (Number(v.transferencia) || 0), 0)
    setEfectivoEsperado(totalEf)
    setDebitoEsperado(totalDb)
    setTransferenciaEsperada(totalTr)
    setVentasHoy(arr.length)
    setVentasEfectivo(arr.filter(v => (Number(v.efectivo) || 0) > 0).length)
    setVentasDebito(arr.filter(v => (Number(v.debito) || 0) > 0).length)
    setVentasTransferencia(arr.filter(v => (Number(v.transferencia) || 0) > 0).length)
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
  const debitoRealNum = Number(debitoReal) || 0
  const transferenciaRealNum = Number(transferenciaReal) || 0
  const debitoDif = debitoRealNum - debitoEsperado
  const transferenciaDif = transferenciaRealNum - transferenciaEsperada

  async function guardarArqueo() {
    if (totalContado === 0 && efectivoEsperado === 0 && debitoRealNum === 0 && transferenciaRealNum === 0) {
      showMsg('Cargá al menos un valor para arquear', 'error')
      return
    }
    const difTotal = diferencia + debitoDif + transferenciaDif
    if (!confirm(
      `📋 GUARDAR ARQUEO\n\n` +
      `💵 Efectivo  esperado: $${Math.round(efectivoEsperado).toLocaleString('es-AR')}  |  contado: $${Math.round(totalContado).toLocaleString('es-AR')}  |  dif: ${diferencia >= 0 ? '+' : ''}$${Math.round(diferencia).toLocaleString('es-AR')}\n` +
      `💳 Débito/QR esperado: $${Math.round(debitoEsperado).toLocaleString('es-AR')}  |  real: $${Math.round(debitoRealNum).toLocaleString('es-AR')}  |  dif: ${debitoDif >= 0 ? '+' : ''}$${Math.round(debitoDif).toLocaleString('es-AR')}\n` +
      `🔄 Transfer. esperada: $${Math.round(transferenciaEsperada).toLocaleString('es-AR')}  |  real: $${Math.round(transferenciaRealNum).toLocaleString('es-AR')}  |  dif: ${transferenciaDif >= 0 ? '+' : ''}$${Math.round(transferenciaDif).toLocaleString('es-AR')}\n\n` +
      `DIFERENCIA TOTAL: ${difTotal >= 0 ? '+' : ''}$${Math.round(difTotal).toLocaleString('es-AR')}\n\n` +
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
      debito_esperado: debitoEsperado,
      debito_real: debitoRealNum,
      debito_diferencia: debitoDif,
      transferencia_esperada: transferenciaEsperada,
      transferencia_real: transferenciaRealNum,
      transferencia_diferencia: transferenciaDif,
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
    setDebitoReal('')
    setTransferenciaReal('')
    setNotas('')
    await cargar()
  }

  function limpiarConteo() {
    if (!confirm('¿Limpiar el conteo actual?')) return
    setConteo({})
    setDebitoReal('')
    setTransferenciaReal('')
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

            {/* RESUMEN DEL DIA POR MEDIO DE PAGO */}
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                💼 Ventas registradas hoy ({ventasHoy})
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div style={{ padding: '10px', background: 'rgba(125,255,125,0.06)', borderRadius: 6, border: '1px solid #2d5a2d' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>💵 EFECTIVO</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#7dff7d', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(efectivoEsperado)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ventasEfectivo} venta(s)</div>
                </div>
                <div style={{ padding: '10px', background: 'rgba(122,157,255,0.06)', borderRadius: 6, border: '1px solid #2d3a5a' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>💳 DÉBITO / QR</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#7a9dff', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(debitoEsperado)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ventasDebito} venta(s)</div>
                </div>
                <div style={{ padding: '10px', background: 'rgba(255,209,122,0.06)', borderRadius: 6, border: '1px solid #6a5a2a' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>🔄 TRANSFERENCIA</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#ffd17a', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(transferenciaEsperada)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ventasTransferencia} venta(s)</div>
                </div>
              </div>

              <div style={{ paddingTop: 10, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Facturado total del día</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>
                  {fmt$(efectivoEsperado + debitoEsperado + transferenciaEsperada)}
                </span>
              </div>
            </div>

            {/* ARQUEO FISICO (SOLO EFECTIVO) */}
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Comparación física (solo efectivo)
            </div>

            <div style={{ padding: '10px 12px', background: 'rgba(125,255,125,0.04)', borderRadius: 8, marginBottom: 10, border: '1px solid #2d5a2d' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>💵 EFECTIVO ESPERADO EN CAJA</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#7dff7d', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(efectivoEsperado)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Suma de las {ventasEfectivo} venta(s) cobradas en efectivo</div>
            </div>

            <div style={{ padding: '10px 12px', background: 'rgba(255,209,122,0.05)', borderRadius: 8, marginBottom: 10, border: '1px solid #6a5a2a' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>📦 TOTAL CONTADO (físico)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totalContado)}</div>
            </div>

            <div style={{ padding: '14px 16px', background: diferencia === 0 ? 'rgba(125,255,125,0.06)' : diferencia > 0 ? 'rgba(255,209,122,0.06)' : 'rgba(255,107,107,0.06)', borderRadius: 8, border: `2px solid ${colorDif}`, marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>DIFERENCIA EFECTIVO</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: colorDif, fontFamily: "'Bebas Neue',cursive" }}>
                {diferencia === 0
                  ? '✅ Cuadrado'
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

            {/* CONFIRMACION MANUAL DEBITO/QR Y TRANSFERENCIA */}
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Confirmar contra banco / Mercado Pago
            </div>

            {/* DEBITO/QR */}
            <div style={{ padding: '12px', background: 'rgba(122,157,255,0.04)', borderRadius: 8, marginBottom: 10, border: '1px solid #2d3a5a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>💳 DÉBITO / QR</div>
                <div style={{ fontSize: 12, color: '#7a9dff' }}>Sistema: <b>{fmt$(debitoEsperado)}</b></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                <input type="number" min="0" step="0.01"
                  value={debitoReal} onChange={e => setDebitoReal(e.target.value)}
                  placeholder="Real desde banco/MP"
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 14, fontWeight: 600 }} />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Diferencia</div>
                  <div style={{ fontSize: 16, fontWeight: 700,
                    color: debitoReal === '' ? 'var(--muted)' : debitoDif === 0 ? '#7dff7d' : debitoDif > 0 ? '#ffd17a' : '#ff8b8b',
                    fontFamily: "'Bebas Neue',cursive" }}>
                    {debitoReal === '' ? '—' : (debitoDif >= 0 ? '+' : '') + fmt$(debitoDif)}
                  </div>
                </div>
              </div>
            </div>

            {/* TRANSFERENCIA */}
            <div style={{ padding: '12px', background: 'rgba(255,209,122,0.04)', borderRadius: 8, marginBottom: 14, border: '1px solid #6a5a2a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>🔄 TRANSFERENCIA</div>
                <div style={{ fontSize: 12, color: '#ffd17a' }}>Sistema: <b>{fmt$(transferenciaEsperada)}</b></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
                <input type="number" min="0" step="0.01"
                  value={transferenciaReal} onChange={e => setTransferenciaReal(e.target.value)}
                  placeholder="Real desde banco"
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 14, fontWeight: 600 }} />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Diferencia</div>
                  <div style={{ fontSize: 16, fontWeight: 700,
                    color: transferenciaReal === '' ? 'var(--muted)' : transferenciaDif === 0 ? '#7dff7d' : transferenciaDif > 0 ? '#ffd17a' : '#ff8b8b',
                    fontFamily: "'Bebas Neue',cursive" }}>
                    {transferenciaReal === '' ? '—' : (transferenciaDif >= 0 ? '+' : '') + fmt$(transferenciaDif)}
                  </div>
                </div>
              </div>
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
          <HistorialArqueosPaginado historial={historial} />
        )}
      </div>
    </div>
  )
}

// Sub-componente: pagina la lista de arqueos para evitar tabla interminable.
function HistorialArqueosPaginado({ historial }) {
  const pag = usePaginacion(historial, 20)
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, minWidth: 900 }}>
          <thead>
            <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Fecha</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Hora</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Cajero</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>💵 Efectivo (esp/cont/dif)</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>💳 Débito/QR (esp/real/dif)</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>🔄 Transfer. (esp/real/dif)</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Notas</th>
            </tr>
          </thead>
          <tbody>
            {pag.items.map(a => {
              const dif = Number(a.diferencia) || 0
              const cEf = dif === 0 ? '#7dff7d' : dif > 0 ? '#ffd17a' : '#ff8b8b'
              const dDeb = Number(a.debito_diferencia) || 0
              const cDeb = dDeb === 0 ? '#7dff7d' : dDeb > 0 ? '#ffd17a' : '#ff8b8b'
              const dTra = Number(a.transferencia_diferencia) || 0
              const cTra = dTra === 0 ? '#7dff7d' : dTra > 0 ? '#ffd17a' : '#ff8b8b'
              const tieneDebito = a.debito_esperado != null || a.debito_real != null
              const tieneTrans  = a.transferencia_esperada != null || a.transferencia_real != null
              const fmt$ = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
              return (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 4px' }}>{a.fecha}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{a.hora}</td>
                  <td style={{ padding: '6px 4px' }}>{a.cajero || '—'}</td>
                  <td style={{ textAlign: 'right', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--muted)' }}>{fmt$(a.efectivo_esperado)}</span>
                    <span style={{ color: 'var(--muted)' }}> / </span>
                    <span style={{ fontWeight: 600 }}>{fmt$(a.total_contado)}</span>
                    <span style={{ color: 'var(--muted)' }}> / </span>
                    <span style={{ color: cEf, fontWeight: 700 }}>{dif === 0 ? '$0' : (dif > 0 ? '+' : '') + fmt$(dif)}</span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                    {tieneDebito ? (
                      <>
                        <span style={{ color: 'var(--muted)' }}>{fmt$(a.debito_esperado)}</span>
                        <span style={{ color: 'var(--muted)' }}> / </span>
                        <span style={{ fontWeight: 600 }}>{fmt$(a.debito_real)}</span>
                        <span style={{ color: 'var(--muted)' }}> / </span>
                        <span style={{ color: cDeb, fontWeight: 700 }}>{dDeb === 0 ? '$0' : (dDeb > 0 ? '+' : '') + fmt$(dDeb)}</span>
                      </>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                    {tieneTrans ? (
                      <>
                        <span style={{ color: 'var(--muted)' }}>{fmt$(a.transferencia_esperada)}</span>
                        <span style={{ color: 'var(--muted)' }}> / </span>
                        <span style={{ fontWeight: 600 }}>{fmt$(a.transferencia_real)}</span>
                        <span style={{ color: 'var(--muted)' }}> / </span>
                        <span style={{ color: cTra, fontWeight: 700 }}>{dTra === 0 ? '$0' : (dTra > 0 ? '+' : '') + fmt$(dTra)}</span>
                      </>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--muted)', maxWidth: 250 }}>{a.notas || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Paginador {...pag.controles} label="arqueos" />
    </>
  )
}
