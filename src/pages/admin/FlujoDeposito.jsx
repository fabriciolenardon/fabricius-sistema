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

  async function aprobarCreandoDesposte(f) {
    // Crear un desposte real y enlazarlo
    let modelo = f.modelo || 'KILO'
    if (f.tipo === 'media_res_kilo') modelo = 'KILO'
    if (f.tipo === 'media_res_mayorista') modelo = 'MAYORISTA'
    if (f.tipo === 'media_res_minorista') modelo = 'MINORISTA'

    if (!confirm(`Crear desposte en el sistema:\n\nMedia res: ${fmt(f.kg_media_res)} kg\nModo: ${modelo}\n\n¿Confirmar?`)) return

    // Insertar desposte
    const { data: desp, error: e1 } = await supabase.from('despostes').insert({
      fecha: f.fecha,
      entrada_id: f.entrada_id,
      modelo,
      tipo_desposte: 'bovino',
      tipo_animal: 'bovino',
      kg_media_res: f.kg_media_res,
      merma_pct: 0,
      kg_neto: f.kg_media_res,
      piezas: [],
      notas: `Procesado desde flujo depósito #${f.id} (${f.empleado_nombre || 'empleado'})`,
    }).select().single()
    if (e1) return aviso('❌ Error creando desposte: ' + e1.message, 'error')

    // Si había entrada_id, marcarla como despostada
    if (f.entrada_id) {
      await supabase.from('entradas_deposito')
        .update({ despostada: true, desposte_id: desp.id })
        .eq('id', f.entrada_id)
    }

    // Marcar flujo como aprobado y enlazar
    const { error: e2 } = await supabase.from('flujo_deposito').update({
      estado: 'aprobado',
      desposte_id: desp.id,
      notas_admin: 'Procesado automáticamente',
      aprobado_por: user?.id,
      aprobado_at: new Date().toISOString(),
    }).eq('id', f.id)
    if (e2) return aviso('Desposte creado pero falló enlazar flujo: ' + e2.message, 'error')

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
