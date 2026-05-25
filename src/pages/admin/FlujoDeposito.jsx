// ============================================================
// FLUJO DEPÓSITO (Admin)
// ============================================================
// Recibe las cargas de medias reses que envían los empleados
// del sector desposte. Admin las corrobora y al aprobar
// procesa según el tipo:
//
//   - media_res_piezas:    abre form de desposte con modelo
//   - media_res_kilo:      registra como desposte "KILO"
//   - media_res_mayorista: registra como reservada mayorista
//   - media_res_minorista: registra como reservada minorista
//
// O simplemente marca como "aprobado" si ya cargó el desposte
// manualmente desde el módulo Depósito.
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { MODELOS_DESPOSTE } from '../../lib/modelosDesposte'
import Paginador, { usePaginacion } from '../../components/Paginador'

const fmt = n => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const LABEL_TIPO = {
  media_res_piezas:     { label: 'En piezas', icono: '🥩', color: 'var(--gold)' },
  media_res_kilo:       { label: 'Venta por kilo', icono: '⚖️', color: '#7a9dff' },
  media_res_mayorista:  { label: 'Mayorista (entera)', icono: '📦', color: '#ffd17a' },
  media_res_minorista:  { label: 'Minorista (entera)', icono: '🏪', color: '#7dff7d' },
}

export default function FlujoDeposito() {
  const { user } = useAuth()
  const [flujos, setFlujos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('pendiente')
  const [msg, setMsg] = useState(null)
  const [confirmando, setConfirmando] = useState(null) // flujo siendo confirmado en modal
  const [procesando, setProcesando]   = useState(false)

  useEffect(() => {
    cargar()
    // Realtime: cuando un empleado envía algo, refrescar
    const canal = supabase.channel('flujo-deposito-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flujo_deposito' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('flujo_deposito').select('*').order('created_at', { ascending: false })
    setFlujos(data || [])
    setLoading(false)
  }

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4000)
  }

  const filtrados = useMemo(() => {
    if (filtroEstado === 'todos') return flujos
    return flujos.filter(f => f.estado === filtroEstado)
  }, [flujos, filtroEstado])

  const pag = usePaginacion(filtrados, 20)
  const pendientes = flujos.filter(f => f.estado === 'pendiente').length

  async function rechazar(f) {
    const motivo = prompt('Motivo del rechazo (opcional):', '')
    if (motivo === null) return
    const { error } = await supabase.from('flujo_deposito').update({
      estado: 'rechazado',
      notas_admin: motivo || 'Rechazado sin motivo',
      aprobado_por: user?.id,
      aprobado_at: new Date().toISOString(),
    }).eq('id', f.id)
    if (error) aviso('❌ ' + error.message, 'error')
    else aviso('Rechazado')
  }

  async function aprobarSimple(f) {
    // Aprobación simple sin procesar (admin lo cargó manualmente en Depósito)
    if (!confirm('Marcar como aprobado sin crear desposte automático?\n(usá esto si ya lo procesaste a mano en Depósito)')) return
    const { error } = await supabase.from('flujo_deposito').update({
      estado: 'aprobado',
      notas_admin: 'Procesado manualmente desde Depósito',
      aprobado_por: user?.id,
      aprobado_at: new Date().toISOString(),
    }).eq('id', f.id)
    if (error) aviso('❌ ' + error.message, 'error')
    else aviso('✅ Aprobado')
  }

  // Abre el modal de confirmación con preview detallado
  function aprobarCreandoDesposte(f) {
    setConfirmando(f)
  }

  // Ejecuta la aprobación (llamada desde el modal de confirmación)
  async function ejecutarAprobacion(f) {
    let modelo = f.modelo || 'KILO'
    if (f.tipo === 'media_res_kilo') modelo = 'KILO'
    if (f.tipo === 'media_res_mayorista') modelo = 'MAYORISTA'
    if (f.tipo === 'media_res_minorista') modelo = 'MINORISTA'

    const piezasFlujo = Array.isArray(f.payload?.piezas) ? f.payload.piezas : []
    const kgPiezasTotal = piezasFlujo.reduce((s, p) => s + (Number(p.kg) || 0), 0)
    const mermaCalc = f.kg_media_res > 0 && kgPiezasTotal > 0
      ? ((f.kg_media_res - kgPiezasTotal) / f.kg_media_res) * 100 : 0

    // Guardia 1: ninguna pieza individual puede pesar más que la media res.
    // Detecta typos en un solo valor (ej. operario tipeó 394 en vez de 39.4).
    if (f.kg_media_res > 0) {
      const piezaInflada = piezasFlujo.find(p => (Number(p.kg) || 0) > f.kg_media_res)
      if (piezaInflada) {
        aviso(`⚠️ Pieza "${piezaInflada.nombre}" tiene ${piezaInflada.kg} kg pero la media res es de ${f.kg_media_res} kg. Rechazá el flujo y pedile al operario que revise.`, 'error')
        return
      }
    }
    // Guardia 2: sanity check de la media res en sí.
    // Rango real Fabricius: 70-140 kg. > 150 kg casi seguro typo.
    if (f.kg_media_res > 150) {
      const ok = window.confirm(
        `⚠️ La media res declara ${f.kg_media_res} kg.\nRango real Fabricius: 70-140 kg.\n¿Estás seguro?`
      )
      if (!ok) { aviso('Aprobación cancelada.', 'error'); return }
    }
    if (f.kg_media_res > 0 && f.kg_media_res < 50) {
      const ok = window.confirm(
        `⚠️ La media res declara solo ${f.kg_media_res} kg.\nRango real Fabricius: 70-140 kg.\n¿Estás seguro?`
      )
      if (!ok) { aviso('Aprobación cancelada.', 'error'); return }
    }
    // Guardia 3: si la suma de piezas supera al peso de la media res por más
    // del 10%, casi seguro hay un typo. Pedir confirmación explícita.
    if (f.kg_media_res > 0 && kgPiezasTotal > f.kg_media_res * 1.1) {
      const ok = window.confirm(
        `⚠️ ATENCIÓN — Valores sospechosos\n\n` +
        `Media res: ${f.kg_media_res} kg\n` +
        `Suma de piezas: ${kgPiezasTotal.toFixed(1)} kg\n\n` +
        `La suma de piezas supera al peso de la media res por mucho.\n` +
        `Probablemente el operario tipeó un kg con un dígito de más.\n\n` +
        `¿Aprobar igual? (No recomendado)`
      )
      if (!ok) { aviso('Aprobación cancelada. Pedile al operario que revise los kg.', 'error'); return }
    }

    setProcesando(true)

    // Insertar desposte
    const { data: desp, error: e1 } = await supabase.from('despostes').insert({
      fecha: f.fecha,
      entrada_id: f.entrada_id,
      modelo,
      tipo_desposte: 'bovino',
      tipo_animal: 'bovino',
      kg_media_res: f.kg_media_res,
      merma_pct: mermaCalc,
      kg_neto: kgPiezasTotal || f.kg_media_res,
      piezas: piezasFlujo,
      notas: `Procesado desde flujo depósito #${f.id} (${f.empleado_nombre || 'empleado'})`,
    }).select().single()
    if (e1) { setProcesando(false); aviso('❌ Error creando desposte: ' + e1.message, 'error'); return }

    // Sumar al stock cada pieza (solo si vos confirmaste en el modal)
    for (const p of piezasFlujo) {
      if (!p.tipo_stock || !p.kg) continue
      const { data: stockRow } = await supabase.from('stock_actual').select('*').eq('tipo', p.tipo_stock).maybeSingle()
      if (stockRow) {
        await supabase.from('stock_actual').update({
          kg_disponible: (Number(stockRow.kg_disponible) || 0) + Number(p.kg)
        }).eq('tipo', p.tipo_stock)
      } else {
        await supabase.from('stock_actual').insert({ tipo: p.tipo_stock, kg_disponible: Number(p.kg) })
      }
    }

    // Marcar entrada como despostada
    if (f.entrada_id) {
      await supabase.from('entradas_deposito')
        .update({ despostada: true, desposte_id: desp.id })
        .eq('id', f.entrada_id)
    }

    // Marcar flujo como aprobado
    const { error: e2 } = await supabase.from('flujo_deposito').update({
      estado: 'aprobado',
      desposte_id: desp.id,
      notas_admin: 'Procesado automáticamente con confirmación',
      aprobado_por: user?.id,
      aprobado_at: new Date().toISOString(),
    }).eq('id', f.id)
    setProcesando(false)
    setConfirmando(null)
    if (e2) { aviso('Desposte creado pero falló enlazar flujo: ' + e2.message, 'error'); return }
    aviso('✅ Flujo aprobado y desposte creado en el sistema')
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Cargando flujo...</p>

  return (
    <div>
      {msg && (
        <div style={{
          position: 'fixed', top: 70, right: 20, zIndex: 1000,
          padding: '14px 22px', borderRadius: 8, fontSize: 14, fontWeight: 700,
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          color: msg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
          border: `1px solid ${msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d'}`,
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>📥 Flujo Depósito</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Cargas que envió el sector desposte para que las apruebes y proceses
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['pendiente', 'aprobado', 'rechazado', 'todos'].map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${filtroEstado === e ? 'var(--gold)' : 'var(--border)'}`,
                background: filtroEstado === e ? 'var(--gold)' : 'transparent',
                color: filtroEstado === e ? '#000' : 'var(--muted)',
                cursor: 'pointer', fontSize: 12, fontWeight: 700,
              }}>
              {e === 'pendiente' && pendientes > 0 && '🔔 '}
              {e.charAt(0).toUpperCase() + e.slice(1)}
              {e === 'pendiente' && pendientes > 0 && ` (${pendientes})`}
            </button>
          ))}
        </div>
      </div>

      {pendientes > 0 && filtroEstado === 'pendiente' && (
        <div style={{ padding: 12, background: '#3a2a14', border: '1px solid #ffd17a', borderRadius: 8, color: '#ffd17a', marginBottom: 12, fontSize: 13 }}>
          🔔 Tenés <strong>{pendientes}</strong> carga(s) pendiente(s) de aprobar. Aprobar crea automáticamente el desposte en el sistema.
        </div>
      )}

      {filtrados.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12 }}>
          Sin flujos {filtroEstado !== 'todos' ? filtroEstado + 's' : ''}.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pag.items.map(f => {
              const info = LABEL_TIPO[f.tipo] || { label: f.tipo, icono: '📋', color: 'var(--muted)' }
              return (
                <div key={f.id} className="card" style={{ padding: 14, borderColor: f.estado === 'pendiente' ? '#ffd17a' : 'var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 250 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 20 }}>{info.icono}</span>
                        <strong style={{ fontSize: 16, color: info.color }}>{info.label}</strong>
                        {f.modelo && <span style={{ background: 'var(--gold)22', color: 'var(--gold)', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Modelo {f.modelo}</span>}
                        <BadgeEstado estado={f.estado} />
                      </div>
                      <div style={{ fontSize: 13 }}>
                        <strong style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue', cursive", fontSize: 22 }}>{fmt(f.kg_media_res)} kg</strong>
                        <span style={{ color: 'var(--muted)', marginLeft: 12 }}>
                          {f.fecha} {f.hora?.slice(0, 5)} · por {f.empleado_nombre || '—'}
                        </span>
                      </div>
                      {f.payload?.modelo_nombre && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                          📋 {f.payload.modelo_nombre}
                        </div>
                      )}
                      {Array.isArray(f.payload?.piezas) && f.payload.piezas.length > 0 && (
                        <div style={{ marginTop: 6, padding: 8, background: 'var(--surface2)', borderRadius: 6 }}>
                          <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>PIEZAS CARGADAS</div>
                          {f.payload.piezas.map((p, i) => (
                            <div key={i} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                              <span>{p.nombre}</span>
                              <strong style={{ color: 'var(--gold)' }}>{fmt(p.kg)} kg</strong>
                            </div>
                          ))}
                          <div style={{ fontSize: 11, color: '#7dff7d', marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                            <strong>Total piezas:</strong>
                            <strong>{fmt(f.payload.kg_piezas_total || f.payload.piezas.reduce((s, p) => s + (Number(p.kg) || 0), 0))} kg</strong>
                          </div>
                        </div>
                      )}
                      {f.payload?.proveedor && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          Proveedor entrada: {f.payload.proveedor}
                        </div>
                      )}
                      {f.notas && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>📝 {f.notas}</div>
                      )}
                      {f.notas_admin && (
                        <div style={{ fontSize: 11, color: '#7a9dff', marginTop: 4 }}>👨‍💼 Admin: {f.notas_admin}</div>
                      )}
                    </div>
                    {f.estado === 'pendiente' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
                        <button onClick={() => aprobarCreandoDesposte(f)}
                          style={{ padding: '10px 14px', background: 'var(--green)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                          ✅ Aprobar y crear desposte
                        </button>
                        <button onClick={() => aprobarSimple(f)}
                          style={{ padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                          ✔ Marcar OK (procesé a mano)
                        </button>
                        <button onClick={() => rechazar(f)}
                          style={{ padding: '8px 14px', background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                          ❌ Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <Paginador {...pag.controles} label="flujos" />
        </>
      )}

      {confirmando && (
        <ModalConfirmarDesposte
          flujo={confirmando}
          procesando={procesando}
          onConfirmar={() => ejecutarAprobacion(confirmando)}
          onCancelar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

// ============================================================
// Modal de confirmación detallada antes de sumar al stock
// ============================================================
function ModalConfirmarDesposte({ flujo, procesando, onConfirmar, onCancelar }) {
  const piezas = Array.isArray(flujo.payload?.piezas) ? flujo.payload.piezas : []
  const kgPiezas = piezas.reduce((s, p) => s + (Number(p.kg) || 0), 0)
  const kgMR = Number(flujo.kg_media_res) || 0
  const merma = kgMR - kgPiezas
  const mermaPct = kgMR > 0 ? (merma / kgMR) * 100 : 0
  const sinPiezas = piezas.length === 0

  const labelStock = {
    bovino_pieza:  '🍖 Bovino Piezas',
    bovino_corte:  '🥩 Bovino Cortes',
    bovino_mr:     '🐄 Media Reses',
    bovino_brosa:  '🫀 Brosa',
  }

  return (
    <div onClick={procesando ? null : onCancelar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '2px solid var(--gold)', borderRadius: 14, padding: 24, maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', marginBottom: 6, letterSpacing: 2 }}>
          ⚠️ CONFIRMAR APROBACIÓN
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Esto va a <strong style={{ color: '#ff8b8b' }}>SUMAR al stock</strong> los kilos de cada pieza y crear el registro de desposte. Revisá bien antes de confirmar.
        </div>

        {/* Datos generales del flujo */}
        <div style={{ padding: 14, background: 'var(--surface2)', borderRadius: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: 'var(--muted)' }}>Empleado:</span>
            <strong>{flujo.empleado_nombre || '—'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: 'var(--muted)' }}>Fecha / hora:</span>
            <strong>{flujo.fecha} {flujo.hora?.slice(0, 5)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: 'var(--muted)' }}>Media res:</span>
            <strong style={{ color: 'var(--gold)', fontFamily: "'Bebas Neue', cursive", fontSize: 22 }}>{fmt(flujo.kg_media_res)} kg</strong>
          </div>
          {flujo.modelo && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)' }}>Modelo:</span>
              <strong>Modelo {flujo.modelo} — {flujo.payload?.modelo_nombre}</strong>
            </div>
          )}
          {flujo.notas && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
              📝 {flujo.notas}
            </div>
          )}
        </div>

        {/* Tabla de piezas a sumar al stock */}
        {!sinPiezas ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#ff8b8b', letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>
              ⚠️ KILOS QUE SE SUMARÁN AL STOCK
            </div>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Pieza</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Va al stock</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Kg</th>
                </tr>
              </thead>
              <tbody>
                {piezas.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 8px', fontWeight: 600 }}>{p.nombre}</td>
                    <td style={{ padding: '8px 8px', color: 'var(--muted)', fontSize: 12 }}>
                      {labelStock[p.tipo_stock] || p.tipo_stock || '—'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 8px', color: 'var(--gold)', fontWeight: 700 }}>
                      +{fmt(p.kg)} kg
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--gold)' }}>
                  <td colSpan={2} style={{ padding: '8px 8px', fontWeight: 700, color: '#7dff7d' }}>TOTAL al stock</td>
                  <td style={{ textAlign: 'right', padding: '8px 8px', color: '#7dff7d', fontWeight: 800, fontFamily: "'Bebas Neue', cursive", fontSize: 20 }}>
                    +{fmt(kgPiezas)} kg
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Cuadro de merma */}
            <div style={{
              marginTop: 12, padding: 10, borderRadius: 8,
              background: merma < 0 ? '#3a1a1a' : mermaPct > 10 ? '#3a2a14' : '#1a2a1a',
              border: `1px solid ${merma < 0 ? '#ff6b6b' : mermaPct > 10 ? '#ffd17a' : '#7dff7d'}`,
              fontSize: 13,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Merma del desposte:</span>
                <strong style={{ color: merma < 0 ? '#ff8b8b' : mermaPct > 10 ? '#ffd17a' : '#7dff7d' }}>
                  {fmt(Math.abs(merma))} kg ({Math.abs(mermaPct).toFixed(1)}%)
                </strong>
              </div>
              {merma < 0 && (
                <div style={{ fontSize: 11, color: '#ff8b8b', marginTop: 4 }}>
                  ⚠️ Las piezas suman MÁS que la media res. Posible error de carga.
                </div>
              )}
              {mermaPct > 10 && merma > 0 && (
                <div style={{ fontSize: 11, color: '#ffd17a', marginTop: 4 }}>
                  ⚠️ Merma alta — verificá que el empleado haya cargado todas las piezas.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ padding: 14, background: 'var(--surface2)', borderRadius: 8, fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            ℹ️ Este flujo no tiene piezas con kilos (probablemente Mayorista/Minorista/Kilo).
            Solo se va a crear el registro de desposte sin tocar el stock.
          </div>
        )}

        {/* Botones */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancelar} disabled={procesando}
            style={{ flex: 1, padding: 14, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 10, cursor: procesando ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}>
            ✕ Cancelar
          </button>
          <button onClick={onConfirmar} disabled={procesando}
            style={{ flex: 2, padding: 14, background: 'var(--green)', color: '#000', border: 'none', borderRadius: 10, cursor: procesando ? 'wait' : 'pointer', fontWeight: 800, fontFamily: "'Bebas Neue', cursive", fontSize: 18, letterSpacing: 2 }}>
            {procesando ? '⏳ PROCESANDO...' : (sinPiezas ? '✅ APROBAR (sin tocar stock)' : `✅ CONFIRMAR Y SUMAR ${fmt(kgPiezas)} KG AL STOCK`)}
          </button>
        </div>
      </div>
    </div>
  )
}

function BadgeEstado({ estado }) {
  const cfg = {
    pendiente:  { bg: '#3a2a14', color: '#ffd17a', label: '⏳ Pendiente' },
    aprobado:   { bg: '#1a2a1a', color: '#7dff7d', label: '✅ Aprobado' },
    rechazado:  { bg: '#3a1a1a', color: '#ff8b8b', label: '❌ Rechazado' },
  }[estado] || { bg: 'var(--surface2)', color: 'var(--muted)', label: estado }
  return (
    <span style={{ background: cfg.bg, color: cfg.color, padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
      {cfg.label}
    </span>
  )
}
