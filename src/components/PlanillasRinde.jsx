// ============================================================
// PLANILLAS DE RINDE — de acá sale la merma de cada producto
// ============================================================
// Son las planillas de papel que usa la administración: entran X kg brutos
// (una media res, un capón, una pierna, un parrillero), se pesa cada corte
// que sale, y la diferencia es la merma.
//
// EL CAPÓN ES DISTINTO: su planilla saca el rinde y lo deja en el historial,
// pero NO ajusta ningún %. Al despostarlo ya se pesa pieza por pieza (Desposte
// Cerdo), así que su merma es MEDIDA en cada animal — dejar que una planilla
// suelta le pisara ese número sería reemplazar lo que se pesó de verdad por
// una muestra. Los otros tres no tienen esa trazabilidad: ahí la planilla es
// la única fuente, y por eso sí ajustan.
//
// Hasta ahora ese número se sacaba a mano y se tipeaba en "Mermas por
// producto". Ahora la planilla lo calcula sola y, al guardarla, la ÚLTIMA de
// cada destino es la que manda el % a `config_sistema.merma_conversion`.
//
// QUÉ CUENTA COMO MERMA (confirmado por Fabricio):
//   · Bovino (media res, pierna, parrillero): HUESOS y GRASA son merma.
//   · Cerdo (capón): TOCINO, GRASA, HUESOS/PATAS/CUERO son merma. La misma
//     regla, para el desposte, vive en `esMermaDeCerdo` de lib/mermas.js.
//   · RECORTES y CABEZA NO son merma — se venden, así que suman al neto.
// El renglón marcado como merma sigue estando en la planilla (hay que pesarlo
// igual, es el control de que la cuenta cierre), pero no suma al neto vendible.
//
// CADA PLANILLA ELIGE SU DESTINO: la de media res elige cuál de los tipos
// cargados en Mermas por producto (Novillito A-1, Vaquillona B-2, etc.), la de
// pierna elige la pieza (Pierna o Cuarto Pistola), etc. Sin eso, una planilla
// de vaquillona le pisaría la merma al novillito.
//
// A propósito NO tiene valores ni ganancia: Fabricio pidió sólo los kilos.
// ============================================================
import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { actualizarMermaPropia } from '../lib/mermaTipos'
import { useAuth } from '../context/AuthContext'
import { fmtKg, parseNumero } from '../lib/formatos'
import { fechaHoyARG } from '../lib/fechas'
import { imprimirHTML } from '../lib/imprimir'

// ── REIMPRIMIR UNA PLANILLA DEL HISTORIAL ───────────────────────────────
// El rinde guardado tiene TODOS los renglones en `cortes`, así que la planilla
// de papel se puede volver a armar tal cual se cargó. Sirve para archivarla o
// para discutir un rinde con el que despostó, meses después.
// Misma vía que el resto de las impresiones del sistema (iframe oculto): en la
// tablet del mostrador un window.open deja el diálogo colgado.
const escHtml = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const kg3 = v => (Number(v) || 0).toFixed(3).replace('.', ',')
const fechaLarga = d => d ? new Date(d + 'T12:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

function imprimirPlanillaRinde(pl, tituloTipo) {
  // Sin el emoji del label: en papel no aporta y hay impresoras que lo dibujan mal.
  const tipoLimpio = String(tituloTipo || '').replace(/^\S+\s/, '')
  const bruto = Number(pl.kg_bruto) || 0
  const cortes = Array.isArray(pl.cortes) ? pl.cortes : []
  // % sobre el bruto: es la lectura con la que se compara una planilla contra
  // otra del mismo tipo (los kilos absolutos cambian con el tamaño del animal).
  const pctDe = kg => bruto > 0 ? ((Number(kg) || 0) / bruto * 100).toFixed(2).replace('.', ',') + '%' : '—'
  const filas = cortes.map(c => `
      <tr class="${c.es_merma ? 'merma' : ''}">
        <td>${escHtml(c.nombre)}${c.es_merma ? ' <span class="tag">merma</span>' : ''}</td>
        <td class="num">${kg3(c.kg)}</td>
        <td class="num">${pctDe(c.kg)}</td>
      </tr>`).join('')

  imprimirHTML(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Planilla de rinde — ${escHtml(pl.destino_label || tipoLimpio)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
      h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: 1px; }
      .sub { font-size: 12px; color: #444; margin-bottom: 14px; }
      .datos { display: flex; gap: 26px; border: 1px solid #999; padding: 8px 12px; margin-bottom: 14px; }
      .datos div { font-size: 12px; }
      .datos b { display: block; font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: .5px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #ddd; padding: 5px 6px; text-align: left; }
      th { font-size: 10px; text-transform: uppercase; color: #666; border-bottom: 1px solid #999; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      tr.merma td { color: #7a2d2d; }
      .tag { font-size: 9px; border: 1px solid #7a2d2d; padding: 0 3px; border-radius: 3px; }
      tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: 700; padding-top: 7px; }
      tfoot tr.total td { font-size: 14px; }
      .notas { margin-top: 14px; font-size: 11px; border: 1px solid #ddd; padding: 8px 10px; }
      .firma { margin-top: 42px; display: flex; gap: 60px; font-size: 11px; color: #666; }
      .firma div { border-top: 1px solid #999; padding-top: 4px; width: 210px; text-align: center; }
      .pie { margin-top: 18px; font-size: 9px; color: #888; }
    </style></head><body>
    <h1>PLANILLA DE RINDE — ${escHtml((pl.destino_label || tipoLimpio || '').toUpperCase())}</h1>
    <div class="sub">FABRICIUS SAS · ${escHtml(tipoLimpio)}</div>
    <div class="datos">
      <div><b>Fecha</b>${fechaLarga(pl.fecha)}</div>
      <div><b>Kilos brutos</b>${kg3(pl.kg_bruto)} kg</div>
      <div><b>Neto vendible</b>${kg3(pl.kg_neto)} kg</div>
      <div><b>Merma</b>${kg3(pl.kg_merma)} kg · ${Number(pl.merma_pct).toFixed(2).replace('.', ',')}%</div>
      <div><b>Cargada por</b>${escHtml(pl.creado_por || '—')}</div>
    </div>
    <table>
      <thead><tr><th>Corte</th><th class="num">Kg</th><th class="num">% del bruto</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="3">Sin renglones cargados.</td></tr>'}</tbody>
      <tfoot>
        <tr><td>NETO VENDIBLE</td><td class="num">${kg3(pl.kg_neto)}</td><td class="num">${pctDe(pl.kg_neto)}</td></tr>
        <tr class="total"><td>MERMA</td><td class="num">${kg3(pl.kg_merma)}</td><td class="num">${Number(pl.merma_pct).toFixed(2).replace('.', ',')}%</td></tr>
      </tfoot>
    </table>
    ${pl.notas ? `<div class="notas"><b>Notas:</b> ${escHtml(pl.notas)}</div>` : ''}
    <div class="firma"><div>Pesó</div><div>Controló</div></div>
    <div class="pie">Reimpresión de la planilla guardada el ${fechaLarga(pl.fecha)}. Los renglones marcados como merma se pesan igual, pero no suman al neto vendible.</div>
  </body></html>`)
}

// ── Las 4 planillas del papel ───────────────────────────────────────────
// m: true = ese renglón es merma (no suma al neto vendible).
const PLANILLAS = {
  media_res: {
    label: '🐄 Media res bovina', bruto: 'Kilos media res',
    destino: 'media_res',
    cortes: [
      'MATAMBRE', 'BOCADO ANCHO', 'BOCADO FINO', 'PULPA PALETA', 'VACIO', 'COSTILLA',
      'FALDA', 'COSTELETA', 'LOMO', 'AGUJA ESPECIAL', 'COGOTE DESHUESADO', 'NALGA',
      'TAPA DE NALGA', 'PECETO', 'JAMON CUADRADO', 'CUADRIL', 'COLITA CUADRIL',
      'BOLA DE LOMO', 'TORTUGUITA', 'OSOBUCO DESHUESADO',
      { n: 'HUESOS', m: true }, { n: 'GRASA', m: true },
    ],
  },
  capon: {
    label: '🐷 Capón', bruto: 'Kilos capón bruto',
    // AJUSTA NADA = false. El capón se pesa pieza por pieza al despostarlo
    // (Desposte Cerdo), así que su merma es MEDIDA en cada animal y no se
    // estima de una muestra. Esta planilla sirve igual para sacar el rinde y
    // dejarlo en el historial, pero NO le pisa el % a nada: si lo hiciera,
    // una sola planilla mandaría por encima de lo que se pesó de verdad.
    destino: null,
    cortes: [
      'MATAMBRE', 'BOCADO DESHUESADO', 'VACIO', 'COSTILLA', 'FALDA DESHUESADA',
      'COSTELETA', 'LOMO', 'BONDIOLA', 'NALGA', 'TAPA DE NALGA', 'PECETO',
      'JAMON CUADRADO', 'CUADRIL', 'COLITA CUADRIL', 'BOLA DE LOMO', 'TORTUGUITA',
      'RECORTES', 'CABEZA',
      { n: 'HUESOS, PATAS, CUERO', m: true }, { n: 'TOCINO', m: true }, { n: 'GRASA', m: true },
    ],
  },
  pierna: {
    // Antes decía "Pierna / Cuarto" porque el selector servía para los dos.
    // Ahora el cuarto pistola tiene su propia planilla con sus cortes.
    label: '🍖 Pierna', bruto: 'Kilos pierna bruto',
    destino: 'pieza', preferida: 'Pierna',
    cortes: [
      'NALGA', 'TAPA DE NALGA', 'PECETO', 'JAMON CUADRADO', 'CUADRIL', 'COLITA CUADRIL',
      'BOLA DE LOMO', 'TORTUGUITA', 'OSOBUCO DESHUESADO', 'RECORTES',
      { n: 'HUESOS', m: true },
    ],
  },
  parrillero: {
    label: '🔥 Parrillero', bruto: 'Kilos parrillero bruto',
    destino: 'pieza', preferida: 'Parrillero',
    cortes: [
      'COSTELETAL', 'LOMO', 'MATAMBRE', 'COSTILLA', 'VACIO', 'AGUJA', 'RECORTES',
      { n: 'HUESOS', m: true },
    ],
  },
  // ── Las que pidió Fabricio el 27/08 ───────────────────────────────────
  // Arrancan casi peladas A PROPÓSITO: él carga los cortes de cada una. Con
  // el recuerdo de la última planilla (ver cargarHistorial), los cortes que
  // agregue quedan como plantilla para la próxima — los carga UNA vez.
  // Sólo van los renglones de merma bovina (huesos/grasa) y recortes, que
  // son iguales en todas.
  // "Carré con lomo" es como le dice él a la pieza que en Mermas por
  // producto se llama "Costeletal con Lomo": el label usa su nombre, el
  // destino apunta a la pieza real.
  cortito: {
    label: '🥩 Cortito', bruto: 'Kilos cortito bruto',
    destino: 'pieza', preferida: 'Cortito',
    cortes: ['RECORTES', { n: 'HUESOS', m: true }, { n: 'GRASA', m: true }],
  },
  carre_lomo: {
    label: '🍢 Carré con lomo', bruto: 'Kilos carré bruto',
    destino: 'pieza', preferida: 'Costeletal con Lomo',
    cortes: ['RECORTES', { n: 'HUESOS', m: true }, { n: 'GRASA', m: true }],
  },
  costillar: {
    label: '🦴 Costillar completo', bruto: 'Kilos costillar bruto',
    destino: 'pieza', preferida: 'Costillar Completo',
    cortes: ['RECORTES', { n: 'HUESOS', m: true }, { n: 'GRASA', m: true }],
  },
  cuarto_pistola: {
    label: '🔫 Cuarto pistola', bruto: 'Kilos cuarto bruto',
    destino: 'pieza', preferida: 'Cuarto Pistola',
    cortes: ['RECORTES', { n: 'HUESOS', m: true }, { n: 'GRASA', m: true }],
  },
  paleta: {
    label: '💪 Paleta entera bovina', bruto: 'Kilos paleta bruto',
    // Como el capón: SÓLO saca el rinde y lo deja en el historial. La paleta
    // NO es una pieza del desposte de la media res (sale junto con el
    // cortito), así que la mig 127 la sacó de Mermas por producto — no hay a
    // dónde mandarle un %. Esta planilla existe para saber a qué precio
    // vender la paleta deshuesada.
    destino: null,
    cortes: ['RECORTES', { n: 'HUESOS', m: true }, { n: 'GRASA', m: true }],
  },
}

const filaNueva = c => (typeof c === 'string'
  ? { nombre: c, kg: '', es_merma: false }
  : { nombre: c.n, kg: '', es_merma: !!c.m })

const inp = {
  background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 6, padding: '6px 9px', fontSize: 13, width: '100%', boxSizing: 'border-box',
}

export default function PlanillasRinde({ config, onConfigChange }) {
  const { profile, isCEO } = useAuth()
  const [tipo, setTipo] = useState('media_res')
  const [destinoId, setDestinoId] = useState('')
  const [fecha, setFecha] = useState(fechaHoyARG())
  const [bruto, setBruto] = useState('')
  const [filas, setFilas] = useState(() => PLANILLAS.media_res.cortes.map(filaNueva))
  const [notas, setNotas] = useState('')
  const [nuevoCorte, setNuevoCorte] = useState('')
  const [historial, setHistorial] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [verHistorial, setVerHistorial] = useState(false)
  // Qué planilla del historial está abierta (id). Se ve renglón por renglón,
  // igual que se cargó, y desde ahí se imprime.
  const [detalleId, setDetalleId] = useState(null)

  const plan = PLANILLAS[tipo]

  // ── A qué fila de "Mermas por producto" puede escribir esta planilla ──
  const destinos = useMemo(() => {
    if (!config) return []
    if (plan.destino === 'media_res') {
      return (config.media_res || []).map(m => ({ id: m.id, label: m.label, actual: m.merma }))
    }
    if (!plan.destino) return []   // el capón no ajusta ningún %
    // pieza: todas las de la lista, con la que da nombre a la planilla
    // primero (cada planilla declara su `preferida`).
    const preferida = plan.preferida
    const todas = Object.entries(config.piezas || {}).map(([n, v]) => ({ id: n, label: n, actual: v }))
    return todas.sort((a, b) => (a.id === preferida ? -1 : b.id === preferida ? 1 : 0))
  }, [config, tipo, plan.destino])

  // Si el destino elegido no existe para esta planilla, agarrar el primero.
  useEffect(() => {
    if (!destinos.length) { setDestinoId(''); return }
    if (!destinos.some(d => d.id === destinoId)) setDestinoId(destinos[0].id)
  }, [destinos])

  useEffect(() => { cargarHistorial() }, [tipo, destinoId])

  async function cargarHistorial() {
    // El capón no tiene destino: su historial se lista sólo por tipo.
    if (plan.destino && !destinoId) { setHistorial([]); return }
    let q = supabase.from('planillas_rinde').select('*').eq('tipo', tipo)
    if (plan.destino) q = q.eq('destino_id', destinoId)
    const { data } = await q
      .order('fecha', { ascending: false }).order('created_at', { ascending: false })
      .limit(30)
    setHistorial(data || [])

    // LOS CORTES SE RECUERDAN DE LA ÚLTIMA PLANILLA GUARDADA. Fabricio pidió
    // agregar él los cortes de las planillas nuevas: sin esto tendría que
    // tipearlos en CADA planilla. Con esto los carga una vez, guarda, y la
    // próxima ya vienen puestos (con los kg vacíos).
    // Sólo se pisa el formulario si todavía no se tipeó ningún kilo — jamás
    // arriba de una planilla a medio cargar. Y con setFilas funcional, porque
    // este fetch es async y `filas` acá estaría vieja.
    const ultima = (data || [])[0]
    if (Array.isArray(ultima?.cortes) && ultima.cortes.length) {
      setFilas(fs => fs.every(f => !String(f.kg).trim())
        ? ultima.cortes.map(c => ({ nombre: c.nombre, kg: '', es_merma: !!c.es_merma }))
        : fs)
    }
  }

  function mostrar(texto, tipoMsg = 'ok') { setMsg({ texto, tipo: tipoMsg }); setTimeout(() => setMsg(null), 6000) }

  // Cambiar de planilla arranca de cero con los renglones de ESA planilla.
  function cambiarTipo(t) {
    setTipo(t)
    setFilas(PLANILLAS[t].cortes.map(filaNueva))
    setBruto(''); setNotas(''); setNuevoCorte('')
  }

  function setFila(i, cambios) { setFilas(fs => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f))) }
  function quitarFila(i) { setFilas(fs => fs.filter((_, j) => j !== i)) }
  function agregarCorte() {
    const n = nuevoCorte.trim().toUpperCase()
    if (!n) return
    if (filas.some(f => f.nombre.toUpperCase() === n)) { mostrar('Ese corte ya está en la planilla', 'error'); return }
    setFilas(fs => [...fs, { nombre: n, kg: '', es_merma: false }])
    setNuevoCorte('')
  }

  // ── La cuenta ────────────────────────────────────────────────────────
  // parseNumero, NO Number(): acepta coma y punto. Los inputs van type="text"
  // porque type="number" se come la coma decimal según el idioma del navegador
  // (ver el remito 1916, que salió con 4715 kg en vez de 4,715).
  const kgBruto = parseNumero(bruto)
  const kgNeto = filas.filter(f => !f.es_merma).reduce((s, f) => s + parseNumero(f.kg), 0)
  const kgDescartado = filas.filter(f => f.es_merma).reduce((s, f) => s + parseNumero(f.kg), 0)
  const kgMerma = kgBruto > 0 ? kgBruto - kgNeto : 0
  const mermaPct = kgBruto > 0 ? (kgMerma / kgBruto) * 100 : 0
  // Control: bruto contra TODO lo pesado. Si no cierra, faltó pesar algo.
  const kgPesado = kgNeto + kgDescartado
  const sinExplicar = kgBruto > 0 ? kgBruto - kgPesado : 0

  const destinoActual = destinos.find(d => d.id === destinoId)
  const puedeGuardar = kgBruto > 0 && kgNeto > 0 && (!plan.destino || destinoId) && !guardando

  async function guardar() {
    if (kgBruto <= 0) { mostrar('Poné los kilos brutos que entraron', 'error'); return }
    if (kgNeto <= 0) { mostrar('Cargá los kilos de al menos un corte', 'error'); return }
    if (kgNeto > kgBruto) { mostrar('Los cortes suman más que el bruto — revisá los pesos', 'error'); return }
    if (plan.destino && !destinoId) { mostrar('Elegí a qué producto le corresponde esta planilla', 'error'); return }
    setGuardando(true)
    try {
      // Se guardan TODOS los renglones con nombre, aunque tengan 0 kg. No es
      // sólo el registro de lo pesado: es también la plantilla que se recuerda
      // en la próxima planilla (ver cargarHistorial) — si se filtraran los
      // vacíos, un corte agregado que esta vez no salió desaparecería de la
      // lista. Los 0 no afectan ningún cálculo (neto y merma salen del estado,
      // no de este JSON).
      const cortes = filas
        .filter(f => f.nombre.trim())
        .map(f => ({ nombre: f.nombre.trim(), kg: parseNumero(f.kg), es_merma: !!f.es_merma }))
      const pct = Math.round(mermaPct * 100) / 100

      const { error } = await supabase.from('planillas_rinde').insert({
        fecha, tipo,
        // Sin destino (capón) igual hay que guardar algo: la tabla los pide
        // NOT NULL y así el historial se sigue agrupando por producto.
        destino_tipo: plan.destino || 'capon',
        destino_id: plan.destino ? destinoId : 'capon',
        destino_label: plan.destino ? (destinoActual?.label || destinoId) : 'Capón',
        kg_bruto: kgBruto, cortes, kg_neto: kgNeto, kg_merma: kgMerma,
        merma_pct: pct, notas: notas || null,
        creado_por: profile?.nombre || null,
      })
      if (error) throw error

      // Capón y paleta no ajustan ningún %: se guarda en el historial y listo. Su
      // merma sale MEDIDA de cada desposte, que pesa pieza por pieza.
      if (!plan.destino) {
        mostrar(`✅ Rinde guardado en el historial: ${pct}% de merma. (Esta planilla no ajusta ningún %.)`)
        setBruto(''); setNotas('')
        setFilas(PLANILLAS[tipo].cortes.map(filaNueva))
        await cargarHistorial()
        return
      }

      // Si el destino es un tipo PROPIO de esta boca (mig 138), el % se guarda
      // en su tabla y no se toca la config de la central. La sucursal ajusta
      // los suyos; los que le impone la central los usa como vienen.
      const esPropio = plan.destino === 'media_res' &&
        (config?.media_res || []).some(m => m.id === destinoId && m.propio)
      if (esPropio) {
        const ok = await actualizarMermaPropia(destinoId, pct)
        mostrar(ok
          ? `✅ Planilla guardada. ${destinoActual?.label} pasa a ${pct}% de merma.`
          : '⚠️ La planilla se guardó, pero no se pudo actualizar el % de ese tipo.', ok ? 'ok' : 'error')
        if (ok) onConfigChange?.({
          ...config,
          media_res: (config.media_res || []).map(m => (m.id === destinoId ? { ...m, merma: pct } : m)),
        })
        setBruto(''); setNotas('')
        setFilas(PLANILLAS[tipo].cortes.map(filaNueva))
        await cargarHistorial()
        return
      }

      // La ÚLTIMA planilla es la que manda: se pisa el % en Mermas por producto.
      const nuevo = JSON.parse(JSON.stringify(config || {}))
      if (plan.destino === 'media_res') {
        nuevo.media_res = (nuevo.media_res || []).map(m => (m.id === destinoId ? { ...m, merma: pct } : m))
      } else {
        nuevo.piezas = { ...(nuevo.piezas || {}), [destinoId]: pct }
      }
      const { data: guardado, error: e2 } = await supabase.from('config_sistema')
        .update({ valor: nuevo }).eq('clave', 'merma_conversion').select('clave')
      // `.update()` con RLS bloqueando devuelve error null y 0 filas: hay que
      // mirar las filas, no el error, o se festeja un guardado que no pasó.
      if (e2) throw e2
      if (!guardado || guardado.length === 0) {
        mostrar(`⚠️ La planilla se guardó en tu historial, pero ${destinoActual?.label || 'ese tipo'} lo define la central: su % no se cambia desde acá. Pasale el dato a Fabricio.`, 'error')
      } else {
        mostrar(`✅ Planilla guardada. ${destinoActual?.label} pasa a ${pct}% de merma.`)
        onConfigChange?.(nuevo)
      }
      setBruto(''); setNotas('')
      setFilas(PLANILLAS[tipo].cortes.map(filaNueva))
      await cargarHistorial()
    } catch (err) {
      mostrar('❌ No se pudo guardar: ' + (err?.message || err), 'error')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(p) {
    if (!isCEO) { mostrar('Sólo el dueño puede borrar una planilla del historial', 'error'); return }
    const { error } = await supabase.from('planillas_rinde').delete().eq('id', p.id)
    if (error) { mostrar('❌ ' + error.message, 'error'); return }
    mostrar('🗑️ Planilla borrada. Ojo: el % de Mermas por producto NO vuelve solo — cargá la planilla buena.')
    await cargarHistorial()
  }

  const colorPct = mermaPct > 35 ? '#ff8b8b' : mermaPct > 0 ? 'var(--gold)' : 'var(--muted)'

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-title">📋 Planillas de rinde</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 14 }}>
        Cargá los kilos que entraron y lo que pesó cada corte. El sistema saca la merma solo
        {plan.destino
          ? <>, y <strong style={{ color: 'var(--text)' }}>la última planilla de cada producto es
              la que manda</strong> el % a Mermas por producto.</>
          : <>. <strong style={{ color: 'var(--text)' }}>Esta planilla no ajusta ningún %</strong>:
              el rinde queda en el historial, para conocer el costo real del corte.</>}
        <div style={{ marginTop: 6, fontSize: 12 }}>
          Los renglones marcados <span style={{ color: '#ff8b8b' }}>merma</span> (hueso, grasa,
          tocino, cuero) se pesan igual pero no suman al neto vendible. Recortes y cabeza sí suman:
          se venden.
        </div>
      </div>

      {msg && (
        <div style={{
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 14px', marginBottom: 14,
          color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600, fontSize: 13,
        }}>{msg.texto}</div>
      )}

      {/* Qué planilla */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(PLANILLAS).map(([k, p]) => (
          <button key={k} onClick={() => cambiarTipo(k)}
            style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              border: `1px solid ${tipo === k ? 'var(--gold)' : 'var(--border)'}`,
              background: tipo === k ? 'var(--gold)' : 'transparent',
              color: tipo === k ? '#000' : 'var(--muted)',
            }}>{p.label}</button>
        ))}
      </div>

      {/* Destino + fecha + bruto */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
        {plan.destino && (
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
            ¿A QUÉ PRODUCTO LE CORRESPONDE?
          </label>
          <select value={destinoId} onChange={e => setDestinoId(e.target.value)} style={inp}>
            {destinos.length === 0 && <option value="">— no hay productos cargados —</option>}
            {destinos.map(d => (
              <option key={d.id} value={d.id}>{d.label}{d.actual != null ? ` — hoy ${d.actual}%` : ''}</option>
            ))}
          </select>
        </div>
        )}
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>FECHA</label>
          <input type="date" value={fecha} max={fechaHoyARG()} onChange={e => setFecha(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
            {plan.bruto.toUpperCase()}
          </label>
          {/* type="text": type="number" se come la coma decimal */}
          <input type="text" inputMode="decimal" value={bruto} placeholder="0,000"
            onChange={e => setBruto(e.target.value)}
            style={{ ...inp, borderColor: 'var(--gold)', fontWeight: 700 }} />
        </div>
      </div>

      {/* Renglones */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup><col /><col style={{ width: 120 }} /><col style={{ width: 92 }} /><col style={{ width: 40 }} /></colgroup>
          <thead>
            <tr style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Corte</th>
              <th style={{ textAlign: 'right', padding: '6px 4px' }}>Kilos</th>
              <th style={{ textAlign: 'center', padding: '6px 4px' }}>¿Merma?</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)', opacity: f.es_merma ? 0.75 : 1 }}>
                <td style={{ padding: '5px 4px' }}>
                  <input value={f.nombre} onChange={e => setFila(i, { nombre: e.target.value })}
                    style={{ ...inp, border: 'none', background: 'transparent', padding: '4px 2px', fontWeight: 600 }} />
                </td>
                <td style={{ padding: '5px 4px' }}>
                  <input type="text" inputMode="decimal" value={f.kg} placeholder="—"
                    onChange={e => setFila(i, { kg: e.target.value })}
                    style={{ ...inp, textAlign: 'right' }} />
                </td>
                <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                  <button onClick={() => setFila(i, { es_merma: !f.es_merma })}
                    title={f.es_merma ? 'No suma al neto vendible' : 'Suma al neto vendible'}
                    style={{
                      padding: '3px 9px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      border: `1px solid ${f.es_merma ? '#ff8b8b' : 'var(--border)'}`,
                      background: f.es_merma ? 'rgba(255,107,107,0.12)' : 'transparent',
                      color: f.es_merma ? '#ff8b8b' : 'var(--muted)',
                    }}>{f.es_merma ? 'merma' : 'vende'}</button>
                </td>
                <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                  <button onClick={() => quitarFila(i)} title="Sacar este corte de la planilla"
                    style={{ background: 'none', border: 'none', color: '#ff8b8b', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input value={nuevoCorte} onChange={e => setNuevoCorte(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') agregarCorte() }}
          placeholder="Agregar un corte a esta planilla…"
          style={{ ...inp, maxWidth: 280, width: 'auto', flex: '1 1 200px' }} />
        <button onClick={agregarCorte}
          style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          + Agregar corte
        </button>
      </div>

      {/* El resultado */}
      <div style={{ marginTop: 16, padding: 14, background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Total kilos neto</div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: 'var(--green)' }}>{fmtKg(kgNeto, { decimales: 3 })}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Kilos de merma</div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: '#ff8b8b' }}>{fmtKg(kgMerma, { decimales: 3 })}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>Merma</div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: colorPct }}>
              {kgBruto > 0 ? `${mermaPct.toFixed(2)} %` : '—'}
            </div>
          </div>
        </div>

        {/* Control de que la cuenta cierre */}
        {kgBruto > 0 && Math.abs(sinExplicar) > 0.5 && (
          <div style={{ marginTop: 10, fontSize: 12, color: sinExplicar > 0 ? '#ffd17a' : '#ff8b8b', lineHeight: 1.5 }}>
            {sinExplicar > 0
              ? <>⚠️ Pesaste {fmtKg(kgPesado, { decimales: 3 })} de {fmtKg(kgBruto, { decimales: 3 })}: quedan {fmtKg(sinExplicar, { decimales: 3 })} sin anotar. Si falta pesar el hueso o la grasa, cargalos — si no, la merma sale inflada.</>
              : <>⚠️ Los renglones suman {fmtKg(kgPesado, { decimales: 3 })} y el bruto es {fmtKg(kgBruto, { decimales: 3 })}. Sale más de lo que entró: revisá algún peso.</>}
          </div>
        )}

        {/* El capón no ajusta nada: que se vea, para que nadie espere que le
            mueva el % de ningún lado. */}
        {!plan.destino && kgBruto > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            Este rinde queda <b style={{ color: 'var(--text)' }}>sólo en el historial</b>: el capón
            no ajusta ningún % de Mermas por producto. Su merma sale medida de cada desposte, que
            pesa pieza por pieza.
          </div>
        )}

        {plan.destino && destinoActual && kgBruto > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', fontSize: 12, color: 'var(--muted)' }}>
            Al guardar, <b style={{ color: 'var(--text)' }}>{destinoActual.label}</b> pasa
            de {destinoActual.actual != null ? `${destinoActual.actual}%` : '—'} a{' '}
            <b style={{ color: 'var(--gold)' }}>{mermaPct.toFixed(2)}%</b> en Mermas por producto.
          </div>
        )}

        <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Notas (opcional): proveedor, quién despostó, algo raro…"
          style={{ ...inp, marginTop: 12 }} />

        <button onClick={guardar} disabled={!puedeGuardar}
          style={{
            marginTop: 12, width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: puedeGuardar ? 'var(--gold)' : 'var(--surface)',
            color: puedeGuardar ? '#000' : 'var(--muted)',
            cursor: puedeGuardar ? 'pointer' : 'not-allowed', fontWeight: 800, fontSize: 14,
          }}>
          {/* El botón dice lo que de verdad va a pasar: capón y paleta no
              ajustan ningún % (destino null), así que prometer "actualizar la
              merma" ahí era mentirle al que aprieta. */}
          {guardando ? 'Guardando…' : plan.destino
            ? '💾 Guardar planilla y actualizar la merma'
            : '💾 Guardar planilla en el historial'}
        </button>
      </div>

      {/* Historial */}
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setVerHistorial(v => !v)}
          style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: 0 }}>
          {verHistorial ? '▾' : '▸'} Historial de {plan.label.replace(/^\S+\s/, '').toLowerCase()}
          {plan.destino && destinoActual ? ` — ${destinoActual.label}` : ''} ({historial.length})
        </button>

        {verHistorial && (historial.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Todavía no hay planillas cargadas.</div>
          : (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>Fecha</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px' }}>Bruto</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px' }}>Neto</th>
                    <th style={{ textAlign: 'right', padding: '6px 4px' }}>Merma</th>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>Quién</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {historial.map((p, i) => {
                    const abierta = detalleId === p.id
                    const cortes = Array.isArray(p.cortes) ? p.cortes : []
                    const brutoN = Number(p.kg_bruto) || 0
                    return (
                    <Fragment key={p.id}>
                    <tr onClick={() => setDetalleId(abierta ? null : p.id)}
                      title="Ver la planilla que se cargó para este rinde"
                      style={{ borderTop: '1px solid var(--border)', background: abierta ? 'rgba(201,168,76,0.14)' : (i === 0 ? 'rgba(201,168,76,0.07)' : 'transparent'), cursor: 'pointer' }}>
                      <td style={{ padding: '6px 4px' }}>
                        <span style={{ color: 'var(--gold)', marginRight: 4 }}>{abierta ? '▾' : '▸'}</span>
                        {p.fecha}
                        {/* "La que rige" sólo tiene sentido donde la planilla ajusta el %.
                            En el capón no rige nada: es historial puro. */}
                        {i === 0 && plan.destino && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--gold)', fontWeight: 700 }}>← la que rige</span>}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtKg(p.kg_bruto, { decimales: 3 })}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: 'var(--green)' }}>{fmtKg(p.kg_neto, { decimales: 3 })}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: 'var(--gold)' }}>{Number(p.merma_pct).toFixed(2)}%</td>
                      <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>{p.creado_por || '—'}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {/* stopPropagation: el click de la fila abre/cierra el detalle. */}
                        <button onClick={e => { e.stopPropagation(); imprimirPlanillaRinde(p, plan.label) }}
                          title="Imprimir esta planilla"
                          style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 13 }}>🖨️</button>
                        {isCEO && (
                          <button onClick={e => { e.stopPropagation(); borrar(p) }} title="Borrar esta planilla"
                            style={{ background: 'none', border: 'none', color: '#ff8b8b', cursor: 'pointer', fontSize: 13 }}>🗑️</button>
                        )}
                      </td>
                    </tr>
                    {abierta && (
                      <tr style={{ background: 'var(--surface2)' }}>
                        <td colSpan={6} style={{ padding: '10px 12px 14px' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                            Planilla del {p.fecha}{p.destino_label ? ` — ${p.destino_label}` : ''} · {fmtKg(p.kg_bruto, { decimales: 3 })} brutos
                          </div>
                          {cortes.length === 0
                            ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>Esta planilla se guardó sin renglones.</div>
                            : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 4px' }}>Corte</th>
                                    <th style={{ textAlign: 'right', padding: '4px 4px' }}>Kg</th>
                                    <th style={{ textAlign: 'right', padding: '4px 4px' }}>% del bruto</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cortes.map((c, j) => (
                                    <tr key={j} style={{ borderTop: '1px solid var(--border)' }}>
                                      <td style={{ padding: '4px 4px', color: c.es_merma ? '#ff8b8b' : 'var(--text)' }}>
                                        {c.nombre}
                                        {c.es_merma && <span style={{ marginLeft: 6, fontSize: 9, border: '1px solid #ff8b8b', borderRadius: 3, padding: '0 3px' }}>merma</span>}
                                      </td>
                                      <td style={{ padding: '4px 4px', textAlign: 'right' }}>{fmtKg(c.kg, { decimales: 3 })}</td>
                                      <td style={{ padding: '4px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                                        {brutoN > 0 ? ((Number(c.kg) || 0) / brutoN * 100).toFixed(2) + '%' : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          {p.notas && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}><b>Notas:</b> {p.notas}</div>}
                          <button onClick={() => imprimirPlanillaRinde(p, plan.label)} className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}>
                            🖨️ Imprimir esta planilla
                          </button>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  )
}
