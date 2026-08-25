// ============================================================
// FACTURACIÓN — Módulo de control fiscal multi-cuenta
// ============================================================
// Maneja varias cuentas (monotributistas + SAS), permite:
//   - Crear / editar cuentas con CUIT y datos clave
//   - Cargar facturas emitidas/recibidas por cuenta
//   - Cargar impuestos y tasas pagados
//   - Alertas automáticas cuando una cuenta se acerca al tope
//     de monotributo (semáforo 70/85/95%)
//   - Importador CSV opcional para volcado del contador
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import {
  CATEGORIAS, TOPE_MAX_ABSOLUTO, PRECIO_UNITARIO_MAX,
  VIGENCIA_DESDE, VIGENCIA_HASTA,
  categoriaSugerida, cuotaMensual, topeAnual, estadoSemaforo,
  proximaRecategorizacion,
} from '../../lib/monotributo2026'
import { esCuitValido, formatearCuit } from '../../lib/cuit'
import { generarLibroVentas, generarLibroCompras, descargarCSV } from '../../lib/libroIva'
import {
  proyectarFacturacionAnual, distribuirEntreCuentas, calcularAvisos,
} from '../../lib/facturacionHelpers'
import { fechaHoyARG } from '../../lib/fechas'
import { fmtPrecio, parseNumero } from '../../lib/formatos'
import {
  COMPROBANTES, DOC_TIPOS, COND_IVA_RECEPTOR, IVA_ALICUOTAS,
  comprobantesDeCuenta, guardarConfigArca, probarConexionArca, emitirComprobante,
  generarCsrArca, buildQrUrl, qrImgUrl,
  condIvaAReceptorAfip, comprobanteRecomendado, ES_NOTA_CD, NOTAS_CREDITO, NOTAS_DEBITO,
} from '../../lib/arca'
import { imprimirComprobante } from '../../lib/comprobantePdf'
import TabBalance from './BalanceEjercicio'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))
const fmtPct = n => (n || 0).toFixed(1) + '%'
const fmtFecha = d => d ? new Date(d).toLocaleDateString('es-AR') : '—'
// Nombre del mes en curso en hora ARG. Con la TZ del navegador, el último día
// del mes después de las 21 el título ya decía el mes siguiente.
const mesActualARG = () => new Date()
  .toLocaleDateString('es-AR', { month: 'long', timeZone: 'America/Argentina/Buenos_Aires' })
  .toUpperCase()
// Hora local ARG (no UTC) — antes después de las 21hs el filtro "hoy"
// quedaba con la fecha del día siguiente.
const hoyISO = () => fechaHoyARG()
const haceUnAno = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 12)
  return fechaHoyARG(d)
}

const TIPOS_CUENTA = [
  { v: 'monotributo',           l: '📘 Monotributo' },
  { v: 'responsable_inscripto', l: '📕 Responsable Inscripto' },
  { v: 'sas',                   l: '🏢 SAS' },
  { v: 'exento',                l: '🟢 Exento' },
]

const CONCEPTOS_IMPUESTO = [
  { v: 'monotributo',         l: '📘 Cuota Monotributo' },
  { v: 'iva',                 l: '📕 IVA (DDJJ)' },
  { v: 'ganancias',           l: '📕 Ganancias' },
  { v: 'iibb',                l: '🏛️ IIBB Local' },
  { v: 'iibb_convenio',       l: '🏛️ IIBB Convenio Multilateral' },
  { v: 'seguridad_higiene',   l: '🏢 Seguridad e Higiene' },
  { v: 'tasa_municipal',      l: '🏢 Tasa Municipal' },
  { v: 'sicore',              l: '💳 SICORE' },
  { v: 'sircreb',             l: '💳 SIRCREB' },
  { v: 'otro',                l: '— Otro' },
]

// Carga manual: tipos de comprobante con NOMBRE COMPLETO (como en ARCA RCEL),
// no abreviado. El `v` (clave corta) es lo que se guarda en facturas.tipo_comprobante.
const TIPOS_COMPROBANTE = [
  { v: 'A', l: 'Factura A' },
  { v: 'B', l: 'Factura B' },
  { v: 'C', l: 'Factura C' },
  { v: 'E', l: 'Factura E (exportación)' },
  { v: 'M', l: 'Factura M' },
  { v: 'LSA', l: 'Liquidación de Servicios A (luz, gas, etc.)' },
  { v: 'LSB', l: 'Liquidación de Servicios B' },
  { v: 'LSC', l: 'Liquidación de Servicios C' },
  { v: 'NDA', l: 'Nota de Débito A' },
  { v: 'NDB', l: 'Nota de Débito B' },
  { v: 'NDC', l: 'Nota de Débito C' },
  { v: 'NCA', l: 'Nota de Crédito A' },
  { v: 'NCB', l: 'Nota de Crédito B' },
  { v: 'NCC', l: 'Nota de Crédito C' },
  { v: 'Ticket', l: 'Ticket' },
  { v: 'Otro', l: 'Otro' },
]
// Nombre completo de un comprobante a partir de la clave corta (tipo_comprobante).
const LABEL_TIPO_COMPROBANTE = Object.fromEntries(TIPOS_COMPROBANTE.map(t => [t.v, t.l]))
// Nombre descriptivo de una factura para listados: usa el código AFIP si es ARCA,
// si no la clave corta de carga manual. Ej: "Nota de Crédito A" en vez de "NCA".
function nombreComprobante(f) {
  if (f?.comprobante_codigo && COMPROBANTES[f.comprobante_codigo]) return COMPROBANTES[f.comprobante_codigo].label
  return LABEL_TIPO_COMPROBANTE[f?.tipo_comprobante] || f?.tipo_comprobante || '—'
}

const inp = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif",
  fontSize: 14, width: '100%', boxSizing: 'border-box',
}

export default function Facturacion() {
  const [tab, setTab] = useState('cuentas') // 'cuentas' | 'facturas' | 'impuestos' | 'importar'
  const [cuentas, setCuentas] = useState([])
  const [facturas, setFacturas] = useState([])
  const [impuestos, setImpuestos] = useState([])
  const [contrapartes, setContrapartes] = useState([])
  const [facturacionPorCuenta, setFacturacionPorCuenta] = useState({})
  // null = el RPC del mes no existe todavía (migración 120 sin correr)
  const [facturacionMesPorCuenta, setFacturacionMesPorCuenta] = useState({})
  // null = el RPC de la proyección no existe todavía (migración 121 sin correr)
  const [proyeccionPorCuenta, setProyeccionPorCuenta] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarTodo() }, [])

  async function cargarTodo() {
    setLoading(true)
    const [
      { data: cs }, { data: fs }, { data: ps }, { data: kp },
      { data: fac12 }, { data: facMes, error: errMes },
      { data: facProy, error: errProy },
    ] = await Promise.all([
      supabase.from('cuentas_fiscales').select('*').order('nombre'),
      supabase.from('facturas').select('*').order('fecha', { ascending: false }),
      supabase.from('impuestos_pagados').select('*').order('fecha_pago', { ascending: false }),
      supabase.from('contrapartes').select('*').eq('activa', true).order('nombre'),
      // Facturado últimos 12 meses por cuenta — calculado en el servidor (no depende
      // del tope de 1.000 filas), clave para el semáforo de tope del monotributo.
      supabase.rpc('facturado_cuentas_12m'),
      // Compras y ventas del MES en curso, también en el servidor: agosto solo
      // ya trae más de 1.000 facturas, así que sumado acá no cerraría.
      supabase.rpc('facturado_cuentas_mes'),
      // Emitido de los últimos 90 días por cuenta — la base de la proyección a
      // 12 meses. También en el servidor: con las 1.000 filas que trae
      // `facturas` entran unas 3 semanas, no 90 días, y la proyección salía
      // corta (el aviso de tope avisaba tarde).
      supabase.rpc('proyeccion_cuentas_90d'),
    ])
    setCuentas(cs || [])
    setFacturas(fs || [])
    setImpuestos(ps || [])
    setContrapartes(kp || [])
    const map = {}
    ;(cs || []).forEach(c => { map[c.id] = { emitido: 0, recibido: 0, cantEmitidas: 0, cantRecibidas: 0 } })
    ;(fac12 || []).forEach(r => {
      map[r.cuenta_id] = {
        emitido: Number(r.emitido) || 0, recibido: Number(r.recibido) || 0,
        cantEmitidas: Number(r.cant_emitidas) || 0, cantRecibidas: Number(r.cant_recibidas) || 0,
      }
    })
    setFacturacionPorCuenta(map)

    // Si la migración 120 todavía no corrió, el RPC no existe. Dejamos null
    // para avisarlo en la tarjeta, en vez de mostrar $0 y hacerle creer que
    // en el mes no se facturó nada.
    if (errMes) {
      setFacturacionMesPorCuenta(null)
    } else {
      const mapMes = {}
      ;(cs || []).forEach(c => {
        mapMes[c.id] = { ventas: 0, compras: 0, cantVentas: 0, cantCompras: 0, ventasAnt: 0, comprasAnt: 0 }
      })
      ;(facMes || []).forEach(r => {
        mapMes[r.cuenta_id] = {
          ventas: Number(r.ventas) || 0, compras: Number(r.compras) || 0,
          cantVentas: Number(r.cant_ventas) || 0, cantCompras: Number(r.cant_compras) || 0,
          ventasAnt: Number(r.ventas_ant) || 0, comprasAnt: Number(r.compras_ant) || 0,
        }
      })
      setFacturacionMesPorCuenta(mapMes)
    }

    // Igual que arriba: sin la migración 121 el RPC no existe. Antes de
    // mostrar una proyección calculada con 3 semanas de facturas (la que se
    // pasaba de largo del tope sin avisar), preferimos decir que falta correr
    // la migración.
    if (errProy) {
      setProyeccionPorCuenta(null)
    } else {
      const mapProy = {}
      ;(cs || []).forEach(c => { mapProy[c.id] = { emitido90: 0, cant90: 0, emitido365: 0 } })
      ;(facProy || []).forEach(r => {
        mapProy[r.cuenta_id] = {
          emitido90: Number(r.emitido_90d) || 0,
          cant90: Number(r.cant_90d) || 0,
          emitido365: Number(r.emitido_365d) || 0,
        }
      })
      setProyeccionPorCuenta(mapProy)
    }
    setLoading(false)
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} key={id}
      style={{
        padding: '9px 20px', borderRadius: 8, border: 'none',
        background: tab === id ? 'var(--gold)' : 'var(--surface)',
        color: tab === id ? '#000' : 'var(--muted)',
        cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13,
      }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">📑 FACTURACIÓN</div>
      <div className="page-sub">
        Control fiscal multi-cuenta · Alertas de tope de monotributo · Vigencia valores: {VIGENCIA_DESDE} → {VIGENCIA_HASTA}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {tabBtn('cuentas', '🏛️ Cuentas')}
        {tabBtn('historial', '📒 Historial')}
        {tabBtn('balance', '📊 Balance')}
        {tabBtn('facturas', '🧾 Facturas')}
        {tabBtn('impuestos', '💸 Impuestos pagados')}
        {tabBtn('contrapartes', '👥 Contrapartes')}
        {tabBtn('importar', '📥 Importar CSV')}
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando...</p>}

      {!loading && tab === 'cuentas' && (
        <TabCuentas
          cuentas={cuentas}
          impuestos={impuestos}
          facturacionPorCuenta={facturacionPorCuenta}
          facturacionMesPorCuenta={facturacionMesPorCuenta}
          proyeccionPorCuenta={proyeccionPorCuenta}
          onChange={cargarTodo}
        />
      )}
      {!loading && tab === 'historial' && (
        <TabHistorial cuentas={cuentas} facturas={facturas} contrapartes={contrapartes} onChange={cargarTodo} />
      )}
      {!loading && tab === 'balance' && (
        <TabBalance cuentas={cuentas} />
      )}
      {!loading && tab === 'facturas' && (
        <TabFacturas cuentas={cuentas} facturas={facturas} contrapartes={contrapartes} onChange={cargarTodo} />
      )}
      {!loading && tab === 'impuestos' && (
        <TabImpuestos cuentas={cuentas} impuestos={impuestos} onChange={cargarTodo} />
      )}
      {!loading && tab === 'importar' && (
        <TabImportar cuentas={cuentas} onChange={cargarTodo} />
      )}
      {!loading && tab === 'contrapartes' && (
        <TabContrapartes contrapartes={contrapartes} onChange={cargarTodo} />
      )}
    </div>
  )
}

// ============================================================
// TAB CUENTAS — listado de cuentas con semáforo + alta/edición
// ============================================================
function TabCuentas({ cuentas, impuestos, facturacionPorCuenta, facturacionMesPorCuenta, proyeccionPorCuenta, onChange }) {
  const [editando, setEditando] = useState(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarSimulador, setMostrarSimulador] = useState(false)
  const [configArca, setConfigArca] = useState(null)
  const avisos = useMemo(() => calcularAvisos(cuentas, impuestos), [cuentas, impuestos])

  function nueva() {
    setEditando(null)
    setMostrarForm(true)
  }

  function editar(c) {
    setEditando(c)
    setMostrarForm(true)
  }

  async function eliminar(c) {
    if (!confirm(`¿Eliminar la cuenta "${c.nombre}"?\nLas facturas asociadas la mantienen como referencia y bloquean el borrado.`)) return
    const { error } = await supabase.from('cuentas_fiscales').delete().eq('id', c.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  return (
    <div>
      {/* Recordatorios de vencimientos */}
      <RecordatoriosVencimientos avisos={avisos} />

      {/* Alertas de tope */}
      <AlertasGlobales cuentas={cuentas} facturacionPorCuenta={facturacionPorCuenta} />

      {/* Lista de cuentas con semáforo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {cuentas.length} cuenta{cuentas.length === 1 ? '' : 's'} registrada{cuentas.length === 1 ? '' : 's'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {cuentas.some(c => c.tipo === 'monotributo') && (
            <button onClick={() => setMostrarSimulador(true)}
              style={{ padding: '8px 16px', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
              🧮 Simular distribución
            </button>
          )}
          <button onClick={nueva}
            style={{ padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            + Nueva cuenta
          </button>
        </div>
      </div>

      {cuentas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
          Todavía no hay cuentas cargadas. Apretá <strong>+ Nueva cuenta</strong> para agregar los 4 monotributos y la SAS.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
          {cuentas.map(c => (
            <CuentaCard
              key={c.id}
              cuenta={c}
              datos={facturacionPorCuenta[c.id] || { emitido: 0, recibido: 0 }}
              datosMes={facturacionMesPorCuenta ? facturacionMesPorCuenta[c.id] : null}
              mesDisponible={facturacionMesPorCuenta !== null}
              proy={proyeccionPorCuenta ? proyeccionPorCuenta[c.id] : null}
              proyDisponible={proyeccionPorCuenta !== null}
              onEditar={() => editar(c)}
              onEliminar={() => eliminar(c)}
              onConfigArca={() => setConfigArca(c)}
            />
          ))}
        </div>
      )}

      {mostrarForm && (
        <FormCuenta
          cuenta={editando}
          onCerrar={() => { setMostrarForm(false); setEditando(null) }}
          onGuardado={() => { setMostrarForm(false); setEditando(null); onChange() }}
        />
      )}

      {mostrarSimulador && (
        <SimuladorDistribucion
          cuentas={cuentas}
          facturacionPorCuenta={facturacionPorCuenta}
          onCerrar={() => setMostrarSimulador(false)}
        />
      )}

      {configArca && (
        <ModalConfigArca
          cuenta={configArca}
          onCerrar={() => setConfigArca(null)}
          onGuardado={() => { setConfigArca(null); onChange() }}
        />
      )}
    </div>
  )
}

function AlertasGlobales({ cuentas, facturacionPorCuenta }) {
  const alertas = useMemo(() => {
    const arr = []
    cuentas.forEach(c => {
      if (c.tipo !== 'monotributo') return
      const f = facturacionPorCuenta[c.id]
      if (!f) return
      const tope = TOPE_MAX_ABSOLUTO
      const pct = (f.emitido / tope) * 100
      if (pct >= 70) {
        const sem = estadoSemaforo(pct)
        arr.push({ ...sem, cuenta: c.nombre, pct, facturado: f.emitido })
      }
    })
    return arr.sort((a, b) => b.pct - a.pct)
  }, [cuentas, facturacionPorCuenta])

  if (alertas.length === 0) return null

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: alertas[0].color }}>
      <div className="card-title" style={{ color: alertas[0].color }}>⚠️ Alertas de tope</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {alertas.map((a, i) => (
          <div key={i} style={{ padding: 10, background: 'var(--surface2)', borderLeft: `4px solid ${a.color}`, borderRadius: 6, fontSize: 13 }}>
            <strong style={{ color: a.color }}>{a.cuenta}</strong> · facturó {fmt$(a.facturado)} en los últimos 12 meses ({fmtPct(a.pct)} del tope K).
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CuentaCard({ cuenta, datos, datosMes, mesDisponible, proy, proyDisponible, onEditar, onEliminar, onConfigArca }) {
  const esMono = cuenta.tipo === 'monotributo'
  const tope = esMono ? TOPE_MAX_ABSOLUTO : null
  const pct = esMono && tope ? (datos.emitido / tope) * 100 : 0
  const sem = esMono ? estadoSemaforo(pct) : null
  const catSugerida = esMono ? categoriaSugerida(datos.emitido) : null
  const cuotaActual = esMono && cuenta.categoria_monotributo
    ? cuotaMensual(cuenta.categoria_monotributo, cuenta.actividad || 'comercio')
    : 0
  // Proyección de facturación a 12 meses con ritmo actual. Los últimos 90 días
  // los suma el RPC proyeccion_cuentas_90d (migración 121): filtrando acá el
  // array `facturas` entraban 3 semanas (Supabase corta en 1.000 filas) y la
  // proyección salía muy por debajo de la real.
  const proyeccion = esMono ? proyectarFacturacionAnual(proy) : 0
  const pctProyeccion = esMono && tope ? (proyeccion / tope) * 100 : 0
  // Mes en curso (lo suma el RPC facturado_cuentas_mes, migración 120)
  const mes = datosMes || { ventas: 0, compras: 0, cantVentas: 0, cantCompras: 0, ventasAnt: 0, comprasAnt: 0 }

  return (
    <div className="card" style={{ padding: 14, borderColor: sem?.color || 'var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{cuenta.nombre}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            CUIT {cuenta.cuit} ·  {TIPOS_CUENTA.find(t => t.v === cuenta.tipo)?.l || cuenta.tipo}
            {esMono && cuenta.categoria_monotributo && ` · Cat ${cuenta.categoria_monotributo}`}
          </div>
          <div style={{ marginTop: 4 }}>
            {cuenta.arca_habilitado ? (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#1a2a1a', color: '#7dff7d', borderRadius: 4, padding: '2px 8px' }}>
                ⚡ ARCA {cuenta.arca_ambiente === 'produccion' ? 'PRODUCCIÓN' : 'homologación'} · PV {String(cuenta.arca_punto_venta || 1).padStart(4, '0')}
              </span>
            ) : (
              <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--surface2)', color: 'var(--muted)', borderRadius: 4, padding: '2px 8px' }}>
                ⚡ ARCA sin configurar
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onConfigArca} title="Configurar ARCA (facturación electrónica)"
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--gold)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
            ⚡
          </button>
          <button onClick={onEditar}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
            ✏️
          </button>
          <button onClick={onEliminar}
            style={{ background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
            🗑️
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, padding: 10, background: 'var(--surface2)', borderRadius: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>FACTURADO ÚLTIMOS 12 MESES</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(datos.emitido)}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {datos.cantEmitidas || 0} factura{(datos.cantEmitidas || 0) === 1 ? '' : 's'} · recibido {fmt$(datos.recibido)}
        </div>
      </div>

      {esMono && (
        <>
          {/* Barra de progreso del tope */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: sem.color, fontWeight: 700 }}>{fmtPct(pct)} del tope K</span>
              <span style={{ color: 'var(--muted)' }}>{fmt$(datos.emitido)} / {fmt$(tope)}</span>
            </div>
            <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: sem.color, transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 10, color: sem.color, marginTop: 4 }}>{sem.label}</div>
          </div>

          {/* Categoría sugerida vs actual */}
          {catSugerida && (
            <div style={{ marginTop: 10, padding: 8, background: 'var(--surface2)', borderRadius: 6, fontSize: 12 }}>
              <div>
                <span style={{ color: 'var(--muted)' }}>Categoría sugerida:</span>{' '}
                <strong style={{ color: catSugerida.cat === cuenta.categoria_monotributo ? '#7dff7d' : '#ffd17a' }}>
                  {catSugerida.cat}
                </strong>
                {catSugerida.cat !== cuenta.categoria_monotributo && (
                  <span style={{ color: '#ffd17a', marginLeft: 4 }}>(actual: {cuenta.categoria_monotributo || '—'})</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Cuota mensual {cuenta.actividad === 'servicios' ? 'servicios' : 'comercio'}: {fmt$(cuotaActual)}
              </div>
            </div>
          )}

          {pct >= 100 && (
            <div style={{ marginTop: 8, padding: 8, background: '#3a1a1a', color: '#ff8b8b', borderRadius: 6, fontSize: 12, textAlign: 'center', fontWeight: 700 }}>
              🚨 EXCEDIDO — Pasaste el tope K. Hablalo YA con tu contador.
            </div>
          )}

          {/* Proyección a 12 meses (la base la suma el RPC de la migración 121) */}
          {!proyDisponible ? (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--surface2)', borderRadius: 6, fontSize: 11, color: '#ffd17a' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>📈 PROYECCIÓN A 12 MESES</div>
              Falta correr la migración <strong>121</strong> en el SQL Editor de Supabase.
              Hasta entonces no se muestra: calculada en la pantalla salía corta
              (entran 3 semanas de facturas, no 90 días) y el aviso de tope llegaba tarde.
            </div>
          ) : proyeccion > 0 ? (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--surface2)', borderRadius: 6, fontSize: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 2 }}>📈 PROYECCIÓN A 12 MESES</div>
              <div>
                Si seguís a este ritmo: <strong>{fmt$(proyeccion)}</strong>{' '}
                <span style={{ color: pctProyeccion >= 100 ? '#ff8b8b' : pctProyeccion >= 85 ? '#ffd17a' : '#7dff7d', fontWeight: 700 }}>
                  ({fmtPct(pctProyeccion)} del tope)
                </span>
              </div>
              {pctProyeccion >= 100 && (
                <div style={{ fontSize: 10, color: '#ff8b8b', marginTop: 2 }}>
                  ⚠️ Si no bajás el ritmo, te vas a pasar antes de fin de año móvil.
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* ------------------------------------------------------------------
          MES EN CURSO — pedido de Fabricio (25/08/2026): debajo del tope,
          del mismo modo, cómo vienen las ventas y las compras del mes.
          Las suma el servidor: agosto solo ya trae más de 1.000 facturas.
      ------------------------------------------------------------------- */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 6 }}>
          📅 {mesActualARG()} — MES EN CURSO
        </div>
        {!mesDisponible ? (
          <div style={{ fontSize: 11, color: '#ffd17a', background: 'var(--surface2)', borderRadius: 6, padding: 8 }}>
            Falta correr la migración <strong>120</strong> en el SQL Editor de Supabase
            para ver las compras y ventas del mes.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <BloqueMes titulo="🧾 VENTAS" monto={mes.ventas} cant={mes.cantVentas} anterior={mes.ventasAnt} colorear />
            <BloqueMes titulo="🛒 COMPRAS" monto={mes.compras} cant={mes.cantCompras} anterior={mes.comprasAnt} />
          </div>
        )}
      </div>
    </div>
  )
}

// Un bloque de plata del mes en curso, con el mismo look que el de los 12
// meses. La comparación va contra el MISMO DÍA del mes anterior (la calcula el
// RPC): un mes a medio andar contra uno entero siempre daría rojo.
// Las ventas se pintan verde/rojo; las compras no, porque comprar más no es
// ni bueno ni malo por sí solo.
function BloqueMes({ titulo, monto, cant, anterior, colorear }) {
  const n = Number(monto) || 0
  const ant = Number(anterior) || 0
  const delta = ant !== 0 ? ((n - ant) / Math.abs(ant)) * 100 : null
  const subio = delta !== null && delta >= 0
  const colorDelta = !colorear ? 'var(--muted)' : subio ? '#7dff7d' : '#ff8b8b'
  const cantidad = Number(cant) || 0

  return (
    <div style={{ padding: 10, background: 'var(--surface2)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>
        {n < 0 ? '−' : ''}{fmt$(n)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
        {cantidad} comprobante{cantidad === 1 ? '' : 's'}
      </div>
      {delta === null ? (
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>sin dato del mes pasado</div>
      ) : (
        <div style={{ fontSize: 10, color: colorDelta, marginTop: 2 }}>
          {subio ? '▲' : '▼'} {fmtPct(Math.abs(delta))} vs. mismo día del mes pasado
        </div>
      )}
    </div>
  )
}

function FormCuenta({ cuenta, onCerrar, onGuardado }) {
  const VACIO = {
    nombre: '', razon_social: '', cuit: '',
    tipo: 'monotributo', categoria_monotributo: 'A', actividad: 'comercio',
    inscripto_iibb: false, iibb_numero: '', iibb_regimen: 'local', alicuota_iibb_pct: '',
    inscripto_municipal: false, alicuota_municipal_pct: '',
    condicion_iva: 'monotributo',
    fecha_inicio_actividad: '', domicilio_fiscal: '', email: '', telefono: '', notas: '', activa: true,
  }
  const [form, setForm] = useState(cuenta || VACIO)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!form.nombre.trim()) return alert('Nombre obligatorio')
    if (!form.cuit.trim()) return alert('CUIT obligatorio')
    if (!esCuitValido(form.cuit)) {
      if (!confirm('⚠️ El CUIT no parece válido (el dígito verificador no coincide). ¿Guardar igual?')) return
    }
    setGuardando(true)
    const datos = {
      ...form,
      alicuota_iibb_pct: form.alicuota_iibb_pct === '' ? null : Number(form.alicuota_iibb_pct),
      alicuota_municipal_pct: form.alicuota_municipal_pct === '' ? null : Number(form.alicuota_municipal_pct),
      fecha_inicio_actividad: form.fecha_inicio_actividad || null,
      categoria_monotributo: form.tipo === 'monotributo' ? form.categoria_monotributo : null,
      updated_at: new Date().toISOString(),
    }
    let error
    if (cuenta?.id) {
      const r = await supabase.from('cuentas_fiscales').update(datos).eq('id', cuenta.id)
      error = r.error
    } else {
      const r = await supabase.from('cuentas_fiscales').insert(datos)
      error = r.error
    }
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  const esMono = form.tipo === 'monotributo'

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {cuenta ? '✏️ Editar cuenta' : '+ Nueva cuenta'}
          </div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Nombre interno *"><input value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder='Ej: "Mono Fabri"' style={inp} /></Campo>
          <Campo label="Razón social"><input value={form.razon_social} onChange={e => set('razon_social', e.target.value)} placeholder="Razón social legal" style={inp} /></Campo>
          <Campo label="CUIT *">
            <input value={form.cuit} onChange={e => set('cuit', e.target.value)} placeholder="20-12345678-9"
              style={{ ...inp, borderColor: form.cuit ? (esCuitValido(form.cuit) ? 'var(--green)' : '#ff8b8b') : 'var(--border)' }} />
            {form.cuit && !esCuitValido(form.cuit) && (
              <div style={{ fontSize: 10, color: '#ff8b8b', marginTop: 2 }}>⚠️ CUIT inválido (dígito verificador no coincide)</div>
            )}
          </Campo>
          <Campo label="Tipo de cuenta *">
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={inp}>
              {TIPOS_CUENTA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Campo>
          {esMono && (
            <>
              <Campo label="Categoría actual">
                <select value={form.categoria_monotributo} onChange={e => set('categoria_monotributo', e.target.value)} style={inp}>
                  {CATEGORIAS.map(c => (
                    <option key={c.cat} value={c.cat}>
                      {c.cat} — hasta {fmt$(c.tope_anual)}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Actividad">
                <select value={form.actividad} onChange={e => set('actividad', e.target.value)} style={inp}>
                  <option value="comercio">Comercio / venta de cosas muebles</option>
                  <option value="servicios">Servicios</option>
                </select>
              </Campo>
            </>
          )}
          <Campo label="Condición IVA">
            <select value={form.condicion_iva} onChange={e => set('condicion_iva', e.target.value)} style={inp}>
              <option value="monotributo">Monotributo</option>
              <option value="responsable_inscripto">Responsable Inscripto</option>
              <option value="exento">Exento</option>
              <option value="consumidor_final">Consumidor Final</option>
            </select>
          </Campo>
          <Campo label="Fecha inicio actividad"><input type="date" value={form.fecha_inicio_actividad || ''} onChange={e => set('fecha_inicio_actividad', e.target.value)} style={inp} /></Campo>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>🏛️ INGRESOS BRUTOS (IIBB)</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={form.inscripto_iibb} onChange={e => set('inscripto_iibb', e.target.checked)} />
            Está inscripto en IIBB
          </label>
          {form.inscripto_iibb && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Campo label="Número IIBB"><input value={form.iibb_numero || ''} onChange={e => set('iibb_numero', e.target.value)} style={inp} /></Campo>
              <Campo label="Régimen">
                <select value={form.iibb_regimen || 'local'} onChange={e => set('iibb_regimen', e.target.value)} style={inp}>
                  <option value="local">Local (Córdoba)</option>
                  <option value="convenio_multilateral">Convenio Multilateral</option>
                  <option value="simplificado">Simplificado</option>
                </select>
              </Campo>
              <Campo label="Alícuota IIBB %"><input type="number" step="0.01" value={form.alicuota_iibb_pct} onChange={e => set('alicuota_iibb_pct', e.target.value)} placeholder="Ej: 3.50" style={inp} /></Campo>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>🏢 MUNICIPAL (Río Primero, Córdoba)</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={form.inscripto_municipal} onChange={e => set('inscripto_municipal', e.target.checked)} />
            Paga Contribución Comercio e Industria / Tasa Municipal
          </label>
          {form.inscripto_municipal && (
            <Campo label="Alícuota municipal %"><input type="number" step="0.01" value={form.alicuota_municipal_pct} onChange={e => set('alicuota_municipal_pct', e.target.value)} placeholder="Ej: 0.60" style={inp} /></Campo>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>📞 CONTACTO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Campo label="Domicilio fiscal"><input value={form.domicilio_fiscal || ''} onChange={e => set('domicilio_fiscal', e.target.value)} style={inp} /></Campo>
            <Campo label="Email"><input value={form.email || ''} onChange={e => set('email', e.target.value)} style={inp} /></Campo>
            <Campo label="Teléfono"><input value={form.telefono || ''} onChange={e => set('telefono', e.target.value)} style={inp} /></Campo>
          </div>
          <Campo label="Notas"><textarea value={form.notas || ''} onChange={e => set('notas', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} /></Campo>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : (cuenta ? '✅ Guardar cambios' : '✅ Crear cuenta')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  )
}

// ============================================================
// IMPORTADOR "Mis Comprobantes" (Recibidos) de ARCA
// ============================================================
// ARCA no expone los comprobantes RECIBIDOS por web service: se exportan del
// portal "Mis Comprobantes → Recibidos" como CSV. Este parser entiende ese
// formato (detecta separador, mapea columnas por nombre, fechas AR y montos AR)
// y crea las facturas recibidas (compra) de la cuenta, salteando duplicados.
function parseCsvRows(text, delim) {
  const rows = []; let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false } else field += c }
    else if (c === '"') q = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c === '\r') { /* skip */ }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(f => String(f).trim() !== ''))
}
const normHdr = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
function colIdx(headers, ...keywordSets) {
  for (const kws of keywordSets) {
    const i = headers.findIndex(h => kws.every(k => h.includes(k)))
    if (i >= 0) return i
  }
  return -1
}
function parseFechaAfip(s) {
  s = String(s || '').trim()
  let m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}
function tipoCortoDeCodigo(codigo) {
  const letra = COMPROBANTES[codigo]?.letra || ''
  if (NOTAS_CREDITO.has(codigo)) return 'NC' + letra
  if (NOTAS_DEBITO.has(codigo)) return 'ND' + letra
  return letra || 'Otro'
}
// Códigos AFIP que NO son Factura/NC/ND comunes pero igual definen la CLASE (letra)
// del comprobante — clave para el IVA crédito (solo computa clase A): Recibos, Notas
// de Venta, Tique-Factura (controlador fiscal), Liquidación de Servicios Públicos, FCE.
const CODIGO_LETRA = {
  4: 'A', 5: 'A', 16: 'A', 17: 'A', 81: 'A', 201: 'A', 202: 'A', 203: 'A',
  9: 'B', 10: 'B', 18: 'B', 82: 'B', 206: 'B', 207: 'B', 208: 'B',
  15: 'C', 19: 'C', 83: 'C', 211: 'C', 212: 'C', 213: 'C',
}
function tipoCortoDelCsv(raw) {
  const s = String(raw || '').trim()
  const num = parseInt((s.match(/\d+/) || [])[0] || '', 10)
  if (num && COMPROBANTES[num]) return tipoCortoDeCodigo(num)
  if (num && CODIGO_LETRA[num]) return CODIGO_LETRA[num] // Tique/Recibo/Liq. Servicios → su letra
  const t = normHdr(s)
  const letra = /factura a|nota.* a\b|\ba\b/.test(t) ? 'A' : (/factura b|nota.* b\b|\bb\b/.test(t) ? 'B' : 'C')
  if (t.includes('credito')) return 'NC' + letra
  if (t.includes('debito')) return 'ND' + letra
  return letra
}
function parseMisComprobantes(texto) {
  const linea1 = texto.split(/\r?\n/).find(l => l.trim()) || ''
  const delim = (linea1.split(';').length > linea1.split(',').length) ? ';' : ','
  const rows = parseCsvRows(texto, delim)
  if (rows.length < 2) return { error: 'El archivo no tiene datos. ¿Exportaste el CSV de "Mis Comprobantes → Recibidos"?', filas: [] }
  const headers = rows[0].map(normHdr)
  const iFecha = colIdx(headers, ['fecha'])
  const iTipo = colIdx(headers, ['tipo', 'comprob'])
  const iPv = colIdx(headers, ['punto', 'venta'])
  const iNro = colIdx(headers, ['numero', 'desde'], ['numero'], ['nro comprob'])
  // Contraparte: en Recibidos es el EMISOR, en Emitidos el RECEPTOR. "denominacion"
  // y "nro doc" cubren ambos casos sin importar la dirección del CSV.
  const iNombre = colIdx(headers, ['denominacion'], ['razon social'], ['receptor'], ['emisor'])
  const iCuit = colIdx(headers, ['nro doc'], ['nro', 'doc'], ['cuit'], ['documento'])
  const iCae = colIdx(headers, ['cod', 'autoriz'], ['cae'])
  // OJO: el CSV de ARCA tiene MUCHAS columnas por alícuota ("Imp. Neto Gravado IVA
  // 0%", "IVA 2,5%", … "Imp. Neto Gravado Total", "Total IVA", "Imp. Total"). Hay
  // que elegir las columnas TOTALES, no la primera que matchea.
  let iNeto = headers.indexOf('imp neto gravado total')
  if (iNeto < 0) iNeto = headers.findIndex(h => h.includes('neto') && h.includes('gravado') && h.includes('total'))
  if (iNeto < 0) iNeto = colIdx(headers, ['imp neto'], ['neto', 'gravado'])
  let iIva = headers.indexOf('total iva')
  if (iIva < 0) iIva = headers.findIndex(h => h.includes('total iva'))
  if (iIva < 0) iIva = headers.findIndex(h => h === 'iva')
  let iTotal = headers.indexOf('imp total')
  if (iTotal < 0) iTotal = headers.indexOf('importe total')
  if (iTotal < 0) iTotal = headers.findIndex(h => h.includes('total') && !h.includes('neto') && !h.includes('gravado') && !h.includes('iva'))
  if (iFecha < 0 || iTotal < 0) return { error: 'No reconozco las columnas (esperaba al menos Fecha e Imp. Total). ¿Es el CSV de Mis Comprobantes de ARCA?', filas: [] }
  const filas = []
  for (const r of rows.slice(1)) {
    const fecha = parseFechaAfip(r[iFecha])
    const total = parseNumero(r[iTotal])
    if (!fecha || !(total > 0)) continue
    filas.push({
      fecha,
      tipo_comprobante: iTipo >= 0 ? tipoCortoDelCsv(r[iTipo]) : 'Otro',
      punto_venta: iPv >= 0 ? String(r[iPv] || '').replace(/\D/g, '') : '',
      numero: iNro >= 0 ? String(r[iNro] || '').replace(/\D/g, '') : '',
      cae: iCae >= 0 ? String(r[iCae] || '').replace(/\D/g, '') : '',
      contraparte_nombre: iNombre >= 0 ? String(r[iNombre] || '').trim() : '',
      contraparte_cuit: iCuit >= 0 ? String(r[iCuit] || '').replace(/\D/g, '') : '',
      monto_neto: iNeto >= 0 ? parseNumero(r[iNeto]) : 0,
      monto_iva: iIva >= 0 ? parseNumero(r[iIva]) : 0,
      monto_total: total,
    })
  }
  return { error: null, filas }
}
// Normaliza punto de venta / número quitando ceros a la izquierda (para deduplicar).
const nrmNum = x => String(parseInt(String(x ?? '').replace(/\D/g, ''), 10) || 0)
const claveComprobante = f => `${f.tipo_comprobante || ''}|${nrmNum(f.punto_venta)}|${nrmNum(f.numero)}`

function ModalImportarComprobantes({ cuenta, onCerrar, onImportado }) {
  const [dir, setDir] = useState('recibida') // 'recibida' (compras) | 'emitida' (ventas)
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState(null)
  const [nombreArch, setNombreArch] = useState('')
  const [importando, setImportando] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [analizando, setAnalizando] = useState(false)

  // Trae TODAS las claves ya cargadas de la cuenta+tipo (paginando, porque Supabase
  // corta en 1.000). Así el dedup mira la base completa, no un subconjunto.
  async function clavesExistentes() {
    const set = new Set()
    let from = 0
    for (;;) {
      const { data } = await supabase.from('facturas')
        .select('tipo_comprobante,punto_venta,numero')
        .eq('cuenta_id', cuenta.id).eq('tipo', dir)
        .range(from, from + 999)
      if (!data || !data.length) break
      data.forEach(f => set.add(claveComprobante(f)))
      if (data.length < 1000) break
      from += 1000
    }
    return set
  }

  async function procesar(texto) {
    const res = parseMisComprobantes(String(texto || ''))
    if (res.error) { setError(res.error); setFilas(null); return }
    setError(null); setAnalizando(true)
    const yaCargadas = await clavesExistentes()
    setFilas(res.filas.map(f => ({ ...f, dup: yaCargadas.has(claveComprobante(f)) })))
    setAnalizando(false)
  }
  function onFile(file) {
    if (!file) return
    setNombreArch(file.name); setError(null); setFilas(null)
    const reader = new FileReader()
    reader.onload = () => procesar(String(reader.result || ''))
    reader.readAsText(file)
  }
  function cambiarDir(d) { setDir(d); setFilas(null); setError(null); setNombreArch('') }

  const nuevas = (filas || []).filter(f => !f.dup)
  const dups = (filas || []).filter(f => f.dup).length
  const totalNuevas = nuevas.reduce((s, f) => s + (f.monto_total || 0), 0)
  const esEmitida = dir === 'emitida'

  async function importar() {
    if (!nuevas.length) return
    setImportando(true); setProgreso(0)
    const datos = nuevas.map(f => ({
      cuenta_id: cuenta.id, tipo: dir,
      clasificacion: esEmitida ? 'venta' : 'compra',
      fecha: f.fecha, tipo_comprobante: f.tipo_comprobante,
      punto_venta: f.punto_venta || null, numero: f.numero || null,
      contraparte_nombre: f.contraparte_nombre || null, contraparte_cuit: f.contraparte_cuit || null,
      monto_neto: f.monto_neto || 0, monto_iva: f.monto_iva || 0, monto_otros: 0, monto_total: f.monto_total || 0,
      ...(esEmitida && f.cae ? { cae: f.cae, arca_estado: 'autorizada' } : {}),
    }))
    // Insert en lotes — un insert único de miles de filas supera el límite de Supabase.
    const CHUNK = 400
    let insertadas = 0, errMsg = null
    for (let i = 0; i < datos.length; i += CHUNK) {
      const { error: e } = await supabase.from('facturas').insert(datos.slice(i, i + CHUNK))
      if (e) { errMsg = e.message; break }
      insertadas += Math.min(CHUNK, datos.length - i)
      setProgreso(insertadas)
    }
    setImportando(false); setProgreso(0)
    if (errMsg) {
      alert(`⚠️ Se importaron ${insertadas} de ${datos.length}. Se cortó por un error: ${errMsg}`)
      if (insertadas) onImportado(insertadas, dir)
      return
    }
    onImportado(insertadas, dir)
  }

  const tabBtn = (d, label) => (
    <button onClick={() => cambiarDir(d)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid ' + (dir === d ? 'var(--gold)' : 'var(--border)'), background: dir === d ? 'rgba(201,168,76,0.15)' : 'var(--surface2)', color: dir === d ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>{label}</button>
  )

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>📥 Importar de Mis Comprobantes — {cuenta.nombre}</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {tabBtn('recibida', '📥 Recibidos (compras)')}
          {tabBtn('emitida', '📤 Emitidos (ventas)')}
        </div>

        <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 14, lineHeight: 1.6 }}>
          <strong>Cómo obtener el archivo:</strong> ARCA → <strong>Mis Comprobantes</strong> → pestaña <strong>{esEmitida ? 'Emitidos' : 'Recibidos'}</strong> → elegí el rango de fechas → <strong>Consultar</strong> → <strong>Exportar / Descargar CSV</strong>. Subilo acá. {esEmitida ? 'Se cargan como Ventas (con su CAE).' : 'Se cargan como Compra (en RI reclasificás los Gastos después).'}
        </div>

        <input type="file" accept=".csv,text/csv,text/plain" onChange={e => onFile(e.target.files?.[0])}
          style={{ ...inp, padding: 8 }} />

        {nombreArch && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>📄 {nombreArch}</div>}
        {analizando && <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 8 }}>⏳ Analizando y comparando con lo ya cargado…</div>}
        {error && <div style={{ fontSize: 12, color: '#ff8b8b', background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: '10px 12px', marginTop: 10 }}>❌ {error}</div>}

        {filas && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <KPI label="✅ Nuevas a importar" value={String(nuevas.length)} sub={fmt$(totalNuevas)} color="#7dff7d" />
              <KPI label="↩️ Ya cargadas (saltean)" value={String(dups)} sub="duplicados" color="var(--muted)" />
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', fontSize: 11 }}>
                <thead><tr style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: 5 }}>Fecha</th><th style={{ textAlign: 'left', padding: 5 }}>Comp.</th><th style={{ textAlign: 'left', padding: 5 }}>{esEmitida ? 'Receptor' : 'Emisor'}</th><th style={{ textAlign: 'right', padding: 5 }}>Total</th>
                </tr></thead>
                <tbody>
                  {filas.slice(0, 100).map((f, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)', opacity: f.dup ? 0.45 : 1 }}>
                      <td style={{ padding: 5, whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha)}</td>
                      <td style={{ padding: 5 }}>{LABEL_TIPO_COMPROBANTE[f.tipo_comprobante] || f.tipo_comprobante}{f.dup ? ' (ya está)' : ''}</td>
                      <td style={{ padding: 5 }}>{f.contraparte_nombre || f.contraparte_cuit || '—'}</td>
                      <td style={{ padding: 5, textAlign: 'right' }}>{fmt$(f.monto_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filas.length > 100 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>… y {filas.length - 100} más (se importan todos).</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
          <button onClick={importar} disabled={!nuevas.length || importando}
            style={{ flex: 2, padding: 12, background: nuevas.length ? 'var(--gold)' : 'var(--surface2)', color: nuevas.length ? '#000' : 'var(--muted)', border: 'none', borderRadius: 8, cursor: nuevas.length ? 'pointer' : 'not-allowed', fontWeight: 800, letterSpacing: 1 }}>
            {importando ? `⏳ Importando ${progreso} / ${nuevas.length}...` : `⬇️ Importar ${nuevas.length} ${esEmitida ? 'ventas' : 'comprobantes'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TAB HISTORIAL — control mensual por cuenta (ventas/compras/gastos)
// RI: IVA débito (ventas) − IVA crédito (SOLO Factura A) = saldo IVA del mes.
// Monotributo: sin IVA; muestra el acumulado 12 meses (control de recategorización).
// ============================================================
const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
// Clasificación de un comprobante: venta / compra / gasto (con fallback por tipo).
function clasifFactura(f) { return f.clasificacion || (f.tipo === 'emitida' ? 'venta' : 'compra') }
// Las Notas de Crédito restan; el resto suma.
function esNotaCredito(f) { return NOTAS_CREDITO.has(Number(f.comprobante_codigo)) || String(f.tipo_comprobante || '').toUpperCase().startsWith('NC') }
function signoFactura(f) { return esNotaCredito(f) ? -1 : 1 }
// Letra del comprobante (para saber si el IVA es computable: solo letra A).
function letraFactura(f) {
  if (f.comprobante_codigo && COMPROBANTES[f.comprobante_codigo]) return COMPROBANTES[f.comprobante_codigo].letra
  const t = String(f.tipo_comprobante || '').toUpperCase()
  if (t.endsWith('A')) return 'A'
  if (t.endsWith('B')) return 'B'
  return 'C'
}

function TabHistorial({ cuentas, facturas, contrapartes, onChange }) {
  const HOY = String(fechaHoyARG() || '2026-01-01').slice(0, 10)
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id || '')
  const [modo, setModo] = useState('mes') // 'mes' (mes a mes) | 'periodo' (rango Desde/Hasta)
  const [mes, setMes] = useState(() => HOY.slice(0, 7))
  const [desde, setDesde] = useState(HOY.slice(0, 7) + '-01')
  const [hasta, setHasta] = useState(HOY)
  const [filtro, setFiltro] = useState('todos')
  const [cargar, setCargar] = useState(null) // { tipo } | null
  const [importar, setImportar] = useState(false)
  const [cargarImp, setCargarImp] = useState(false) // form de pago de impuesto/cuota
  const [exportando, setExportando] = useState(null) // null | { hechos, total }

  const cuenta = cuentas.find(c => c.id === Number(cuentaId))
  const esRI = esCuentaRI(cuenta)

  function cambiarMes(delta) {
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(y, (m - 1) + delta, 1)
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Rango efectivo: modo 'mes' = el mes completo · modo 'periodo' = Desde/Hasta.
  const [my, mm] = mes.split('-').map(Number)
  const ultimoDia = new Date(my, mm, 0).getDate()
  const rDesde = modo === 'periodo' ? desde : `${mes}-01`
  const rHasta = modo === 'periodo' ? hasta : `${mes}-${String(ultimoDia).padStart(2, '0')}`
  const etiquetaPeriodo = modo === 'periodo' ? `${fmtFecha(rDesde)} → ${fmtFecha(rHasta)}` : `${MESES_NOMBRE[(mm || 1) - 1]} ${my}`

  // Una cuenta puede tener DECENAS DE MILES de facturas → no se traen todas al
  // front (Supabase corta en 1.000). Los TOTALES los calcula una función SQL
  // (facturas_historial por rango de fechas) y el DETALLE se pagina en el servidor.
  const [resumen, setResumen] = useState(null)
  const [detalle, setDetalle] = useState([])
  const [totalDet, setTotalDet] = useState(0)
  const [pagDet, setPagDet] = useState(1)
  const [cargandoDet, setCargandoDet] = useState(false)
  const [refrescar, setRefrescar] = useState(0)
  const PAGE = 25

  // Resumen del rango (RPC). Recalcula al cambiar cuenta / rango / refresco.
  useEffect(() => {
    let vivo = true
    setResumen(null); setPagDet(1)
    supabase.rpc('facturas_historial', { p_cuenta: Number(cuentaId), p_desde: rDesde, p_hasta: rHasta })
      .then(({ data }) => { if (vivo) setResumen(data || {}) })
    return () => { vivo = false }
  }, [cuentaId, rDesde, rHasta, refrescar])

  // Impuestos / cuotas pagados en el período (tabla aparte `impuestos_pagados`).
  // Para monotributo, acá cae la CUOTA DE MONOTRIBUTO: es gasto del perfil y NO
  // discrimina IVA (el IVA va integrado en el componente impositivo). Son pocas
  // filas (carga manual) → se traen directo, sin paginar.
  const [impPeriodo, setImpPeriodo] = useState([])
  useEffect(() => {
    let vivo = true
    supabase.from('impuestos_pagados').select('*')
      .eq('cuenta_id', Number(cuentaId)).gte('fecha_pago', rDesde).lte('fecha_pago', rHasta)
      .order('fecha_pago', { ascending: false })
      .then(({ data }) => { if (vivo) setImpPeriodo(data || []) })
    return () => { vivo = false }
  }, [cuentaId, rDesde, rHasta, refrescar])

  // 🗑️ Borrado de comprobantes mal cargados/importados (ej: las ventas de un
  // CSV de Mis Comprobantes que entraron a Recibidos por error). Confirmación
  // inline por fila + borrado en LOTE de todo lo listado con el filtro actual.
  const [confirmarBorrarId, setConfirmarBorrarId] = useState(null)
  const [confirmarBorrarTodo, setConfirmarBorrarTodo] = useState(false)
  const [borrandoComp, setBorrandoComp] = useState(false)

  async function borrarComprobante(f) {
    setBorrandoComp(true)
    const { error } = await supabase.from('facturas').delete().eq('id', f.id)
    setBorrandoComp(false)
    setConfirmarBorrarId(null)
    if (error) { alert('❌ No se pudo borrar: ' + error.message); return }
    setRefrescar(x => x + 1)
    onChange()
  }

  // Borra TODO lo que matchea el filtro actual (cuenta + período + clasificación),
  // no solo la página visible. Mismo criterio de filtrado que el listado.
  async function borrarTodoListado() {
    setBorrandoComp(true)
    let q = supabase.from('facturas').delete()
      .eq('cuenta_id', Number(cuentaId)).gte('fecha', rDesde).lte('fecha', rHasta)
    if (filtro === 'venta') q = q.or('clasificacion.eq.venta,and(clasificacion.is.null,tipo.eq.emitida)')
    else if (filtro === 'compra') q = q.or('clasificacion.eq.compra,and(clasificacion.is.null,tipo.eq.recibida)')
    else if (filtro === 'gasto') q = q.eq('clasificacion', 'gasto')
    const { error } = await q
    setBorrandoComp(false)
    setConfirmarBorrarTodo(false)
    if (error) { alert('❌ No se pudo borrar: ' + error.message); return }
    setRefrescar(x => x + 1)
    onChange()
  }

  // Detalle paginado del rango (server-side, con filtro).
  useEffect(() => {
    let vivo = true
    setCargandoDet(true)
    setConfirmarBorrarId(null)
    setConfirmarBorrarTodo(false)
    let q = supabase.from('facturas').select('*', { count: 'exact' })
      .eq('cuenta_id', Number(cuentaId)).gte('fecha', rDesde).lte('fecha', rHasta)
    if (filtro === 'venta') q = q.or('clasificacion.eq.venta,and(clasificacion.is.null,tipo.eq.emitida)')
    else if (filtro === 'compra') q = q.or('clasificacion.eq.compra,and(clasificacion.is.null,tipo.eq.recibida)')
    else if (filtro === 'gasto') q = q.eq('clasificacion', 'gasto')
    const from = (pagDet - 1) * PAGE
    q.order('fecha', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1)
      .then(({ data, count }) => { if (vivo) { setDetalle(data || []); setTotalDet(count || 0); setCargandoDet(false) } })
    return () => { vivo = false }
  }, [cuentaId, rDesde, rHasta, filtro, pagDet, refrescar])

  const r = resumen || {}
  const totVentas = Number(r.ventas_total) || 0
  const totCompras = Number(r.compras_total) || 0
  const totGastos = Number(r.gastos_total) || 0
  const cantVentas = Number(r.ventas_cant) || 0
  const cantCompras = Number(r.compras_cant) || 0
  const cantGastos = Number(r.gastos_cant) || 0
  const ivaDebito = Number(r.iva_debito) || 0
  const ivaCredito = Number(r.iva_credito) || 0
  const saldoIva = ivaDebito - ivaCredito
  const acum12 = Number(r.acum12) || 0
  const totImpuestos = impPeriodo.reduce((s, p) => s + (Number(p.monto) || 0), 0)
  const totalPagDet = Math.max(1, Math.ceil(totalDet / PAGE))

  // --- Liquidación mensual (solo Responsable Inscripto, ej. la SAS) ---
  // IIBB y municipal se calculan sobre las VENTAS NETAS (sin IVA): el IVA débito
  // no integra la base imponible de Ingresos Brutos del RI.
  const ventasNeto = Math.max(0, totVentas - ivaDebito)
  const iibbAlic = Number(cuenta?.alicuota_iibb_pct) || 0
  const iibbMes = esRI && cuenta?.inscripto_iibb ? ventasNeto * iibbAlic / 100 : 0
  const munAlic = Number(cuenta?.alicuota_municipal_pct) || 0
  const munMes = esRI && cuenta?.inscripto_municipal ? ventasNeto * munAlic / 100 : 0
  const ivaAPagar = Math.max(0, saldoIva)
  const totalAPagar = ivaAPagar + iibbMes + munMes

  async function abrirPdf(f) {
    if (f.cae) { imprimirComprobante(f, cuenta || {}); return }
    if (f.archivo_url) {
      const { data } = await supabase.storage.from('facturas').createSignedUrl(f.archivo_url, 120)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
      else alert('No se pudo abrir el PDF')
    }
  }

  // Exporta a un ZIP todos los comprobantes con archivo adjunto (PDF/foto) del
  // período + un índice CSV. Pensado para pasarle al contador para el balance.
  async function exportarArchivos() {
    const { data: rows, error } = await supabase.from('facturas')
      .select('fecha,tipo,clasificacion,tipo_comprobante,punto_venta,numero,contraparte_nombre,monto_neto,monto_iva,monto_total,archivo_url')
      .eq('cuenta_id', Number(cuentaId)).gte('fecha', rDesde).lte('fecha', rHasta)
      .not('archivo_url', 'is', null)
      .order('fecha', { ascending: true })
    if (error) { alert('❌ ' + error.message); return }
    if (!rows || rows.length === 0) { alert('No hay comprobantes con archivo adjunto en este período.'); return }

    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`
    const filas = [['Fecha', 'Tipo', 'Clasif', 'Comprobante', 'Nro', 'Contraparte', 'Neto', 'IVA', 'Total', 'Archivo'].map(esc).join(';')]
    const usados = {}
    setExportando({ hechos: 0, total: rows.length })
    for (let i = 0; i < rows.length; i++) {
      const f = rows[i]
      let nombreArch = ''
      try {
        const { data: sig } = await supabase.storage.from('facturas').createSignedUrl(f.archivo_url, 120)
        if (sig?.signedUrl) {
          const blob = await (await fetch(sig.signedUrl)).blob()
          const ext = (f.archivo_url.match(/\.[a-zA-Z0-9]+$/) || ['.bin'])[0]
          const comp = `${(f.tipo_comprobante || f.clasificacion || 'comprob')}_${String(f.numero || i + 1)}`.replace(/[^a-zA-Z0-9._-]/g, '_')
          let base = `${f.fecha}_${comp}`
          usados[base] = (usados[base] || 0) + 1
          if (usados[base] > 1) base += `_${usados[base]}`
          nombreArch = base + ext
          zip.file(nombreArch, blob)
        }
      } catch { /* archivo faltante → sigue */ }
      filas.push([f.fecha, f.tipo, f.clasificacion || (f.tipo === 'emitida' ? 'venta' : 'compra'),
        f.tipo_comprobante || '', `${f.punto_venta || ''}-${f.numero || ''}`, f.contraparte_nombre || '',
        f.monto_neto || 0, f.monto_iva || 0, f.monto_total || 0, nombreArch].map(esc).join(';'))
      setExportando({ hechos: i + 1, total: rows.length })
    }
    zip.file('00_INDICE.csv', '﻿' + filas.join('\r\n'))
    const out = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(out)
    const a = document.createElement('a')
    a.href = url
    a.download = `comprobantes_${(cuenta?.nombre || 'cuenta').trim().replace(/\s+/g, '_')}_${rDesde}_a_${rHasta}.zip`
    a.click()
    URL.revokeObjectURL(url)
    setExportando(null)
  }

  const navBtn = { padding: '6px 11px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }
  const chip = activo => ({ padding: '6px 14px', borderRadius: 20, border: '1px solid ' + (activo ? 'var(--gold)' : 'var(--border)'), background: activo ? 'rgba(201,168,76,0.15)' : 'var(--surface)', color: activo ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', fontWeight: 700, fontSize: 12 })
  const badge = clasif => {
    const map = { venta: ['📤 Venta', 'var(--gold)'], compra: ['📥 Compra', '#7a9dff'], gasto: ['🧾 Gasto', 'var(--purple)'] }
    const [txt, col] = map[clasif] || ['—', 'var(--muted)']
    return <span style={{ fontSize: 10, fontWeight: 700, color: col, border: `1px solid ${col}`, borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}>{txt}</span>
  }

  if (cuentas.length === 0) {
    return <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Primero cargá una cuenta en <strong>🏛️ Cuentas</strong>.</div>
  }

  return (
    <div>
      {/* Cuenta + mes + cargar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} style={{ ...inp, width: 250 }}>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {esCuentaRI(c) ? 'Resp. Inscripto' : 'Monotributo'}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => { setModo('mes'); setPagDet(1) }} style={chip(modo === 'mes')}>Mes</button>
          <button onClick={() => { setModo('periodo'); setPagDet(1) }} style={chip(modo === 'periodo')}>Período</button>
        </div>
        {modo === 'mes' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => cambiarMes(-1)} style={navBtn}>◀</button>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)} style={{ ...inp, width: 160 }} />
            <button onClick={() => cambiarMes(1)} style={navBtn}>▶</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Desde</span>
            <input type="date" value={desde} onChange={e => { setDesde(e.target.value); setPagDet(1) }} style={{ ...inp, width: 150 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Hasta</span>
            <input type="date" value={hasta} onChange={e => { setHasta(e.target.value); setPagDet(1) }} style={{ ...inp, width: 150 }} />
          </div>
        )}
        <button onClick={exportarArchivos} disabled={!!exportando} style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: exportando ? 'wait' : 'pointer', fontWeight: 700, fontSize: 13, opacity: exportando ? 0.6 : 1 }} title="Descarga un ZIP con todos los PDF/fotos adjuntos del período + un índice CSV, para pasarle al contador.">{exportando ? `📦 ${exportando.hechos}/${exportando.total}…` : '📦 Exportar archivos'}</button>
        <button onClick={() => setImportar(true)} style={{ padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>📥 Importar Mis Comprobantes</button>
        <button onClick={() => setCargar({ tipo: 'recibida' })} style={{ padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>➕ Compra/gasto</button>
        <button onClick={() => setCargarImp(true)} style={{ padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }} title="Cuota de monotributo, IVA DDJJ, Ganancias, IIBB, tasas… (gasto del perfil, sin IVA)">💸 Pago impuesto/cuota</button>
        <button onClick={() => setCargar({ tipo: 'emitida' })} style={{ padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>🧾 Cargar venta</button>
      </div>

      {/* Totales del mes */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, letterSpacing: 1 }}>📅 {etiquetaPeriodo.toUpperCase()}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <KPI label="📤 Ventas" value={fmt$(totVentas)} sub={`${cantVentas} comprob.`} color="var(--gold)" />
        <KPI label="📥 Compras" value={fmt$(totCompras)} sub={`${cantCompras} comprob.`} color="#7a9dff" />
        <KPI label="🧾 Gastos" value={fmt$(totGastos)} sub={`${cantGastos} comprob.`} color="var(--purple)" />
        {esRI ? (
          <>
            <KPI label="IVA Débito" value={fmt$(ivaDebito)} sub="de las ventas" color="#ff8b8b" />
            <KPI label="IVA Crédito" value={fmt$(ivaCredito)} sub="solo Factura A" color="#7dff7d" />
            <KPI label="Saldo IVA del mes" value={fmt$(Math.abs(saldoIva))} sub={saldoIva >= 0 ? 'a pagar' : 'a favor'} color={saldoIva >= 0 ? '#ff8b8b' : '#7dff7d'} />
          </>
        ) : (
          <KPI label="📈 Facturado 12 meses" value={fmt$(acum12)} sub="ARCA lo usa p/ recategorizar" color="#7dff7d" />
        )}
        <KPI label="💸 Impuestos / Cuotas" value={fmt$(totImpuestos)} sub={`${impPeriodo.length} pago(s) · sin IVA`} color="var(--purple)" />
      </div>

      {/* Liquidación mensual a pagar (solo Responsable Inscripto, ej. la SAS): IVA + IIBB + municipal. */}
      {esRI && (
        <div className="card" style={{ padding: 14, marginBottom: 12, border: '1px solid var(--gold)' }}>
          <div style={{ fontSize: 11, color: 'var(--gold)', letterSpacing: 1, marginBottom: 10, fontWeight: 700 }}>🧾 LIQUIDACIÓN MENSUAL A PAGAR · {etiquetaPeriodo.toUpperCase()}</div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <tbody>
              <tr style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 6px', whiteSpace: 'nowrap', fontWeight: 600 }}>📕 IVA {saldoIva < 0 ? '(saldo a favor)' : 'a pagar'}</td>
                <td style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: 11 }}>Débito {fmt$(ivaDebito)} − Crédito {fmt$(ivaCredito)} · ARCA → Presentación de DDJJ y Pagos → Nuevo VEP</td>
                <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 700, color: saldoIva > 0 ? '#ff8b8b' : '#7dff7d' }}>{saldoIva < 0 ? 'a favor ' : ''}{fmt$(Math.abs(saldoIva))}</td>
              </tr>
              {cuenta?.inscripto_iibb && (
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 6px', whiteSpace: 'nowrap', fontWeight: 600 }}>🏛️ IIBB Córdoba</td>
                  <td style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: 11 }}>{iibbAlic.toLocaleString('es-AR')}% × ventas netas {fmt$(ventasNeto)} · mínimo $19.200/mes · SIFERE / Rentas Córdoba</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 700, color: '#ff8b8b' }}>{fmt$(Math.max(iibbMes, modo === 'mes' ? 19200 : 0))}</td>
                </tr>
              )}
              {cuenta?.inscripto_municipal && munMes > 0 && (
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 6px', whiteSpace: 'nowrap', fontWeight: 600 }}>🏢 Municipal</td>
                  <td style={{ padding: '7px 6px', color: 'var(--muted)', fontSize: 11 }}>{munAlic.toLocaleString('es-AR')}% × ventas netas {fmt$(ventasNeto)} · Río Primero</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 700, color: '#ff8b8b' }}>{fmt$(munMes)}</td>
                </tr>
              )}
              <tr style={{ borderTop: '2px solid var(--gold)' }}>
                <td style={{ padding: '9px 6px', fontWeight: 800 }} colSpan={2}>TOTAL A PAGAR (estimado)</td>
                <td style={{ padding: '9px 6px', textAlign: 'right', fontWeight: 800, fontSize: 16, color: 'var(--gold)' }}>{fmt$(ivaAPagar + Math.max(iibbMes, modo === 'mes' && cuenta?.inscripto_iibb ? 19200 : 0) + munMes)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
            💡 Los VEP los generás vos: <strong>IVA</strong> en ARCA (Presentación de DDJJ y Pagos → Nuevo VEP, tras la DDJJ F.2002) · <strong>IIBB</strong> en SIFERE / Rentas Córdoba. Después registrá lo pagado con <strong>💸 Pago impuesto/cuota</strong>. Estos montos son orientativos — confirmá contra tu primer VEP real (puede haber retenciones/percepciones a deducir).
          </div>
        </div>
      )}

      {/* Impuestos / cuotas del período (incluye la cuota de monotributo) — gasto del perfil, sin IVA. */}
      {impPeriodo.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12, borderColor: 'rgba(150,120,220,0.45)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>💸 IMPUESTOS / CUOTAS PAGADOS EN EL PERÍODO · GASTO DEL PERFIL · SIN IVA</div>
          <table style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Fecha pago</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Concepto</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Período</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>Comprob. (VEP)</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {impPeriodo.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{fmtFecha(p.fecha_pago)}</td>
                  <td style={{ padding: '5px 6px' }}>{CONCEPTOS_IMPUESTO.find(c => c.v === p.concepto)?.l || p.concepto}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--muted)' }}>{p.periodo_mes ? `${String(p.periodo_mes).padStart(2, '0')}/${p.periodo_anio}` : `Anual ${p.periodo_anio}`}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--muted)' }}>{p.comprobante || '—'}</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 700 }}>{fmt$(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['todos', 'Todos'], ['venta', 'Ventas'], ['compra', 'Compras'], ['gasto', 'Gastos']].map(([v, l]) => (
          <button key={v} onClick={() => { setFiltro(v); setPagDet(1) }} style={chip(filtro === v)}>{l}</button>
        ))}
        {/* Borrado en lote de lo filtrado (solo con una clasificación elegida,
            para no volar el historial completo de un clic). Pensado para
            deshacer un CSV importado a la pestaña equivocada. */}
        {filtro !== 'todos' && totalDet > 0 && (
          !confirmarBorrarTodo ? (
            <button onClick={() => setConfirmarBorrarTodo(true)}
              style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 20, border: '1px solid #5a2a2a', background: 'var(--surface)', color: '#ff8b8b', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
              🗑️ Borrar {totalDet === 1 ? 'el comprobante listado' : `los ${totalDet} comprobantes listados`}
            </button>
          ) : (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ color: '#ff8b8b', fontWeight: 700 }}>
                ¿Borrar {totalDet === 1 ? 'este comprobante' : `los ${totalDet} comprobantes`} ({filtro === 'compra' ? 'compras' : filtro === 'venta' ? 'ventas' : 'gastos'}) de {etiquetaPeriodo}? No se puede deshacer.
              </span>
              <button onClick={borrarTodoListado} disabled={borrandoComp}
                style={{ background: '#ff8b8b', border: 'none', color: '#000', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12, opacity: borrandoComp ? 0.6 : 1 }}>
                {borrandoComp ? '⏳ Borrando…' : '✅ Sí, borrar'}
              </button>
              <button onClick={() => setConfirmarBorrarTodo(false)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                Cancelar
              </button>
            </span>
          )
        )}
      </div>

      {/* Detalle paginado */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 880 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Comprobante</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Contraparte</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Clasif.</th>
                {esRI && <th style={{ textAlign: 'right', padding: '8px 6px' }}>Neto</th>}
                {esRI && <th style={{ textAlign: 'right', padding: '8px 6px' }}>IVA</th>}
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Total</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}></th>
              </tr>
            </thead>
            <tbody>
              {cargandoDet ? (
                <tr><td colSpan={esRI ? 8 : 6} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Cargando…</td></tr>
              ) : detalle.length === 0 ? (
                <tr><td colSpan={esRI ? 8 : 6} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Sin movimientos en {etiquetaPeriodo}.</td></tr>
              ) : detalle.map(f => {
                const sg = signoFactura(f)
                return (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>{fmtFecha(f.fecha)}</td>
                    <td style={{ padding: '6px 6px', whiteSpace: 'nowrap' }}>{nombreComprobante(f)}{f.punto_venta && f.numero ? <span style={{ color: 'var(--muted)' }}> {String(f.punto_venta).padStart(4, '0')}-{String(f.numero).padStart(8, '0')}</span> : ''}</td>
                    <td style={{ padding: '6px 6px' }}>{f.contraparte_nombre || '—'}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'center' }}>{badge(clasifFactura(f))}</td>
                    {esRI && <td style={{ padding: '6px 6px', textAlign: 'right', color: 'var(--muted)' }}>{fmt$(sg * (Number(f.monto_neto) || 0))}</td>}
                    {esRI && <td style={{ padding: '6px 6px', textAlign: 'right', color: letraFactura(f) === 'A' ? 'var(--text)' : 'var(--muted)' }}>{fmt$(sg * (Number(f.monto_iva) || 0))}</td>}
                    <td style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: sg < 0 ? '#ff8b8b' : 'var(--text)' }}>{sg < 0 ? '−' : ''}{fmt$(Number(f.monto_total) || 0)}</td>
                    <td style={{ padding: '6px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {(f.cae || f.archivo_url) && <button onClick={() => abrirPdf(f)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--gold)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>{f.cae ? '🖨️' : '📎'}</button>}
                      {confirmarBorrarId === f.id ? (
                        <span style={{ whiteSpace: 'nowrap', marginLeft: 4 }}>
                          <button onClick={() => borrarComprobante(f)} disabled={borrandoComp}
                            style={{ background: '#ff8b8b', border: 'none', color: '#000', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 800, marginRight: 4, opacity: borrandoComp ? 0.6 : 1 }}>
                            {borrandoComp ? '⏳' : '✓ Borrar'}
                          </button>
                          <button onClick={() => setConfirmarBorrarId(null)}
                            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmarBorrarId(f.id)} title="Eliminar este comprobante"
                          style={{ background: 'none', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11, marginLeft: 4 }}>🗑️</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {totalDet > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>{(pagDet - 1) * PAGE + 1}–{Math.min(pagDet * PAGE, totalDet)}</span> de <span style={{ color: 'var(--text)', fontWeight: 600 }}>{totalDet}</span> comprobantes</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <button onClick={() => setPagDet(1)} disabled={pagDet === 1} style={{ ...navBtn, opacity: pagDet === 1 ? 0.4 : 1, fontSize: 12 }}>« Primera</button>
              <button onClick={() => setPagDet(p => Math.max(1, p - 1))} disabled={pagDet === 1} style={{ ...navBtn, opacity: pagDet === 1 ? 0.4 : 1, fontSize: 12 }}>‹ Ant</button>
              <span style={{ minWidth: 90, textAlign: 'center', color: 'var(--text)', fontWeight: 600 }}>Pág {pagDet} / {totalPagDet}</span>
              <button onClick={() => setPagDet(p => Math.min(totalPagDet, p + 1))} disabled={pagDet === totalPagDet} style={{ ...navBtn, opacity: pagDet === totalPagDet ? 0.4 : 1, fontSize: 12 }}>Sig ›</button>
              <button onClick={() => setPagDet(totalPagDet)} disabled={pagDet === totalPagDet} style={{ ...navBtn, opacity: pagDet === totalPagDet ? 0.4 : 1, fontSize: 12 }}>Última »</button>
            </div>
          </div>
        )}
      </div>

      {cargar && (
        <FormFactura cuentas={cuentas} contrapartes={contrapartes} facturas={facturas}
          cuentaInicial={Number(cuentaId)} tipoInicial={cargar.tipo}
          onCerrar={() => setCargar(null)} onGuardado={() => { setCargar(null); setRefrescar(x => x + 1); onChange() }} />
      )}
      {importar && cuenta && (
        <ModalImportarComprobantes cuenta={cuenta}
          onCerrar={() => setImportar(false)}
          onImportado={(n, d) => { setImportar(false); setRefrescar(x => x + 1); onChange(); alert(`✅ ${n} ${d === 'emitida' ? 'ventas' : 'comprobantes'} importados a ${cuenta.nombre}.`) }} />
      )}
      {cargarImp && (
        <FormImpuesto cuentas={cuentas} cuentaInicial={Number(cuentaId)}
          onCerrar={() => setCargarImp(false)}
          onGuardado={() => { setCargarImp(false); setRefrescar(x => x + 1); onChange() }} />
      )}
    </div>
  )
}

// ============================================================
// TAB FACTURAS — listado paginado + form de alta
// ============================================================
function TabFacturas({ cuentas, facturas, contrapartes, onChange }) {
  const [filtroCuenta, setFiltroCuenta] = useState('todas')
  const [filtroTipo, setFiltroTipo] = useState('todas')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarLibro, setMostrarLibro] = useState(false)
  // ☑️ Selección múltiple para borrar en LOTE (ej: un CSV de Mis Comprobantes
  // importado a Recibidos en vez de Emitidos). El check del encabezado tilda
  // TODO lo filtrado (no solo la página visible) y la confirmación es inline.
  const [seleccion, setSeleccion] = useState(() => new Set())
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [borrando, setBorrando] = useState(false)

  const filtradas = useMemo(() => {
    return facturas.filter(f => {
      if (filtroCuenta !== 'todas' && f.cuenta_id !== Number(filtroCuenta)) return false
      if (filtroTipo !== 'todas' && f.tipo !== filtroTipo) return false
      return true
    })
  }, [facturas, filtroCuenta, filtroTipo])

  const pag = usePaginacion(filtradas, 20)

  // Cambiar de filtro deselecciona todo (evita borrar filas que ya no se ven)
  useEffect(() => { setSeleccion(new Set()); setConfirmarBorrado(false) }, [filtroCuenta, filtroTipo])

  function toggleSel(id) {
    setConfirmarBorrado(false)
    setSeleccion(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const todasFiltradasSel = filtradas.length > 0 && filtradas.every(f => seleccion.has(f.id))
  function toggleTodas() {
    setConfirmarBorrado(false)
    setSeleccion(todasFiltradasSel ? new Set() : new Set(filtradas.map(f => f.id)))
  }

  async function borrarSeleccionadas() {
    const ids = [...seleccion]
    if (!ids.length) return
    setBorrando(true)
    // Borrar en lotes: un .in() con miles de ids supera el límite del request
    const CHUNK = 200
    let err = null
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase.from('facturas').delete().in('id', ids.slice(i, i + CHUNK))
      if (error) { err = error; break }
    }
    setBorrando(false)
    setConfirmarBorrado(false)
    setSeleccion(new Set())
    if (err) alert('❌ Se cortó el borrado: ' + err.message)
    onChange()
  }

  const totales = useMemo(() => {
    const t = { emitido: 0, recibido: 0, ivaEmitido: 0, ivaRecibido: 0 }
    filtradas.forEach(f => {
      const m = Number(f.monto_total) || 0
      const iva = Number(f.monto_iva) || 0
      if (f.tipo === 'emitida') { t.emitido += m; t.ivaEmitido += iva }
      else { t.recibido += m; t.ivaRecibido += iva }
    })
    return t
  }, [filtradas])

  async function borrar(f) {
    if (!confirm(`¿Borrar factura ${f.tipo} #${f.numero || ''} de ${fmtFecha(f.fecha)}?`)) return
    const { error } = await supabase.from('facturas').delete().eq('id', f.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  function nombreCuenta(id) {
    return cuentas.find(c => c.id === id)?.nombre || `#${id}`
  }

  if (cuentas.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
        Primero cargá al menos una cuenta en la pestaña <strong>🏛️ Cuentas</strong>.
      </div>
    )
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)} style={{ ...inp, width: 220 }}>
          <option value="todas">Todas las cuentas</option>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ ...inp, width: 180 }}>
          <option value="todas">Emitidas + Recibidas</option>
          <option value="emitida">Solo emitidas</option>
          <option value="recibida">Solo recibidas</option>
        </select>
        {/* Libro IVA solo para Responsables Inscriptos (la SAS). Monotributo no lleva. */}
        {cuentas.some(esCuentaRI) && (
          <button onClick={() => setMostrarLibro(true)}
            style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            📊 Libro IVA
          </button>
        )}
        <button onClick={() => setMostrarForm(true)}
          style={{ marginLeft: cuentas.some(esCuentaRI) ? undefined : 'auto', padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          + Cargar factura
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <KPI label="💵 Emitido" value={fmt$(totales.emitido)} sub={`IVA débito ${fmt$(totales.ivaEmitido)}`} color="var(--gold)" />
        <KPI label="📥 Recibido" value={fmt$(totales.recibido)} sub={`IVA crédito ${fmt$(totales.ivaRecibido)}`} color="#7a9dff" />
        <KPI label="📊 Resultado IVA" value={fmt$(totales.ivaEmitido - totales.ivaRecibido)} sub="Débito − Crédito" color={totales.ivaEmitido >= totales.ivaRecibido ? '#7dff7d' : '#ff8b8b'} />
      </div>

      {/* Barra de selección múltiple (borrado en lote) */}
      {seleccion.size > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#2a1f0a', border: '1px solid var(--amber)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
          <b style={{ color: 'var(--amber)' }}>☑️ {seleccion.size} seleccionada{seleccion.size === 1 ? '' : 's'}</b>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            Total {fmt$(facturas.filter(f => seleccion.has(f.id)).reduce((s, f) => s + (Number(f.monto_total) || 0), 0))}
          </span>
          {!confirmarBorrado ? (
            <button onClick={() => setConfirmarBorrado(true)}
              style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
              🗑️ Borrar seleccionadas
            </button>
          ) : (
            <>
              <span style={{ color: '#ff8b8b', fontWeight: 700, fontSize: 12 }}>¿Borrar {seleccion.size} comprobante{seleccion.size === 1 ? '' : 's'}? No se puede deshacer.</span>
              <button onClick={borrarSeleccionadas} disabled={borrando}
                style={{ background: '#ff8b8b', border: 'none', color: '#000', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12, opacity: borrando ? 0.6 : 1 }}>
                {borrando ? '⏳ Borrando…' : '✅ Sí, borrar'}
              </button>
              <button onClick={() => setConfirmarBorrado(false)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
                Cancelar
              </button>
            </>
          )}
          <button onClick={() => { setSeleccion(new Set()); setConfirmarBorrado(false) }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
            ✕ Deseleccionar
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ width: 30, padding: '8px 6px' }}>
                  <input type="checkbox" checked={todasFiltradasSel} onChange={toggleTodas}
                    title={`Seleccionar TODAS las filtradas (${filtradas.length})`}
                    style={{ width: 15, height: 15, cursor: 'pointer' }} />
                </th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Cuenta</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Tipo</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Comp.</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Número</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Contraparte</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Neto</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>IVA</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Total</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {pag.items.map(f => (
                <tr key={f.id} style={{ borderTop: '1px solid var(--border)', background: seleccion.has(f.id) ? 'rgba(255,184,107,0.06)' : undefined }}>
                  <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                    <input type="checkbox" checked={seleccion.has(f.id)} onChange={() => toggleSel(f.id)}
                      style={{ width: 15, height: 15, cursor: 'pointer' }} />
                  </td>
                  <td style={{ padding: '6px 6px' }}>{fmtFecha(f.fecha)}</td>
                  <td style={{ padding: '6px 6px', fontWeight: 600 }}>{nombreCuenta(f.cuenta_id)}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                    <span style={{ background: f.tipo === 'emitida' ? 'var(--gold)22' : '#7a9dff22', color: f.tipo === 'emitida' ? 'var(--gold)' : '#7a9dff', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                      {f.tipo === 'emitida' ? '↗ EMI' : '↙ REC'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{nombreComprobante(f)}</td>
                  <td style={{ padding: '6px 6px', fontFamily: 'monospace', fontSize: 11 }}>
                    {f.punto_venta ? `${f.punto_venta}-` : ''}{f.numero || '—'}
                    {f.archivo_url && (
                      <span title="Tiene PDF adjunto" style={{ marginLeft: 4, color: 'var(--gold)' }}>📎</span>
                    )}
                    {f.emitida_por_arca && (
                      <span title={f.cae ? `CAE ${f.cae}${f.cae_vto ? ` · vto ${fmtFecha(f.cae_vto)}` : ''}` : `ARCA: ${f.arca_estado || ''}`}
                        style={{ marginLeft: 4, color: f.arca_estado === 'autorizada' ? '#7dff7d' : '#ff8b8b' }}>
                        {f.arca_estado === 'autorizada' ? '⚡' : '⚠️'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 6px' }}>{f.contraparte_nombre || '—'}</td>
                  <td style={{ textAlign: 'right', padding: '6px 6px' }}>{fmt$(f.monto_neto)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 6px', color: 'var(--muted)' }}>{fmt$(f.monto_iva)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 6px', fontWeight: 700, color: 'var(--gold)' }}>{fmt$(f.monto_total)}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px', whiteSpace: 'nowrap' }}>
                    {f.emitida_por_arca && f.cae && (
                      <button onClick={() => imprimirComprobante(f, cuentas.find(c => c.id === f.cuenta_id) || {})}
                        title="Imprimir / PDF"
                        style={{ background: 'transparent', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 12, marginRight: 4 }}>
                        🖨️
                      </button>
                    )}
                    <button onClick={() => borrar(f)}
                      style={{ background: 'transparent', border: 'none', color: '#ff8b8b', cursor: 'pointer', fontSize: 12 }}>
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan="11" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin facturas con esos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 10 }}>
          <Paginador {...pag.controles} label="facturas" />
        </div>
      </div>

      {mostrarForm && (
        <FormFactura cuentas={cuentas} contrapartes={contrapartes} facturas={facturas} onCerrar={() => setMostrarForm(false)} onGuardado={() => { setMostrarForm(false); onChange() }} />
      )}
      {mostrarLibro && (
        <ModalLibroIva cuentas={cuentas} facturas={facturas} onCerrar={() => setMostrarLibro(false)} />
      )}
    </div>
  )
}

// Deriva los campos ARCA del receptor (lo que se manda al WSFE y va al PDF) a
// partir de la condición IVA (texto) y el CUIT de la contraparte. Así "Condición
// IVA receptor", "Tipo doc." y "Nº documento" quedan correctos según la contraparte
// (antes quedaban en el default Consumidor Final / sin identificar → factura mal).
function receptorArcaDesde(condIvaTexto, cuit) {
  const cuitLimpio = String(cuit || '').replace(/\D/g, '')
  const tieneCuit = cuitLimpio.length === 11
  return {
    cond_iva_receptor: condIvaAReceptorAfip(condIvaTexto),
    doc_tipo: tieneCuit ? 80 : 99,            // 80=CUIT · 99=Consumidor Final sin identificar
    doc_nro: tieneCuit ? cuitLimpio : '',
  }
}

function FormFactura({ cuentas, contrapartes, facturas, cuentaInicial, tipoInicial, onCerrar, onGuardado }) {
  const VACIO = {
    cuenta_id: cuentaInicial || cuentas[0]?.id || '',
    tipo: tipoInicial || 'emitida',
    clasificacion: 'compra', // para recibidas en RI: 'compra' | 'gasto'
    fecha: hoyISO(),
    punto_venta: '0001',
    numero: '',
    tipo_comprobante: 'C',
    monto_neto: '',
    monto_iva: '',
    monto_otros: '',
    monto_total: '',
    contraparte_nombre: '',
    contraparte_cuit: '',
    contraparte_iva: 'consumidor_final',
    concepto: '',
    condicion_pago: 'contado',
    notas: '',
    // --- ARCA (facturación electrónica) ---
    comprobante_codigo: 11,
    doc_tipo: 99,
    doc_nro: '',
    cond_iva_receptor: 5,
    iva_id: 4, // 10,5% (carne) por defecto
    items: [{ descripcion: '', cantidad: 1, precio_unit: '', iva_id: 4 }],
  }
  const [form, setForm] = useState(VACIO)
  const [cbteAsoc, setCbteAsoc] = useState(null) // factura original asociada (NC/ND)
  const [guardando, setGuardando] = useState(false)
  const [archivoSubido, setArchivoSubido] = useState(null)
  const [modoArca, setModoArca] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)
  const [resultadoCae, setResultadoCae] = useState(null)
  const [errorArca, setErrorArca] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const cuentaSel = useMemo(
    () => cuentas.find(c => String(c.id) === String(form.cuenta_id)),
    [cuentas, form.cuenta_id]
  )
  const puedeArca = !!cuentaSel?.arca_habilitado
  // Comprobantes que esta cuenta puede emitir (Factura/NC/ND según condición IVA).
  const compsArca = useMemo(() => {
    if (!cuentaSel) return []
    return comprobantesDeCuenta(cuentaSel)
  }, [cuentaSel])
  const esFacturaC = [11, 12, 13].includes(Number(form.comprobante_codigo)) // letra C: sin IVA discriminado
  const esNotaCD = ES_NOTA_CD(form.comprobante_codigo)
  // Código AFIP de condición IVA del receptor: SIEMPRE deriva de la condición real
  // de la contraparte elegida (fuente de verdad). Evita que un valor viejo del form
  // —p. ej. arrastrado por una NC— quede desincronizado y salga RI como Mono/CF.
  const condIvaReceptorAfip = form.contraparte_iva
    ? condIvaAReceptorAfip(form.contraparte_iva)
    : Number(form.cond_iva_receptor || 5)
  // Facturas originales (emitidas con CAE) de esta cuenta, para asociar una NC/ND.
  const facturasOriginales = useMemo(() => {
    if (!cuentaSel) return []
    return (facturas || []).filter(f =>
      f.cuenta_id === cuentaSel.id && f.tipo === 'emitida' && f.cae && [1, 6, 11].includes(Number(f.comprobante_codigo))
    )
  }, [facturas, cuentaSel])

  // Si la cuenta no puede emitir, apagar el modo ARCA
  useEffect(() => { if ((!puedeArca || form.tipo !== 'emitida') && modoArca) setModoArca(false) }, [puedeArca, modoArca, form.tipo])
  // Mantener un comprobante válido para la cuenta elegida
  useEffect(() => {
    if (modoArca && compsArca.length && !compsArca.includes(Number(form.comprobante_codigo))) {
      set('comprobante_codigo', compsArca[0])
    }
  }, [modoArca, compsArca]) // eslint-disable-line
  // Para emisor Responsable Inscripto: la LETRA de la FACTURA depende del receptor
  // (A=1 si el receptor es RI, B=6 si no). NO toca las NC/ND (esas las elige el
  // usuario a mano). Monotributo siempre C.
  useEffect(() => {
    if (!modoArca || !cuentaSel) return
    if (![1, 6, 11].includes(Number(form.comprobante_codigo))) return // no pisar NC/ND
    const recomendado = comprobanteRecomendado(cuentaSel.condicion_iva, form.contraparte_iva)
    if (recomendado !== 11 && Number(form.comprobante_codigo) !== recomendado) {
      set('comprobante_codigo', recomendado)
    }
  }, [modoArca, cuentaSel, form.contraparte_iva]) // eslint-disable-line
  // Al cambiar de comprobante: si dejó de ser NC/ND, limpiar el asociado.
  useEffect(() => { if (!esNotaCD && cbteAsoc) setCbteAsoc(null) }, [esNotaCD]) // eslint-disable-line

  function elegirContraparte(c) {
    if (!c) return
    setForm(f => ({
      ...f,
      contraparte_id: c.id,
      contraparte_nombre: c.nombre,
      contraparte_cuit: c.cuit || '',
      contraparte_iva: c.condicion_iva || 'consumidor_final',
      // Sincroniza la sección RECEPTOR (ARCA) con la contraparte elegida.
      ...receptorArcaDesde(c.condicion_iva, c.cuit),
    }))
  }

  // Al asociar una NC/ND a su factura original: guarda la referencia y copia el
  // receptor, la contraparte y los importes/ítems (mirror por defecto; editable
  // para una NC/ND parcial).
  function elegirOriginal(f) {
    if (!f) { setCbteAsoc(null); return }
    setCbteAsoc(f)
    setForm(prev => ({
      ...prev,
      contraparte_id: f.contraparte_id || null,
      contraparte_nombre: f.contraparte_nombre || '',
      contraparte_cuit: f.contraparte_cuit || '',
      contraparte_iva: f.contraparte_iva || 'consumidor_final',
      doc_tipo: f.doc_tipo || 99,
      doc_nro: f.doc_nro || '',
      cond_iva_receptor: f.cond_iva_receptor || 5,
      items: Array.isArray(f.items) && f.items.length
        ? f.items.map(it => ({ descripcion: it.descripcion || '', cantidad: it.cantidad || 1, precio_unit: it.precio_unit ?? '', iva_id: it.iva_id || 4 }))
        : prev.items,
      monto_neto: f.monto_neto != null ? String(f.monto_neto) : prev.monto_neto,
      monto_iva: f.monto_iva != null ? String(f.monto_iva) : prev.monto_iva,
      monto_total: f.monto_total != null ? String(f.monto_total) : prev.monto_total,
    }))
  }

  async function subirPdf(file) {
    if (!file) return
    const ruta = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { data, error } = await supabase.storage.from('facturas').upload(ruta, file)
    if (error) { alert('❌ Error subiendo PDF: ' + error.message); return }
    setArchivoSubido({ ruta: data.path, nombre: file.name })
  }

  // Auto-calcular total si dejaron el campo en blanco
  function calcularTotal() {
    const n = Number(form.monto_neto) || 0
    const i = Number(form.monto_iva) || 0
    const o = Number(form.monto_otros) || 0
    set('monto_total', String(Math.round((n + i + o) * 100) / 100))
  }

  // ARCA Factura A/B: recalcula IVA = neto × alícuota y total = neto + IVA
  function recalcIvaArca(netoVal, ivaIdVal) {
    const neto = Number(netoVal ?? form.monto_neto) || 0
    const alic = IVA_ALICUOTAS.find(a => a.id === Number(ivaIdVal ?? form.iva_id))
    const iva = Math.round(neto * (alic?.pct || 0)) / 100
    setForm(f => ({ ...f, monto_iva: String(iva), monto_total: String(Math.round((neto + iva) * 100) / 100) }))
  }

  // --- Ítems (detalle de productos) ---
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100
  function setItem(idx, k, v) {
    setForm(f => { const items = [...(f.items || [])]; items[idx] = { ...items[idx], [k]: v }; return { ...f, items } })
  }
  function addItem() {
    setForm(f => ({ ...f, items: [...(f.items || []), { descripcion: '', cantidad: 1, precio_unit: '', iva_id: Number(f.iva_id) || 4 }] }))
  }
  function delItem(idx) {
    setForm(f => ({ ...f, items: (f.items || []).filter((_, i) => i !== idx) }))
  }
  // Totales calculados desde los ítems (para Factura C no hay IVA)
  const totalesItems = useMemo(() => {
    let neto = 0, iva = 0
    ;(form.items || []).forEach(it => {
      const n = (Number(it.cantidad) || 0) * (Number(it.precio_unit) || 0)
      neto += n
      if (!esFacturaC) iva += n * ((IVA_ALICUOTAS.find(a => a.id === Number(it.iva_id))?.pct) || 0) / 100
    })
    neto = round2(neto); iva = round2(iva)
    return { neto, iva, total: round2(neto + iva) }
  }, [form.items, esFacturaC])

  async function guardar() {
    if (!form.cuenta_id) return alert('Elegí una cuenta')
    if (!form.fecha) return alert('Fecha obligatoria')
    const total = Number(form.monto_total) || 0
    if (total <= 0) return alert('El total debe ser mayor a 0')
    setGuardando(true)
    const datos = {
      cuenta_id: Number(form.cuenta_id),
      tipo: form.tipo,
      // Emitidas = venta. Recibidas = compra/gasto (gasto solo se elige en RI).
      clasificacion: form.tipo === 'emitida' ? 'venta' : (form.clasificacion || 'compra'),
      fecha: form.fecha,
      punto_venta: form.punto_venta || null,
      numero: form.numero || null,
      tipo_comprobante: form.tipo_comprobante || null,
      monto_neto: Number(form.monto_neto) || 0,
      monto_iva: Number(form.monto_iva) || 0,
      monto_otros: Number(form.monto_otros) || 0,
      monto_total: total,
      contraparte_id: form.contraparte_id || null,
      contraparte_nombre: form.contraparte_nombre || null,
      contraparte_cuit: form.contraparte_cuit || null,
      contraparte_iva: form.contraparte_iva || null,
      concepto: form.concepto || null,
      condicion_pago: form.condicion_pago || null,
      notas: form.notas || null,
      archivo_url: archivoSubido?.ruta || null,
    }
    const { error } = await supabase.from('facturas').insert(datos)
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  // Emitir electrónicamente: pide el CAE a ARCA vía edge function
  async function emitir() {
    if (!form.cuenta_id) return alert('Elegí una cuenta')
    const itemsValidos = (form.items || []).filter(it => Number(it.cantidad) > 0 && Number(it.precio_unit) > 0)
    if (itemsValidos.length === 0) return alert('Cargá al menos un ítem con cantidad y precio')
    const total = totalesItems.total
    if (total <= 0) return alert('El total debe ser mayor a 0')
    const docTipo = Number(form.doc_tipo)
    if (docTipo !== 99 && !String(form.doc_nro).trim()) {
      return alert('Ingresá el número de documento del receptor (o elegí Consumidor Final sin identificar)')
    }
    if (esNotaCD && !cbteAsoc) {
      return alert('Una Nota de Crédito/Débito necesita la factura original asociada. Elegila en "Comprobante asociado".')
    }
    setEmitiendo(true); setErrorArca(null)
    const r = await emitirComprobante({
      cuenta_id: Number(form.cuenta_id),
      comprobante_codigo: Number(form.comprobante_codigo),
      doc_tipo: docTipo,
      doc_nro: String(form.doc_nro || '0'),
      cond_iva_receptor: condIvaReceptorAfip,
      concepto: 1,
      fecha: form.fecha,
      cbte_asoc: esNotaCD && cbteAsoc ? {
        tipo: Number(cbteAsoc.comprobante_codigo),
        pto_vta: Number(String(cbteAsoc.punto_venta).replace(/\D/g, '')),
        nro: Number(String(cbteAsoc.numero).replace(/\D/g, '')),
        fecha: cbteAsoc.fecha,
      } : undefined,
      importe_total: total,
      importe_neto: totalesItems.neto,
      importe_iva: esFacturaC ? 0 : totalesItems.iva,
      iva_id: Number(form.iva_id) || 4,
      items: itemsValidos.map(it => ({
        descripcion: it.descripcion || '',
        cantidad: Number(it.cantidad) || 0,
        precio_unit: Number(it.precio_unit) || 0,
        iva_id: esFacturaC ? null : (Number(it.iva_id) || 4),
      })),
      descripcion: form.concepto || null,
      condicion_pago: form.condicion_pago,
      contraparte_id: form.contraparte_id || null,
      contraparte_nombre: form.contraparte_nombre || null,
      contraparte_cuit: form.contraparte_cuit || null,
      contraparte_iva: form.contraparte_iva || null,
    })
    setEmitiendo(false)
    if (!r.ok) { setErrorArca(r.error); return }
    // Éxito: armar QR y mostrar panel
    const qrUrl = buildQrUrl({
      fecha: form.fecha,
      cuit: r.data.cuit_emisor,
      ptoVta: r.data.punto_venta,
      tipoCmp: r.data.comprobante_codigo,
      nroCmp: r.data.numero,
      importe: r.data.importe_total,
      tipoDocRec: docTipo,
      nroDocRec: Number(String(form.doc_nro || '0').replace(/\D/g, '')) || 0,
      codAut: r.data.cae,
    })
    setResultadoCae({ ...r.data, qrUrl, cuentaNombre: cuentaSel?.nombre })
  }

  // ---- Panel de éxito: comprobante emitido con CAE ----
  if (resultadoCae) {
    const comp = COMPROBANTES[resultadoCae.comprobante_codigo]
    return (
      <div onClick={() => { onGuardado() }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: 'var(--surface)', border: '1px solid var(--green)', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>Comprobante autorizado</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            {comp?.label || 'Factura'} · {resultadoCae.cuentaNombre}
          </div>

          <div style={{ background: '#fff', borderRadius: 8, padding: 10, display: 'inline-block' }}>
            <img src={qrImgUrl(resultadoCae.qrUrl, 180)} alt="QR ARCA" width={180} height={180}
              style={{ display: 'block' }} />
          </div>

          <div style={{ marginTop: 16, textAlign: 'left', background: 'var(--surface2)', borderRadius: 8, padding: 14, fontSize: 14 }}>
            <Linea k="Comprobante" v={`${comp?.letra || ''} ${String(resultadoCae.punto_venta).padStart(4, '0')}-${String(resultadoCae.numero).padStart(8, '0')}`} />
            <Linea k="CAE" v={resultadoCae.cae} mono />
            <Linea k="Vto CAE" v={fmtFecha(resultadoCae.cae_vto)} />
            <Linea k="Total" v={fmt$(resultadoCae.importe_total)} />
            {resultadoCae.observaciones && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#ffd17a' }}>⚠️ {resultadoCae.observaciones}</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <button onClick={() => {
              imprimirComprobante({
                comprobante_codigo: resultadoCae.comprobante_codigo,
                punto_venta: resultadoCae.punto_venta,
                numero: resultadoCae.numero,
                fecha: form.fecha,
                cae: resultadoCae.cae,
                cae_vto: resultadoCae.cae_vto,
                doc_tipo: Number(form.doc_tipo),
                doc_nro: form.doc_nro,
                cond_iva_receptor: condIvaReceptorAfip,
                contraparte_nombre: form.contraparte_nombre,
                monto_neto: totalesItems.neto,
                monto_iva: esFacturaC ? 0 : totalesItems.iva,
                monto_total: resultadoCae.importe_total,
                items: (form.items || []).filter(it => Number(it.cantidad) > 0 && Number(it.precio_unit) > 0)
                  .map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unit: Number(it.precio_unit), iva_id: esFacturaC ? null : Number(it.iva_id) })),
              }, cuentaSel || {})
            }}
              style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
              🖨️ Imprimir / PDF
            </button>
            <button onClick={() => onGuardado()}
              style={{ flex: 1, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
              Listo
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{modoArca ? '⚡ Emitir factura electrónica' : form.tipo === 'recibida' ? '📥 Cargar comprobante recibido (compra / gasto)' : '🧾 Cargar venta / factura'}</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Toggle modo emisión electrónica — SOLO para VENTAS (emitidas). Una
            compra/gasto la emitió otro: nosotros somos el receptor, no se emite. */}
        {form.tipo === 'emitida' && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 8,
          background: modoArca ? '#1a2a14' : 'var(--surface2)',
          border: `1px solid ${modoArca ? 'var(--gold)' : 'var(--border)'}` }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: puedeArca ? 'pointer' : 'not-allowed', opacity: puedeArca ? 1 : 0.6 }}>
            <input type="checkbox" checked={modoArca} disabled={!puedeArca}
              onChange={e => { setModoArca(e.target.checked); if (e.target.checked) set('tipo', 'emitida') }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>⚡ Emitir electrónicamente en ARCA (obtener CAE)</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {puedeArca
                  ? `Cuenta lista (${cuentaSel?.arca_ambiente === 'produccion' ? 'PRODUCCIÓN' : 'homologación'}). ARCA asigna el número y devuelve el CAE.`
                  : 'Esta cuenta no tiene ARCA configurado. Configurala en la pestaña Cuentas → ⚡, o registrá la factura manualmente.'}
              </div>
            </div>
          </label>
        </div>
        )}
        {form.tipo === 'recibida' && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
            📥 <strong>Factura recibida</strong> — la emitió tu proveedor; vos la registrás como comprobante recibido (compra o gasto). Adjuntá el PDF abajo.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Campo label="Cuenta *">
            <select value={form.cuenta_id} onChange={e => set('cuenta_id', e.target.value)} style={inp}>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Tipo *">
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={inp} disabled={modoArca}>
              <option value="emitida">↗ Emitida (venta)</option>
              <option value="recibida">↙ Recibida (compra/gasto)</option>
            </select>
          </Campo>
          <Campo label="Fecha *">
            <input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} style={inp} />
          </Campo>
          {modoArca ? (
            <>
              <Campo label="Comprobante *">
                <select value={form.comprobante_codigo} onChange={e => set('comprobante_codigo', Number(e.target.value))} style={inp}>
                  {compsArca.map(c => <option key={c} value={c}>{COMPROBANTES[c]?.label || c}</option>)}
                </select>
              </Campo>
              <Campo label="Punto venta">
                <input value={String(cuentaSel?.arca_punto_venta || 1).padStart(4, '0')} disabled style={{ ...inp, opacity: 0.7 }} />
              </Campo>
              <Campo label="Número">
                <input value="(automático)" disabled style={{ ...inp, opacity: 0.7, fontStyle: 'italic' }} />
              </Campo>
            </>
          ) : (
            <>
              <Campo label="Comprobante">
                <select value={form.tipo_comprobante} onChange={e => set('tipo_comprobante', e.target.value)} style={inp}>
                  {TIPOS_COMPROBANTE.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </Campo>
              <Campo label="Punto venta">
                <input value={form.punto_venta} onChange={e => set('punto_venta', e.target.value)} placeholder="0001" style={inp} />
              </Campo>
              <Campo label="Número">
                <input value={form.numero} onChange={e => set('numero', e.target.value)} placeholder="00012345" style={inp} />
              </Campo>
            </>
          )}
        </div>

        {/* Clasificación de la factura recibida: Compra o Gasto (gasto solo en RI) */}
        {form.tipo === 'recibida' && (
          <div style={{ marginTop: 12 }}>
            {esCuentaRI(cuentaSel) ? (
              <Campo label="¿Compra o Gasto?">
                <select value={form.clasificacion} onChange={e => set('clasificacion', e.target.value)} style={inp}>
                  <option value="compra">📥 Compra (mercadería / reventa)</option>
                  <option value="gasto">🧾 Gasto (servicios, alquiler, etc.)</option>
                </select>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  En Responsable Inscripto el IVA crédito solo se computa de <strong>Facturas A</strong>.
                </div>
              </Campo>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                🐷 Monotributo: se registra como <strong>Compra</strong> (sin IVA computable).
              </div>
            )}
          </div>
        )}

        {/* Comprobante asociado — obligatorio para Notas de Crédito/Débito */}
        {modoArca && esNotaCD && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>🔗 COMPROBANTE ASOCIADO (factura original) *</div>
            {facturasOriginales.length === 0 ? (
              <div style={{ fontSize: 12, color: '#ffb84d', background: '#3a2f1a', border: '1px solid #5a4a2d', borderRadius: 8, padding: '10px 12px' }}>
                No hay facturas emitidas con CAE para esta cuenta. Una Nota de Crédito/Débito tiene que referenciar una factura existente.
              </div>
            ) : (
              <select value={cbteAsoc?.id || ''} onChange={e => elegirOriginal(facturasOriginales.find(f => f.id === Number(e.target.value)))} style={inp}>
                <option value="">— Elegí la factura original —</option>
                {facturasOriginales.map(f => (
                  <option key={f.id} value={f.id}>
                    {COMPROBANTES[f.comprobante_codigo]?.label || f.comprobante_codigo} {String(f.punto_venta).padStart(5, '0')}-{String(f.numero).padStart(8, '0')} · {fmtFecha(f.fecha)} · {fmt$(f.monto_total)}{f.contraparte_nombre ? ' · ' + f.contraparte_nombre : ''}
                  </option>
                ))}
              </select>
            )}
            {cbteAsoc && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 6 }}>
                ✅ Asociada a {COMPROBANTES[cbteAsoc.comprobante_codigo]?.label} {String(cbteAsoc.punto_venta).padStart(5, '0')}-{String(cbteAsoc.numero).padStart(8, '0')}. Copié receptor e importes — editalos si la nota es por un monto parcial.
              </div>
            )}
          </div>
        )}

        {/* Datos del receptor exigidos por ARCA */}
        {modoArca && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>🧾 RECEPTOR (ARCA)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 10 }}>
              <Campo label="Tipo doc.">
                <select value={form.doc_tipo} onChange={e => set('doc_tipo', Number(e.target.value))} style={inp}>
                  {DOC_TIPOS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </Campo>
              <Campo label="Nº documento">
                <input value={form.doc_nro} onChange={e => set('doc_nro', e.target.value)}
                  placeholder={Number(form.doc_tipo) === 99 ? '0' : 'sin guiones'}
                  disabled={Number(form.doc_tipo) === 99} style={inp} />
              </Campo>
              <Campo label="Condición IVA receptor">
                {/* Refleja la condición real de la contraparte. Si la cambiás acá, también
                    actualiza la contraparte para que ambos queden sincronizados. */}
                <select value={condIvaReceptorAfip} onChange={e => {
                  const cod = Number(e.target.value)
                  const txt = { 1: 'responsable_inscripto', 4: 'exento', 5: 'consumidor_final', 6: 'monotributo', 13: 'monotributo_social', 16: 'monotributo' }[cod] || 'consumidor_final'
                  setForm(f => ({ ...f, cond_iva_receptor: cod, contraparte_iva: txt }))
                }} style={inp}>
                  {COND_IVA_RECEPTOR.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
                </select>
              </Campo>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>👤 CONTRAPARTE</div>
          {contrapartes && contrapartes.length > 0 && (
            <Campo label="Elegir del padrón (opcional)">
              <select value={form.contraparte_id || ''} onChange={e => {
                const id = Number(e.target.value)
                elegirContraparte(contrapartes.find(c => c.id === id))
              }} style={inp}>
                <option value="">— Tipear manualmente —</option>
                {contrapartes.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}{c.cuit ? ` · ${c.cuit}` : ''}</option>
                ))}
              </select>
            </Campo>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Campo label="Nombre / razón social"><input value={form.contraparte_nombre} onChange={e => set('contraparte_nombre', e.target.value)} style={inp} /></Campo>
            <Campo label="CUIT">
              <input value={form.contraparte_cuit} onChange={e => {
                const v = e.target.value
                setForm(f => ({ ...f, contraparte_cuit: v, ...receptorArcaDesde(f.contraparte_iva, v) }))
              }}
                style={{ ...inp, borderColor: form.contraparte_cuit ? (esCuitValido(form.contraparte_cuit) ? 'var(--green)' : 'var(--border)') : 'var(--border)' }} />
            </Campo>
            <Campo label="Condición IVA">
              <select value={form.contraparte_iva} onChange={e => {
                const v = e.target.value
                setForm(f => ({ ...f, contraparte_iva: v, ...receptorArcaDesde(v, f.contraparte_cuit) }))
              }} style={inp}>
                <option value="responsable_inscripto">RI</option>
                <option value="monotributo">Mono</option>
                <option value="exento">Exento</option>
                <option value="consumidor_final">CF</option>
                <option value="no_aplica">N/A</option>
              </select>
            </Campo>
          </div>
          <Campo label="📎 Adjuntar comprobante — PDF o foto (luz, combustible, etc.)">
            <input type="file" accept="application/pdf,image/*" capture="environment" onChange={e => subirPdf(e.target.files?.[0])}
              style={{ ...inp, padding: '6px 8px' }} />
            {archivoSubido && (
              <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 4 }}>✅ {archivoSubido.nombre} subido</div>
            )}
          </Campo>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>💰 IMPORTES</div>
          {modoArca ? (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, minWidth: 520 }}>
                  <thead>
                    <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Producto / descripción</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', width: 70 }}>Cant.</th>
                      <th style={{ textAlign: 'right', padding: '4px 6px', width: 100 }}>P. unit</th>
                      {!esFacturaC && <th style={{ textAlign: 'center', padding: '4px 6px', width: 90 }}>IVA</th>}
                      <th style={{ textAlign: 'right', padding: '4px 6px', width: 100 }}>Subtotal</th>
                      <th style={{ width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(form.items || []).map((it, idx) => {
                      const sub = round2((Number(it.cantidad) || 0) * (Number(it.precio_unit) || 0))
                      return (
                        <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 6px' }}>
                            <input value={it.descripcion} onChange={e => setItem(idx, 'descripcion', e.target.value)}
                              placeholder="Ej: Asado x kg" style={{ ...inp, padding: '6px 8px' }} />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <input type="number" step="0.001" value={it.cantidad} onChange={e => setItem(idx, 'cantidad', e.target.value)}
                              style={{ ...inp, padding: '6px 8px', textAlign: 'right' }} />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <input type="number" step="0.01" value={it.precio_unit} onChange={e => setItem(idx, 'precio_unit', e.target.value)}
                              style={{ ...inp, padding: '6px 8px', textAlign: 'right' }} />
                          </td>
                          {!esFacturaC && (
                            <td style={{ padding: '4px 6px' }}>
                              <select value={it.iva_id} onChange={e => setItem(idx, 'iva_id', Number(e.target.value))} style={{ ...inp, padding: '6px 4px' }}>
                                {IVA_ALICUOTAS.map(a => <option key={a.id} value={a.id}>{a.pct}%</option>)}
                              </select>
                            </td>
                          )}
                          <td style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 600 }}>{fmt$(sub)}</td>
                          <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                            {(form.items || []).length > 1 && (
                              <button onClick={() => delItem(idx)} style={{ background: 'transparent', border: 'none', color: '#ff8b8b', cursor: 'pointer' }}>🗑️</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button onClick={addItem}
                style={{ marginTop: 8, padding: '6px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                + Agregar ítem
              </button>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 18, fontSize: 13 }}>
                {!esFacturaC && <span style={{ color: 'var(--muted)' }}>Neto: <strong style={{ color: 'var(--text)' }}>{fmt$(totalesItems.neto)}</strong></span>}
                {!esFacturaC && <span style={{ color: 'var(--muted)' }}>IVA: <strong style={{ color: 'var(--text)' }}>{fmt$(totalesItems.iva)}</strong></span>}
                <span style={{ color: 'var(--muted)' }}>Total: <strong style={{ color: 'var(--gold)', fontSize: 16 }}>{fmt$(totalesItems.total)}</strong></span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
                {esFacturaC
                  ? 'Factura C (monotributo): no discrimina IVA. ARCA recibe solo el total; el detalle va en la impresión.'
                  : 'Cada ítem lleva su alícuota (carne 10,5%). ARCA recibe los totales; el detalle de productos va en la factura impresa.'}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <Campo label="Neto"><input type="number" step="0.01" value={form.monto_neto} onChange={e => set('monto_neto', e.target.value)} onBlur={calcularTotal} style={inp} /></Campo>
                <Campo label="IVA"><input type="number" step="0.01" value={form.monto_iva} onChange={e => set('monto_iva', e.target.value)} onBlur={calcularTotal} style={inp} /></Campo>
                <Campo label="Otros"><input type="number" step="0.01" value={form.monto_otros} onChange={e => set('monto_otros', e.target.value)} onBlur={calcularTotal} style={inp} /></Campo>
                <Campo label="Total *"><input type="number" step="0.01" value={form.monto_total} onChange={e => set('monto_total', e.target.value)} style={{ ...inp, borderColor: 'var(--gold)', fontWeight: 700 }} /></Campo>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                Al salir del campo "Otros" se autocalcula Total = Neto + IVA + Otros. Podés editarlo manualmente si querés.
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Campo label="Concepto / descripción">
              <input value={form.concepto} onChange={e => set('concepto', e.target.value)} placeholder="Ej: venta carne semana, compra ganado..." style={inp} />
            </Campo>
            <Campo label="Condición de pago">
              <select value={form.condicion_pago} onChange={e => set('condicion_pago', e.target.value)} style={inp}>
                <option value="contado">Contado</option>
                <option value="cuenta_corriente">Cuenta corriente</option>
                <option value="cheque">Cheque</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
          </div>
          <Campo label="Notas">
            <input value={form.notas} onChange={e => set('notas', e.target.value)} style={inp} />
          </Campo>
        </div>

        {errorArca && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#3a1a1a', color: '#ff8b8b', fontSize: 13 }}>
            ❌ {errorArca}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          {modoArca ? (
            <button onClick={emitir} disabled={emitiendo}
              style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
              {emitiendo ? '⏳ Emitiendo en ARCA...' : '⚡ Emitir y obtener CAE'}
            </button>
          ) : (
            <button onClick={guardar} disabled={guardando}
              style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
              {guardando ? '⏳ Guardando...' : '✅ Registrar factura'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Fila clave/valor para el panel de CAE
function Linea({ k, v, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span style={{ fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit', textAlign: 'right' }}>{v}</span>
    </div>
  )
}

// ============================================================
// TAB IMPUESTOS — listado paginado + form
// ============================================================
function TabImpuestos({ cuentas, impuestos, onChange }) {
  const [filtroCuenta, setFiltroCuenta] = useState('todas')
  const [filtroConcepto, setFiltroConcepto] = useState('todos')
  const [mostrarForm, setMostrarForm] = useState(false)

  const filtrados = useMemo(() => {
    return impuestos.filter(p => {
      if (filtroCuenta !== 'todas' && p.cuenta_id !== Number(filtroCuenta)) return false
      if (filtroConcepto !== 'todos' && p.concepto !== filtroConcepto) return false
      return true
    })
  }, [impuestos, filtroCuenta, filtroConcepto])

  const pag = usePaginacion(filtrados, 20)
  const totalPagado = filtrados.reduce((s, p) => s + (Number(p.monto) || 0), 0)

  function nombreCuenta(id) {
    return cuentas.find(c => c.id === id)?.nombre || `#${id}`
  }

  async function borrar(p) {
    if (!confirm(`¿Borrar pago de ${CONCEPTOS_IMPUESTO.find(c => c.v === p.concepto)?.l || p.concepto} de ${fmtFecha(p.fecha_pago)}?`)) return
    const { error } = await supabase.from('impuestos_pagados').delete().eq('id', p.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  if (cuentas.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
        Primero cargá al menos una cuenta en la pestaña <strong>🏛️ Cuentas</strong>.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)} style={{ ...inp, width: 220 }}>
          <option value="todas">Todas las cuentas</option>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={filtroConcepto} onChange={e => setFiltroConcepto(e.target.value)} style={{ ...inp, width: 240 }}>
          <option value="todos">Todos los conceptos</option>
          {CONCEPTOS_IMPUESTO.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
        <button onClick={() => setMostrarForm(true)}
          style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          + Cargar pago
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <KPI label="💸 Total pagado en la vista" value={fmt$(totalPagado)} sub={`${filtrados.length} pago${filtrados.length === 1 ? '' : 's'}`} color="#ff8b8b" />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 800 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Cuenta</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Concepto</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Período</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Monto</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Comprobante</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {pag.items.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 6px' }}>{fmtFecha(p.fecha_pago)}</td>
                  <td style={{ padding: '6px 6px', fontWeight: 600 }}>{nombreCuenta(p.cuenta_id)}</td>
                  <td style={{ padding: '6px 6px' }}>{CONCEPTOS_IMPUESTO.find(c => c.v === p.concepto)?.l || p.concepto}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--muted)' }}>
                    {p.periodo_mes ? `${String(p.periodo_mes).padStart(2, '0')}/${p.periodo_anio}` : p.periodo_anio}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 6px', fontWeight: 700, color: '#ff8b8b' }}>{fmt$(p.monto)}</td>
                  <td style={{ padding: '6px 6px', fontSize: 11, color: 'var(--muted)' }}>{p.comprobante || '—'}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                    <button onClick={() => borrar(p)}
                      style={{ background: 'transparent', border: 'none', color: '#ff8b8b', cursor: 'pointer', fontSize: 12 }}>
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin pagos registrados con esos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 10 }}>
          <Paginador {...pag.controles} label="pagos" />
        </div>
      </div>

      {mostrarForm && (
        <FormImpuesto cuentas={cuentas} onCerrar={() => setMostrarForm(false)} onGuardado={() => { setMostrarForm(false); onChange() }} />
      )}
    </div>
  )
}

function FormImpuesto({ cuentas, cuentaInicial, onCerrar, onGuardado }) {
  const hoy = new Date()
  const VACIO = {
    cuenta_id: cuentaInicial || cuentas[0]?.id || '',
    concepto: 'monotributo',
    periodo_anio: hoy.getFullYear(),
    periodo_mes: hoy.getMonth() + 1,
    monto: '',
    fecha_pago: hoyISO(),
    comprobante: '',
    notas: '',
  }
  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [archivoSubido, setArchivoSubido] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function elegirContraparte(c) {
    if (!c) return
    setForm(f => ({
      ...f,
      contraparte_id: c.id,
      contraparte_nombre: c.nombre,
      contraparte_cuit: c.cuit || '',
      contraparte_iva: c.condicion_iva || 'consumidor_final',
    }))
  }

  async function subirPdf(file) {
    if (!file) return
    const ruta = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { data, error } = await supabase.storage.from('facturas').upload(ruta, file)
    if (error) { alert('❌ Error subiendo PDF: ' + error.message); return }
    setArchivoSubido({ ruta: data.path, nombre: file.name })
  }

  async function guardar() {
    if (!form.cuenta_id) return alert('Elegí cuenta')
    if (!form.monto || Number(form.monto) <= 0) return alert('Monto debe ser > 0')
    setGuardando(true)
    const { error } = await supabase.from('impuestos_pagados').insert({
      ...form,
      cuenta_id: Number(form.cuenta_id),
      monto: Number(form.monto),
      periodo_anio: Number(form.periodo_anio),
      periodo_mes: form.periodo_mes ? Number(form.periodo_mes) : null,
    })
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 540, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>+ Registrar pago de impuesto</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Cuenta *">
            <select value={form.cuenta_id} onChange={e => set('cuenta_id', e.target.value)} style={inp}>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Concepto *">
            <select value={form.concepto} onChange={e => set('concepto', e.target.value)} style={inp}>
              {CONCEPTOS_IMPUESTO.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Campo>
          <Campo label="Período año">
            <input type="number" value={form.periodo_anio} onChange={e => set('periodo_anio', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Período mes (vacío = anual)">
            <select value={form.periodo_mes || ''} onChange={e => set('periodo_mes', e.target.value)} style={inp}>
              <option value="">— Anual —</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Monto *">
            <input type="number" step="0.01" value={form.monto} onChange={e => set('monto', e.target.value)} style={{ ...inp, borderColor: 'var(--gold)', fontWeight: 700 }} />
          </Campo>
          <Campo label="Fecha de pago *">
            <input type="date" value={form.fecha_pago} onChange={e => set('fecha_pago', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Comprobante (VEP/ticket)">
            <input value={form.comprobante} onChange={e => set('comprobante', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Notas">
            <input value={form.notas} onChange={e => set('notas', e.target.value)} style={inp} />
          </Campo>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : '✅ Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TAB IMPORTAR — bulk CSV de facturas
// ============================================================
function TabImportar({ cuentas, onChange }) {
  const [texto, setTexto] = useState('')
  const [preview, setPreview] = useState([])
  const [resultado, setResultado] = useState(null)
  const [cargando, setCargando] = useState(false)

  function parsear() {
    setResultado(null)
    const lineas = texto.trim().split(/\r?\n/).filter(l => l.trim())
    if (lineas.length < 2) { alert('Pegá el contenido del CSV con encabezado en la primera fila'); return }

    const headers = lineas[0].split(',').map(h => h.trim().toLowerCase())
    const required = ['cuenta', 'tipo', 'fecha', 'monto_total']
    const faltan = required.filter(r => !headers.includes(r))
    if (faltan.length > 0) {
      alert(`Faltan columnas obligatorias: ${faltan.join(', ')}\nColumnas detectadas: ${headers.join(', ')}`)
      return
    }

    const out = []
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split(',').map(c => c.trim())
      const row = {}
      headers.forEach((h, idx) => row[h] = cols[idx] || '')

      const cuenta = cuentas.find(c =>
        c.nombre.toLowerCase() === row.cuenta?.toLowerCase() ||
        c.cuit === row.cuenta
      )
      out.push({
        ok: !!cuenta && ['emitida', 'recibida'].includes(row.tipo?.toLowerCase()),
        cuentaResuelta: cuenta,
        raw: row,
      })
    }
    setPreview(out)
  }

  async function importar() {
    const validos = preview.filter(p => p.ok)
    if (validos.length === 0) { alert('No hay filas válidas'); return }
    if (!confirm(`Importar ${validos.length} factura(s)?`)) return
    setCargando(true)
    const filas = validos.map(p => ({
      cuenta_id: p.cuentaResuelta.id,
      tipo: p.raw.tipo.toLowerCase(),
      fecha: p.raw.fecha,
      punto_venta: p.raw.punto_venta || null,
      numero: p.raw.numero || null,
      tipo_comprobante: p.raw.tipo_comprobante || null,
      monto_neto: Number(p.raw.monto_neto) || 0,
      monto_iva: Number(p.raw.monto_iva) || 0,
      monto_otros: Number(p.raw.monto_otros) || 0,
      monto_total: Number(p.raw.monto_total) || 0,
      contraparte_nombre: p.raw.contraparte_nombre || null,
      contraparte_cuit: p.raw.contraparte_cuit || null,
      concepto: p.raw.concepto || null,
    }))
    const { error } = await supabase.from('facturas').insert(filas)
    setCargando(false)
    if (error) {
      setResultado({ ok: false, msg: error.message })
      return
    }
    setResultado({ ok: true, msg: `✅ ${filas.length} factura(s) importada(s)` })
    setTexto(''); setPreview([])
    onChange()
  }

  const EJEMPLO = `cuenta,tipo,fecha,tipo_comprobante,punto_venta,numero,monto_neto,monto_iva,monto_total,contraparte_nombre,contraparte_cuit,concepto
Mono Fabri,emitida,2026-05-01,C,0001,00012345,1500000,0,1500000,Cliente Tal,20-12345678-9,Venta semana
SAS Fabricius,recibida,2026-05-05,A,0003,00056789,800000,168000,968000,Frigorífico X,30-11111111-1,Compra ganado`

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📥 Importar facturas desde CSV</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
          Pegá un CSV separado por comas. La primera fila debe tener los encabezados.
          Las columnas obligatorias son: <code>cuenta</code> (nombre interno o CUIT), <code>tipo</code> (emitida/recibida), <code>fecha</code>, <code>monto_total</code>.
          Opcionales: <code>tipo_comprobante</code>, <code>punto_venta</code>, <code>numero</code>, <code>monto_neto</code>, <code>monto_iva</code>, <code>monto_otros</code>, <code>contraparte_nombre</code>, <code>contraparte_cuit</code>, <code>concepto</code>.
        </div>
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--gold)', fontSize: 12 }}>Ver ejemplo</summary>
          <pre style={{ background: 'var(--surface2)', padding: 10, borderRadius: 6, fontSize: 11, overflowX: 'auto', marginTop: 6 }}>{EJEMPLO}</pre>
        </details>
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Pegá acá el CSV..."
          rows={10}
          style={{ ...inp, fontFamily: 'monospace', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={parsear} disabled={!texto.trim()}
            style={{ padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            🔍 Validar
          </button>
          {preview.length > 0 && (
            <button onClick={importar} disabled={cargando}
              style={{ padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
              {cargando ? '⏳ Importando...' : `✅ Importar ${preview.filter(p => p.ok).length} válidas`}
            </button>
          )}
        </div>
        {resultado && (
          <div style={{ marginTop: 10, padding: 10, background: resultado.ok ? '#1a2a1a' : '#3a1a1a', color: resultado.ok ? '#7dff7d' : '#ff8b8b', borderRadius: 6 }}>
            {resultado.msg}
          </div>
        )}
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">Vista previa ({preview.filter(p => p.ok).length} válidas / {preview.length} total)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textTransform: 'uppercase' }}>
                  <th style={{ width: 30 }}></th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Cuenta</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Fecha</th>
                  <th style={{ textAlign: 'right', padding: 4 }}>Total</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Contraparte</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)', background: p.ok ? 'transparent' : '#3a1a1a44' }}>
                    <td style={{ textAlign: 'center', padding: 4 }}>{p.ok ? '✅' : '❌'}</td>
                    <td style={{ padding: 4 }}>{p.raw.cuenta} {!p.cuentaResuelta && <span style={{ color: '#ff8b8b' }}>(no encontrada)</span>}</td>
                    <td style={{ padding: 4 }}>{p.raw.tipo}</td>
                    <td style={{ padding: 4 }}>{p.raw.fecha}</td>
                    <td style={{ textAlign: 'right', padding: 4 }}>{fmt$(p.raw.monto_total)}</td>
                    <td style={{ padding: 4 }}>{p.raw.contraparte_nombre || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, sub, color }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Bebas Neue',cursive", color: color || 'var(--gold)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

// ============================================================
// COMPONENTES NUEVOS — agregados en migración 29
// ============================================================

// --- Recordatorios de vencimientos (cuotas mono, recategorización, etc) ---
function RecordatoriosVencimientos({ avisos }) {
  if (!avisos || avisos.length === 0) return null
  const colores = {
    danger:  { bg: '#3a1a1a', border: '#ff4f4f', text: '#ff8b8b' },
    warning: { bg: '#3a2a14', border: '#ff9b3a', text: '#ffd17a' },
    info:    { bg: '#1a2a3a', border: '#7a9dff', text: '#9bb6ff' },
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">🔔 Recordatorios y vencimientos</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {avisos.map((a, i) => {
          const c = colores[a.tipo] || colores.info
          return (
            <div key={i} style={{
              padding: 10, background: c.bg, borderLeft: `4px solid ${c.border}`,
              borderRadius: 6, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>{a.icono}</span>
              <div>
                <div style={{ fontWeight: 700, color: c.text }}>{a.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.sub}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- Simulador de distribución entre cuentas para nivelar % del tope ---
function SimuladorDistribucion({ cuentas, facturacionPorCuenta, onCerrar }) {
  const [monto, setMonto] = useState('')
  const monos = cuentas.filter(c => c.tipo === 'monotributo')
  const dataMonos = monos.map(c => ({
    id: c.id, nombre: c.nombre, tope: TOPE_MAX_ABSOLUTO,
    facturado12m: facturacionPorCuenta[c.id]?.emitido || 0,
  }))
  const montoNum = Number(monto) || 0
  const distribucion = montoNum > 0 ? distribuirEntreCuentas(montoNum, dataMonos) : []

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>🧮 Simulador de distribución</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          Ingresá un monto que pensás facturar próximamente. El sistema te dice cómo distribuirlo entre los monotributistas
          para que todos queden al mismo % del tope (criterio: nivelar el riesgo).
        </div>
        <Campo label="💰 Monto a distribuir">
          <input type="number" step="1000" value={monto} onChange={e => setMonto(e.target.value)}
            placeholder="Ej: 5000000" autoFocus
            style={{ ...inp, fontSize: 18, fontWeight: 700, borderColor: 'var(--gold)' }} />
        </Campo>

        {montoNum > 0 && (
          <div style={{ marginTop: 14 }}>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px' }}>Cuenta</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Ya facturó</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Sugerido</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px' }}>Quedaría en</th>
                </tr>
              </thead>
              <tbody>
                {distribucion.map(d => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 600 }}>{d.nombre}</td>
                    <td style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--muted)' }}>{fmt$(d.facturado12m)}</td>
                    <td style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--gold)', fontWeight: 700, fontSize: 15 }}>
                      {d.asignar > 0 ? fmt$(d.asignar) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '8px 4px', color: estadoSemaforo(d.pctFinal).color, fontWeight: 700 }}>
                      {fmtPct(d.pctFinal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {distribucion.some(d => d.alerta) && (
              <div style={{ marginTop: 10, padding: 10, background: '#3a1a1a', color: '#ff8b8b', borderRadius: 6, fontSize: 12 }}>
                ⚠️ {distribucion.find(d => d.alerta).alerta}
              </div>
            )}
            <div style={{ marginTop: 10, padding: 10, background: 'var(--surface2)', borderRadius: 6, fontSize: 12, color: 'var(--muted)' }}>
              💡 La sugerencia equilibra el % consumido del tope K entre todas las cuentas. Si una cuenta ya tiene más % consumido que la nivelación final, recibe 0 (no se le asigna nada).
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <button onClick={onCerrar}
            style={{ width: '100%', padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

// El Libro IVA es SOLO para Responsables Inscriptos (la SAS). Los monotributos
// no llevan Libro IVA (no discriminan IVA), así que se excluyen.
const esCuentaRI = c => c?.condicion_iva === 'responsable_inscripto' || c?.tipo === 'sas'

// --- Modal de generación de Libro IVA Ventas/Compras ---
function ModalLibroIva({ cuentas, facturas, onCerrar }) {
  const hoy = new Date()
  const [tipo, setTipo] = useState('ventas') // 'ventas' | 'compras'
  const [cuentaId, setCuentaId] = useState('todas')
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)

  // Solo cuentas Responsable Inscripto (Libro IVA no aplica a monotributo).
  const cuentasRI = cuentas.filter(esCuentaRI)
  const idsRI = new Set(cuentasRI.map(c => c.id))

  function generar() {
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
    const ult = new Date(anio, mes, 0).getDate()
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(ult).padStart(2, '0')}`
    // Solo facturas de cuentas RI (las de monotributo no van al Libro IVA).
    let filtradas = facturas.filter(f => f.fecha >= desde && f.fecha <= hasta && idsRI.has(f.cuenta_id))
    if (cuentaId !== 'todas') filtradas = filtradas.filter(f => f.cuenta_id === Number(cuentaId))

    const contenido = tipo === 'ventas'
      ? generarLibroVentas(filtradas, cuentas)
      : generarLibroCompras(filtradas, cuentas)
    const cuentaNom = cuentaId === 'todas' ? 'todas' : (cuentas.find(c => c.id === Number(cuentaId))?.nombre || cuentaId)
    const nombre = `libro-iva-${tipo}-${anio}-${String(mes).padStart(2, '0')}-${cuentaNom}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_')
    descargarCSV(contenido, nombre)
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 540, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>📊 Libro IVA</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          El <strong>Libro IVA es solo para Responsables Inscriptos</strong> (la SAS). Los monotributos no llevan Libro IVA. Genera un CSV que tu contador abre directo en Excel (separador <code>;</code>, BOM UTF-8).
        </div>

        {cuentasRI.length === 0 ? (
          <div style={{ background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: 8, padding: '18px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No tenés cuentas <strong>Responsable Inscripto</strong>. El Libro IVA no aplica a monotributo.
            <div style={{ marginTop: 14 }}>
              <button onClick={onCerrar} style={{ padding: '10px 20px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Cerrar</button>
            </div>
          </div>
        ) : (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Tipo">
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={inp}>
              <option value="ventas">📤 Ventas (emitidas)</option>
              <option value="compras">📥 Compras (recibidas)</option>
            </select>
          </Campo>
          <Campo label="Cuenta (Resp. Inscripto)">
            <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} style={inp}>
              <option value="todas">Todas las RI</option>
              {cuentasRI.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Año">
            <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))} style={inp} />
          </Campo>
          <Campo label="Mes">
            <select value={mes} onChange={e => setMes(Number(e.target.value))} style={inp}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{String(m).padStart(2, '0')} — {['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][m-1]}</option>
              ))}
            </select>
          </Campo>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={generar}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            ⬇️ Descargar CSV
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}

// --- Tab Contrapartes: padrón de clientes y proveedores ---
function TabContrapartes({ contrapartes, onChange }) {
  const [editando, setEditando] = useState(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [filtro, setFiltro] = useState('')

  const filtradas = useMemo(() => {
    const q = filtro.toLowerCase().trim()
    if (!q) return contrapartes
    return contrapartes.filter(c =>
      c.nombre?.toLowerCase().includes(q) ||
      c.cuit?.includes(q)
    )
  }, [contrapartes, filtro])

  const pag = usePaginacion(filtradas, 20)

  async function eliminar(c) {
    if (!confirm(`¿Eliminar "${c.nombre}" del padrón?\nLas facturas asociadas pierden el link, pero conservan nombre y CUIT.`)) return
    const { error } = await supabase.from('contrapartes').delete().eq('id', c.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar por nombre o CUIT..."
          style={{ ...inp, maxWidth: 320 }} />
        <button onClick={() => { setEditando(null); setMostrarForm(true) }}
          style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          + Nueva contraparte
        </button>
      </div>

      {contrapartes.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
          Todavía no hay contrapartes cargadas. Cargá tus clientes y proveedores frecuentes para tenerlos a un click al cargar facturas.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, minWidth: 700 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Nombre</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>CUIT</th>
                  <th style={{ textAlign: 'center', padding: '8px 6px' }}>IVA</th>
                  <th style={{ textAlign: 'center', padding: '8px 6px' }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>Contacto</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {pag.items.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 6px', fontWeight: 600 }}>{c.nombre}</td>
                    <td style={{ padding: '6px 6px', fontFamily: 'monospace', fontSize: 12 }}>
                      {c.cuit ? formatearCuit(c.cuit) : '—'}
                      {c.cuit && !esCuitValido(c.cuit) && <span title="CUIT con dígito inválido" style={{ color: '#ff8b8b', marginLeft: 4 }}>⚠️</span>}
                    </td>
                    <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--muted)', fontSize: 11 }}>{c.condicion_iva || '—'}</td>
                    <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                      <span style={{ background: 'var(--surface2)', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                        {c.tipo === 'cliente' ? '🧑 CLI' : c.tipo === 'proveedor' ? '🏭 PROV' : '↔️ AMBOS'}
                      </span>
                    </td>
                    <td style={{ padding: '6px 6px', fontSize: 11, color: 'var(--muted)' }}>{c.email || c.telefono || '—'}</td>
                    <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                      <button onClick={() => { setEditando(c); setMostrarForm(true) }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4 }}>✏️</button>
                      <button onClick={() => eliminar(c)} style={{ background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 10 }}>
            <Paginador {...pag.controles} label="contrapartes" />
          </div>
        </div>
      )}

      {mostrarForm && (
        <FormContraparte
          contraparte={editando}
          onCerrar={() => { setMostrarForm(false); setEditando(null) }}
          onGuardado={() => { setMostrarForm(false); setEditando(null); onChange() }}
        />
      )}
    </div>
  )
}

function FormContraparte({ contraparte, onCerrar, onGuardado }) {
  const VACIO = { nombre: '', cuit: '', condicion_iva: 'responsable_inscripto', tipo: 'ambos', email: '', telefono: '', domicilio: '', notas: '' }
  const [form, setForm] = useState(contraparte || VACIO)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!form.nombre.trim()) return alert('Nombre obligatorio')
    if (form.cuit && !esCuitValido(form.cuit)) {
      if (!confirm('⚠️ El CUIT no parece válido. ¿Guardar igual?')) return
    }
    setGuardando(true)
    const datos = { ...form, updated_at: new Date().toISOString() }
    let error
    if (contraparte?.id) {
      const r = await supabase.from('contrapartes').update(datos).eq('id', contraparte.id)
      error = r.error
    } else {
      const r = await supabase.from('contrapartes').insert(datos)
      error = r.error
    }
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 540, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{contraparte ? '✏️ Editar contraparte' : '+ Nueva contraparte'}</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Nombre / razón social *">
            <input value={form.nombre} onChange={e => set('nombre', e.target.value)} style={inp} />
          </Campo>
          <Campo label="CUIT">
            <input value={form.cuit} onChange={e => set('cuit', e.target.value)} placeholder="20-12345678-9"
              style={{ ...inp, borderColor: form.cuit ? (esCuitValido(form.cuit) ? 'var(--green)' : '#ff8b8b') : 'var(--border)' }} />
            {form.cuit && !esCuitValido(form.cuit) && (
              <div style={{ fontSize: 10, color: '#ff8b8b', marginTop: 2 }}>⚠️ CUIT inválido</div>
            )}
          </Campo>
          <Campo label="Condición IVA">
            <select value={form.condicion_iva} onChange={e => set('condicion_iva', e.target.value)} style={inp}>
              <option value="responsable_inscripto">RI</option>
              <option value="monotributo">Monotributo</option>
              <option value="exento">Exento</option>
              <option value="consumidor_final">Consumidor Final</option>
              <option value="no_aplica">N/A</option>
            </select>
          </Campo>
          <Campo label="Tipo">
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={inp}>
              <option value="cliente">🧑 Cliente</option>
              <option value="proveedor">🏭 Proveedor</option>
              <option value="ambos">↔️ Ambos</option>
            </select>
          </Campo>
          <Campo label="Email"><input value={form.email || ''} onChange={e => set('email', e.target.value)} style={inp} /></Campo>
          <Campo label="Teléfono"><input value={form.telefono || ''} onChange={e => set('telefono', e.target.value)} style={inp} /></Campo>
        </div>
        <Campo label="Domicilio"><input value={form.domicilio || ''} onChange={e => set('domicilio', e.target.value)} style={inp} /></Campo>
        <Campo label="Notas"><input value={form.notas || ''} onChange={e => set('notas', e.target.value)} style={inp} /></Campo>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : '✅ Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// MODAL CONFIGURAR ARCA — credenciales de facturación electrónica
// ============================================================
// Carga cert + clave privada por cuenta (se mandan a la edge function
// `arca-config`, que las guarda con service_role; nunca vuelven al front),
// elige ambiente y punto de venta, y prueba la conexión contra ARCA.
function ModalConfigArca({ cuenta, onCerrar, onGuardado }) {
  const [ambiente, setAmbiente] = useState(cuenta.arca_ambiente || 'homologacion')
  const [puntoVenta, setPuntoVenta] = useState(cuenta.arca_punto_venta || 1)
  const [cert, setCert] = useState('')
  const [key, setKey] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, texto }
  const [genUser, setGenUser] = useState(String(cuenta.cuit || '').replace(/\D/g, ''))
  const [csrResult, setCsrResult] = useState(null)
  const [generandoCsr, setGenerandoCsr] = useState(false)
  // Marca local: arranca con el estado de la cuenta, pero se prende apenas
  // generamos/guardamos credenciales (así Probar/Guardar no las vuelven a pedir).
  const [tieneCredsLocal, setTieneCredsLocal] = useState(!!cuenta.arca_habilitado)
  const yaConfig = cuenta.arca_habilitado || tieneCredsLocal

  function leerArchivo(file, setter) {
    if (!file) return
    const r = new FileReader()
    r.onload = () => setter(String(r.result || '').trim())
    r.readAsText(file)
  }

  async function guardar({ luegoProbar } = {}) {
    // Para una cuenta nueva solo exigimos el CERTIFICADO (.crt) que da ARCA.
    // La clave privada (.key) NO se re-pide: con el método CSR ya quedó guardada
    // cifrada en el servidor, y la edge function conserva la existente si el campo
    // va vacío. Si alguien pega un cert sin key y el server no tiene ninguna, el
    // error real lo muestra "Probar conexión" (no este guard).
    if (!yaConfig && !cert) {
      setMsg({ ok: false, texto: 'Pegá o subí el certificado (.crt) que te dio ARCA. La clave privada ya quedó guardada cuando generaste el CSR — dejá ese campo vacío.' })
      return false
    }
    setGuardando(true); setMsg(null)
    const r = await guardarConfigArca({
      cuenta_id: cuenta.id,
      ambiente,
      punto_venta: Number(puntoVenta) || 1,
      cert: cert || undefined,            // si va vacío, la function conserva el anterior
      key: key || undefined,
    })
    setGuardando(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.error }); return false }
    if (r.data?.tiene_credenciales) setTieneCredsLocal(true)
    if (!luegoProbar) {
      setMsg({ ok: true, texto: '✅ Configuración guardada.' })
      onGuardado()
    }
    return true
  }

  async function generarCsr() {
    setGenerandoCsr(true)
    setMsg({ ok: true, texto: '⏳ Generando clave privada + CSR (puede tardar unos segundos)...' })
    const r = await generarCsrArca({
      cuenta_id: cuenta.id, ambiente,
      punto_venta: Number(puntoVenta) || 1,
      arca_username: genUser,
    })
    setGenerandoCsr(false)
    if (r.ok) {
      setCsrResult(r.data?.csr || '')
      setMsg({ ok: true, texto: '✅ CSR generado. Seguí los 3 pasos de abajo para obtener el certificado.' })
    } else {
      setMsg({ ok: false, texto: '❌ ' + r.error })
    }
  }

  async function probar() {
    // Guardar primero (por si cambiaron cert/key/ambiente/PV) y después probar
    const okGuardado = await guardar({ luegoProbar: true })
    if (!okGuardado) return
    setProbando(true); setMsg({ ok: true, texto: '⏳ Probando conexión con ARCA...' })
    const r = await probarConexionArca(cuenta.id)
    setProbando(false)
    if (r.ok) {
      setMsg({ ok: true, texto: '✅ ' + (r.data?.mensaje || 'Conexión OK con ARCA.') })
      onGuardado()
    } else {
      setMsg({ ok: false, texto: '❌ ' + r.error })
    }
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>⚡ Configurar ARCA — {cuenta.nombre}</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          CUIT {cuenta.cuit}. El certificado y la clave privada se guardan cifrados en el servidor y nunca se muestran de vuelta.
          {yaConfig && <span style={{ color: '#7dff7d' }}> · Esta cuenta ya tiene credenciales cargadas (dejá los campos vacíos para conservarlas).</span>}
        </div>

        {/* Certificado propio: clave + CSR, conexión DIRECTA con ARCA (sin terceros) */}
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--gold)' }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>📄 Generar certificado propio (conexión directa con ARCA)</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            La app genera la <strong>clave privada + un CSR</strong>. Subís el CSR a ARCA, ARCA te da el certificado, lo pegás abajo y listo.
            Sin intermediarios, sin límites y sin costo. Para <strong>apoderado</strong> (ej. la SAS), poné en "Usuario ARCA" el CUIT del apoderado.
          </div>
          <Campo label="Usuario ARCA (CUIT del titular / apoderado)">
            <input value={genUser} onChange={e => setGenUser(e.target.value)} style={inp} />
          </Campo>
          <button onClick={generarCsr} disabled={generandoCsr || guardando || probando}
            style={{ width: '100%', padding: 11, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800 }}>
            {generandoCsr ? '⏳ Generando CSR...' : '📄 Generar clave + CSR'}
          </button>

          {csrResult && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Tu CSR (copialo entero):</div>
              <textarea readOnly value={csrResult} rows={6}
                onFocus={e => e.target.select()}
                style={{ ...inp, fontFamily: 'monospace', fontSize: 10, resize: 'vertical' }} />
              <button onClick={() => { navigator.clipboard?.writeText(csrResult); setMsg({ ok: true, texto: '📋 CSR copiado al portapapeles.' }) }}
                style={{ marginTop: 6, padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                📋 Copiar CSR
              </button>
              <ol style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Entrá a ARCA → <strong>Administración de Certificados Digitales</strong> (con la clave fiscal del titular).</li>
                <li>Creá un alias y <strong>subí/pegá este CSR</strong>. ARCA te devuelve un <strong>certificado (.crt / .pem)</strong>.</li>
                <li>Pegá ese certificado en el campo <strong>"Certificado"</strong> de abajo y apretá <strong>Guardar</strong>. (La clave ya quedó guardada.)</li>
                <li>Después: <strong>Administrador de Relaciones</strong> → autorizá el servicio <strong>wsfe</strong> para ese certificado. Y <strong>Probar conexión</strong>.</li>
              </ol>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Ambiente">
            <select value={ambiente} onChange={e => setAmbiente(e.target.value)} style={inp}>
              <option value="homologacion">🧪 Homologación (testing)</option>
              <option value="produccion">🏛️ Producción (real)</option>
            </select>
          </Campo>
          <Campo label="Punto de venta">
            <input type="number" min="1" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} style={inp} />
          </Campo>
        </div>

        <div style={{ marginTop: 14 }}>
          <Campo label={`Certificado (.crt / .pem)${yaConfig ? ' — opcional, reemplaza el actual' : ' *'}`}>
            <input type="file" accept=".crt,.pem,.cer,.txt" onChange={e => leerArchivo(e.target.files?.[0], setCert)}
              style={{ ...inp, padding: '6px 8px' }} />
            <textarea value={cert} onChange={e => setCert(e.target.value)} rows={3}
              placeholder="-----BEGIN CERTIFICATE-----"
              style={{ ...inp, marginTop: 6, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }} />
          </Campo>
        </div>

        <div style={{ marginTop: 10 }}>
          <Campo label={`Clave privada (.key)${yaConfig ? ' — opcional, reemplaza la actual' : ' *'}`}>
            <input type="file" accept=".key,.pem,.txt" onChange={e => leerArchivo(e.target.files?.[0], setKey)}
              style={{ ...inp, padding: '6px 8px' }} />
            <textarea value={key} onChange={e => setKey(e.target.value)} rows={3}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
              style={{ ...inp, marginTop: 6, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }} />
          </Campo>
        </div>

        {msg && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 6, fontSize: 13,
            background: msg.ok ? '#1a2a1a' : '#3a1a1a', color: msg.ok ? '#7dff7d' : '#ff8b8b' }}>
            {msg.texto}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cerrar
          </button>
          <button onClick={probar} disabled={guardando || probando}
            style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
            {probando ? '⏳ Probando...' : '🔌 Probar conexión'}
          </button>
          <button onClick={() => guardar()} disabled={guardando || probando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : '✅ Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
