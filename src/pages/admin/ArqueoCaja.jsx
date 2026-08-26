// ============================================================
// ARQUEO DE CAJA
// ============================================================
// Permite al cajero contar físicamente los billetes/monedas al cierre
// del día y compararlos con el efectivo esperado (suma de ventas en
// efectivo del día). Guarda el arqueo en la tabla arqueos_caja con
// la diferencia (sobrante, faltante o cuadrado).
//
// ── ARQUEO CIEGO (rol cajero) ────────────────────────────────
// Al CAJERO no se le muestra cuánto tendría que haber hasta DESPUÉS de
// guardar. Cuenta, guarda, y recién ahí ve la diferencia.
//
// Por qué. Si ve el objetivo, el conteo deja de ser una medición y pasa a
// ser una copia de lo ticketeado: se cuenta hasta llegar al número. Y en
// Fabricius eso es caro por partida doble —
//   1. El minorista SALE del arqueo, no de los tickets (ver el Dashboard
//      Ejecutivo). O sea que el arqueo no es un control sobre la
//      facturación: ES la facturación. Si se acomoda, se acomoda el número
//      con el que se calculan los márgenes y el mes.
//   2. AlertasAnomalias vigila faltantes > $5.000 del día y > $20.000 de la
//      semana. Con el esperado a la vista, esa alarma no suena nunca.
// Es el mismo criterio de la planilla CIEGA del conteo de stock: se cuenta
// sin la cantidad del sistema al lado.
//
// Los admin (Fabricio, Ariel, Giuliana) y el personal de sucursal ven todo
// siempre: son los que controlan, no los controlados.
//
// TRAMPA al tocar esta pantalla: el esperado no se filtra sólo por los
// carteles grandes. También se escapa por los avisos previos a confirmar
// ("el día tiene $X en efectivo") y por el resumen de confirmación. Si
// agregás un aviso nuevo que cite un monto del sistema, ponelo detrás de
// `ciego` o estás abriendo el agujero de nuevo por la ventana.
// ============================================================
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fechaHoyARG, horaHoyARG } from '../../lib/fechas'
import { parseNumero, fmtPrecio } from '../../lib/formatos'
import Paginador, { usePaginacion } from '../../components/Paginador'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))

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

  // NUEVO: fecha del arqueo (para cargar arqueos de dias pasados) +
  // modo rapido (input simple en lugar de conteo billete-por-billete,
  // util para backfills donde solo se sabe el total contado).
  const [fechaArqueo, setFechaArqueo] = useState(fechaHoyARG())
  const [modoRapido, setModoRapido] = useState(false)
  const [efectivoContadoRapido, setEfectivoContadoRapido] = useState('')

  // EDICION: cuando setEditandoId !== null, el form esta editando un arqueo
  // existente en lugar de crear uno nuevo. Solo el CEO puede editar.
  const [editandoId, setEditandoId] = useState(null)
  // Confirmacion inline del guardado. NO usar window.confirm(): iOS lo
  // suprime silenciosamente en la app instalada (PWA) y el guardado
  // quedaba bloqueado sin ningun mensaje.
  const [confirmandoGuardar, setConfirmandoGuardar] = useState(false)
  // Confirmacion inline del BORRADO (mismo motivo que arriba: nada de
  // window.confirm). Guarda el arqueo pendiente de eliminar.
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(null)
  // Permiso de dueño centralizado en lib/permisos.js (antes se comparaba
  // el email a mano acá).
  // `ciego` = arqueo a ciegas para el rol cajero (ver cabecera del archivo).
  const { isCEO: esCEO, isCajero: ciego, profile } = useAuth()
  // Resultado del arqueo recién guardado, para revelárselo al cajero DESPUÉS
  // de cerrarlo. Es una foto: se congela con los valores del guardado, así
  // el formulario se puede limpiar sin que la revelación se borre.
  const [revelado, setRevelado] = useState(null)
  // Para llevar el foco al campo del nombre cuando frena el guardado: un
  // cartel de error arriba se pasa por alto, el cursor parpadeando no.
  const cajeroRef = useRef(null)

  // Recargar ventas cuando cambia la fecha seleccionada (y cerrar la
  // confirmacion pendiente para no guardar contra datos de otro dia)
  useEffect(() => { setConfirmandoGuardar(false); setRevelado(null); cargar() }, [fechaArqueo])

  // QUIÉN CIERRA LA CAJA. El campo se pedía a mano y venía vacío en 48 de los
  // últimos 51 arqueos — el aviso se ignoraba. Ahora es obligatorio (ver
  // guardarArqueo).
  //
  // EN LA CAJA NO SE PRECARGA, a propósito: `caja2` es una cuenta COMPARTIDA
  // por todas las chicas del mostrador, así que el nombre del perfil
  // ("Cajera") no identifica a nadie. Precargarlo convertiría el campo
  // obligatorio en un trámite — se aprieta guardar y listo, y seguiríamos sin
  // saber quién contó. Tiene que escribir su nombre.
  //
  // A los admin sí se les precarga: cada uno tiene su cuenta personal, y ahí
  // el nombre del perfil ES la persona.
  const nombrePorDefecto = () => (ciego ? '' : (profile?.nombre || ''))

  // Dep sin `cajero` a propósito: si dependiera de él, borrar el campo para
  // escribir otro nombre lo volvería a llenar en el acto.
  useEffect(() => {
    if (!ciego && !editandoId && !cajero && profile?.nombre) setCajero(profile.nombre)
  }, [profile, ciego])

  async function cargar() {
    setLoading(true)
    const [{ data: ventas }, { data: arqueos }] = await Promise.all([
      supabase.from('ventas_minoristas').select('efectivo, debito, transferencia').eq('origen', 'caja').eq('fecha', fechaArqueo),
      fetchAllRows(() => supabase.from('arqueos_caja').select('*').order('fecha', { ascending: false }).order('hora', { ascending: false })),
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

  // Eliminar arqueo viejo (solo CEO — protegido en UI y en runtime).
  // Pide confirmacion inline: setea confirmandoBorrar y la fila del
  // historial muestra los botones "Sí" / "No".
  function pedirEliminarArqueo(arqueo) {
    if (!esCEO) {
      showMsg('❌ Solo el CEO puede eliminar arqueos', 'error')
      return
    }
    setConfirmandoBorrar(arqueo)
  }

  async function eliminarArqueo(arqueo) {
    if (!esCEO) {
      showMsg('❌ Solo el CEO puede eliminar arqueos', 'error')
      return
    }
    setConfirmandoBorrar(null)
    const { error } = await supabase.from('arqueos_caja').delete().eq('id', arqueo.id)
    if (error) {
      showMsg('❌ Error al eliminar: ' + error.message, 'error')
      return
    }
    showMsg('✅ Arqueo eliminado', 'success')
    await cargar()
  }

  // Cargar los valores del arqueo viejo en el form para editarlo.
  // Tambien cambia la fecha seleccionada para que el "esperado" se
  // recalcule mostrando las ventas reales de ese dia.
  function iniciarEdicion(arqueo) {
    if (!esCEO) {
      showMsg('❌ Solo el CEO puede editar arqueos', 'error')
      return
    }
    setConfirmandoGuardar(false)
    setEditandoId(arqueo.id)
    setFechaArqueo(arqueo.fecha)
    setConteo(arqueo.billetes || {})
    setDebitoReal(String(arqueo.debito_real || ''))
    setTransferenciaReal(String(arqueo.transferencia_real || ''))
    setNotas(arqueo.notas || '')
    setCajero(arqueo.cajero || '')
    // Si el arqueo viejo fue cargado en modo rapido (sin desglose),
    // arrancamos en modo rapido con el total_contado precargado
    const billetesObj = arqueo.billetes || {}
    const sinDesglose = Object.keys(billetesObj).length === 0
    if (sinDesglose && Number(arqueo.total_contado) > 0) {
      setModoRapido(true)
      setEfectivoContadoRapido(String(arqueo.total_contado))
    } else {
      setModoRapido(false)
      setEfectivoContadoRapido('')
    }
    // Scroll al tope para que vea el form
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicion() {
    setConfirmandoGuardar(false)
    setEditandoId(null)
    setConteo({})
    setDebitoReal('')
    setTransferenciaReal('')
    setEfectivoContadoRapido('')
    setNotas('')
    setCajero(nombrePorDefecto())  // admin: su nombre · caja: vacío, lo escribe
    setModoRapido(false)
    setFechaArqueo(fechaHoyARG())
  }

  function showMsg(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4000)
  }

  // Empezar a contar de nuevo tapa la revelación del arqueo anterior: si
  // quedara en pantalla, el cajero tendría el esperado a la vista mientras
  // cuenta — exactamente lo que este modo evita.
  function setCantidad(valor, cant) {
    setRevelado(null)
    setConteo(c => ({ ...c, [valor]: cant }))
  }

  function setContadoRapido(v) {
    setRevelado(null)
    setEfectivoContadoRapido(v)
  }

  // === Cálculos en vivo ===
  // En modo normal: suma billete por billete del conteo
  // En modo rapido: usa el input unico de efectivo contado (para backfill)
  const totalContado = useMemo(() => {
    if (modoRapido) return parseNumero(efectivoContadoRapido)
    return DENOMINACIONES.reduce((s, d) => s + (parseInt(conteo[d.valor]) || 0) * d.valor, 0)
  }, [conteo, modoRapido, efectivoContadoRapido])

  const diferencia = totalContado - efectivoEsperado
  const debitoRealNum = parseNumero(debitoReal)
  const transferenciaRealNum = parseNumero(transferenciaReal)
  const debitoDif = debitoRealNum - debitoEsperado
  const transferenciaDif = transferenciaRealNum - transferenciaEsperada

  // ============================================================
  // AVISOS ANTES DE CONFIRMAR — "esto no parece un arqueo bueno"
  // ============================================================
  // El arqueo se guarda igual (a veces la realidad es rara: un día
  // con diferencia grande de verdad existe), pero el que guarda tiene
  // que VERLO antes de apretar. Nació del 14/08/2026: se guardó un
  // arqueo vacío arriba del bueno y quedó un faltante falso de $428.393
  // que disparó alertas en el Dashboard durante días.
  const totalEsperadoDia = efectivoEsperado + debitoEsperado + transferenciaEsperada
  const difTotal = diferencia + debitoDif + transferenciaDif

  // ¿Ya hay un arqueo guardado para esta fecha? (si estoy editando ESE,
  // no cuenta — es el que estoy corrigiendo)
  const arqueoDuplicado = useMemo(
    () => (historial || []).find(a => a.fecha === fechaArqueo && a.id !== editandoId),
    [historial, fechaArqueo, editandoId],
  )

  const avisos = useMemo(() => {
    const out = []
    const push = (nivel, texto) => out.push({ nivel, texto })

    // Los avisos que citan un monto del sistema van con dos redacciones: la
    // completa para quien puede ver el esperado, y una SIN NÚMERO para el
    // cajero. El aviso tiene que seguir sonando igual — lo que no puede es
    // soplarle el objetivo justo cuando está por confirmar el conteo.
    if (arqueoDuplicado) {
      const d = Number(arqueoDuplicado.diferencia) || 0
      const hora = arqueoDuplicado.hora ? ` a las ${String(arqueoDuplicado.hora).slice(0, 5)}` : ''
      const cuanto = ciego ? '' : ` (${d >= 0 ? '+' : '−'}${fmt$(d)})`
      push('alto', `Ya hay un arqueo del ${fechaArqueo}${hora}${cuanto}. Si guardás este, quedan los DOS y el día va a mostrar un sobrante y un faltante a la vez. Para corregir el que ya está, cancelá y usá ✏️ en el historial.`)
    }
    if (totalContado === 0 && efectivoEsperado > 0) {
      push('alto', ciego
        ? 'Estás guardando $0 de efectivo contado y el día tiene ventas cobradas en efectivo. Va a quedar como un faltante de todo el día.'
        : `Estás guardando $0 de efectivo contado, pero el día tiene ${fmt$(efectivoEsperado)} de ventas en efectivo. Va a quedar como un faltante de todo el día.`)
    }
    if (debitoRealNum === 0 && debitoEsperado > 0) {
      push('alto', ciego
        ? 'Débito/QR en $0 y el día tiene cobros con posnet registrados. ¿Te falta cargar el cierre del posnet?'
        : `Débito/QR en $0 con ${fmt$(debitoEsperado)} esperados. ¿Te falta cargar el cierre del posnet?`)
    }
    if (transferenciaRealNum === 0 && transferenciaEsperada > 0) {
      push('alto', ciego
        ? 'Transferencias en $0 y el día tiene cobros por transferencia registrados. ¿Te falta cargar el resumen del banco?'
        : `Transferencias en $0 con ${fmt$(transferenciaEsperada)} esperadas. ¿Te falta cargar el resumen del banco?`)
    }
    if (totalEsperadoDia === 0 && (totalContado > 0 || debitoRealNum > 0 || transferenciaRealNum > 0)) {
      push('alto', `El ${fechaArqueo} no tiene NINGUNA venta cargada en el sistema y estás arqueando plata. Fijate que la fecha sea la correcta.`)
    }
    // Diferencia grande: relativa al día y con piso en pesos, para no
    // avisar por monedas en un día flojo ni callarse en uno grande.
    // AL CAJERO NO SE LE MUESTRA, ni siquiera sin el monto: un aviso que
    // aparece y desaparece según cuánto cargó es un termómetro — probando
    // valores hasta que se apaga, deduce el esperado igual.
    if (!ciego && totalEsperadoDia > 0 && Math.abs(difTotal) > 20000 && Math.abs(difTotal) > totalEsperadoDia * 0.1) {
      push('medio', `La diferencia total (${difTotal >= 0 ? '+' : '−'}${fmt$(difTotal)}) es más del 10% de lo esperado del día. Vale la pena recontar antes de dejarlo asentado.`)
    }
    // (El nombre de quien cierra NO va acá: dejó de ser un aviso y pasó a ser
    // un requisito — se bloquea en guardarArqueo(), así que nunca se llega a
    // esta pantalla con el campo vacío.)
    return out
  }, [arqueoDuplicado, fechaArqueo, totalContado, efectivoEsperado, debitoRealNum, debitoEsperado,
      transferenciaRealNum, transferenciaEsperada, totalEsperadoDia, difTotal, cajero, ciego])

  const hayAvisosAltos = avisos.some(a => a.nivel === 'alto')

  function guardarArqueo() {
    // QUIÉN CIERRA LA CAJA ES OBLIGATORIO. Antes era un aviso amarillo y se
    // ignoraba: 48 de los últimos 51 arqueos quedaron sin nombre. Una
    // diferencia sin dueño no se puede preguntar — y con el arqueo ciego el
    // dato pasa a ser la mitad del control, así que acá se frena.
    const pedirNombre = () => {
      cajeroRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      cajeroRef.current?.focus()
    }
    const quienCierra = cajero.trim()
    if (!quienCierra) {
      showMsg('❌ Poné quién está cerrando la caja. Sin nombre el arqueo no se guarda.', 'error')
      pedirNombre()
      return
    }
    // Que no zafe poniendo el nombre de la cuenta: `caja2` la comparten todas,
    // así que "Cajera" identifica tan poco como dejarlo vacío.
    if (profile?.nombre && quienCierra.toLowerCase() === String(profile.nombre).trim().toLowerCase() && ciego) {
      showMsg(`❌ "${profile.nombre}" es el nombre de la cuenta, no de una persona. Poné tu nombre.`, 'error')
      pedirNombre()
      return
    }
    // Ni con una inicial. Dos letras no sirven para preguntarle a nadie.
    if (quienCierra.length < 3) {
      showMsg('❌ Escribí tu nombre completo, no una inicial.', 'error')
      pedirNombre()
      return
    }
    // Los tres valores REALES en 0 = no se cargó nada. Antes esto se
    // guardaba igual si el día tenía ventas (porque el esperado no era 0)
    // y el arqueo quedaba con un "faltante" del total esperado — un
    // fantasma. Pasó el 14/08/2026: un arqueo vacío guardado 14 segundos
    // después del bueno inventó un faltante de $428.393 y disparó las
    // alertas del Dashboard. Un día sin efectivo es posible (todo débito
    // o transferencia), pero entonces alguno de los otros dos viene con
    // valor: que los TRES estén en 0 con ventas cargadas no existe.
    if (totalContado === 0 && debitoRealNum === 0 && transferenciaRealNum === 0) {
      const hayVentas = efectivoEsperado > 0 || debitoEsperado > 0 || transferenciaEsperada > 0
      showMsg(hayVentas
        ? '⚠️ Está todo en 0 y el día tiene ventas. Cargá lo contado antes de guardar (si no, queda un faltante falso).'
        : 'Cargá al menos un valor para arquear', 'error')
      return
    }
    setConfirmandoGuardar(true)
  }

  async function confirmarGuardarArqueo() {
    setConfirmandoGuardar(false)
    setGuardando(true)
    // En modo rapido no tenemos desglose por denominacion; guardamos
    // billetes como {} y agregamos nota indicando que fue backfill manual
    const notaSinPrefix = (notas || '').replace(/^\[BACKFILL[^\]]*\]\s*/, '')  // evita acumular prefijos al editar
    const notaFinal = modoRapido
      ? `[BACKFILL MANUAL — sin desglose billete-por-billete] ${notaSinPrefix}`.trim()
      : (notaSinPrefix || null)
    const payload = {
      fecha: fechaArqueo,
      billetes: modoRapido ? {} : conteo,
      total_contado: totalContado,
      efectivo_esperado: efectivoEsperado,
      diferencia,
      debito_esperado: debitoEsperado,
      debito_real: debitoRealNum,
      debito_diferencia: debitoDif,
      transferencia_esperada: transferenciaEsperada,
      transferencia_real: transferenciaRealNum,
      transferencia_diferencia: transferenciaDif,
      notas: notaFinal,
      cajero: cajero || null,
    }
    // Si estamos editando preservamos la hora original y hacemos UPDATE.
    // Si es nuevo, ponemos hora actual y hacemos INSERT.
    let error
    if (editandoId) {
      const result = await supabase.from('arqueos_caja').update(payload).eq('id', editandoId)
      error = result.error
    } else {
      const result = await supabase.from('arqueos_caja').insert({ ...payload, hora: horaHoyARG() })
      error = result.error
    }
    setGuardando(false)
    if (error) {
      showMsg('❌ Error: ' + error.message, 'error')
      return
    }
    showMsg(`✅ Arqueo del ${fechaArqueo} ${editandoId ? 'actualizado' : 'guardado'}`, 'success')
    // REVELACIÓN: el conteo ya quedó asentado, así que ahora sí se puede
    // mostrar contra qué se comparó. Antes de este punto el cajero no vio
    // ningún esperado. Se congela una foto porque abajo se limpia el form.
    setRevelado({
      fecha: fechaArqueo,
      efectivoEsperado, totalContado, diferencia,
      debitoEsperado, debitoRealNum, debitoDif,
      transferenciaEsperada, transferenciaRealNum, transferenciaDif,
      difTotal,
    })
    setConteo({})
    setDebitoReal('')
    setTransferenciaReal('')
    setEfectivoContadoRapido('')
    setNotas('')
    setCajero(nombrePorDefecto())  // admin: su nombre · caja: vacío, lo escribe
    setEditandoId(null)
    await cargar()
  }

  function limpiarConteo() {
    if (!confirm('¿Limpiar el conteo actual?')) return
    setConteo({})
    setDebitoReal('')
    setTransferenciaReal('')
    setEfectivoContadoRapido('')
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

      {/* ============================================================
          REVELACIÓN — el arqueo ya quedó asentado, recién ahora se
          muestra contra qué se comparó. El cajero cerró a ciegas y acá
          ve cómo le fue; ya no puede cambiar el conteo de ese arqueo.
          ============================================================ */}
      {revelado && (
        <div style={{
          background: revelado.difTotal === 0 ? 'rgba(125,255,125,0.06)' : 'rgba(255,209,122,0.06)',
          border: `2px solid ${revelado.difTotal === 0 ? '#7dff7d' : 'var(--gold)'}`,
          borderRadius: 10, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: 'var(--gold)' }}>
              🔓 ARQUEO DEL {revelado.fecha} CERRADO — ASÍ TE FUE
            </div>
            <button onClick={() => setRevelado(null)}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ✕ Cerrar
            </button>
          </div>

          <div style={{
            fontSize: 30, fontWeight: 800, fontFamily: "'Bebas Neue',cursive", marginBottom: 10,
            color: revelado.diferencia === 0 ? '#7dff7d' : revelado.diferencia > 0 ? '#ffd17a' : '#ff8b8b',
          }}>
            {revelado.diferencia === 0
              ? '✅ Efectivo cuadrado'
              : revelado.diferencia > 0
                ? `⚠️ Sobrante en efectivo: +${fmt$(revelado.diferencia)}`
                : `❌ Faltante en efectivo: ${fmt$(revelado.diferencia)}`}
          </div>

          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            <div>💵 Efectivo — esperado {fmt$(revelado.efectivoEsperado)} · contaste <b>{fmt$(revelado.totalContado)}</b></div>
            <div>💳 Débito/QR — esperado {fmt$(revelado.debitoEsperado)} · cargaste <b>{fmt$(revelado.debitoRealNum)}</b> · dif {revelado.debitoDif >= 0 ? '+' : ''}{fmt$(revelado.debitoDif)}</div>
            <div>🔄 Transfer. — esperada {fmt$(revelado.transferenciaEsperada)} · cargaste <b>{fmt$(revelado.transferenciaRealNum)}</b> · dif {revelado.transferenciaDif >= 0 ? '+' : ''}{fmt$(revelado.transferenciaDif)}</div>
            <div style={{ marginTop: 6, fontWeight: 800, color: revelado.difTotal === 0 ? '#7dff7d' : '#ffd17a' }}>
              DIFERENCIA TOTAL: {revelado.difTotal >= 0 ? '+' : ''}{fmt$(revelado.difTotal)}
            </div>
          </div>

          {ciego && revelado.diferencia !== 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
              {revelado.diferencia > 0
                ? 'Sobró plata: fijate si alguien pagó y no se cargó la venta, o si te dieron de más y no diste el vuelto completo.'
                : 'Faltó plata: suele ser un vuelto mal dado o una venta cobrada sin registrar. Si te acordás de cuál fue, dejalo escrito en las notas del arqueo.'}
            </div>
          )}
        </div>
      )}

      {/* BANNER DE EDICION CEO */}
      {editandoId && (
        <div style={{
          background: 'linear-gradient(90deg, #2a1a0a, #1a1408)',
          border: '2px solid var(--gold)', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>✏️ EDITANDO ARQUEO #{editandoId}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Estás modificando un arqueo existente. Los valores que carges van a reemplazar a los actuales al guardar.
            </div>
          </div>
          <button onClick={cancelarEdicion}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ✕ Cancelar edición
          </button>
        </div>
      )}

      {/* SELECTOR DE FECHA + MODO RAPIDO (backfill) */}
      <div className="card" style={{ marginBottom: 16, padding: 14, background: fechaArqueo !== fechaHoyARG() ? 'rgba(255,209,122,0.04)' : 'var(--surface)' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 FECHA DEL ARQUEO</label>
            <input type="date" value={fechaArqueo} max={fechaHoyARG()}
              onChange={e => setFechaArqueo(e.target.value)}
              style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600 }} />
            {fechaArqueo !== fechaHoyARG() && (
              <div style={{ fontSize: 10, color: '#ffd17a', marginTop: 4 }}>⚠️ Cargando arqueo de día pasado</div>
            )}
          </div>

          {/* Aviso temprano de duplicado: mejor enterarse ANTES de contar
              todo de nuevo que en la confirmación. */}
          {arqueoDuplicado && !editandoId && (
            <div style={{ flex: '1 1 320px', minWidth: 260, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,107,107,0.10)', border: '1px solid var(--red-light)', color: '#ff8b8b', fontSize: 12, lineHeight: 1.5 }}>
              🚨 <b>Ya hay un arqueo del {fechaArqueo}</b>
              {arqueoDuplicado.hora ? ` (${String(arqueoDuplicado.hora).slice(0, 5)})` : ''}. Si querés corregirlo,
              usá el ✏️ del historial — si guardás otro quedan los dos y el día muestra sobrante y faltante a la vez.
            </div>
          )}

          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>MODO DE CARGA</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setModoRapido(false)}
                style={{
                  padding: '8px 14px', borderRadius: 6,
                  border: `1px solid ${!modoRapido ? 'var(--gold)' : 'var(--border)'}`,
                  background: !modoRapido ? 'var(--gold)' : 'transparent',
                  color: !modoRapido ? '#000' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}>🧾 Conteo detallado</button>
              <button onClick={() => setModoRapido(true)}
                style={{
                  padding: '8px 14px', borderRadius: 6,
                  border: `1px solid ${modoRapido ? 'var(--gold)' : 'var(--border)'}`,
                  background: modoRapido ? 'var(--gold)' : 'transparent',
                  color: modoRapido ? '#000' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}>⚡ Modo rápido</button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
              {modoRapido
                ? 'Solo total (sin desglose por billete). Para backfills aproximados.'
                : 'Billete por billete y moneda por moneda. Para arqueo real diario.'}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>

        {/* CONTEO DE BILLETES o MODO RAPIDO */}
        <div className="card">
          <div className="card-title">{modoRapido ? '⚡ Total contado (modo rápido)' : '💵 Conteo físico de la caja'}</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {modoRapido
              ? 'Ingresá solo el total que contaste en efectivo. Útil para cargar arqueos de días pasados aproximados.'
              : 'Cargá cuántos billetes/monedas tenés de cada denominación.'}
          </p>

          {modoRapido && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💵 EFECTIVO CONTADO TOTAL</label>
              <input type="text" inputMode="decimal"
                value={efectivoContadoRapido}
                onChange={e => setContadoRapido(e.target.value)}
                placeholder="Ej: 50000 o 50.000,50"
                autoFocus
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '14px 16px', fontSize: 20, fontWeight: 700, fontFamily: "'Bebas Neue',cursive" }} />
              {efectivoContadoRapido && (
                <div style={{ marginTop: 10, padding: 10, background: 'var(--surface2)', borderRadius: 6, fontSize: 13 }}>
                  Vas a registrar: <strong style={{ color: 'var(--gold)' }}>{fmt$(totalContado)}</strong> en efectivo
                </div>
              )}
            </div>
          )}
          {!modoRapido && (
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
          )}
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

            {/* RESUMEN DEL DIA POR MEDIO DE PAGO — el esperado en crudo.
                Es lo primero que se tapa en modo ciego. */}
            {!ciego && (
            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                💼 Ventas registradas {fechaArqueo === fechaHoyARG() ? 'hoy' : `el ${fechaArqueo}`} ({ventasHoy})
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
            )}

            {/* ARQUEO FISICO (SOLO EFECTIVO) */}
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              {ciego ? 'Conteo a ciegas (solo efectivo)' : 'Comparación física (solo efectivo)'}
            </div>

            {ciego ? (
              <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 10, border: '1px dashed var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>🙈 EFECTIVO ESPERADO EN CAJA</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--muted)', fontFamily: "'Bebas Neue',cursive" }}>OCULTO HASTA GUARDAR</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>
                  Contá la caja como esté y guardá. La diferencia aparece
                  enseguida — pero después, para que el conteo sea el de verdad
                  y no el que "tenía que dar".
                </div>
              </div>
            ) : (
              <div style={{ padding: '10px 12px', background: 'rgba(125,255,125,0.04)', borderRadius: 8, marginBottom: 10, border: '1px solid #2d5a2d' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>💵 EFECTIVO ESPERADO EN CAJA</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#7dff7d', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(efectivoEsperado)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Suma de las {ventasEfectivo} venta(s) cobradas en efectivo</div>
              </div>
            )}

            <div style={{ padding: '10px 12px', background: 'rgba(255,209,122,0.05)', borderRadius: 8, marginBottom: 10, border: '1px solid #6a5a2a' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>📦 TOTAL CONTADO (físico)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(totalContado)}</div>
            </div>

            {ciego ? null : totalContado === 0 ? (
              <div style={{ padding: '14px 16px', background: 'var(--surface2)', borderRadius: 8, border: '2px dashed var(--border)', marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>DIFERENCIA EFECTIVO</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)', marginTop: 4 }}>
                  ⏳ Empezá a contar billetes y monedas arriba para ver la diferencia
                </div>
              </div>
            ) : (
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
            )}

            {/* CONFIRMACION MANUAL DEBITO/QR Y TRANSFERENCIA */}
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Confirmar contra banco / Mercado Pago
            </div>

            {/* DEBITO/QR */}
            <div style={{ padding: '12px', background: 'rgba(122,157,255,0.04)', borderRadius: 8, marginBottom: 10, border: '1px solid #2d3a5a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>💳 DÉBITO / QR</div>
                {!ciego && <div style={{ fontSize: 12, color: '#7a9dff' }}>Sistema: <b>{fmt$(debitoEsperado)}</b></div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: ciego ? '1fr' : '1fr 1fr', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="decimal"
                  value={debitoReal} onChange={e => setDebitoReal(e.target.value)}
                  placeholder={ciego ? 'Total del cierre del posnet' : 'Real desde banco/MP'}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 14, fontWeight: 600 }} />
                {!ciego && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Diferencia</div>
                    <div style={{ fontSize: 16, fontWeight: 700,
                      color: debitoReal === '' ? 'var(--muted)' : debitoDif === 0 ? '#7dff7d' : debitoDif > 0 ? '#ffd17a' : '#ff8b8b',
                      fontFamily: "'Bebas Neue',cursive" }}>
                      {debitoReal === '' ? '—' : (debitoDif >= 0 ? '+' : '') + fmt$(debitoDif)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* TRANSFERENCIA */}
            <div style={{ padding: '12px', background: 'rgba(255,209,122,0.04)', borderRadius: 8, marginBottom: 14, border: '1px solid #6a5a2a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>🔄 TRANSFERENCIA</div>
                {!ciego && <div style={{ fontSize: 12, color: '#ffd17a' }}>Sistema: <b>{fmt$(transferenciaEsperada)}</b></div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: ciego ? '1fr' : '1fr 1fr', gap: 8, alignItems: 'center' }}>
                <input type="text" inputMode="decimal"
                  value={transferenciaReal} onChange={e => setTransferenciaReal(e.target.value)}
                  placeholder={ciego ? 'Total del resumen del banco' : 'Real desde banco'}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 14, fontWeight: 600 }} />
                {!ciego && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>Diferencia</div>
                    <div style={{ fontSize: 16, fontWeight: 700,
                      color: transferenciaReal === '' ? 'var(--muted)' : transferenciaDif === 0 ? '#7dff7d' : transferenciaDif > 0 ? '#ffd17a' : '#ff8b8b',
                      fontFamily: "'Bebas Neue',cursive" }}>
                      {transferenciaReal === '' ? '—' : (transferenciaDif >= 0 ? '+' : '') + fmt$(transferenciaDif)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                QUIÉN CIERRA LA CAJA <span style={{ color: 'var(--red-light, #ff8b8b)' }}>*</span>
              </label>
              <input ref={cajeroRef} value={cajero} onChange={e => setCajero(e.target.value)}
                placeholder={ciego ? 'Tu nombre y apellido' : 'Nombre y apellido'}
                style={{
                  width: '100%', background: 'var(--surface2)', color: 'var(--text)',
                  border: `1px solid ${cajero.trim() ? 'var(--border)' : '#ff8b8b'}`,
                  borderRadius: 6, padding: '8px 10px', fontSize: 13, marginBottom: cajero.trim() ? 10 : 4,
                }} />
              {!cajero.trim() && (
                <div style={{ fontSize: 11, color: '#ff8b8b', marginBottom: 10 }}>
                  Sin esto el arqueo no se guarda: si aparece una diferencia, hay que saber a quién preguntarle.
                </div>
              )}

              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>NOTAS (opcional)</label>
              <textarea value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej: faltó $500 por error de vuelto en venta #45"
                rows={3}
                style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 10px', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            {!confirmandoGuardar && (
              <button onClick={guardarArqueo} disabled={guardando}
                style={{ marginTop: 12, width: '100%', padding: '12px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 14, opacity: guardando ? 0.6 : 1 }}>
                {guardando
                  ? 'Guardando...'
                  : editandoId
                    ? `✏️ Guardar cambios del arqueo del ${fechaArqueo}`
                    : `💾 Guardar arqueo del ${fechaArqueo}`}
              </button>
            )}
            {confirmandoGuardar && (
              <div style={{ marginTop: 12, padding: 14, background: 'rgba(255,209,122,0.06)', border: '1px solid var(--gold)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>📋 CONFIRMAR ARQUEO DEL {fechaArqueo}</div>
                {/* En modo ciego el resumen repite SOLO lo que cargó el
                    cajero. Nada de esperados ni diferencias: si estuvieran
                    acá, taparlos arriba no habría servido de nada. */}
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  {/* Quién cierra, a la vista justo antes de apretar: queda
                      asentado con su nombre y lo sabe. */}
                  <div style={{ marginBottom: 4, paddingBottom: 4, borderBottom: '1px dashed var(--border)' }}>
                    👤 Cierra la caja: <b style={{ color: 'var(--gold)' }}>{cajero.trim()}</b>
                  </div>
                  {ciego ? (
                    <>
                      <div>💵 Efectivo contado: <b>{fmt$(totalContado)}</b></div>
                      <div>💳 Débito/QR: <b>{fmt$(debitoRealNum)}</b></div>
                      <div>🔄 Transferencias: <b>{fmt$(transferenciaRealNum)}</b></div>
                      <div style={{ marginTop: 6, color: 'var(--muted)' }}>
                        Al guardar se compara con el sistema y te muestra la diferencia.
                      </div>
                    </>
                  ) : (
                    <>
                      <div>💵 Efectivo — esperado {fmt$(efectivoEsperado)} · contado <b>{fmt$(totalContado)}</b> · dif {diferencia >= 0 ? '+' : ''}{fmt$(diferencia)}</div>
                      <div>💳 Débito/QR — esperado {fmt$(debitoEsperado)} · real <b>{fmt$(debitoRealNum)}</b> · dif {debitoDif >= 0 ? '+' : ''}{fmt$(debitoDif)}</div>
                      <div>🔄 Transfer. — esperada {fmt$(transferenciaEsperada)} · real <b>{fmt$(transferenciaRealNum)}</b> · dif {transferenciaDif >= 0 ? '+' : ''}{fmt$(transferenciaDif)}</div>
                      <div style={{ marginTop: 6, fontWeight: 800, color: difTotal === 0 ? '#7dff7d' : '#ffd17a' }}>
                        DIFERENCIA TOTAL: {difTotal >= 0 ? '+' : ''}{fmt$(difTotal)}
                      </div>
                    </>
                  )}
                </div>

                {/* Avisos: lo que hace pensar que este arqueo no es bueno.
                    No bloquean (la realidad a veces es rara), pero hay que verlos. */}
                {avisos.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {avisos.map((a, i) => (
                      <div key={i} style={{
                        padding: '8px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                        background: a.nivel === 'alto' ? 'rgba(255,107,107,0.10)' : 'rgba(255,209,122,0.08)',
                        border: `1px solid ${a.nivel === 'alto' ? 'var(--red-light)' : '#6a5a2a'}`,
                        color: a.nivel === 'alto' ? '#ff8b8b' : '#ffd17a',
                      }}>
                        <b>{a.nivel === 'alto' ? '🚨' : '⚠️'}</b> {a.texto}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={confirmarGuardarArqueo} disabled={guardando}
                    style={{ flex: 1, padding: '12px', background: hayAvisosAltos ? '#5a1a1a' : 'var(--gold)', color: hayAvisosAltos ? '#ff8b8b' : '#000', border: hayAvisosAltos ? '1px solid var(--red-light)' : 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
                    {hayAvisosAltos ? '⚠️ Guardar igual' : '✅ Sí, guardar'}
                  </button>
                  <button onClick={() => setConfirmandoGuardar(false)}
                    style={{ flex: 1, padding: '12px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HISTORIAL — no es del cajero: es la lista de TODOS los cierres del
          negocio, día por día, con el esperado y la diferencia de cada uno.
          Ella ve el suyo en el panel de revelación al terminar de contar.
          Ojo: `historial` se sigue cargando aunque no se muestre — de ahí sale
          la detección de arqueo duplicado, que tiene que seguir avisando. */}
      {!ciego && (
      <div className="card" style={{ marginTop: 8 }}>
        <div className="card-title">📋 Arqueos anteriores</div>
        {loading && <p style={{ color: 'var(--muted)' }}>Cargando...</p>}
        {!loading && historial.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Todavía no hay arqueos guardados.</p>
        )}
        {!loading && historial.length > 0 && (
          <HistorialArqueosPaginado
            historial={historial}
            onEliminar={eliminarArqueo}
            onPedirEliminar={pedirEliminarArqueo}
            onCancelarBorrar={() => setConfirmandoBorrar(null)}
            confirmandoBorrar={confirmandoBorrar}
            onEditar={iniciarEdicion}
            editandoId={editandoId}
            esCEO={esCEO}
          />
        )}
        {!loading && historial.length > 0 && !esCEO && (
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'right' }}>
            🔒 Solo el CEO puede modificar o eliminar arqueos.
          </p>
        )}
      </div>
      )}
    </div>
  )
}

// Sub-componente: pagina la lista de arqueos para evitar tabla interminable.
// Las acciones (✏️ editar y 🗑️ eliminar) solo aparecen para el CEO.
function HistorialArqueosPaginado({ historial, onEliminar, onPedirEliminar, onCancelarBorrar, confirmandoBorrar, onEditar, editandoId, esCEO }) {
  const pag = usePaginacion(historial, 20)
  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, minWidth: esCEO ? 1020 : 900 }}>
          <thead>
            <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Fecha</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Hora</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Cajero</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>💵 Efectivo (esp/cont/dif)</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>💳 Débito/QR (esp/real/dif)</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>🔄 Transfer. (esp/real/dif)</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Notas</th>
              {esCEO && <th style={{ textAlign: 'center', padding: '6px 4px' }}>Acciones</th>}
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
              const esBackfill = (a.notas || '').startsWith('[BACKFILL')
              const enEdicion = editandoId === a.id
              return (
                <tr key={a.id} style={{
                  borderTop: '1px solid var(--border)',
                  background: enEdicion
                    ? 'rgba(255,209,122,0.18)'
                    : esBackfill ? 'rgba(255,209,122,0.04)' : 'transparent',
                  outline: enEdicion ? '1px solid var(--gold)' : 'none',
                }}>
                  <td style={{ padding: '6px 4px' }}>
                    {a.fecha}
                    {esBackfill && <span title="Cargado manualmente (backfill)" style={{ marginLeft: 6, fontSize: 10, color: '#ffd17a' }}>⚡</span>}
                  </td>
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
                  {esCEO && (
                    <td style={{ padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button onClick={() => onEditar(a)}
                        disabled={enEdicion}
                        title={enEdicion ? 'Ya estás editando este arqueo' : 'Editar este arqueo'}
                        style={{
                          background: enEdicion ? 'var(--surface2)' : 'var(--gold)',
                          border: 'none', borderRadius: 6, padding: '3px 8px',
                          cursor: enEdicion ? 'not-allowed' : 'pointer',
                          fontSize: 11, fontWeight: 700, color: enEdicion ? 'var(--muted)' : '#000',
                          marginRight: 4, opacity: enEdicion ? 0.6 : 1,
                        }}>
                        {enEdicion ? '✏️ en edición' : '✏️'}
                      </button>
                      {confirmandoBorrar?.id === a.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, fontWeight: 700 }}>¿Eliminar?</span>
                          <button onClick={() => onEliminar(a)}
                            style={{ background: '#5a1a1a', border: '1px solid var(--red-light)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 800, color: '#ff8b8b' }}>
                            Sí
                          </button>
                          <button onClick={onCancelarBorrar}
                            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>
                            No
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => onPedirEliminar(a)}
                          title="Eliminar este arqueo"
                          style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--red-light)' }}>
                          🗑️
                        </button>
                      )}
                    </td>
                  )}
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
