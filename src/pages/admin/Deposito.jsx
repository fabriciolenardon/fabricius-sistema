import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fechaHoyARG, fechaRelativaARG, esFechaFutura } from '../../lib/fechas'
import { lunesDeLaSemana, domingoDeLaSemana } from '../../lib/cierreAuto'
import { resolverDescuentoStock } from '../../lib/stockHelpers'
import { bucketDePiezaBovina } from '../../lib/modelosDesposte'
import { cargarCajasDisponibles, crearCajasIngreso, venderCaja, revertirVentaCaja, CATEGORIA_A_TIPO_CAJA } from '../../lib/cajasStock'
import { fmtPrecio, fmtKg, parseNumero } from '../../lib/formatos'
import { imprimirHTML } from '../../lib/imprimir'
import { recomputarSaldoCliente } from '../../lib/ctaCorriente'
import { getCampoPrecio } from '../../lib/listasPrecios'
import CuentaCorrienteProveedor from './CuentaCorrienteProveedor'
import { agregarMovimiento, eliminarMovimiento, registrarCompraDesdeEntrada, revertirCompraDeEntrada } from '../../lib/ctaProveedores'
import Paginador, { usePaginacion } from '../../components/Paginador'
import FlujoDeposito from './FlujoDeposito'
import AjusteStock from './AjusteStock'
import CajasTab from './CajasTab'
import PolloCajonesTab from './PolloCajonesTab'

// Nombre legible de cada tipo de embutido/salame (para descripciones de
// historial y entradas registradas). El <select> usa estas mismas claves.
const NOMBRE_EMBUTIDO = {
  chorizo_parrillero: 'Chorizo Parrillero',
  chorizo_saborizado: 'Chorizo Saborizado',
  chorizo_colorado: 'Chorizo Colorado',
  salchicha_parrillera: 'Salchicha Parrillera',
  morcilla: 'Morcilla',
  salame_comun: 'Salame Común',
  salame_rockeford: 'Salame Rockeford',
  salame_holanda: 'Salame Holanda',
}

// Bucket de stock PROPIO de cada embutido elaborado (mig 60, modelo "cerdo
// piezas"): la elaboración suma acá y la venta descuenta de acá (vía
// precios.stock_origen — la caja y las salidas lo priorizan sobre la
// categoría). Los embutidos no elaborados (jamón crudo, arrollado, etc.)
// no trackean stock. Cada tipo de salame tiene su propio bucket (mig 60e):
// Salame Casero Env./sin Env. → común; Holanda y Rockeford → el suyo.
const BUCKET_EMBUTIDO = {
  chorizo_parrillero: 'emb_chorizo_parrillero',
  chorizo_saborizado: 'emb_chorizo_saborizado',
  chorizo_colorado: 'emb_chorizo_colorado',
  salchicha_parrillera: 'emb_salchicha_parrillera',
  morcilla: 'emb_morcilla',
  salame_comun: 'emb_salame_comun',
  salame_rockeford: 'emb_salame_rockeford',
  salame_holanda: 'emb_salame_holanda',
}
const LABEL_BUCKET_EMB = {
  emb_chorizo_parrillero: '🌭 Chorizo Parrillero',
  emb_chorizo_saborizado: '🌭 Chorizo Saborizado',
  emb_chorizo_colorado: '🌶️ Chorizo Colorado',
  emb_salchicha_parrillera: '🌭 Salchicha Parrillera',
  emb_morcilla: '🖤 Morcilla',
  emb_salame_comun: '🥩 Salame Común Casero',
  emb_salame_holanda: '🧀 Salame Holanda',
  emb_salame_rockeford: '🧀 Salame Rockeford',
}

// Etiqueta/estilo de la forma de cobro de un remito. Solo 'cta_cte' es a
// crédito (deuda); el resto es contado = pagado en el acto.
const COBRO_LABEL = {
  cta_cte:       { txt: 'CTA CTE',            color: '#e0a030', bg: '#2a1f0a' },
  efectivo:      { txt: 'PAGADO · EFECTIVO',  color: '#5fd55f', bg: '#10240f' },
  transferencia: { txt: 'PAGADO · TRANSF.',   color: '#5fd55f', bg: '#10240f' },
  cheque:        { txt: 'PAGADO · CHEQUE',    color: '#5fd55f', bg: '#10240f' },
  echeq:         { txt: 'PAGADO · E-CHEQ',    color: '#5fd55f', bg: '#10240f' },
  mixto:         { txt: 'PAGADO · MIXTO',     color: '#5fd55f', bg: '#10240f' },
}

// Nombre corto de cada forma de pago (para el desglose del pago dividido).
const METODO_PAGO_LABEL = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  echeq: 'E-cheq',
}

// Tipos que se COMPRAN POR KG a un proveedor: el importe se calcula como
// kg × precio/kg (no se pide un importe total manual). Incluye media res,
// capón y las piezas bovinas compradas directas al frigorífico.
// IMPORTANTE: las piezas que salen de despostar una media res NUESTRA NO pasan
// por acá — entran por el flujo de desposte con importe 0 (su costo ya está en
// la media res). Esto solo aplica a las COMPRAS directas vía EntradaForm.
const TIPOS_COMPRA_POR_KG = new Set([
  'bovino_mr', 'cerdo',
  'pieza_pierna', 'pieza_cuarto_pistola', 'pieza_costillar', 'pieza_cortito',
  'pieza_costeletal', 'pieza_paleta', 'pieza_parrillero',
])

// ── Detector de posibles cargas duplicadas ──────────────────
// Devuelve el Set de ids de entradas que comparten MISMO peso y MISMA fecha
// con otra entrada de la lista. Caso real del 11/06: se cargaron 7 medias
// dos veces y el depostero despostó la copia equivocada (dos medias de
// 100 kg idénticas en el selector). Con esto el selector lo grita.
function idsConPosibleDuplicado(lista) {
  const porClave = {}
  ;(lista || []).forEach(e => {
    const clave = `${e.fecha}|${Number(e.kg_real || e.kg || 0)}`
    ;(porClave[clave] = porClave[clave] || []).push(e.id)
  })
  return new Set(Object.values(porClave).filter(g => g.length > 1).flat())
}

// Banner de aviso cuando el selector tiene posibles duplicadas
function AvisoDuplicadas({ cantidad }) {
  if (!cantidad) return null
  return (
    <div style={{ background: '#3a2a1a', border: '1px solid #ffb86b', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#ffb86b', fontWeight: 700 }}>
      ⚠️ Hay {cantidad} medias con el MISMO peso y fecha — puede haber una carga duplicada.
      Verificá el código MR antes de operar; si sobra alguna, anulala primero en el Historial de Ingresos.
    </div>
  )
}

// Etiqueta chica para marcar cada tarjeta sospechosa
function TagDuplicada() {
  return (
    <span style={{ background: '#3a2a1a', color: '#ffb86b', border: '1px solid #ffb86b', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 800, letterSpacing: 0.5 }}>
      ⚠️ MISMO PESO Y FECHA
    </span>
  )
}

// ============================================================
// Sinónimos de búsqueda de productos (buscador de remitos)
// ------------------------------------------------------------
// Permite que buscar un término general (ej. "media res") traiga
// todas las categorías que cuentan como tal, aunque en los remitos
// estén cargadas con códigos distintos (NT, VQ, NOVILLITO, etc.).
//   - claves:    términos que el usuario puede tipear para el grupo
//   - productos: valores de `producto` (normalizados: minúscula + trim)
//                que pertenecen al grupo (match EXACTO para no traer cortes)
// Para sumar más grupos en el futuro, agregá otra entrada acá.
// ============================================================
const SINONIMOS_PRODUCTO = [
  {
    claves: ['media res', 'mediares', 'media-res', 'medias res', 'res', 'mr', 'bovino', 'novillito', 'novillo', 'vaquillona', 'vaca', 'nt', 'vq'],
    productos: ['nt', 'nto', 'vq', 'novillito', 'novillo', 'vaquillona', 'vaca', 'bovino_mr', 'media res', 'bovino media res'],
  },
]

// ¿La compra `c` coincide con el texto `q` (ya en minúscula)?
// Hace match por substring normal + expansión por sinónimos.
function coincideTextoProducto(c, q) {
  const prod = (c.producto || '').toLowerCase().trim()
  const prov = (c.proveedor_nombre || '').toLowerCase()
  if ((prov + ' ' + prod).includes(q)) return true
  for (const g of SINONIMOS_PRODUCTO) {
    const queryEnGrupo = g.claves.some(k => k === q || k.includes(q) || q.includes(k))
    if (queryEnGrupo && g.productos.includes(prod)) return true
  }
  return false
}

async function actualizarStock(tipo, kg) {
  // Devuelve { error } para que el caller pueda chequear si la operación
  // falló. Antes los errores se tragaban silenciosamente — eso causó que
  // alguna vez la elaboración descontara las piezas pero no sumara los
  // embutidos al stock (la operaria tuvo que ajustarlo a mano).
  const { data, error: errSel } = await supabase.from('stock_actual').select('*').eq('tipo', tipo).maybeSingle()
  if (errSel) return { error: errSel }
  if (data) {
    const { error } = await supabase.from('stock_actual')
      .update({ kg_disponible: (data.kg_disponible || 0) + kg })
      .eq('tipo', tipo)
    return { error: error || null }
  }
  const { error } = await supabase.from('stock_actual').insert({ tipo, kg_disponible: kg })
  return { error: error || null }
}

// Suma kg a un bucket y VERIFICA con un re-read que efectivamente subió
// (patrón anti-error de la elaboración de embutidos: si algo falla se ve
// al instante en vez de tener que cuadrar el stock a mano). Tira Error.
async function sumarStockVerificado(tipo, kg) {
  const { data: antes } = await supabase.from('stock_actual').select('kg_disponible').eq('tipo', tipo).maybeSingle()
  const esperado = (Number(antes?.kg_disponible) || 0) + kg
  const { error } = await actualizarStock(tipo, kg)
  if (error) throw new Error(`No se sumó al stock ${tipo}: ${error.message}`)
  const { data: despues } = await supabase.from('stock_actual').select('kg_disponible').eq('tipo', tipo).maybeSingle()
  if (Math.abs((Number(despues?.kg_disponible) || 0) - esperado) > 0.01) {
    throw new Error(`El stock ${tipo} no se actualizó correctamente. Esperado: ${esperado.toFixed(2)} kg. Revisá Ajuste Stock.`)
  }
}

// Helper: format de hora desde un timestamp de Postgres.
// Convertimos created_at a hora ARG con formato HH:MM. Dos pasos:
//   1) Si el string no trae TZ explicita (caso de columnas legacy
//      `timestamp without time zone`) lo tratamos como UTC.
//   2) Forzamos timeZone ARG en el toLocaleTimeString — sino la maquina
//      del cliente decide la TZ (ej. si la PC del local esta mal seteada).
function fmtHora(ts) {
  if (!ts) return ''
  try {
    const tieneTZ = /(Z|[+\-]\d{2}:?\d{2})$/.test(String(ts).trim())
    const d = new Date(tieneTZ ? ts : ts.replace(' ', 'T') + 'Z')
    return d.toLocaleTimeString('es-AR', {
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Argentina/Buenos_Aires',
    })
  } catch {
    return ''
  }
}

const MODELOS_DESPOSTE = {
  A: {
    nombre: 'Cuarto Pistola + Costillar Completo + Cortito',
    icono: '🅰️',
    merma_desposte_pct: 0.03,
    piezas: [
      { nombre: 'Cuarto Pistola', pct: 0.44, tipo_stock: 'pieza_cuarto_pistola', busqueda_precio: 'pistola' },
      { nombre: 'Cortito', pct: 0.33, tipo_stock: 'pieza_cortito', busqueda_precio: 'cortito' },
      { nombre: 'Costillar Completo', pct: 0.20, tipo_stock: 'pieza_costillar', busqueda_precio: 'costilla' },
    ],
  },
  B: {
    nombre: 'Pierna + Costeletal con Lomo + Costillar Completo + Cortito',
    icono: '🅱️',
    merma_desposte_pct: 0.03,
    piezas: [
      { nombre: 'Pierna', pct: 0.30, tipo_stock: 'pieza_pierna', busqueda_precio: 'pierna' },
      { nombre: 'Costeletal con Lomo', pct: 0.14, tipo_stock: 'pieza_costeletal', busqueda_precio: 'lomo' },
      { nombre: 'Cortito', pct: 0.33, tipo_stock: 'pieza_cortito', busqueda_precio: 'cortito' },
      { nombre: 'Costillar Completo', pct: 0.20, tipo_stock: 'pieza_costillar', busqueda_precio: 'costilla' },
    ],
  },
  C: {
    nombre: 'Pierna + Parrillero + Cortito',
    icono: '🅲',
    merma_desposte_pct: 0.02,
    piezas: [
      { nombre: 'Pierna', pct: 0.30, tipo_stock: 'pieza_pierna', busqueda_precio: 'pierna' },
      { nombre: 'Parrillero', pct: 0.35, tipo_stock: 'pieza_parrillero', busqueda_precio: 'parrillero' },
      { nombre: 'Cortito', pct: 0.33, tipo_stock: 'pieza_cortito', busqueda_precio: 'cortito' },
    ],
  },
}

// Wrapper que mantiene la firma vieja `fmt(n)` (precio en $) usando el
// formatter centralizado — ahora muestra decimales si los hay, siempre con
// coma decimal y punto miles (formato AR). Ver src/lib/formatos.js.
const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

// Mapeo categoría de item de despacho → tipo de stock_actual a descontar.
// Vive a nivel de módulo (no dentro de un componente) porque lo usan tanto
// SalidaForm (al despachar, descuenta stock) como RemitosTab (al anular un
// remito, devuelve el mismo stock). Si quedara local en SalidaForm, el revert
// de la anulación no podría calcular qué stock devolver.
const CATEGORIA_A_STOCK = {
  bovino_mr: 'bovino_mr',
  bovino_corte: 'bovino_corte',
  bovino_brosa: 'bovino_brosa',
  bovino_pieza: 'bovino_pieza',
  bovino_caja_cb: 'caja_cb',
  bovino_caja_pt: 'caja_pt',
  pieza_pierna: 'pieza_pierna',
  pieza_cuarto_pistola: 'pieza_cuarto_pistola',
  pieza_costillar: 'pieza_costillar',
  pieza_cortito: 'pieza_cortito',
  pieza_carre: 'pieza_costeletal',  // carré = costeletal con lomo (fusionado)
  pieza_paleta: 'pieza_paleta',
  pieza_parrillero: 'pieza_parrillero',
  caja_cb: 'caja_cb',
  caja_pt: 'caja_pt',
  // ── CERDO ──────────────────────────────────────────────
  // cerdo (capón entero) → stock_actual.tipo='cerdo' (capones)
  // cerdo_corte / cerdo_pieza → SIEMPRE se descuenta del stock_origen del
  //   producto (ej. 'cerdo_bondiola', 'cerdo_pierna'). Todos los cortes de
  //   cerdo tienen stock_origen configurado. El bucket genérico 'cerdo_pieza'
  //   fue ELIMINADO (acumulaba negativos). Por eso NO se mapea acá: si un
  //   producto de cerdo no tuviera stock_origen, resolverDescuentoStock cae al
  //   nombre crudo de la categoría (queda visible como tipo sin mapear) en vez
  //   de resucitar el bucket buggy. NUNCA descontar de 'cerdo' (capones).
  cerdo: 'cerdo',
  // embutido: los de elaboración propia tienen stock_origen (emb_*, mig 60);
  // el resto (jamón crudo, arrollado, etc.) NO trackea stock — el bucket
  // genérico 'embutido' fue eliminado, null = no descontar (como cerdo_pieza).
  embutido: null,
  pollo: 'pollo',
  rebozado: 'rebozado',
}

export function Deposito() {
  const [tab, setTab] = useState('entradas')
  const [alert, setAlert] = useState(null)
  const [remitoActual, setRemitoActual] = useState(null)
  const [proveedores, setProveedores] = useState([])

  useEffect(() => {
    supabase.from('proveedores').select('nombre').eq('activo', true).order('nombre')
      .then(({ data }) => setProveedores((data || []).map(p => p.nombre)))
  }, [])

  function showAlert(msg) { setAlert(msg); setTimeout(() => setAlert(null), 4000) }

  return (
    <div>
      <div className="page-title">DEPÓSITO</div>
      <div className="page-sub">Stock, entradas, desposte, piezas y proveedores</div>
      {alert && <div className={`alert alert-${alert?.type || 'success'}`}>{alert?.msg || alert}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'entradas', label: '📥 Ingresos' },
          { id: 'desposte', label: '🔪 Desposte' },
          { id: 'piezas', label: '🥩 Piezas' },
          { id: 'cajas', label: '📦 Cajas Bovinas' },
          { id: 'pollo_cajones', label: '🍗 Pollo Cajones' },
          { id: 'flujo', label: '📥 Flujo Depósito' },
          { id: 'remitos', label: '🧾 Remitos' },
          { id: 'proveedores', label: '🏭 Proveedores' },
          { id: 'ajuste', label: '🔧 Ajuste Stock' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${tab === t.id ? 'var(--amber)' : 'var(--border)'}`, background: tab === t.id ? 'var(--amber)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'entradas' && <EntradaForm onSaved={() => {}} showAlert={showAlert} proveedores={proveedores} />}
        {tab === 'desposte' && <DesposteTab key={tab} onSaved={() => {}} />}
{tab === 'piezas' && <PiezasTab key={tab} />}
{tab === 'cajas' && <CajasTab key={tab} />}
{tab === 'pollo_cajones' && <PolloCajonesTab key={tab} />}
{tab === 'remitos' && <RemitosTab remitoActual={remitoActual} />}
      {tab === 'flujo' && <FlujoDeposito />}
      {tab === 'proveedores' && <ProveedoresTab />}
      {tab === 'ajuste' && <AjusteStock />}
    </div>
  )
}

export default Deposito
// =============================================
// MÓDULO DE DESPOSTE BOVINO
// =============================================
function DesposteTab({ onSaved }) {
  const [subtab, setSubtab] = useState('piezas')
  const [mediasRes, setMediasRes] = useState([])
  const [piezasStock, setPiezasStock] = useState({})
  const [despostes, setDespostes] = useState([])
  const [precios, setPrecios] = useState([])
  const [seleccionada, setSeleccionada] = useState(null)
  const [modelo, setModelo] = useState('A')
  const [tipoAnimal, setTipoAnimal] = useState('novillo')
  const [piezas, setPiezas] = useState([])
  const [fecha, setFecha] = useState(fechaHoyARG())
  const [notas, setNotas] = useState('')
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(false)
  const [kgPiezaConvertir, setKgPiezaConvertir] = useState('')
  const [tipoPiezaSeleccionada, setTipoPiezaSeleccionada] = useState('')
  const [nombrePieza, setNombrePieza] = useState('')
  const [tipoAnimalPieza, setTipoAnimalPieza] = useState('novillo')
  const [precioCostoPieza, setPrecioCostoPieza] = useState('')
  const [mermaPieza, setMermaPieza] = useState(25)
  const [caponesDisponibles, setCaponesDisponibles] = useState([])
const [caponSeleccionado, setCaponSeleccionado] = useState(null)
const [piezasCerdo, setPiezasCerdo] = useState({
  pierna: '', carre: '', pechito: '', matambre: '',
  paleta: '', parrillero: '', bondiola: '', huesos: '', tocino: '', cuero: '', cabeza: ''
})
const [tipoElaboracion, setTipoElaboracion] = useState('embutido')
const [tipoEmbutido, setTipoEmbutido] = useState('chorizo_parrillero')
const [piezasEmbutido, setPiezasEmbutido] = useState({
  cerdo_pierna: '', cerdo_paleta: '', cerdo_parrillero: '', cerdo_pechito: '',
  cerdo_matambre: '', cerdo_carre: '', cerdo_bondiola: '', cerdo_tocino: ''
})
const [kgCarneBovinaEmbutido, setKgCarneBovinaEmbutido] = useState('')
const [kgQuesoEmbutido, setKgQuesoEmbutido] = useState('')
const [pctAumentoEmbutido, setPctAumentoEmbutido] = useState(10)
// Peso real embutido por variedad (parrilleros). Si se carga, la merma sale sola.
// Peso real por PRODUCTO terminado: una misma elaboración puede producir
// chorizos comunes, saborizados Y salchichas (cada uno va a su stock).
const [pesoRealEmb, setPesoRealEmb] = useState({ chorizo_parrillero: '', chorizo_saborizado: '', chorizo_colorado: '', salchicha_parrillera: '', morcilla: '' })
const [elaboraciones, setElaboraciones] = useState([])
const [piezasIndividuales, setPiezasIndividuales] = useState([])
// Historial completo de medias_stock (todos los estados) para la pestana
// "Historial Medias". Se carga junto con cargarDatos.
const [mediasStockAll, setMediasStockAll] = useState([])
const [piezaIndividualSeleccionada, setPiezaIndividualSeleccionada] = useState(null)
  const MERMAS_KILO = {
    novillo:  { label: 'Novillo / Novillito', merma: 0.24, color: 'var(--gold)' },
    ternera:  { label: 'Ternera',             merma: 0.30, color: 'var(--amber)' },
    bubalino: { label: 'Bubalino',            merma: 0.25, color: 'var(--blue)' },
  }

  useEffect(() => { cargarDatos() }, [])

  // Realtime: cuando OTRO usuario (admin desde otra pestaña, desposte
  // desde el tablet, cajero al vender) modifica el stock o las medias,
  // recargamos los datos automaticamente para que esta pantalla siempre
  // muestre la realidad — sin necesidad de F5.
  // Usamos un canal por tabla critica y un debounce de 400ms para no
  // disparar 10 recargas seguidas si llegan varios eventos juntos.
  useEffect(() => {
    let timer = null
    const debouncedReload = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cargarDatos(), 400)
    }
    const canal = supabase.channel('deposito-stock-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entradas_deposito' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medias_stock' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'piezas_stock' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cajas_stock' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_actual' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'despostes' }, debouncedReload)
      .subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(canal)
    }
  }, [])

  async function cargarDatos() {
    // Orden: fecha DESC + created_at DESC para todas las queries de entradas_deposito.
    // `fecha` es DATE (sin hora), así que entradas del mismo día caían en orden
    // inestable. `id` no sirve como tiebreaker porque son UUIDs aleatorios.
    // `created_at` (timestamp) es el único campo que refleja el orden real de
    // creación.
    const [{ data: entradas }, { data: despostesData }, { data: preciosData }, { data: stockData }, { data: caponesData }, { data: elaboracionesData }, { data: piezasIndivData }, { data: mediasStockData }] = await Promise.all([
  // NOTA: NO se filtra por `reservada`. El Flujo Depósito es solo informativo
  // y no debe sacar medias de circulación; toda media no despostada está
  // disponible para despostar/vender. (Ver DesposteMediaRes — ya no reserva.)
  // SÍ se filtra `eliminado`: un ingreso anulado no puede despostarse — bug del
  // 11/06: una media duplicada anulada seguía en este selector y se despostó.
  supabase.from('entradas_deposito').select('*').eq('tipo', 'bovino_mr').eq('despostada', false).eq('eliminado', false).order('fecha', { ascending: false }).order('created_at', { ascending: false }),
  // Orden por fecha + created_at (timestamp real de emisión) para que los del
  // mismo día queden de más nuevo a más viejo, no desordenados.
  supabase.from('despostes').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }),
  supabase.from('precios').select('*').eq('categoria', 'bovino_pieza'),
  supabase.from('stock_actual').select('*'),
  supabase.from('entradas_deposito').select('*').eq('tipo', 'cerdo').eq('despostada', false).eq('eliminado', false).order('fecha', { ascending: false }).order('created_at', { ascending: false }),
  supabase.from('elaboraciones_embutidos').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
  supabase.from('piezas_stock').select('*').order('fecha_ingreso', { ascending: false }).order('id', { ascending: false }),
  // Trazabilidad individual de medias reses con codigo MR-XXX.
  // Traemos TODAS las filas (cualquier estado) para alimentar tanto el mapeo
  // de codigos como el historial completo de medias en el sub-tab "Historial Medias".
  supabase.from('medias_stock').select('*').order('id', { ascending: false }),
])
// Enriquecer cada entrada con el codigo MR-XXX de medias_stock
const codigoPorEntrada = {}
;(mediasStockData || []).forEach(m => { if (m.entrada_id) codigoPorEntrada[m.entrada_id] = m.codigo })
setMediasStockAll(mediasStockData || [])
setMediasRes((entradas || []).map(e => ({ ...e, codigo_media: codigoPorEntrada[e.id] || null })))
setDespostes(despostesData || [])
setPrecios(preciosData || [])
setPiezasIndividuales(piezasIndivData || [])
const stockMap = {}
;(stockData || []).forEach(r => stockMap[r.tipo] = r.kg_disponible)
setPiezasStock(stockMap)
setCaponesDisponibles(caponesData || [])
setElaboraciones(elaboracionesData || [])
  }
  function showAlert(msg, type = 'success') { setAlert({ msg, type }); setTimeout(() => setAlert(null), 5000) }

  function buscarPrecio(busqueda) {
    const termino = busqueda.toLowerCase()
    const encontrado = precios.find(p =>
      p.nombre.toLowerCase().includes(termino) ||
      termino.split(' ').some(t => t.length > 3 && p.nombre.toLowerCase().includes(t))
    )
    return encontrado?.precio_carniceria || encontrado?.precio_mayorista || 0
  }

  function calcularPiezas(entrada, modeloId) {
    if (!entrada) return []
    const kgBase = entrada.kg_real || entrada.kg || 0
    const kgNeto = kgBase * 0.975
    return MODELOS_DESPOSTE[modeloId].piezas.map(pieza => ({
      nombre: pieza.nombre,
      kg: parseFloat((kgNeto * pieza.pct).toFixed(2)),
      kg_editado: parseFloat((kgNeto * pieza.pct).toFixed(2)),
      tipo_stock: pieza.tipo_stock,
      precio_venta: buscarPrecio(pieza.busqueda_precio),
      precio_costo_kg: entrada.precio_kg || 0,
    }))
  }

  function seleccionarMedia(entrada) {
    setSeleccionada(entrada)
    setPiezas(calcularPiezas(entrada, modelo))
  }

  function cambiarModelo(m) {
    if (m === modelo) return
    const hayKilosManualmenteCargados = piezas.some(p => Math.abs((p.kg_editado || 0) - (p.kg || 0)) > 0.01)
    if (hayKilosManualmenteCargados) {
      const ok = window.confirm('¿Cambiar de modelo? Se van a perder los kilos cargados.')
      if (!ok) return
    }
    setModelo(m)
    if (seleccionada) setPiezas(calcularPiezas(seleccionada, m))
  }

  function editarKg(idx, valor) {
    setPiezas(prev => prev.map((p, i) => i === idx ? { ...p, kg_editado: parseFloat(valor) || 0 } : p))
  }

  function editarPrecio(idx, valor) {
    setPiezas(prev => prev.map((p, i) => i === idx ? { ...p, precio_venta: parseFloat(valor) || 0 } : p))
  }

  async function confirmarDespostePiezas() {
    if (!seleccionada || piezas.length === 0) { showAlert('Selecciona una media res', 'error'); return }
    setLoading(true)
    try {
      const kgBase = seleccionada.kg_real || seleccionada.kg || 0
      const kgNeto = kgBase * 0.975
      const { data: desposteData, error } = await supabase.from('despostes').insert({
        fecha, entrada_id: seleccionada.id, modelo,
        tipo_desposte: 'piezas', tipo_animal: tipoAnimal,
        kg_media_res: kgBase, merma_pct: 2.5, kg_neto: kgNeto,
        piezas: piezas.map(p => ({ nombre: p.nombre, kg: p.kg_editado, precio_venta: p.precio_venta, tipo_stock: p.tipo_stock })),
        notas
      }).select().single()
      if (error) throw error
      await supabase.from('entradas_deposito').update({ despostada: true, desposte_id: desposteData.id }).eq('id', seleccionada.id)
      // Marcar la media res como despostada en medias_stock (trazabilidad individual)
      await supabase.from('medias_stock').update({
        estado: 'despostada', desposte_id: desposteData.id, fecha_salida: fecha,
      }).eq('entrada_id', seleccionada.id)
      await actualizarStock('bovino_mr', -kgBase)
      // Stock por pieza: cada pieza suma a SU bucket propio (pieza_pierna, pieza_cortito…),
      // ya no al genérico bovino_pieza. Así cada pieza tiene su stock individual.
      for (const pieza of piezas) { await actualizarStock(pieza.tipo_stock || bucketDePiezaBovina(pieza.nombre), pieza.kg_editado) }
      // Stock individual: una fila por pieza para trazabilidad completa
      const filasPiezas = piezas
        .filter(p => (p.kg_editado || 0) > 0)
        .map(p => ({
          desposte_id: desposteData.id,
          entrada_id: seleccionada.id,
          tipo_pieza: p.nombre,
          tipo_stock: p.tipo_stock || 'bovino_pieza',
          kg: p.kg_editado,
          precio_costo_kg: p.precio_costo_kg || seleccionada.precio_kg || null,
          fecha_ingreso: fecha,
          proveedor_origen: seleccionada.proveedor_nombre || null,
          descripcion_origen: (seleccionada.descripcion || 'Media Res') + ' (' + (Number(seleccionada.kg_real) || Number(seleccionada.kg) || 0).toFixed(1) + ' kg)',
          modelo_desposte: modelo,
          estado: 'disponible',
        }))
      if (filasPiezas.length > 0) {
        const { error: errPiezas } = await supabase.from('piezas_stock').insert(filasPiezas)
        if (errPiezas) console.warn('No se pudieron registrar piezas individuales:', errPiezas.message)
      }
      // Registrar cada pieza como entrada para que aparezca en el historial del Dashboard
      // Mapeo nombre de pieza -> tipo granular usado por el Dashboard
      const NOMBRE_A_TIPO = {
        'Cuarto Pistola': 'pieza_cuarto_pistola',
        'Costillar Completo': 'pieza_costillar',
        'Cortito': 'pieza_cortito',
        'Pierna': 'pieza_pierna',
        'Costeletal con Lomo': 'pieza_costeletal',
        'Parrillero': 'pieza_parrillero',
        'Paleta': 'pieza_paleta',
      }
      const filasEntradasBovino = piezas
        .filter(p => (p.kg_editado || 0) > 0)
        .map(p => ({
          fecha,
          tipo: NOMBRE_A_TIPO[p.nombre] || 'bovino_pieza',
          proveedor_nombre: seleccionada.proveedor_nombre || null,
          descripcion: `${p.nombre} de MR #${seleccionada.id} (${seleccionada.descripcion || 'Media Res'})`,
          kg: p.kg_editado,
          kg_real: p.kg_editado,
          merma_pct: 0,
          precio_kg: p.precio_costo_kg || seleccionada.precio_kg || 0,
          importe: 0,
          destino: 'desposte',
          cantidad: 1,
        }))
      if (filasEntradasBovino.length > 0) {
        const { error: errEntradasBov } = await supabase.from('entradas_deposito').insert(filasEntradasBovino)
        if (errEntradasBov) console.warn('No se pudieron registrar entradas por pieza bovina:', errEntradasBov.message)
      }
      showAlert('✅ Desposte en piezas completado — ' + piezas.length + ' piezas al stock')
      setSeleccionada(null); setPiezas([]); setNotas('')
      await cargarDatos(); onSaved()
    } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
    setLoading(false)
  }

  async function confirmarDesposteKilo() {
    if (!seleccionada) { showAlert('Selecciona una media res', 'error'); return }
    setLoading(true)
    try {
      const kgBase = seleccionada.kg_real || seleccionada.kg || 0
      const merma = MERMAS_KILO[tipoAnimal].merma
      const kgNeto = parseFloat((kgBase * (1 - merma)).toFixed(2))
      const precioCostoKg = seleccionada.precio_kg > 0 ? parseFloat((seleccionada.precio_kg / (1 - merma)).toFixed(0)) : 0
      const { data: desposteData, error } = await supabase.from('despostes').insert({
        fecha, entrada_id: seleccionada.id, modelo: 'KILO',
        tipo_desposte: 'kilo', tipo_animal: tipoAnimal,
        kg_media_res: kgBase, merma_pct: merma * 100, kg_neto: kgNeto,
        piezas: [{ nombre: 'Bovino cortes por kilo', kg: kgNeto, precio_costo_kg: precioCostoKg }],
        notas
      }).select().single()
      if (error) throw error
      await supabase.from('entradas_deposito').update({ despostada: true, desposte_id: desposteData.id }).eq('id', seleccionada.id)
      // Marcar la media res como despostada en medias_stock (trazabilidad individual)
      await supabase.from('medias_stock').update({
        estado: 'despostada', desposte_id: desposteData.id, fecha_salida: fecha,
      }).eq('entrada_id', seleccionada.id)
      await actualizarStock('bovino_mr', -kgBase)
      await actualizarStock('bovino_corte', kgNeto)
      showAlert('✅ Media res enviada a cortes — ' + kgNeto.toFixed(1) + ' kg al stock')
      setSeleccionada(null); setNotas('')
      await cargarDatos(); onSaved()
    } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
    setLoading(false)
  }
async function confirmarElaboracionEmbutido() {
  const kgCerdo = Object.values(piezasEmbutido).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  if (kgCerdo === 0) { showAlert('Ingresá al menos una pieza de cerdo', 'error'); return }
  setLoading(true)
  try {
    const kgTotal = kgCerdo + (parseNumero(kgCarneBovinaEmbutido))
    // Peso real por producto terminado (chorizo común / saborizado / salchicha).
    // Si se cargó al menos uno, ese total es el kg final y la merma sale de ahí;
    // si no, se usa el % manual y todo el lote va al tipo elegido en el select.
    const productosFinales = Object.entries(pesoRealEmb)
      .map(([tipo, v]) => ({ tipo, kg: parseNumero(v) }))
      .filter(p => p.kg > 0)
    const totalElab = productosFinales.reduce((s, p) => s + p.kg, 0)
    const usaReal = totalElab > 0
    const kgFinal = parseFloat((usaReal ? totalElab : kgTotal * (1 + pctAumentoEmbutido / 100)).toFixed(2))
    const pctFinal = kgTotal > 0 ? parseFloat(((kgFinal / kgTotal - 1) * 100).toFixed(2)) : pctAumentoEmbutido
    // A qué bucket de stock va cada kg elaborado
    const destinosStock = usaReal ? productosFinales : [{ tipo: tipoEmbutido, kg: kgFinal }]
    const piezasUsadas = Object.entries(piezasEmbutido)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([tipo, v]) => ({ tipo, kg: parseFloat(v) }))
    await supabase.from('elaboraciones_embutidos').insert({
      fecha, tipo: 'embutido', tipo_embutido: tipoEmbutido,
      piezas_usadas: piezasUsadas,
      kg_carne_cerdo: kgCerdo,
      kg_carne_bovina: parseNumero(kgCarneBovinaEmbutido),
      kg_elaborado: kgTotal, pct_aumento: pctFinal,
      // legacy: comunes/saborizados se siguen llenando para los reportes viejos
      kg_comunes: usaReal ? parseNumero(pesoRealEmb.chorizo_parrillero) : null,
      kg_saborizados: usaReal ? parseNumero(pesoRealEmb.chorizo_saborizado) : null,
      productos_finales: destinosStock,
      kg_final: kgFinal, maduracion_completa: true, notas
    })
    for (const [tipo, v] of Object.entries(piezasEmbutido)) {
      if (parseFloat(v) > 0) {
        const { error } = await actualizarStock(tipo, -parseFloat(v))
        if (error) throw new Error(`No se descontó ${tipo}: ${error.message}`)
      }
    }
    // Retazos cerdo: se descuentan del stock de Cabezas de cerdo ('cerdo_cabeza').
    if (parseNumero(kgCarneBovinaEmbutido) > 0) {
      const { error } = await actualizarStock('cerdo_cabeza', -parseNumero(kgCarneBovinaEmbutido))
      if (error) throw new Error(`No se descontó retazos cerdo (cabezas): ${error.message}`)
    }
    // Suma al stock PROPIO de cada producto terminado (mig 60) — paso
    // crítico que antes fallaba en silencio; sumarStockVerificado re-lee
    // y verifica cada bucket.
    for (const p of destinosStock) {
      await sumarStockVerificado(BUCKET_EMBUTIDO[p.tipo] || 'embutido', p.kg)
    }
    // Registrar la elaboración como entrada informativa, así aparece junto a
    // las compras en "Entradas registradas" y en el historial del Dashboard.
    // Mismo patrón que el desposte de cerdo: importe 0 y NO toca el stock
    // (eso ya se hizo arriba) — es solo trazabilidad/visibilidad.
    const kgBovinaEmb = parseNumero(kgCarneBovinaEmbutido)
    const { error: errEntrada } = await supabase.from('entradas_deposito').insert({
      fecha,
      tipo: 'embutido',
      proveedor_nombre: 'Elaboración propia',
      descripcion: `${destinosStock.map(p => `${NOMBRE_EMBUTIDO[p.tipo] || p.tipo} ${p.kg.toFixed(1)} kg`).join(' + ')} elaborado (${kgCerdo.toFixed(1)} kg cerdo${kgBovinaEmb > 0 ? ` + ${kgBovinaEmb.toFixed(1)} kg retazos` : ''})`,
      kg: kgFinal,
      kg_real: kgFinal,
      merma_pct: 0,
      precio_kg: 0,
      importe: 0,
      destino: 'elaboracion',
      cantidad: 1,
    })
    if (errEntrada) console.warn('No se pudo registrar la entrada de la elaboración:', errEntrada.message)
    showAlert(`✅ ${kgFinal.toFixed(1)} kg elaborados — ${destinosStock.map(p => `${NOMBRE_EMBUTIDO[p.tipo] || p.tipo}: ${p.kg.toFixed(1)} kg`).join(' · ')} (cada uno a su stock)`)
    setPiezasEmbutido({ cerdo_pierna: '', cerdo_paleta: '', cerdo_parrillero: '', cerdo_pechito: '', cerdo_matambre: '', cerdo_carre: '', cerdo_bondiola: '', cerdo_tocino: '' })
    setKgCarneBovinaEmbutido(''); setKgQuesoEmbutido(''); setNotas('')
    setPesoRealEmb({ chorizo_parrillero: '', chorizo_saborizado: '', chorizo_colorado: '', salchicha_parrillera: '', morcilla: '' })
    await cargarDatos(); onSaved()
  } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
  setLoading(false)
}

async function confirmarElaboracionSalame() {
    const kgCerdo = Object.values(piezasEmbutido).reduce((s, v) => s + (parseFloat(v) || 0), 0)
    if (kgCerdo === 0) { showAlert('Ingresá al menos una pieza de cerdo', 'error'); return }
    setLoading(true)
    try {
      // kg netos = suma de piezas de cerdo + bovino + queso. NO se aplica
      // ninguna merma automática: el peso final real se carga después del
      // secado (varía mucho cuánto tarda, así que no se fija una fecha).
      const kgTotal = kgCerdo + (parseNumero(kgCarneBovinaEmbutido)) + (parseNumero(kgQuesoEmbutido))
      const piezasUsadas = Object.entries(piezasEmbutido)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([tipo, v]) => ({ tipo, kg: parseFloat(v) }))
      await supabase.from('elaboraciones_embutidos').insert({
        fecha, tipo: 'salame', tipo_embutido: tipoEmbutido,
        piezas_usadas: piezasUsadas,
        kg_carne_cerdo: kgCerdo,
        kg_carne_bovina: parseNumero(kgCarneBovinaEmbutido),
        kg_queso: parseNumero(kgQuesoEmbutido),
        kg_elaborado: kgTotal, pct_aumento: 0,
        kg_final: 0, maduracion_completa: false,
        fecha_fin_maduracion: null,
        notas
      })
      for (const [tipo, v] of Object.entries(piezasEmbutido)) {
        if (parseFloat(v) > 0) {
          const { error } = await actualizarStock(tipo, -parseFloat(v))
          if (error) throw new Error(`No se descontó ${tipo}: ${error.message}`)
        }
      }
      if (parseNumero(kgCarneBovinaEmbutido) > 0) {
        const { error } = await actualizarStock('bovino_corte', -parseNumero(kgCarneBovinaEmbutido))
        if (error) throw new Error(`No se descontó bovino_corte: ${error.message}`)
      }
      showAlert(`✅ Salame registrado en secado — ${kgTotal.toFixed(1)} kg netos. Cargá el peso final cuando esté seco.`)
      setPiezasEmbutido({ cerdo_pierna: '', cerdo_paleta: '', cerdo_parrillero: '', cerdo_pechito: '', cerdo_matambre: '', cerdo_carre: '', cerdo_bondiola: '', cerdo_tocino: '' })
      setKgCarneBovinaEmbutido(''); setKgQuesoEmbutido(''); setNotas('')
      await cargarDatos(); onSaved()
    } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
    setLoading(false)
  }

  // Etapa 2 del salame: una vez seco, se pesa y se cargan los kg FINALES
  // reales. Al registrar la elaboración NO se sumó nada al stock de embutidos
  // (solo se descontaron las piezas de cerdo/bovino). Recién acá, con el peso
  // seco real en mano, se suma al stock. Ese peso queda en kg_final, la merma
  // real se calcula sola (kg_final vs kg netos) y la elaboración pasa a completa.
  async function finalizarMaduracionSalame(elab, kgFinalesStr) {
    const kgFinales = parseNumero(kgFinalesStr)
    if (!(kgFinales > 0)) { showAlert('Ingresá los kg finales pesados después del secado', 'error'); return }
    setLoading(true)
    try {
      // Sumar al bucket del tipo de salame (mig 60e) con verificación
      // (mismo patrón anti-error que la elaboración de embutidos).
      await sumarStockVerificado(BUCKET_EMBUTIDO[elab.tipo_embutido] || 'emb_salame_comun', kgFinales)
      // Marcar la elaboración como completa guardando el peso final seco.
      // pct_aumento = merma real (negativa) calculada con el peso exacto.
      const pct = elab.kg_elaborado > 0 ? parseFloat(((kgFinales / elab.kg_elaborado - 1) * 100).toFixed(2)) : 0
      const { error: errUpd } = await supabase.from('elaboraciones_embutidos')
        .update({ kg_final: kgFinales, maduracion_completa: true, pct_aumento: pct })
        .eq('id', elab.id)
      if (errUpd) throw new Error(`No se actualizó la elaboración: ${errUpd.message}`)
      // Entrada informativa para que figure junto a las compras y en el Dashboard.
      const nombreSal = NOMBRE_EMBUTIDO[elab.tipo_embutido] || 'Salame'
      const { error: errEnt } = await supabase.from('entradas_deposito').insert({
        fecha: fechaHoyARG(),
        tipo: 'embutido',
        proveedor_nombre: 'Elaboración propia',
        descripcion: `${nombreSal} seco finalizado — ${kgFinales.toFixed(1)} kg finales (de ${Number(elab.kg_elaborado || 0).toFixed(1)} kg netos · merma ${pct.toFixed(1)}%)`,
        kg: kgFinales,
        kg_real: kgFinales,
        merma_pct: 0,
        precio_kg: 0,
        importe: 0,
        destino: 'elaboracion',
        cantidad: 1,
      })
      if (errEnt) console.warn('No se registró la entrada del salame finalizado:', errEnt.message)
      showAlert(`✅ Salame seco finalizado — ${kgFinales.toFixed(1)} kg al stock de ${NOMBRE_EMBUTIDO[elab.tipo_embutido] || 'Salame Común'}`)
      await cargarDatos(); onSaved()
    } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
    setLoading(false)
  }
async function confirmarDesposteCerdo() {
  if (!caponSeleccionado) { showAlert('Seleccioná un capón', 'error'); return }
  const kgCapon = caponSeleccionado.kg_real || caponSeleccionado.kg || 0
  const piezasRegistradas = [
    { nombre: 'Piernas (x2)', kg: parseNumero(piezasCerdo.pierna), stock: 'cerdo_pierna' },
    { nombre: 'Carrés (x2)', kg: parseNumero(piezasCerdo.carre), stock: 'cerdo_carre' },
    { nombre: 'Pechitos (x2)', kg: parseNumero(piezasCerdo.pechito), stock: 'cerdo_pechito' },
    { nombre: 'Matambres (x2)', kg: parseNumero(piezasCerdo.matambre), stock: 'cerdo_matambre' },
    { nombre: 'Paletas (x2)', kg: parseNumero(piezasCerdo.paleta), stock: 'cerdo_paleta' },
    { nombre: 'Carnaza', kg: parseNumero(piezasCerdo.parrillero), stock: 'cerdo_parrillero' },
    { nombre: 'Huesos', kg: parseNumero(piezasCerdo.huesos), stock: 'cerdo_huesos' },
    { nombre: 'Bondiola s/hueso', kg: parseNumero(piezasCerdo.bondiola), stock: 'cerdo_bondiola' },
    { nombre: 'Tocino', kg: parseNumero(piezasCerdo.tocino), stock: 'cerdo_tocino' },
    { nombre: 'Cuero', kg: parseNumero(piezasCerdo.cuero), stock: 'cerdo_cuero' },
    { nombre: 'Cabeza', kg: parseNumero(piezasCerdo.cabeza), stock: 'cerdo_cabeza' },
  ].filter(p => p.kg > 0)

  // Validaciones anti-error humano (mismo patrón que media res bovina):
  //   (a) Ninguna pieza individual puede pesar más que el capón
  //   (b) Suma de piezas no debe superar el capón por más del 10%
  //   (c) Capón > 150 kg = sospechoso
  const piezaInflada = piezasRegistradas.find(p => p.kg > kgCapon)
  if (piezaInflada) {
    showAlert(`⚠️ "${piezaInflada.nombre}" tiene ${piezaInflada.kg} kg pero el capón es de ${kgCapon} kg. Una pieza no puede pesar más que el capón.`, 'error')
    return
  }
  const sumaPiezas = piezasRegistradas.reduce((s, p) => s + p.kg, 0)
  if (kgCapon > 0 && sumaPiezas > kgCapon * 1.1) {
    showAlert(`⚠️ La suma de piezas (${sumaPiezas.toFixed(1)} kg) supera al capón (${kgCapon} kg). Revisá los valores — probablemente sobra un dígito.`, 'error')
    return
  }
  // Rango real Fabricius para capones: 70-150 kg
  if (kgCapon > 160) {
    if (!confirm(`⚠️ ${kgCapon} kg es demasiado para un capón (rango real: 70-150 kg). ¿Continuar?`)) return
  }
  if (kgCapon > 0 && kgCapon < 60) {
    if (!confirm(`⚠️ ${kgCapon} kg es muy bajo para un capón (rango real: 70-150 kg). ¿Continuar?`)) return
  }

  setLoading(true)
  try {
    await supabase.from('despostes').insert({
      fecha, entrada_id: caponSeleccionado.id, modelo: 'CERDO',
      tipo_desposte: 'cerdo', tipo_animal: 'cerdo',
      kg_media_res: kgCapon, merma_pct: 0, kg_neto: kgCapon,
      piezas: piezasRegistradas.map(p => ({ nombre: p.nombre, kg: p.kg, tipo_stock: p.stock })),
      notas
    })
    await supabase.from('entradas_deposito').update({ despostada: true }).eq('id', caponSeleccionado.id)
    await actualizarStock('cerdo', -kgCapon)
    for (const pieza of piezasRegistradas) {
      await actualizarStock(pieza.stock, pieza.kg)
    }
    // Registrar cada pieza como entrada para que aparezca en el historial del Dashboard
    const filasEntradasCerdo = piezasRegistradas.map(p => ({
      fecha,
      tipo: p.stock,
      proveedor_nombre: caponSeleccionado.proveedor_nombre || null,
      descripcion: `${p.nombre} de Capón #${caponSeleccionado.id} (${caponSeleccionado.descripcion || 'Capón'})`,
      kg: p.kg,
      kg_real: p.kg,
      merma_pct: 0,
      precio_kg: 0,
      importe: 0,
      destino: 'desposte',
      cantidad: 1,
    }))
    if (filasEntradasCerdo.length > 0) {
      const { error: errEntradas } = await supabase.from('entradas_deposito').insert(filasEntradasCerdo)
      if (errEntradas) console.warn('No se pudieron registrar entradas por pieza de cerdo:', errEntradas.message)
    }
    showAlert('✅ Capón despostado — piezas al stock')
    setCaponSeleccionado(null)
    setPiezasCerdo({ pierna: '', carre: '', pechito: '', matambre: '', paleta: '', parrillero: '', bondiola: '', tocino: '', cuero: '', cabeza: '' })
    setNotas('')
    await cargarDatos(); onSaved()
  } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
  setLoading(false)
}
  async function confirmarConversionPieza() {
  if (!kgPiezaConvertir || !nombrePieza) { showAlert('Completa todos los campos', 'error'); return }
  const kg = parseFloat(kgPiezaConvertir)
  const merma = mermaPieza / 100
  const kgNeto = parseFloat((kg * (1 - merma)).toFixed(2))
  // COSTO REAL: el costo bruto de la pieza (kg × precio/kg) se reparte sobre los
  // kg NETOS (con merma), así el corte resultante refleja su costo real por kg.
  // Ej: 39,8 kg × $10.500 = $417.900 ÷ 29,05 kg (con merma) = $14.385/kg.
  const costoBasePieza = parseFloat(precioCostoPieza) || piezaIndividualSeleccionada?.precio_costo_kg || 0
  const costoRealKg = (kgNeto > 0 && costoBasePieza > 0)
    ? parseFloat(((kg * costoBasePieza) / kgNeto).toFixed(2))
    : costoBasePieza

  const PIEZA_A_STOCK = {
    '🦵 Pierna con hueso': 'pieza_pierna',
    '🥩 Cuarto pistola': 'pieza_cuarto_pistola',
    '🍖 Costillar completo': 'pieza_costillar',
    '🥩 Cortito': 'pieza_cortito',
    '🥩 Costeletal con Lomo': 'pieza_costeletal',
    '🥩 Paleta entera': 'pieza_paleta',
    '🥩 Parrillero': 'pieza_parrillero',
    '📦 Caja CB': 'caja_cb',
    '📦 Caja PT': 'caja_pt',
  }
  // Preferir el bucket real de la pieza individual seleccionada (ya específico);
  // si la conversión es por nombre suelto, mapear por nombre.
  const tipoStock = piezaIndividualSeleccionada?.tipo_stock || PIEZA_A_STOCK[nombrePieza] || 'bovino_pieza'

  setLoading(true)
  try {
    await supabase.from('despostes').insert({
      fecha, entrada_id: piezaIndividualSeleccionada?.entrada_id || null, modelo: 'PIEZA_KILO',
      tipo_desposte: 'pieza_kilo', tipo_animal: tipoAnimalPieza,
      kg_media_res: kg, merma_pct: merma * 100, kg_neto: kgNeto,
      piezas: [{ nombre: nombrePieza, kg: kgNeto, precio_costo_kg: costoRealKg, pieza_origen_id: piezaIndividualSeleccionada?.id || null }],
      notas
    })
    await actualizarStock(tipoStock, -kg)
    await actualizarStock('bovino_corte', kgNeto)
    // Registrar la conversión en salidas_deposito para que aparezca en el historial del Dashboard
    const descripcionSalida = piezaIndividualSeleccionada
      ? `${piezaIndividualSeleccionada.tipo_pieza} #${piezaIndividualSeleccionada.id} (${piezaIndividualSeleccionada.proveedor_origen || 's/proveedor'}) → Bovino Cortes — ${kgNeto.toFixed(2)} kg netos (merma ${(merma * 100).toFixed(1)}%)`
      : `${nombrePieza} → Bovino Cortes — ${kgNeto.toFixed(2)} kg netos (merma ${(merma * 100).toFixed(1)}%)`
    const { error: errSalida } = await supabase.from('salidas_deposito').insert({
      fecha,
      cliente_nombre: 'CONVERSIÓN A CORTES',
      tipo: tipoStock,
      descripcion: descripcionSalida,
      kg,
      precio_kg: costoRealKg,
      total: parseFloat((kg * costoBasePieza).toFixed(2)),
      lista: 'desposte',
      cobro: 'interno',
      notas: 'Conversión de pieza a cortes por kilo'
    })
    if (errSalida) console.warn('No se pudo registrar salida por conversión:', errSalida.message)
    // Si la conversión vino desde una pieza individual seleccionada del stock, la marcamos como convertida
    if (piezaIndividualSeleccionada?.id) {
      const { error: errMark } = await supabase.from('piezas_stock').update({
        estado: 'convertida_cortes',
        destino: 'cortes',
        fecha_salida: fecha,
        notas_salida: 'Convertida a cortes (' + kgNeto.toFixed(1) + ' kg netos, merma ' + (merma * 100).toFixed(1) + '%)',
      }).eq('id', piezaIndividualSeleccionada.id)
      if (errMark) console.warn('No se pudo marcar la pieza individual como convertida:', errMark.message)
    }
    showAlert('✅ ' + nombrePieza + ' convertida — ' + kgNeto.toFixed(1) + ' kg al stock')
    setKgPiezaConvertir(''); setNombrePieza(''); setPrecioCostoPieza(''); setNotas('')
    setPiezaIndividualSeleccionada(null)
    await cargarDatos(); onSaved()
  } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
  setLoading(false)
}
  const kgBase = seleccionada ? (seleccionada.kg_real || seleccionada.kg || 0) : 0
  const kgNetoPiezas = kgBase * 0.975
  const kgTotalPiezas = piezas.reduce((s, p) => s + (p.kg_editado || 0), 0)
  // Merma de desposte REAL = lo que sobra del kg neto después de pesar todas las piezas
  // (huesos, recortes, sangre, pérdidas de corte). Antes se llamaba "Diferencia".
  const mermaDesposteKg = kgNetoPiezas - kgTotalPiezas
  const mermaDesposteRealPct = kgNetoPiezas > 0 ? (mermaDesposteKg / kgNetoPiezas) * 100 : 0
  const mermaDesposteSugeridaPct = (MODELOS_DESPOSTE[modelo]?.merma_desposte_pct || 0) * 100
  // Alias para no romper referencias previas
  const diferencia = mermaDesposteKg
  const mermaKilo = MERMAS_KILO[tipoAnimal]
  const kgNetoKilo = kgBase * (1 - mermaKilo.merma)
  const precioCostoKilo = seleccionada?.precio_kg > 0 ? (seleccionada.precio_kg / (1 - mermaKilo.merma)).toFixed(0) : 0
 const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, boxSizing: 'border-box' }

  return (
    <div>
      {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[{ id: 'piezas', label: '🍖 Desposte en Piezas' }, { id: 'kilo', label: '⚖️ Desposte para venta por Kilo' }, { id: 'pieza_kilo', label: '🔄 Convertir Pieza a Cortes' }, { id: 'cerdo', label: '🐷 Desposte Cerdo' },
{ id: 'embutidos', label: '🌭 Elaborar Embutidos' }, { id: 'medias_hist', label: '🐄 Historial Medias' }, { id: 'historial', label: '📋 Historial Desposte' }].map(t => (
          <button key={t.id} onClick={() => { setSubtab(t.id); setSeleccionada(null); setPiezas([]); cargarDatos() }}
            style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${subtab === t.id ? 'var(--gold)' : 'var(--border)'}`, background: subtab === t.id ? 'var(--gold)' : 'transparent', color: subtab === t.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      {subtab === 'piezas' && (
        <div style={{ display: 'grid', gridTemplateColumns: seleccionada ? '1fr 1.5fr' : '1fr', gap: 16 }}>
          <div>
            <div className="card">
              <div className="card-title">🐄 Medias Reses disponibles</div>
              <AvisoDuplicadas cantidad={idsConPosibleDuplicado(mediasRes).size} />
              {mediasRes.length === 0 ? <div className="empty">Sin medias reses para despostar</div> : (() => { const dupIds = idsConPosibleDuplicado(mediasRes); return mediasRes.map(e => (
                <div key={e.id} onClick={() => seleccionarMedia(e)}
                  style={{ padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: `2px solid ${seleccionada?.id === e.id ? 'var(--gold)' : (dupIds.has(e.id) ? '#ffb86b' : 'var(--border)')}`, background: seleccionada?.id === e.id ? 'rgba(201,168,76,0.08)' : 'var(--surface2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {e.codigo_media && <span style={{ background: 'var(--gold)', color: '#000', padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>{e.codigo_media}</span>}
                        🐄 {e.descripcion || 'Media Res'}
                        {dupIds.has(e.id) && <TagDuplicada />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
                      {e.precio_kg > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{fmtPrecio(e.precio_kg)}/kg</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{fmtKg(e.kg_real || e.kg || 0, { decimales: 2 })}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Neto: {fmtKg((e.kg_real || e.kg || 0) * 0.975, { decimales: 2 })}</div>
                    </div>
                  </div>
                </div>
              )) })()}
            </div>
          </div>
          {seleccionada && (
            <div className="card" style={{ borderColor: 'var(--gold)' }}>
              <div className="card-title">🔪 Despostar en piezas: {seleccionada.descripcion || 'Media Res'}</div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg entrada</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{fmtKg(kgBase, { decimales: 2 })}</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>Merma 2.5%</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--red-light)' }}>-{fmtKg(kgBase * 0.025, { decimales: 2 })}</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg neto</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--green)' }}>{fmtKg(kgNetoPiezas, { decimales: 2 })}</div></div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
                <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Modelo</label>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {Object.entries(MODELOS_DESPOSTE).map(([id, m]) => (
                    <button key={id} onClick={() => cambiarModelo(id)}
                      style={{ flex: '1 1 200px', padding: '10px 14px', borderRadius: 10, border: `2px solid ${modelo === id ? 'var(--gold)' : 'var(--border)'}`, background: modelo === id ? 'rgba(201,168,76,0.1)' : 'var(--surface2)', color: modelo === id ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12, textAlign: 'left' }}>
                      <div style={{ fontSize: 15, marginBottom: 3 }}>{m.icono || id} Modelo {id}</div>
                      <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4 }}>{m.nombre || m.piezas.map(p => p.nombre).join(' + ')}</div>
                      <div style={{ fontSize: 10, opacity: 0.7 }}>Merma desposte sug.: {(m.merma_desposte_pct * 100).toFixed(0)}%</div>
                    </button>
                  ))}
                </div>
              </div>
              <table style={{ marginBottom: 14 }}>
                <thead><tr><th>Pieza</th><th>% sug.</th><th>Kg sugerido</th><th>Kg real</th><th>% real</th><th style={{ color: 'var(--gold)' }}>Precio/kg</th><th style={{ color: 'var(--green)' }}>Valor</th></tr></thead>
                <tbody>
                  {piezas.map((p, i) => {
                    const pctReal = kgNetoPiezas > 0 ? ((p.kg_editado || 0) / kgNetoPiezas) * 100 : 0
                    return (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{(MODELOS_DESPOSTE[modelo].piezas[i]?.pct * 100).toFixed(1)}%</td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{fmtKg(p.kg, { decimales: 2 })}</td>
                      <td><input type="number" step="0.1" value={p.kg_editado} onChange={e => editarKg(i, e.target.value)} style={{ ...inp, width: 75, borderColor: Math.abs(p.kg_editado - p.kg) > 2 ? 'var(--amber)' : 'var(--border)' }} /></td>
                      <td style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 600 }}>{pctReal.toFixed(1)}%</td>
                      <td><input type="number" value={p.precio_venta} onChange={e => editarPrecio(i, e.target.value)} style={{ ...inp, width: 100, borderColor: 'var(--gold)' }} /></td>
                      <td style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>{fmtPrecio((p.kg_editado || 0) * (p.precio_venta || 0))}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg en piezas</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{fmtKg(kgTotalPiezas, { decimales: 2 })}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    Merma desposte <span style={{ opacity: 0.7 }}>(sug. {mermaDesposteSugeridaPct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: Math.abs(mermaDesposteRealPct - mermaDesposteSugeridaPct) > 3 ? 'var(--red-light)' : (Math.abs(mermaDesposteRealPct - mermaDesposteSugeridaPct) > 1.5 ? 'var(--amber)' : 'var(--green)') }}>
                    {fmtKg(mermaDesposteKg, { decimales: 2 })} · {mermaDesposteRealPct.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>Valor total</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--green)' }}>{fmtPrecio(piezas.reduce((s, p) => s + (p.kg_editado || 0) * (p.precio_venta || 0), 0))}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => { setSeleccionada(null); setPiezas([]) }}>Cancelar</button>
                <button className="btn btn-gold" onClick={confirmarDespostePiezas} disabled={loading}>{loading ? '⏳ Procesando...' : '🔪 Confirmar desposte en piezas'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {subtab === 'kilo' && (
        <div style={{ display: 'grid', gridTemplateColumns: seleccionada ? '1fr 1.2fr' : '1fr', gap: 16 }}>
          <div>
            <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#7db5ff', marginBottom: 6 }}>⚖️ Desposte para venta por kilo</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>La media res se desarma completa. Los kg netos van al stock de <strong style={{ color: 'var(--gold)' }}>Bovino Cortes</strong>.</div>
            </div>
            <div className="card">
              <div className="card-title">🐄 Seleccioná una media res</div>
              <AvisoDuplicadas cantidad={idsConPosibleDuplicado(mediasRes).size} />
              {mediasRes.length === 0 ? <div className="empty">Sin medias reses disponibles</div> : (() => { const dupIds = idsConPosibleDuplicado(mediasRes); return mediasRes.map(e => (
                <div key={e.id} onClick={() => setSeleccionada(e)}
                  style={{ padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: `2px solid ${seleccionada?.id === e.id ? 'var(--blue)' : (dupIds.has(e.id) ? '#ffb86b' : 'var(--border)')}`, background: seleccionada?.id === e.id ? 'rgba(41,128,185,0.08)' : 'var(--surface2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {e.codigo_media && <span style={{ background: 'var(--blue)', color: '#fff', padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>{e.codigo_media}</span>}
                        🐄 {e.descripcion || 'Media Res'}
                        {dupIds.has(e.id) && <TagDuplicada />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
                      {e.precio_kg > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>Costo: {fmtPrecio(e.precio_kg)}/kg</div>}
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--blue)' }}>{fmtKg(e.kg_real || e.kg || 0, { decimales: 2 })}</div>
                  </div>
                </div>
              )) })()}
            </div>
          </div>
          {seleccionada && (
            <div className="card" style={{ borderColor: 'var(--blue)' }}>
              <div className="card-title">⚖️ Configurar desposte por kilo</div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Tipo de animal</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {Object.entries(MERMAS_KILO).map(([id, m]) => (
                    <button key={id} onClick={() => setTipoAnimal(id)}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${tipoAnimal === id ? m.color : 'var(--border)'}`, background: tipoAnimal === id ? m.color + '22' : 'var(--surface2)', color: tipoAnimal === id ? m.color : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
                      <div>{m.label}</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>Merma: {(m.merma * 100).toFixed(0)}%</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Kg entrada</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24 }}>{fmtKg(kgBase, { decimales: 2 })}</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Merma {(mermaKilo.merma * 100).toFixed(0)}%</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--red-light)' }}>-{fmtKg(kgBase * mermaKilo.merma, { decimales: 2 })}</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Kg vendibles</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--green)' }}>{fmtKg(kgNetoKilo, { decimales: 2 })}</div></div>
                </div>
                {seleccionada.precio_kg > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Costo compra: <strong style={{ color: 'var(--text)' }}>{fmtPrecio(seleccionada.precio_kg)}/kg</strong></div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Costo real: <span style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{fmtPrecio(precioCostoKilo)}/kg</span></div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>ℹ️ El costo real sube porque el mismo precio pagado rinde menos kg útiles.</div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
                <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setSeleccionada(null)}>Cancelar</button>
                <button className="btn btn-gold" onClick={confirmarDesposteKilo} disabled={loading}>{loading ? '⏳ Procesando...' : `⚖️ Confirmar — ${fmtKg(kgNetoKilo, { decimales: 2 })} a Bovino Cortes`}</button>
              </div>
            </div>
          )}
        </div>
      )}

     {subtab === 'pieza_kilo' && (
  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16 }}>
    <div>
      <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#7db5ff', marginBottom: 6 }}>🔄 Convertir Pieza a Cortes</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Seleccioná una pieza individual del stock. Al confirmar, esa pieza específica pasa a <strong style={{ color: 'var(--gold)' }}>Bovino Cortes</strong> y queda registrada como "convertida" en el historial.</div>
      </div>
      <div className="card">
        <div className="card-title">📦 Piezas disponibles ({piezasIndividuales.filter(pz => pz.estado === 'disponible').length})</div>
        {(() => {
          const disponibles = piezasIndividuales.filter(pz => pz.estado === 'disponible')
          if (disponibles.length === 0) return <div className="empty">No hay piezas individuales en stock. Despostá una media res para generar piezas.</div>
          const porTipo = {}
          disponibles.forEach(pz => { (porTipo[pz.tipo_pieza] = porTipo[pz.tipo_pieza] || []).push(pz) })
          return Object.entries(porTipo).map(([tipo, lista]) => (
            <div key={tipo} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingBottom: 4, borderBottom: '1px dashed var(--border)' }}>
                {tipo} <span style={{ color: 'var(--gold)' }}>· {lista.length} {lista.length === 1 ? 'pieza' : 'piezas'} · {fmtKg(lista.reduce((s, x) => s + (x.kg || 0), 0), { decimales: 2 })} total</span>
              </div>
              {lista.map(pz => {
                const sel = piezaIndividualSeleccionada?.id === pz.id
                return (
                  <div key={pz.id}
                    onClick={() => {
                      setPiezaIndividualSeleccionada(pz)
                      setNombrePieza(pz.tipo_pieza)
                      setTipoPiezaSeleccionada(pz.tipo_stock || 'bovino_pieza')
                      setKgPiezaConvertir(String(pz.kg))
                      setPrecioCostoPieza(pz.precio_costo_kg ? String(pz.precio_costo_kg) : '')
                    }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: sel ? 'rgba(201,168,76,0.12)' : 'var(--surface2)', border: sel ? '2px solid var(--gold)' : '1px solid var(--border)', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>#{pz.id} · {pz.tipo_pieza}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {pz.proveedor_origen || '—'} · MR del {pz.fecha_ingreso}
                        {pz.modelo_desposte && <span> · Mod. {pz.modelo_desposte}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{fmtKg(pz.kg || 0, { decimales: 2 })}</div>
                      {pz.precio_costo_kg > 0 && <div style={{ fontSize: 10, color: 'var(--amber)' }}>{fmtPrecio(pz.precio_costo_kg)}/kg costo</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        })()}
      </div>
    </div>
    <div className="card">
      <div className="card-title">🔄 Convertir pieza a cortes</div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Pieza seleccionada</label>
        <input value={nombrePieza} onChange={e => setNombrePieza(e.target.value)} placeholder="Clickeá una pieza del stock o escribí..." style={{ ...inp, borderColor: nombrePieza ? 'var(--gold)' : 'var(--border)' }} />
      </div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Kg a convertir</label>
        <input type="number" step="0.1" value={kgPiezaConvertir} onChange={e => setKgPiezaConvertir(e.target.value)} placeholder="0" style={{ ...inp, borderColor: 'var(--gold)' }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>% de merma de la pieza</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="number" step="0.5" min="0" max="50" value={mermaPieza} onChange={e => setMermaPieza(parseFloat(e.target.value) || 0)}
            style={{ ...inp, width: 80, borderColor: 'var(--gold)', textAlign: 'center', fontSize: 18, fontWeight: 700 }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>% — editable según la pieza</span>
        </div>
      </div>
      {kgPiezaConvertir > 0 && (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
            <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg pieza</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{fmtKg(parseFloat(kgPiezaConvertir), { decimales: 2 })}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Merma {mermaPieza}%</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--red-light)' }}>-{fmtKg(parseFloat(kgPiezaConvertir) * mermaPieza / 100, { decimales: 2 })}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg a cortes</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--green)' }}>{fmtKg(parseFloat(kgPiezaConvertir) * (1 - mermaPieza / 100), { decimales: 2 })}</div></div>
          </div>
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Precio costo/kg de la pieza</label>
        <input type="number" value={precioCostoPieza} onChange={e => setPrecioCostoPieza(e.target.value)} placeholder="Ej: 10500" style={inp} />
        {(() => {
          const base = parseFloat(precioCostoPieza) || 0
          const kgN = parseFloat(kgPiezaConvertir) * (1 - mermaPieza / 100)
          const costoReal = (base > 0 && kgN > 0) ? (parseFloat(kgPiezaConvertir) * base) / kgN : 0
          if (!(costoReal > 0)) return null
          const bruto = parseFloat(kgPiezaConvertir) * base
          return (
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(201,168,76,0.1)', border: '1px solid var(--amber)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>💰 Costo real <span style={{ fontSize: 10 }}>(bruto ÷ kg con merma)</span></span>
                <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive" }}>{fmtPrecio(costoReal)}/kg</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                {fmtKg(parseFloat(kgPiezaConvertir), { decimales: 2 })} × {fmtPrecio(base)} = {fmtPrecio(bruto)} ÷ {fmtKg(kgN, { decimales: 2 })} kg
              </div>
            </div>
          )
        })()}
      </div>
      <div className="form-group" style={{ marginBottom: 14 }}>
        <label>Fecha</label>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} />
      </div>
      <button className="btn btn-gold" onClick={confirmarConversionPieza} disabled={loading || !kgPiezaConvertir || !nombrePieza} style={{ width: '100%' }}>
        {loading ? '⏳ Procesando...' : '🔄 Confirmar conversión a cortes'}
      </button>
    </div>
  </div>
)}
{subtab === 'cerdo' && (
  <div style={{ display: 'grid', gridTemplateColumns: caponSeleccionado ? '1fr 1.5fr' : '1fr', gap: 16 }}>
  <div>
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
      <div className="card-title">🐷 Stock piezas de cerdo</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { tipo: 'cerdo_pierna', label: '🦵 Piernas' },
          { tipo: 'cerdo_carre', label: '🥩 Carrés' },
          { tipo: 'cerdo_pechito', label: '🍖 Pechitos' },
          { tipo: 'cerdo_matambre', label: '🥩 Matambres' },
          { tipo: 'cerdo_paleta', label: '🥩 Paletas' },
          { tipo: 'cerdo_parrillero', label: '🥩 Carnaza' },
          { tipo: 'cerdo_huesos', label: '🦴 Huesos' },
          { tipo: 'cerdo_bondiola', label: '🥩 Bondiola' },
          { tipo: 'cerdo_tocino', label: '🧀 Tocino' },
          { tipo: 'cerdo_cuero', label: '🟫 Cuero' },
          { tipo: 'cerdo_cabeza', label: '💀 Cabeza' },
        ].map(p => (
          <div key={p.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: (piezasStock[p.tipo] || 0) > 0 ? 'var(--amber)' : 'var(--muted)' }}>
              {fmtKg(piezasStock[p.tipo] || 0, { decimales: 2 })}
            </span>
          </div>
        ))}
      </div>
    </div>
    <div className="card">
      <div className="card-title">🐷 Capones disponibles</div>
      {caponesDisponibles.length === 0 ? <div className="empty">Sin capones para despostar</div> : caponesDisponibles.map(e => (
        <div key={e.id} onClick={() => setCaponSeleccionado(e)}
          style={{ padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: `2px solid ${caponSeleccionado?.id === e.id ? 'var(--amber)' : 'var(--border)'}`, background: caponSeleccionado?.id === e.id ? 'rgba(201,130,60,0.08)' : 'var(--surface2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>🐷 {e.descripcion || 'Capón'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
              {e.precio_kg > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{fmtPrecio(e.precio_kg)}/kg</div>}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--amber)' }}>{(Number(e.kg_real) || Number(e.kg) || 0).toFixed(1)} kg</div>
          </div>
        </div>
      ))}
    </div>
  </div>
    {caponSeleccionado && (
      <div className="card" style={{ borderColor: 'var(--amber)' }}>
        <div className="card-title">🔪 Despostar capón: {caponSeleccionado.descripcion || 'Capón'} — {(Number(caponSeleccionado.kg_real) || Number(caponSeleccionado.kg) || 0).toFixed(1)} kg</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Ingresá los kg de cada pieza. Los valores son editables.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { id: 'pierna', label: '🦵 Piernas (x2)', stock: 'cerdo_pierna' },
            { id: 'carre', label: '🥩 Carrés (x2)', stock: 'cerdo_carre' },
            { id: 'pechito', label: '🍖 Pechitos (x2)', stock: 'cerdo_pechito' },
            { id: 'matambre', label: '🥩 Matambres (x2)', stock: 'cerdo_matambre' },
            { id: 'paleta', label: '🥩 Paletas (x2)', stock: 'cerdo_paleta' },
            { id: 'parrillero', label: '🥩 Carnaza', stock: 'cerdo_parrillero' },
{ id: 'huesos', label: '🦴 Huesos', stock: 'cerdo_huesos' },
            { id: 'bondiola', label: '🥩 Bondiola s/hueso', stock: 'cerdo_bondiola' },
            { id: 'tocino', label: '🧀 Tocino', stock: 'cerdo_tocino' },
            { id: 'cuero', label: '🟫 Cuero', stock: 'cerdo_cuero' },
            { id: 'cabeza', label: '💀 Cabeza', stock: 'cerdo_cabeza' },
          ].map(p => (
            <div key={p.id}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{p.label}</label>
              <input type="number" step="0.1" placeholder="0" value={piezasCerdo[p.id]} onChange={e => setPiezasCerdo(prev => ({ ...prev, [p.id]: e.target.value }))}
                style={{ ...inp, borderColor: piezasCerdo[p.id] ? 'var(--amber)' : 'var(--border)' }} />
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Kg capón:</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{(Number(caponSeleccionado.kg_real) || Number(caponSeleccionado.kg) || 0).toFixed(1)} kg</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Kg registrados:</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--amber)' }}>
              {Object.values(piezasCerdo).reduce((s, v) => s + (parseFloat(v) || 0), 0).toFixed(1)} kg
            </span>
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
          <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setCaponSeleccionado(null)}>Cancelar</button>
          <button className="btn btn-gold" onClick={confirmarDesposteCerdo} disabled={loading} style={{ background: 'var(--amber)' }}>
            {loading ? '⏳ Procesando...' : '🔪 Confirmar desposte de cerdo'}
          </button>
        </div>
      </div>
    )}
  </div>
)}
{subtab === 'embutidos' && (
  <>
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 16 }}>
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🌭 Tipo de elaboración</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[{ id: 'embutido', label: '🌭 Embutidos frescos' }, { id: 'salame', label: '🥩 Salames' }].map(t => (
            <button key={t.id} onClick={() => setTipoElaboracion(t.id)}
              style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${tipoElaboracion === t.id ? 'var(--gold)' : 'var(--border)'}`, background: tipoElaboracion === t.id ? 'rgba(201,168,76,0.1)' : 'var(--surface2)', color: tipoElaboracion === t.id ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
              {t.label}
            </button>
          ))}
        </div>
        {tipoElaboracion === 'embutido' && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Tipo de embutido</label>
            <select value={tipoEmbutido} onChange={e => setTipoEmbutido(e.target.value)} style={{ ...inp, marginBottom: 10 }}>
              <option value="chorizo_parrillero">🌭 Chorizo Parrillero</option>
              <option value="chorizo_saborizado">🌭 Chorizo Saborizado</option>
              <option value="chorizo_colorado">🌶️ Chorizo Colorado</option>
              <option value="salchicha_parrillera">🌭 Salchicha Parrillera</option>
              <option value="morcilla">🖤 Morcilla</option>
            </select>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>% de merma (−) o aumento (+)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <input type="number" step="0.5" min="-50" max="30" value={pctAumentoEmbutido} onChange={e => setPctAumentoEmbutido(parseFloat(e.target.value) || 0)}
                style={{ ...inp, width: 90, borderColor: 'var(--gold)', textAlign: 'center', fontSize: 18, fontWeight: 700 }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>% — <strong style={{ color: '#ff8b8b' }}>negativo = merma</strong> · positivo = agregados (vino, tripas, especias)</span>
            </div>
          </div>
        )}
        {tipoElaboracion === 'salame' && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Tipo de salame</label>
            <select value={tipoEmbutido} onChange={e => setTipoEmbutido(e.target.value)} style={{ ...inp, marginBottom: 10 }}>
              <option value="salame_comun">🥩 Salame Común</option>
              <option value="salame_rockeford">🥩 Salame Rockeford</option>
              <option value="salame_holanda">🥩 Salame Holanda (con queso)</option>
            </select>
            <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7db5ff' }}>
              ℹ️ Registrás los <strong>kg netos</strong> que entran al secado (descuentan de cada pieza). <strong>No se aplica ninguna merma automática.</strong> El salame queda "🔒 en proceso de secado" y NO suma al stock de embutidos hasta que, una vez seco, lo peses y cargues los <strong>kg finales</strong> reales desde el historial.
            </div>
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-title">📦 Stock piezas de cerdo disponibles</div>
        {[
          { tipo: 'cerdo_pierna', label: '🦵 Piernas' },
          { tipo: 'cerdo_paleta', label: '🥩 Paletas' },
          { tipo: 'cerdo_parrillero', label: '🥩 Carnaza' },
          { tipo: 'cerdo_pechito', label: '🍖 Pechitos' },
          { tipo: 'cerdo_matambre', label: '🥩 Matambres' },
          { tipo: 'cerdo_carre', label: '🥩 Carrés' },
          { tipo: 'cerdo_bondiola', label: '🥩 Bondiola' },
          { tipo: 'cerdo_tocino', label: '🧀 Tocino' },
        ].map(p => (
          <div key={p.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: (piezasStock[p.tipo] || 0) > 0 ? 'var(--amber)' : 'var(--muted)' }}>
              {fmtKg(piezasStock[p.tipo] || 0, { decimales: 2 })}
            </span>
          </div>
        ))}
      </div>
      {/* Stock de embutidos por producto (mig 60): cada elaborado tiene su
          bucket propio; 'embutido' queda para comprados/sin clasificar */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">🌭 Stock embutidos por producto</div>
        {Object.entries(LABEL_BUCKET_EMB).map(([tipo, label]) => (
          <div key={tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: (piezasStock[tipo] || 0) > 0 ? 'var(--green)' : 'var(--muted)' }}>
              {fmtKg(piezasStock[tipo] || 0, { decimales: 2 })}
            </span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 2px' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--gold)' }}>TOTAL EMBUTIDOS</span>
          <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>
            {fmtKg(Object.keys(LABEL_BUCKET_EMB).reduce((s, t) => s + (piezasStock[t] || 0), 0), { decimales: 2 })}
          </span>
        </div>
      </div>
    </div>
    <div className="card">
      <div className="card-title">🌭 {tipoElaboracion === 'embutido' ? 'Elaborar embutidos' : 'Elaborar salames'}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Ingresá los kg de cada pieza que vas a usar.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        {[
          { id: 'cerdo_pierna', label: '🦵 Piernas' },
          { id: 'cerdo_paleta', label: '🥩 Paletas' },
          { id: 'cerdo_parrillero', label: '🥩 Carnaza' },
          { id: 'cerdo_pechito', label: '🍖 Pechitos' },
          { id: 'cerdo_matambre', label: '🥩 Matambres' },
          { id: 'cerdo_carre', label: '🥩 Carrés' },
          { id: 'cerdo_bondiola', label: '🥩 Bondiola' },
          { id: 'cerdo_tocino', label: '🧀 Tocino' },
        ].map(p => (
          <div key={p.id}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{p.label}</label>
            <input type="number" step="0.1" placeholder="0" value={piezasEmbutido[p.id]} onChange={e => setPiezasEmbutido(prev => ({ ...prev, [p.id]: e.target.value }))}
              style={{ ...inp, borderColor: piezasEmbutido[p.id] ? 'var(--gold)' : 'var(--border)' }} />
          </div>
        ))}
      </div>
      <div className="form-group" style={{ marginBottom: 10 }}>
        <label>{tipoElaboracion === 'embutido' ? '🐷 Retazos cerdo (kg) — se descuentan de Cabezas de cerdo' : '🥩 Carne bovina (kg)'}</label>
        <input type="number" step="0.1" placeholder="0" value={kgCarneBovinaEmbutido} onChange={e => setKgCarneBovinaEmbutido(e.target.value)} style={{ ...inp, borderColor: 'var(--gold)' }} />
      </div>

      {tipoElaboracion === 'embutido' && (() => {
        const kgCerdoB = Object.values(piezasEmbutido).reduce((s, v) => s + (parseFloat(v) || 0), 0)
        const kgTotB = kgCerdoB + parseNumero(kgCarneBovinaEmbutido)
        const totalElab = Object.values(pesoRealEmb).reduce((s, v) => s + parseNumero(v), 0)
        const mermaCalc = (kgTotB > 0 && totalElab > 0) ? ((totalElab / kgTotB - 1) * 100) : null
        return (
          <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#7db5ff', marginBottom: 4 }}>🌭 Peso real embutido (productos terminados)</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>Una misma elaboración puede producir varios: cargá los kg de cada uno y cada producto suma a su propio stock.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              {[
                { id: 'chorizo_parrillero', label: '🌭 Chorizo Parrillero (kg)' },
                { id: 'chorizo_saborizado', label: '🌭 Chorizo Saborizado (kg)' },
                { id: 'chorizo_colorado', label: '🌶️ Chorizo Colorado (kg)' },
                { id: 'salchicha_parrillera', label: '🌭 Salchicha Parrillera (kg)' },
                { id: 'morcilla', label: '🖤 Morcilla (kg)' },
              ].map(p => (
                <div key={p.id}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{p.label}</label>
                  <input type="number" step="0.1" placeholder="0" value={pesoRealEmb[p.id]} onChange={e => setPesoRealEmb(prev => ({ ...prev, [p.id]: e.target.value }))} style={{ ...inp, borderColor: pesoRealEmb[p.id] ? 'var(--gold)' : 'var(--border)' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total elaborado</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--gold)' }}>{totalElab.toFixed(1)} kg</div>
              </div>
              {mermaCalc !== null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Merma calculada</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: mermaCalc < 0 ? 'var(--red-light)' : 'var(--green)' }}>{mermaCalc >= 0 ? '+' : ''}{mermaCalc.toFixed(1)}%</div>
                </div>
              )}
            </div>
            {totalElab > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>Al cargar el peso real, la merma se calcula sola y reemplaza al % de arriba. Si no cargás nada, todo el lote va al stock del tipo elegido arriba.</div>}
          </div>
        )
      })()}
      {tipoElaboracion === 'salame' && tipoEmbutido === 'salame_holanda' && (
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label>🧀 Queso Holanda (kg)</label>
          <input type="number" step="0.1" placeholder="0" value={kgQuesoEmbutido} onChange={e => setKgQuesoEmbutido(e.target.value)} style={{ ...inp, borderColor: 'var(--amber)' }} />
        </div>
      )}
      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        {(() => {
          const kgCerdo = Object.values(piezasEmbutido).reduce((s, v) => s + (parseFloat(v) || 0), 0)
          const kgBovino = parseNumero(kgCarneBovinaEmbutido)
          const kgQueso = parseNumero(kgQuesoEmbutido)
          const kgTotal = kgCerdo + kgBovino + kgQueso
          // SALAME: sin merma automática. Solo se muestra el peso neto que entra
          // al secado; el peso final real se carga después desde el historial.
          if (tipoElaboracion === 'salame') {
            return (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Kg netos que entran al secado</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 30, color: 'var(--gold)' }}>{kgTotal.toFixed(1)} kg</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>🔒 No suma al stock todavía. El peso final se carga seco, sin merma automática.</div>
              </div>
            )
          }
          // EMBUTIDO: si se cargó el peso real (comunes + saborizados), ese es el
          // final y la merma sale de ahí; si no, se usa el % manual.
          const totalElabBox = Object.values(pesoRealEmb).reduce((s, v) => s + parseNumero(v), 0)
          const usaReal = totalElabBox > 0
          const kgFinal = usaReal ? totalElabBox : kgTotal * (1 + pctAumentoEmbutido / 100)
          const pctMostrar = kgTotal > 0 ? ((kgFinal / kgTotal - 1) * 100) : 0
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
              <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg carne total</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{kgTotal.toFixed(1)} kg</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{`${pctMostrar >= 0 ? '+' : ''}${pctMostrar.toFixed(1)}% ${usaReal ? '(real)' : pctMostrar >= 0 ? 'agregados' : 'merma'}`}</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: (kgFinal - kgTotal) >= 0 ? 'var(--green)' : 'var(--red-light)' }}>{(kgFinal - kgTotal) >= 0 ? '+' : ''}{(kgFinal - kgTotal).toFixed(1)} kg</div></div>
              <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg finales</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{kgFinal.toFixed(1)} kg</div></div>
            </div>
          )
        })()}
      </div>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
        <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
      </div>
      <button className="btn btn-gold" onClick={tipoElaboracion === 'embutido' ? confirmarElaboracionEmbutido : confirmarElaboracionSalame} disabled={loading} style={{ width: '100%' }}>
        {loading ? '⏳ Procesando...' : tipoElaboracion === 'embutido' ? '🌭 Confirmar elaboración de embutidos' : '🥩 Registrar salame en secado'}
      </button>
    </div>
  </div>
  <div style={{ marginTop: 16 }}>
    <HistorialElaboraciones elaboraciones={elaboraciones} onFinalizarSalame={finalizarMaduracionSalame} loading={loading} />
  </div>
  </>
)}

{subtab === 'medias_hist' && (
  <HistorialMedias medias={mediasStockAll} />
)}

{subtab === 'historial' && (
  <div>
    <HistorialDespostes despostes={despostes} />
    <HistorialElaboraciones elaboraciones={elaboraciones} onFinalizarSalame={finalizarMaduracionSalame} loading={loading} />
  </div>
)}
{false && (
  <div>
    {/* Bloque legacy mantenido como referencia visual del estilo original.
        Está deshabilitado con `false &&` — el render real lo hacen los
        componentes <HistorialDespostes /> y <HistorialElaboraciones /> de
        arriba que ya manejan paginación. */}
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">📋 Historial de despostes</div>
      {despostes.length === 0 ? <div className="empty">Sin despostes registrados</div> : despostes.map(d => (
        <div key={d.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {d.tipo_desposte === 'piezas' ? '🍖 Piezas' : d.tipo_desposte === 'kilo' ? '⚖️ Por Kilo' : d.tipo_desposte === 'cerdo' ? '🐷 Cerdo' : '🔄 Pieza a Kilo'}
                {d.tipo_animal ? ` · ${MERMAS_KILO[d.tipo_animal]?.label || d.tipo_animal}` : ''}
                {d.modelo && d.modelo !== 'KILO' && d.modelo !== 'PIEZA_KILO' && d.modelo !== 'CERDO' ? ` · Modelo ${d.modelo}` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.fecha} · {fmtKg(d.kg_media_res)} — {fmtKg(d.kg_neto)} neto</div>
              {d.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{d.notas}</div>}
            </div>
            <span style={{ background: d.tipo_desposte === 'piezas' ? '#2a2010' : d.tipo_desposte === 'cerdo' ? '#2a1a0a' : '#1a1a2a', color: d.tipo_desposte === 'piezas' ? 'var(--gold)' : d.tipo_desposte === 'cerdo' ? 'var(--amber)' : '#7db5ff', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
              {d.tipo_desposte === 'piezas' ? 'PIEZAS' : d.tipo_desposte === 'kilo' ? 'X KILO' : d.tipo_desposte === 'cerdo' ? 'CERDO' : 'PIEZA→KILO'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(d.piezas || []).filter(Boolean).map((p, i) => (
              <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text2)' }}>
                {p.nombre}: {p.kg?.toFixed(1)} kg{p.precio_venta > 0 ? ` · $${Math.round(p.precio_venta).toLocaleString('es-AR')}/kg` : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div className="card">
      <div className="card-title">🌭 Historial de elaboraciones</div>
      {elaboraciones.length === 0 ? <div className="empty">Sin elaboraciones registradas</div> : elaboraciones.map(e => (
        <div key={e.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {e.tipo === 'salame' ? '🥩 Salame' : '🌭'} {e.tipo === 'embutido' ? e.tipo_embutido?.replace(/_/g, ' ').toUpperCase() : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {e.fecha} · {(Number(e.kg_carne_cerdo) || 0).toFixed(1)} kg cerdo + {(Number(e.kg_carne_bovina) || 0).toFixed(1)} kg bovino
                {Number(e.kg_queso) > 0 ? ` + ${Number(e.kg_queso).toFixed(1)} kg queso` : ''}
              </div>
              {Array.isArray(e.productos_finales) && e.productos_finales.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {(e.productos_finales || []).filter(Boolean).map((p, i) => (
                    <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text2)' }}>
                      {NOMBRE_EMBUTIDO[p.tipo] || p.tipo}: {(Number(p.kg) || 0).toFixed(1)} kg
                    </span>
                  ))}
                </div>
              )}
              {e.tipo === 'salame' && !e.maduracion_completa && (
                <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 2 }}>⏳ En maduración hasta: {e.fecha_fin_maduracion}</div>
              )}
              {e.tipo === 'salame' && e.maduracion_completa && (
                <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>✅ Maduración completa</div>
              )}
              {e.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{e.notas}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ background: e.tipo === 'salame' ? '#2a1a0a' : '#1a2a1a', color: e.tipo === 'salame' ? 'var(--amber)' : 'var(--green)', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                {e.tipo === 'salame' ? 'SALAME' : 'EMBUTIDO'}
              </span>
              <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--gold)', marginTop: 4 }}>
                {e.tipo === 'salame' ? `${(Number(e.kg_elaborado) || 0).toFixed(1)} kg salame` : `${(Number(e.kg_final) || 0).toFixed(1)} kg`}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
    </div>
  )
}
// ───────────────────────────────────────────────────────────
// Componentes auxiliares para paginar los historiales del tab
// "Desposte → Historial Medias" — historial completo de medias_stock.
// Una fila por cada media res fisica con su codigo MR-XXX, estado actual,
// y trazabilidad (proveedor, fecha ingreso, destino, cliente, fecha salida).
// Patron equivalente al de piezas individuales pero para medias.
// ───────────────────────────────────────────────────────────
function HistorialMedias({ medias }) {
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const ESTADOS = [
    { id: 'todos',      label: 'Todas', color: 'var(--muted)' },
    { id: 'disponible', label: '🟢 Disponibles', color: '#7dff7d' },
    { id: 'reservada',  label: '🟡 Reservadas', color: '#ffd17a' },
    { id: 'despostada', label: '🔪 Despostadas', color: '#a78bfa' },
    { id: 'vendida',    label: '💰 Vendidas (enteras)', color: '#7db5ff' },
    { id: 'anulada',    label: '❌ Anuladas', color: '#ff8b8b' },
  ]
  const filtradas = (medias || []).filter(m => filtroEstado === 'todos' || m.estado === filtroEstado)
  const pag = usePaginacion(filtradas, 25)
  // Conteos por estado para los badges del filtro
  const counts = {}
  ;(medias || []).forEach(m => { counts[m.estado] = (counts[m.estado] || 0) + 1 })
  counts.todos = (medias || []).length

  function colorEstado(estado) {
    return ESTADOS.find(e => e.id === estado)?.color || 'var(--muted)'
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">🐄 Historial de Medias Reses ({(medias || []).length})</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        Cada media res cargada al sistema tiene un código <strong style={{ color: 'var(--gold)' }}>MR-XXX</strong> para
        trazarla en todo su ciclo: ingreso, reserva, desposte, venta.
      </div>
      {/* Filtros por estado */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {ESTADOS.map(e => (
          <button key={e.id} onClick={() => setFiltroEstado(e.id)}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              border: `1px solid ${filtroEstado === e.id ? e.color : 'var(--border)'}`,
              background: filtroEstado === e.id ? `${e.color}22` : 'transparent',
              color: filtroEstado === e.id ? e.color : 'var(--muted)',
              cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
            }}>
            {e.label} <span style={{ opacity: 0.7 }}>({counts[e.id] || 0})</span>
          </button>
        ))}
      </div>

      {filtradas.length === 0
        ? <div className="empty">Sin medias reses en este filtro</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={th}>Código</th>
                  <th style={th}>Ingreso</th>
                  <th style={th}>Proveedor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Kg</th>
                  <th style={{ ...th, textAlign: 'right' }}>$/kg</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Destino / Cliente</th>
                  <th style={th}>Fecha salida</th>
                </tr>
              </thead>
              <tbody>
                {pag.items.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <td style={td}>
                      <span style={{ background: 'var(--gold)', color: '#000', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>
                        {m.codigo}
                      </span>
                    </td>
                    <td style={td}>{m.fecha_ingreso}</td>
                    <td style={td}>{m.proveedor_origen || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: "'Bebas Neue',cursive", fontSize: 15, color: 'var(--gold)' }}>
                      {Number(m.kg || 0).toFixed(1)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--amber)' }}>
                      {m.precio_costo_kg ? `$${Math.round(m.precio_costo_kg).toLocaleString('es-AR')}` : '—'}
                    </td>
                    <td style={td}>
                      <span style={{ color: colorEstado(m.estado), fontWeight: 700 }}>
                        {ESTADOS.find(e => e.id === m.estado)?.label?.replace(/^[^ ]+ /, '') || m.estado}
                      </span>
                    </td>
                    <td style={td}>
                      {m.cliente_nombre || m.destino || (m.estado === 'reservada' ? m.reservada_para : '—')}
                    </td>
                    <td style={td}>{m.fecha_salida || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginador {...pag.controles} label="medias" />
          </div>
        )
      }
    </div>
  )
}
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }
const td = { padding: '8px 10px', verticalAlign: 'middle' }

// ───────────────────────────────────────────────────────────
// "Desposte → Historial" (despostes + elaboraciones de embutidos/salames)
// ───────────────────────────────────────────────────────────
function HistorialDespostes({ despostes }) {
  const pag = usePaginacion(despostes || [], 15)
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">📋 Historial de despostes ({(despostes || []).length})</div>
      {(despostes || []).length === 0
        ? <div className="empty">Sin despostes registrados</div>
        : pag.items.map(d => (
          <div key={d.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {d.tipo_desposte === 'piezas' ? '🍖 Piezas' : d.tipo_desposte === 'kilo' ? '⚖️ Por Kilo' : d.tipo_desposte === 'cerdo' ? '🐷 Cerdo' : '🔄 Pieza a Kilo'}
                  {d.modelo && d.modelo !== 'KILO' && d.modelo !== 'PIEZA_KILO' && d.modelo !== 'CERDO' ? ` · Modelo ${d.modelo}` : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.fecha} · {fmtKg(d.kg_media_res)} — {fmtKg(d.kg_neto)} neto</div>
                {d.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{d.notas}</div>}
              </div>
              <span style={{ background: d.tipo_desposte === 'piezas' ? '#2a2010' : d.tipo_desposte === 'cerdo' ? '#2a1a0a' : '#1a1a2a', color: d.tipo_desposte === 'piezas' ? 'var(--gold)' : d.tipo_desposte === 'cerdo' ? 'var(--amber)' : '#7db5ff', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                {d.tipo_desposte === 'piezas' ? 'PIEZAS' : d.tipo_desposte === 'kilo' ? 'X KILO' : d.tipo_desposte === 'cerdo' ? 'CERDO' : 'PIEZA→KILO'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(d.piezas || []).filter(Boolean).map((p, i) => (
                <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text2)' }}>
                  {p.nombre}: {p.kg?.toFixed(1)} kg{p.precio_venta > 0 ? ` · $${Math.round(p.precio_venta).toLocaleString('es-AR')}/kg` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      <Paginador {...pag.controles} label="despostes" />
    </div>
  )
}

function HistorialElaboraciones({ elaboraciones, onFinalizarSalame, loading }) {
  const pag = usePaginacion(elaboraciones || [], 15)
  // id del salame cuyo candado está abierto + kg finales tipeados
  const [finId, setFinId] = useState(null)
  const [kgFinalInput, setKgFinalInput] = useState('')
  return (
    <div className="card">
      <div className="card-title">🌭 Historial de elaboraciones ({(elaboraciones || []).length})</div>
      {(elaboraciones || []).length === 0
        ? <div className="empty">Sin elaboraciones registradas</div>
        : pag.items.map(e => (
          <div key={e.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {e.tipo === 'salame' ? '🥩 Salame' : '🌭'} {e.tipo === 'embutido' ? e.tipo_embutido?.replace(/_/g, ' ').toUpperCase() : (e.tipo_embutido?.replace(/_/g, ' ').toUpperCase() || '')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {e.fecha}{e.created_at ? ` · ${fmtHora(e.created_at)}` : ''} · {fmtKg(e.kg_carne_cerdo)} cerdo + {fmtKg(e.kg_carne_bovina)} bovino
                  {Number(e.kg_queso) > 0 ? ` + ${fmtKg(e.kg_queso)} queso` : ''}
                </div>
                {Array.isArray(e.productos_finales) && e.productos_finales.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {(e.productos_finales || []).filter(Boolean).map((p, i) => (
                      <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text2)' }}>
                        {NOMBRE_EMBUTIDO[p.tipo] || p.tipo}: {(Number(p.kg) || 0).toFixed(1)} kg
                      </span>
                    ))}
                  </div>
                )}
                {e.tipo === 'salame' && !e.maduracion_completa && (
                  <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 2 }}>🔒 En proceso de secado · {fmtKg(e.kg_elaborado)} netos (no suma al stock todavía)</div>
                )}
                {e.tipo === 'salame' && e.maduracion_completa && (
                  <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>✅ Secado finalizado · {fmtKg(e.kg_final)} finales al stock{Number(e.kg_elaborado) > 0 ? ` · merma ${(((Number(e.kg_final) || 0) / Number(e.kg_elaborado) - 1) * 100).toFixed(1)}%` : ''}</div>
                )}
                {e.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{e.notas}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ background: e.tipo === 'salame' ? '#2a1a0a' : '#1a2a1a', color: e.tipo === 'salame' ? 'var(--amber)' : 'var(--green)', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                  {e.tipo === 'salame' ? 'SALAME' : 'EMBUTIDO'}
                </span>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--gold)', marginTop: 4 }}>
                  {e.tipo === 'salame'
                    ? (e.maduracion_completa ? fmtKg(e.kg_final) : `${fmtKg(e.kg_elaborado)} netos`)
                    : fmtKg(e.kg_final)}
                </div>
              </div>
            </div>
            {/* Etapa 2: candado de secado. Cerrado = en proceso; al abrirlo se
                cargan los kg finales reales (pesados secos) y recién ahí suben
                al stock de embutidos. */}
            {e.tipo === 'salame' && !e.maduracion_completa && onFinalizarSalame && (
              finId === e.id ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16 }}>🔓</span>
                  <input
                    type="number" step="0.1" min="0" autoFocus
                    value={kgFinalInput}
                    onChange={ev => setKgFinalInput(ev.target.value)}
                    placeholder="kg finales (pesados secos)"
                    style={{ background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: 180, boxSizing: 'border-box' }}
                  />
                  <button
                    className="btn btn-gold"
                    disabled={loading}
                    onClick={async () => { await onFinalizarSalame(e, kgFinalInput); setFinId(null); setKgFinalInput('') }}
                    style={{ fontSize: 12 }}
                  >
                    {loading ? '⏳' : '✅ Confirmar y sumar al stock'}
                  </button>
                  <button className="btn" onClick={() => { setFinId(null); setKgFinalInput('') }} style={{ fontSize: 12 }}>Cancelar</button>
                </div>
              ) : (
                <button
                  className="btn"
                  title="Desbloquear para cargar el peso final del salame seco"
                  onClick={() => { setFinId(e.id); setKgFinalInput('') }}
                  style={{ fontSize: 12, marginTop: 6, borderColor: 'var(--gold)', color: 'var(--gold)' }}
                >
                  🔒 Cargar peso final (secado listo)
                </button>
              )
            )}
          </div>
        ))}
      <Paginador {...pag.controles} label="elaboraciones" />
    </div>
  )
}

function EntradaForm({ onSaved, showAlert, proveedores }) {
  const [form, setForm] = useState({ tipo: '', proveedor: '', descripcion: '', fecha: fechaHoyARG(), kg: '', precioKg: '9800', merma: '', destino: 'DEPOSITO', importe: '', cantidad: '1', cajaProductoId: '', polloProductoId: '', embutidoProductoId: '' })
  const [historial, setHistorial] = useState([])
  const [editando, setEditando] = useState(null)
  const [formEdit, setFormEdit] = useState({})
  // Anti doble-submit: el ref bloquea de forma SÍNCRONA (el estado de React se
  // actualiza async, así que dos clicks muy rápidos pasarían igual).
  const [guardandoEntrada, setGuardandoEntrada] = useState(false)
  const guardandoRef = useRef(false)
  // Para cajas CB/PT: array con el peso de cada caja individual.
  // Se sincroniza con form.cantidad cuando tipo es caja_cb / caja_pt.
  const [cajasPesos, setCajasPesos] = useState([])
  // Productos de precios filtrados — selectores para cargar entradas que
  // necesitan vincular a un producto específico de la lista:
  //   · Cajas (CB/PT) → cajas_stock con producto_id
  //   · Pollo/Rebozado cajón → entrada normal, pero precarga kg_por_unidad
  //     del producto seleccionado (Pechuga, Pollo entero, Pata muslo, etc.)
  const [productosCajas, setProductosCajas] = useState([])
  const [productosPolloCajon, setProductosPolloCajon] = useState([])
  const [productosRebozadoCajon, setProductosRebozadoCajon] = useState([])
  // Embutidos COMPRADOS elaborados (ej. morcilla): el selector solo lista los
  // que tienen stock propio (stock_origen emb_*) — la entrada suma a ese bucket.
  const [productosEmbutido, setProductosEmbutido] = useState([])
  useEffect(() => {
    supabase.from('precios').select('id, nombre, categoria, kg_por_unidad, stock_origen')
      .in('categoria', ['bovino_caja_cb', 'bovino_caja_pt', 'pollo_cajon', 'rebozado_cajon', 'embutido'])
      .order('nombre')
      .then(({ data }) => {
        const all = data || []
        setProductosCajas(all.filter(p => p.categoria === 'bovino_caja_cb' || p.categoria === 'bovino_caja_pt'))
        setProductosPolloCajon(all.filter(p => p.categoria === 'pollo_cajon'))
        setProductosRebozadoCajon(all.filter(p => p.categoria === 'rebozado_cajon'))
        setProductosEmbutido(all.filter(p => p.categoria === 'embutido' && String(p.stock_origen || '').startsWith('emb_')))
      })
  }, [])

  // Helpers para detectar si el tipo actual requiere selector de producto
  const esPolloCajon = form.tipo === 'pollo'
  const esRebozadoCajon = form.tipo === 'rebozado'
  const esEmbutido = form.tipo === 'embutido'
  const productosFiltradosTipo = esPolloCajon ? productosPolloCajon
                                : esRebozadoCajon ? productosRebozadoCajon
                                : []
  // Cuando el usuario elige un producto pollo/rebozado, autocompletar kg_por_unidad
  function onProductoCajonChange(productoId) {
    const prod = productosFiltradosTipo.find(p => p.id === productoId)
    setForm(f => ({
      ...f,
      polloProductoId: productoId,
      kg: prod?.kg_por_unidad ? String(prod.kg_por_unidad) : f.kg,
    }))
  }

  // Tipos que tienen tracking individual (cada unidad es una fila en cajas_stock)
  const esCajaIndividual = form.tipo === 'caja_cb' || form.tipo === 'caja_pt'

  // Sincronizar el array de pesos con la cantidad cada vez que cambia
  // form.cantidad o form.tipo (entrando/saliendo del modo cajas).
  useEffect(() => {
    if (!esCajaIndividual) { setCajasPesos([]); return }
    const n = Math.max(1, parseInt(form.cantidad) || 1)
    setCajasPesos(prev => {
      const arr = [...prev]
      while (arr.length < n) arr.push('')
      if (arr.length > n) arr.length = n
      return arr
    })
  }, [form.cantidad, form.tipo, esCajaIndividual])

  useEffect(() => { cargarHistorial() }, [])

  async function cargarHistorial() {
    // Antes estaba limitado a 100, lo que cortaba el historial de meses
    // anteriores. Ahora traemos todo y paginamos en cliente con usePaginacion.
    // Orden: fecha DESC + created_at DESC. Antes se usaba `id` como tiebreaker
    // pero `id` es UUID (aleatorio), no autoincremental, así que el orden de
    // entradas del mismo día era impredecible. `created_at` es el timestamp
    // real de inserción y SÍ refleja la hora.
    const [{ data }, { data: medias }] = await Promise.all([
      supabase
        .from('entradas_deposito')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false }),
      // Código MR-XXX de cada media res (vive en medias_stock, no en la
      // entrada). Lo asociamos por entrada_id para mostrarlo en el historial
      // de ingresos y tener trazabilidad: el mismo código del Historial de
      // Medias y del usuario de Desposte.
      supabase.from('medias_stock').select('entrada_id, codigo'),
    ])
    const codigoPorEntrada = {}
    ;(medias || []).forEach(m => { if (m.entrada_id) codigoPorEntrada[m.entrada_id] = m.codigo })
    setHistorial((data || []).map(e => ({ ...e, codigo_media: codigoPorEntrada[e.id] || null })))
  }

  // Paginación del historial — 20 por página por defecto, opciones 10/20/50/100
  const pag = usePaginacion(historial, 20)

  // Tipos que vienen en unidades discretas (cajones, cajas).
  // Para estos, el campo "Kg" representa los KG POR UNIDAD y se multiplica
  // por la cantidad de unidades.
  const TIPOS_EN_UNIDADES = ['pollo', 'caja_cb', 'caja_pt', 'almacen', 'bebidas']

  // Tipos que son por unidad PURA (no se pesan, no se manejan en kg).
  // Para estos no se muestra Kg ni Precio/kg — solo Cantidad e Importe total.
  // El cálculo interno usa Kg=1 para sumar las unidades al stock directo.
  const TIPOS_SOLO_UNIDADES = ['almacen', 'bebidas']
  const esSoloUnidades = TIPOS_SOLO_UNIDADES.includes(form.tipo)

  async function guardar() {
    if (guardandoRef.current) return       // bloqueo síncrono contra doble click
    guardandoRef.current = true
    setGuardandoEntrada(true)
    try {
    const esSoloUnid = TIPOS_SOLO_UNIDADES.includes(form.tipo)
    if (!form.tipo || !form.proveedor) { showAlert({ type: 'error', msg: 'Completá los campos requeridos' }); return }
    if (esFechaFutura(form.fecha)) { showAlert({ type: 'error', msg: `⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})` }); return }

    // Sanity check de kg: cualquier valor numérico inválido o sospechosamente
    // alto debe ser bloqueado o confirmado.
    // parseNumero acepta "12,5" o "12.5" (coma o punto) sin distinción.
    const kgInput = parseNumero(form.kg)
    if (!esCajaIndividual && !esSoloUnid && kgInput < 0) {
      showAlert({ type: 'error', msg: 'Los kilos no pueden ser negativos' }); return
    }
    // Pollo por cajón: rango real Fabricius 10-30 kg por cajón.
    // > 40 kg = sospechoso (probablemente sobra un dígito).
    if (form.tipo === 'pollo' && kgInput > 40) {
      if (!confirm(`⚠️ ${kgInput} kg por cajón de pollo es mucho (rango real: 10-30 kg). ¿Es correcto?`)) return
    }
    if (form.tipo === 'pollo' && kgInput > 0 && kgInput < 5) {
      if (!confirm(`⚠️ ${kgInput} kg por cajón de pollo es muy poco (rango real: 10-30 kg). ¿Es correcto?`)) return
    }
    // Otros tipos en unidades (no pollo, no cajas individuales, no almacén)
    if (TIPOS_EN_UNIDADES.includes(form.tipo) && form.tipo !== 'pollo' && !esSoloUnid && !esCajaIndividual && kgInput > 200) {
      if (!confirm(`⚠️ ${kgInput} kg por unidad es bastante alto. ¿Es correcto?`)) return
    }
    // Media res: rango real Fabricius 70-140 kg
    if (form.tipo === 'bovino_mr' && kgInput > 150) {
      if (!confirm(`⚠️ ${kgInput} kg para una media res es demasiado (rango real: 70-140 kg). ¿Es correcto?`)) return
    }
    if (form.tipo === 'bovino_mr' && kgInput > 0 && kgInput < 50) {
      if (!confirm(`⚠️ ${kgInput} kg es muy bajo para una media res (rango real: 70-140 kg). ¿Es correcto?`)) return
    }
    // Capón cerdo: rango real Fabricius 70-150 kg
    if (form.tipo === 'cerdo' && kgInput > 160) {
      if (!confirm(`⚠️ ${kgInput} kg para un capón es demasiado (rango real: 70-150 kg). ¿Es correcto?`)) return
    }
    if (form.tipo === 'cerdo' && kgInput > 0 && kgInput < 60) {
      if (!confirm(`⚠️ ${kgInput} kg es muy bajo para un capón (rango real: 70-150 kg). ¿Es correcto?`)) return
    }

    // ── CAJAS CB / PT: tracking individual ────────────────────────────
    // Cada caja se carga con su propio peso. Insertamos N filas en cajas_stock
    // (una por caja) y UNA fila en entradas_deposito como registro contable.
    if (esCajaIndividual) {
      // Validar que se haya seleccionado un producto (ej. Bola de Lomo Caja PT)
      // para vincular las cajas — sin esto el selector de venta no las encuentra.
      if (!form.cajaProductoId) {
        showAlert({ type: 'error', msg: 'Seleccioná el producto que va dentro de las cajas (ej. Bola de Lomo Caja PT)' })
        return
      }
      // parseNumero acepta "15,4" o "15.4" — el operario tipea como prefiera
      const pesosValidos = cajasPesos.map(p => parseNumero(p)).filter(p => p > 0)
      const cantPesperada = Math.max(1, parseInt(form.cantidad) || 1)
      if (pesosValidos.length !== cantPesperada) {
        showAlert({ type: 'error', msg: `Cargá el peso de las ${cantPesperada} cajas (faltan ${cantPesperada - pesosValidos.length})` })
        return
      }
      // Sanity check: las cajas bovinas (CB/PT) van de 5 a 30 kg típicamente.
      // > 40 kg = sospechoso, < 3 kg = sospechoso. Pide confirm.
      const cajaInflada = pesosValidos.find(kg => kg > 40)
      if (cajaInflada) {
        if (!confirm(`⚠️ Hay al menos una caja con ${cajaInflada} kg (rango real: 5-30 kg). ¿Es correcto?`)) return
      }
      const cajaMuyBaja = pesosValidos.find(kg => kg < 3)
      if (cajaMuyBaja) {
        if (!confirm(`⚠️ Hay al menos una caja con ${cajaMuyBaja} kg (rango real: 5-30 kg). ¿Es correcto?`)) return
      }
      const productoCaja = productosCajas.find(p => p.id === form.cajaProductoId)
      const kgTotalCajas = pesosValidos.reduce((s, kg) => s + kg, 0)
      const importeCajas = parseNumero(form.importe)
      // BLOQUEO: las cajas tampoco entran sin precio.
      if (!(importeCajas > 0)) {
        showAlert({ type: 'error', msg: '⛔ Cargá el importe (precio) de las cajas — no se puede ingresar sin precio.' })
        return
      }
      const precioPromedioKg = kgTotalCajas > 0 ? importeCajas / kgTotalCajas : 0
      const descripcionCajas = `${productoCaja?.nombre || form.descripcion || (form.tipo === 'caja_cb' ? 'Caja CB' : 'Caja PT')} ×${cantPesperada}`
      // 1) Registrar la entrada contable (suma de las cajas)
      const { data: entradaIns, error: errEnt } = await supabase.from('entradas_deposito').insert({
        fecha: form.fecha, tipo: form.tipo, proveedor_nombre: form.proveedor,
        descripcion: descripcionCajas, kg: kgTotalCajas, kg_real: kgTotalCajas,
        merma_pct: 0, precio_kg: precioPromedioKg,
        importe: importeCajas, destino: form.destino, cantidad: cantPesperada,
      }).select().single()
      if (errEnt) { showAlert({ type: 'error', msg: errEnt.message }); return }
      // 2) Insertar una fila por caja en cajas_stock (con su peso individual)
      const { error: errCajas } = await crearCajasIngreso(pesosValidos, {
        tipoCaja: form.tipo === 'caja_cb' ? 'CB' : 'PT',
        fecha: form.fecha,
        proveedor: form.proveedor,
        descripcion: productoCaja?.nombre || form.descripcion || null,
        precioCostoKg: precioPromedioKg,
        entradaId: entradaIns?.id || null,
        productoId: form.cajaProductoId,
      })
      if (errCajas) { showAlert({ type: 'error', msg: 'Cajas no se cargaron: ' + errCajas }); return }
      // 3) Registrar en compras_proveedores (entrada_id = vínculo exacto, mig 57)
      await supabase.from('compras_proveedores').insert({
        fecha: form.fecha, proveedor_nombre: form.proveedor,
        producto: descripcionCajas, kg: kgTotalCajas, importe: importeCajas,
        entrada_id: entradaIns?.id || null,
      })
      // Si el proveedor tiene cuenta corriente inicializada, la compra de
      // cajas va sola a su cuenta corriente (debe).
      await registrarCompraDesdeEntrada({
        proveedorNombre: form.proveedor, fecha: form.fecha, importe: importeCajas,
        descripcion: descripcionCajas, entradaId: entradaIns?.id,
      })
      showAlert({ type: 'success', msg: `✅ ${cantPesperada} cajas de ${productoCaja?.nombre || 'sin nombre'} registradas — ${kgTotalCajas.toFixed(1)} kg en total` })
      setForm(f => ({ ...f, descripcion: '', kg: '', importe: '', precioKg: '9800', cantidad: '1', cajaProductoId: '' }))
      setCajasPesos([])
      onSaved()
      cargarHistorial()
      setTimeout(() => showAlert(null), 3000)
      return
    }

    // ── FLUJO HISTÓRICO PARA EL RESTO DE TIPOS ────────────────────────
    if (esSoloUnid && !form.cantidad) { showAlert({ type: 'error', msg: 'Ingresá la cantidad de unidades' }); return }
    if (!esSoloUnid && !form.kg) { showAlert({ type: 'error', msg: 'Completá los campos requeridos' }); return }

    // Para pollo/rebozado por cajones: producto obligatorio (Pollo entero,
    // Pechuga, etc.) — sino no sabemos qué se está ingresando exactamente.
    if ((esPolloCajon || esRebozadoCajon) && productosFiltradosTipo.length > 0 && !form.polloProductoId) {
      showAlert({ type: 'error', msg: `Seleccioná el producto específico (${esPolloCajon ? 'Pollo entero, Pechuga, etc.' : 'tipo de rebozado'})` })
      return
    }
    // Embutidos comprados elaborados (ej. morcilla): producto obligatorio —
    // define a qué stock propio (emb_*) suma la entrada. No existe más el
    // bucket genérico 'embutido'.
    const prodEmbutido = esEmbutido ? productosEmbutido.find(p => p.id === form.embutidoProductoId) : null
    if (esEmbutido && !prodEmbutido) {
      showAlert({ type: 'error', msg: 'Seleccioná qué embutido estás ingresando (Morcilla, Chorizo, Salame...) — la entrada suma a su stock propio' })
      return
    }

    const esEnUnidades = TIPOS_EN_UNIDADES.includes(form.tipo)
    const cantidad = esEnUnidades ? Math.max(1, parseInt(form.cantidad) || 1) : 1
    // Para almacén/bebidas: kg por unidad = 1, así la cantidad se suma directo al stock
    // parseNumero acepta coma/punto indistintamente.
    const kgUnidad = esSoloUnid ? 1 : parseNumero(form.kg)
    const kgTotal = kgUnidad * cantidad
    const kgReal = kgTotal * (1 - parseNumero(form.merma) / 100)
    // Media res y capón (cerdo) se compran POR KG → importe = kg × precio/kg.
    // El resto usa el importe total. Así el capón nunca queda en $0 y suma al
    // debe del proveedor.
    const esPorKg = TIPOS_COMPRA_POR_KG.has(form.tipo)
    const importe = esPorKg
      ? kgTotal * parseNumero(form.precioKg)
      : parseNumero(form.importe)
    // BLOQUEO: nada entra al depósito sin precio.
    if (!(importe > 0)) {
      showAlert({ type: 'error', msg: esPorKg
        ? '⛔ Cargá el precio por kg — no se puede ingresar sin precio.'
        : '⛔ Cargá el importe (precio total) — no se puede ingresar al depósito sin precio.' })
      return
    }
    // Si se seleccionó un producto pollo/rebozado/embutido, usar su nombre en la descripción.
    const productoSelec = productosFiltradosTipo.find(p => p.id === form.polloProductoId)
    const descripcionBase = prodEmbutido?.nombre?.trim() || productoSelec?.nombre || form.descripcion || form.tipo
    const descripcionFinal = esEnUnidades && cantidad > 1
      ? `${descripcionBase} ×${cantidad}`
      : descripcionBase
    // Embutidos: la entrada se guarda con el tipo del BUCKET (emb_morcilla,
    // emb_salame_comun, etc.) — así suma al stock correcto y, si se edita o
    // elimina, la reversión también pega en el bucket correcto.
    const tipoEntrada = prodEmbutido ? prodEmbutido.stock_origen : form.tipo
    // Para bovino_mr necesitamos el id de la entrada insertada para crear
    // la fila correspondiente en medias_stock (el codigo MR-XXX se genera
    // automaticamente desde el id de medias_stock por columna generada).
    const { data: entradaInsertada, error } = await supabase.from('entradas_deposito').insert({
      fecha: form.fecha, tipo: tipoEntrada, proveedor_nombre: form.proveedor,
      descripcion: descripcionFinal, kg: kgTotal, kg_real: kgReal,
      merma_pct: parseNumero(form.merma), precio_kg: parseNumero(form.precioKg),
      importe, destino: form.destino, cantidad
    }).select().single()
    if (error) { showAlert({ type: 'error', msg: error.message }); return }
    const kgSumar = form.tipo === 'bovino_mr' ? kgReal : kgTotal
    await actualizarStock(tipoEntrada, kgSumar)

    // Tracking individual de medias reses: una fila por cada media fisica
    // en medias_stock, con codigo visible MR-XXX. Si la entrada agrupa varias
    // unidades (cantidad > 1, raro en bovino_mr pero posible), creamos una
    // fila por unidad.
    if (form.tipo === 'bovino_mr' && entradaInsertada) {
      const filasMedias = []
      // Si vino 1 sola media: 1 fila con todos los kg. Si vinieron varias en
      // una sola carga (caso raro), repartimos kg en partes iguales. Esto es
      // best-effort — lo ideal es cargar una entrada por media res fisica.
      const kgPorMedia = kgReal / cantidad
      for (let i = 0; i < cantidad; i++) {
        filasMedias.push({
          // Solo la primera fila tiene entrada_id (la columna es UNIQUE).
          // Las demas quedan sin referencia a entradas_deposito — el codigo
          // MR-XXX igual las identifica. Esto solo importa si cantidad > 1.
          entrada_id: i === 0 ? entradaInsertada.id : null,
          kg: kgPorMedia,
          proveedor_origen: form.proveedor,
          fecha_ingreso: form.fecha,
          precio_costo_kg: parseNumero(form.precioKg),
          descripcion: descripcionFinal,
          estado: 'disponible',
        })
      }
      const { error: errMedias } = await supabase.from('medias_stock').insert(filasMedias)
      if (errMedias) console.warn('No se pudo crear fila en medias_stock:', errMedias.message)
    }

    // Compras DIRECTAS de piezas bovinas (pierna, cortito, etc.) al frigorífico:
    // además del stock agregado, creamos su fila individual en piezas_stock para
    // que aparezcan en la pestaña Piezas (igual que las que salen del desposte
    // de medias reses). Solo aplica a entradas manuales de tipo pieza_* bovino;
    // las piezas que vienen del desposte ya crean su propia fila por otro flujo.
    const TIPOS_PIEZA_BOVINA = {
      pieza_pierna: 'Pierna', pieza_cuarto_pistola: 'Cuarto Pistola',
      pieza_costillar: 'Costillar Completo', pieza_cortito: 'Cortito',
      pieza_costeletal: 'Costeletal con Lomo', pieza_paleta: 'Paleta', pieza_parrillero: 'Parrillero',
    }
    if (TIPOS_PIEZA_BOVINA[form.tipo] && entradaInsertada) {
      const kgPorPieza = kgTotal / cantidad
      const filasPiezas = []
      for (let i = 0; i < cantidad; i++) {
        filasPiezas.push({
          entrada_id: entradaInsertada.id,
          tipo_pieza: TIPOS_PIEZA_BOVINA[form.tipo],
          tipo_stock: form.tipo,
          kg: kgPorPieza,
          precio_costo_kg: parseNumero(form.precioKg) || null,
          fecha_ingreso: form.fecha,
          proveedor_origen: form.proveedor,
          descripcion_origen: form.descripcion || TIPOS_PIEZA_BOVINA[form.tipo],
          estado: 'disponible',
        })
      }
      const { error: errPz } = await supabase.from('piezas_stock').insert(filasPiezas)
      if (errPz) console.warn('No se pudo crear fila en piezas_stock:', errPz.message)
    }

    await supabase.from('compras_proveedores').insert({
      fecha: form.fecha, proveedor_nombre: form.proveedor,
      producto: descripcionFinal,
      kg: kgTotal, importe,
      entrada_id: entradaInsertada?.id || null,  // vínculo exacto compra↔entrada (mig 57)
    })
    // Si el proveedor tiene cuenta corriente inicializada, esta compra
    // va sola a su cuenta corriente (debe). Si no está inicializada, no
    // hace nada (queda en compras_proveedores para el fallback).
    await registrarCompraDesdeEntrada({
      proveedorNombre: form.proveedor, fecha: form.fecha, importe,
      descripcion: descripcionFinal, entradaId: entradaInsertada?.id,
    })
    const msgOK = esEnUnidades && cantidad > 1
      ? `✅ ${cantidad} unidades de ${descripcionBase} registradas — ${kgTotal.toFixed(1)} kg al stock`
      : '✅ Entrada registrada — Stock actualizado'
    showAlert({ type: 'success', msg: msgOK })
    setForm(f => ({ ...f, descripcion: '', kg: '', importe: '', precioKg: '9800', cantidad: '1', polloProductoId: '', embutidoProductoId: '' }))
    onSaved()
    cargarHistorial()
    setTimeout(() => showAlert(null), 3000)
    } finally {
      guardandoRef.current = false
      setGuardandoEntrada(false)
    }
  }

async function eliminar(entrada) {
  if (entrada.eliminado) { showAlert({ type: 'error', msg: 'Este ingreso ya está anulado' }); return }
  if (!confirm(`¿Anular este ingreso de ${entrada.kg} kg de ${entrada.proveedor_nombre}?\n\nQueda marcado ANULADO (no se borra), se revierte el stock, se anulan sus piezas y se anula la compra en la cuenta del proveedor.`)) return

  // Quién anula — para la trazabilidad (igual patrón que la anulación de remitos)
  const { data: { user } } = await supabase.auth.getUser()
  const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user?.id).maybeSingle()
  const anuladoPor = perfil?.nombre || user?.email || 'admin'
  const ahora = new Date().toISOString()

  if (entrada.despostada && entrada.desposte_id) {
    const { data: desposte } = await supabase.from('despostes').select('*').eq('id', entrada.desposte_id).single()
    if (desposte) {
      if (desposte.tipo_desposte === 'piezas' || desposte.tipo_desposte === 'cerdo') {
        // Revertir cada pieza a SU bucket propio (bovino o cerdo, según tipo_stock).
        // Incluye el desposte de CAPÓN (tipo 'cerdo'): antes no se revertían sus
        // piezas (pierna/carré/etc.) al anular el ingreso → stock inflado.
        for (const p of (desposte.piezas || [])) {
          await actualizarStock(p.tipo_stock || bucketDePiezaBovina(p.nombre), -(p.kg || 0))
        }
        // El desposte de capón además crea una entrada por cada pieza (historial).
        // Las anulamos para que no queden como ingresos fantasma ni se puedan
        // re-anular (doble descuento). Match por el id del capón en la descripción.
        if (desposte.tipo_desposte === 'cerdo') {
          await supabase.from('entradas_deposito')
            .update({ eliminado: true, eliminado_por: anuladoPor, eliminado_en: ahora })
            .ilike('descripcion', `%Capón #${entrada.id}%`)
            .eq('eliminado', false)
        }
      } else if (desposte.tipo_desposte === 'kilo' || desposte.tipo_desposte === 'pieza_kilo') {
        await actualizarStock('bovino_corte', -(desposte.kg_neto || 0))
      }
      await supabase.from('despostes').delete().eq('id', entrada.desposte_id)
    }
  }
  // Marcar la compra del proveedor como anulada (queda en "Buscar remitos de
  // ingreso" marcada, sin sumar a los totales) en vez de borrarla.
  // Match EXACTO por entrada_id (mig 57). NUNCA update masivo por
  // fecha+proveedor+kg: con cargas duplicadas gemelas marcaba TODAS las
  // coincidencias — bug del 11/06 que anuló también las 7 compras reales
  // de PRETTO al anular sus duplicadas.
  const { data: compraPorEntrada } = await supabase.from('compras_proveedores')
    .update({ anulado: true, anulado_por: anuladoPor, anulado_en: ahora })
    .eq('entrada_id', entrada.id)
    .select('id')
  if (!compraPorEntrada || compraPorEntrada.length === 0) {
    // Fallback para compras viejas sin entrada_id: UNA sola fila candidata
    // (la más vieja no-anulada que coincida), nunca todas.
    const { data: candidata } = await supabase.from('compras_proveedores')
      .select('id')
      .eq('fecha', entrada.fecha)
      .eq('proveedor_nombre', entrada.proveedor_nombre)
      .eq('kg', entrada.kg)
      .eq('anulado', false)
      .is('entrada_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
    if (candidata?.[0]) {
      await supabase.from('compras_proveedores')
        .update({ anulado: true, anulado_por: anuladoPor, anulado_en: ahora })
        .eq('id', candidata[0].id)
    }
  }
  // Cuenta corriente del proveedor: la compra se ANULA (queda visible marcada
  // en el extracto, deja de sumar a la deuda) en vez de borrarse.
  await revertirCompraDeEntrada(entrada.id, anuladoPor)
  // Media res → su fila en medias_stock pasa a 'anulada'.
  if (entrada.tipo === 'bovino_mr') {
    const { error: errMedia } = await supabase.from('medias_stock')
      .update({ estado: 'anulada' }).eq('entrada_id', entrada.id)
    if (errMedia) console.warn('No se pudo anular la media asociada:', errMedia.message)
  }
  // Piezas individuales que generó esta entrada (pierna, cortito, etc.): las que
  // siguen DISPONIBLES pasan a 'anulada' + por quién (dejan de contar como stock
  // y aparecen anuladas en el Historial de Piezas). Las ya vendidas/despostadas
  // no se tocan (esa salida no se puede revertir desde acá).
  const { data: piezasEntrada } = await supabase.from('piezas_stock').select('id, estado').eq('entrada_id', entrada.id)
  const piezasDisp = (piezasEntrada || []).filter(p => p.estado === 'disponible')
  if (piezasDisp.length > 0) {
    await supabase.from('piezas_stock')
      .update({ estado: 'anulada', anulada_por: anuladoPor, anulada_en: ahora })
      .in('id', piezasDisp.map(p => p.id))
  }
  const piezasNoRevert = (piezasEntrada || []).length - piezasDisp.length
  // Revertir el stock que sumó la entrada — SOLO si NO fue despostada.
  // Si la entrada YA estaba despostada, su stock original (ej. bovino_mr) ya lo
  // consumió el desposte (que lo movió a cortes/piezas), y ARRIBA ya revertimos
  // ese movimiento. Volver a restar acá descontaría los kg DOS VECES y dejaría el
  // bucket negativo (bug del -99: media despostada y luego eliminada).
  if (!entrada.despostada) {
    await actualizarStock(entrada.tipo, -(entrada.kg_real || entrada.kg))
  }
  // Soft-delete: la entrada NO se borra, queda marcada ANULADA + por quién.
  await supabase.from('entradas_deposito')
    .update({ eliminado: true, eliminado_por: anuladoPor, eliminado_en: ahora })
    .eq('id', entrada.id)
  showAlert({ type: 'success', msg: `❌ Ingreso anulado por ${anuladoPor} — stock revertido${piezasNoRevert > 0 ? ` · ⚠️ ${piezasNoRevert} pieza(s) ya vendida(s)/despostada(s) no se revirtieron` : ''}` })
  cargarHistorial()
  onSaved()
}

  function abrirEdicion(entrada) {
    setEditando(entrada.id)
    setFormEdit({
      fecha: entrada.fecha,
      descripcion: entrada.descripcion || '',
      kg: entrada.kg || '',
      precioKg: entrada.precio_kg || '',
      proveedor: entrada.proveedor_nombre || '',
      destino: entrada.destino || 'DEPOSITO',
    })
  }

  async function guardarEdicion(entrada) {
    if (esFechaFutura(formEdit.fecha)) { showAlert({ type: 'error', msg: `⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})` }); return }
    const kgAnterior = entrada.kg_real || entrada.kg || 0
    const kgNuevo = parseNumero(formEdit.kg)
    const kgReal = kgNuevo * (1 - (entrada.merma_pct || 0) / 100)
    const diferencia = kgReal - kgAnterior
    await supabase.from('entradas_deposito').update({
      fecha: formEdit.fecha,
      descripcion: formEdit.descripcion,
      kg: kgNuevo,
      kg_real: kgReal,
      precio_kg: parseNumero(formEdit.precioKg),
      proveedor_nombre: formEdit.proveedor,
      destino: formEdit.destino,
      importe: kgNuevo * (parseNumero(formEdit.precioKg))
    }).eq('id', entrada.id)
    if (diferencia !== 0) await actualizarStock(entrada.tipo, diferencia)
    setEditando(null)
    showAlert({ type: 'success', msg: '✅ Entrada actualizada' })
    cargarHistorial()
    onSaved()
  }

  const TIPOS = {
    bovino_mr: '🐄 Media Res', bovino_corte: '🥩 Bovino Corte',
    bovino_brosa: '🫀 Brosa', cerdo: '🐷 Cerdo',
    pollo: '🍗 Pollo', embutido: '🌭 Embutido',
    // Embutidos con stock propio (mig 60): las entradas nuevas se guardan
    // con el tipo del bucket para que la reversión pegue donde corresponde.
    emb_chorizo_parrillero: '🌭 Embutido',
    emb_chorizo_saborizado: '🌭 Embutido',
    emb_chorizo_colorado: '🌭 Embutido',
    emb_salchicha_parrillera: '🌭 Embutido',
    emb_morcilla: '🌭 Embutido',
    emb_salame_comun: '🥩 Salame',
    emb_salame_holanda: '🥩 Salame',
    emb_salame_rockeford: '🥩 Salame',
    // Piezas bovinas — mismos nombres que la lista de precios (entran por
    // desposte interno de media res o por compra directa a proveedor).
    pieza_pierna: '🥩 Pierna Bovina – Mocho',
    pieza_cuarto_pistola: '🥩 Cuarto Pistola',
    pieza_costillar: '🥩 Costillar Completo',
    pieza_cortito: '🥩 Cortito',
    pieza_costeletal: '🥩 Costeletal con Lomo',
    pieza_paleta: '🥩 Paleta/Cogote',
    pieza_parrillero: '🥩 Parrillero',
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Registrar entrada al depósito</div>
        <div className="form-row">
          <div className="form-group"><label>Tipo de producto</label>
            <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
              <option value="">— Seleccioná —</option>
<option value="bovino_mr">🐄 Media Res</option>
<option value="pieza_pierna">🥩 Pierna Bovina – Mocho</option>
<option value="pieza_cuarto_pistola">🥩 Cuarto Pistola</option>
<option value="pieza_costillar">🥩 Costillar Completo</option>
<option value="pieza_cortito">🥩 Cortito</option>
<option value="pieza_costeletal">🥩 Costeletal con Lomo</option>
<option value="pieza_paleta">🥩 Paleta/Cogote</option>
<option value="pieza_parrillero">🥩 Parrillero</option>
<option value="caja_cb">📦 Caja bovina CB</option>
<option value="caja_pt">📦 Caja bovina PT</option>
<option value="bovino_brosa">🫀 Bovino — Brosa</option>
<option value="cerdo">🐷 Cerdo — Capón</option>
<option value="pollo">🍗 Pollo por Cajones</option>
<option value="embutido">🌭 Embutido</option>
<option value="rebozado">🧊 Rebozado por Cajones</option>
<option value="almacen">🛒 Almacén (por unidad)</option>
<option value="bebidas">🥤 Bebidas (por unidad)</option>
            </select>
          </div>
          <div className="form-group"><label>Fecha</label>
            <input type="date" value={form.fecha} max={fechaHoyARG()} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Proveedor</label>
            <select value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}>
              <option value="">— Seleccioná —</option>
              {proveedores.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Descripción</label>
            <input placeholder="Ej: Novillito Premium..." value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
        </div>
        {/* Selector de producto específico para Pollo/Rebozado por cajones —
            así sabemos qué tipo de pollo (entero, pechuga, pata muslo, etc.)
            se está ingresando y autocompletamos kg_por_unidad de la lista. */}
        {(esPolloCajon || esRebozadoCajon) && (
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1/-1' }}>
              <label>🍗 Producto específico</label>
              <select
                value={form.polloProductoId || ''}
                onChange={e => onProductoCajonChange(e.target.value)}
                style={{ borderColor: 'var(--gold)' }}
              >
                <option value="">— Seleccioná el producto —</option>
                {productosFiltradosTipo.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.kg_por_unidad ? ` (${p.kg_por_unidad} kg/u)` : ' — sin kg cargado'}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {productosFiltradosTipo.length === 0
                  ? <span style={{ color: '#ff8b8b' }}>⚠️ No hay productos de esta categoría cargados — agregalos primero en /admin/precios.</span>
                  : 'Al elegir el producto se autocompleta los kg por unidad. Igual lo podés editar si este lote pesa distinto.'}
              </div>
            </div>
          </div>
        )}
        {/* Selector de producto para EMBUTIDOS comprados elaborados (morcilla,
            chorizos, salames de terceros). Define a qué stock propio (emb_*)
            suma la entrada — el bucket genérico 'embutido' no existe más. */}
        {esEmbutido && (
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1/-1' }}>
              <label>🌭 ¿Qué embutido ingresa?</label>
              <select
                value={form.embutidoProductoId || ''}
                onChange={e => setForm(f => ({ ...f, embutidoProductoId: e.target.value }))}
                style={{ borderColor: 'var(--gold)' }}
              >
                <option value="">— Seleccioná el embutido —</option>
                {productosEmbutido.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {productosEmbutido.length === 0
                  ? <span style={{ color: '#ff8b8b' }}>⚠️ No hay embutidos con stock propio — asignales su "stock origen" en /admin/precios.</span>
                  : 'La entrada suma directo al stock propio de ese producto (el mismo que descuentan las ventas). Si falta alguno, asignale su stock origen en Precios.'}
              </div>
            </div>
          </div>
        )}

        {TIPOS_EN_UNIDADES.includes(form.tipo) && (
          <div className="form-row">
            <div className="form-group"><label>{esSoloUnidades ? '📦 Cantidad de unidades' : esCajaIndividual ? '📦 Cantidad de cajas' : 'Cantidad de unidades'}</label>
              <input type="number" min="1" step="1" placeholder={esSoloUnidades ? 'Ej: 24' : esCajaIndividual ? 'Ej: 5' : 'Ej: 14'} value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))} style={{ borderColor: 'var(--gold)' }} />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>
                {(() => {
                  const cant = Math.max(1, parseInt(form.cantidad) || 1)
                  if (esSoloUnidades) return `📦 Se sumarán ${cant} unidades al stock`
                  if (esCajaIndividual) {
                    const total = cajasPesos.reduce((s, p) => s + (parseFloat(p) || 0), 0)
                    return total > 0
                      ? `📦 Total: ${cant} cajas = ${total.toFixed(1)} kg`
                      : '📦 Cargá el peso de cada caja abajo'
                  }
                  const kgU = parseFloat(form.kg) || 0
                  return kgU > 0 ? `📦 Total: ${cant} × ${kgU} kg = ${(cant * kgU).toFixed(1)} kg al stock` : '📦 Ingresá kg por unidad para ver el total'
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────
            CAJAS CB/PT: producto que va dentro + grid de pesos por caja.
            El producto se usa para que la venta filtre correctamente
            (solo aparecen cajas del producto que se está vendiendo).
            ────────────────────────────────────────────────────────── */}
        {esCajaIndividual && (
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1/-1' }}>
              <label>🥩 Producto que contienen estas cajas</label>
              <select
                value={form.cajaProductoId || ''}
                onChange={e => setForm(f => ({ ...f, cajaProductoId: e.target.value }))}
                style={{ borderColor: 'var(--gold)' }}
              >
                <option value="">— Seleccioná un producto —</option>
                {productosCajas
                  .filter(p => p.categoria === (form.tipo === 'caja_cb' ? 'bovino_caja_cb' : 'bovino_caja_pt'))
                  .map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Cada caja queda vinculada a este producto. Cuando vendas "{productosCajas.find(p => p.id === form.cajaProductoId)?.nombre || 'el producto'}" desde Caja o Mayorista, el selector va a mostrar solo estas cajas.
                {productosCajas.length === 0 && <span style={{ color: '#ff8b8b' }}> · Aún no tenés productos de categoría caja en Precios — agregalos primero.</span>}
              </div>
            </div>
          </div>
        )}
        {esCajaIndividual && cajasPesos.length > 0 && (
          <div style={{ background: '#1a2a3a', border: '1px solid #2d3a5a', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#7db5ff', marginBottom: 10 }}>
              ⚖️ Peso individual de cada caja {form.tipo === 'caja_cb' ? 'CB' : 'PT'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {cajasPesos.map((p, idx) => (
                <div key={idx}>
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Caja #{idx + 1} (kg)</label>
                  <input
                    type="number" step="0.01" min="0" placeholder="0.0"
                    value={p}
                    onChange={e => setCajasPesos(prev => prev.map((v, i) => i === idx ? e.target.value : v))}
                    style={{ width: '100%', background: 'var(--surface)', border: `1px solid ${p ? 'var(--gold)' : 'var(--border)'}`, color: 'var(--text)', borderRadius: 6, padding: '6px 8px', fontSize: 14, fontWeight: 600, boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
              💡 Cada caja se carga individualmente. Al vender vas a elegir cuál caja específica del stock.
            </div>
          </div>
        )}

        {!esSoloUnidades && !esCajaIndividual && (
          <div className="form-row">
            <div className="form-group"><label>{TIPOS_EN_UNIDADES.includes(form.tipo) ? 'Kg por unidad' : 'Kg'}</label>
              <input type="number" step="0.1" placeholder="0" value={form.kg} onChange={e => setForm(f => ({ ...f, kg: e.target.value }))} />
            </div>
            <div className="form-group"><label>Precio/kg ($)</label>
              <input type="number" value={form.precioKg} onChange={e => setForm(f => ({ ...f, precioKg: e.target.value }))} placeholder="Precio por kg" />
            </div>
          </div>
        )}
        {esSoloUnidades && (
          <div className="form-row">
            <div className="form-group"><label>Precio por unidad ($)</label>
              <input type="number" value={form.precioKg} onChange={e => setForm(f => ({ ...f, precioKg: e.target.value }))} placeholder="Ej: 1200" />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 8 }}>
                {(() => {
                  const cant = Math.max(1, parseInt(form.cantidad) || 1)
                  const pu = parseFloat(form.precioKg) || 0
                  return pu > 0 ? `💰 Sugerido: ${cant} × $${pu.toLocaleString('es-AR')} = $${(cant * pu).toLocaleString('es-AR')}` : 'Cargá el precio por unidad para ver el total sugerido'
                })()}
              </div>
            </div>
          </div>
        )}
        <div className="form-row">
          {form.tipo === 'bovino_mr' && (
            <div className="form-group"><label>Merma % (opcional)</label>
              <input type="number" step="0.5" placeholder="2.5" value={form.merma} onChange={e => setForm(f => ({ ...f, merma: e.target.value }))} />
            </div>
          )}
          {/* Los tipos que se compran por kg (media res, capón, piezas bovinas
              compradas a proveedor) calculan el importe = kg × precio/kg, así que
              no piden importe total — el campo solo aparece para el resto. */}
          {!TIPOS_COMPRA_POR_KG.has(form.tipo) && (
            <div className="form-group"><label>Importe total ($)</label>
              <input type="number" placeholder="0" value={form.importe} onChange={e => setForm(f => ({ ...f, importe: e.target.value }))} />
            </div>
          )}
          <div className="form-group"><label>Destino</label>
            <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value }))}>
              <option value="MITRE">Local Mitre</option>
              <option value="CENTRO">Centro</option>
              <option value="MONTE CRISTO">Monte Cristo</option>
              <option value="CLIENTE">Cliente externo</option>
              <option value="DEPOSITO">Queda en depósito</option>
            </select>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>
          ✅ La entrada actualizará el stock y se registrará en Cuenta Proveedores
        </div>
        <button className="btn btn-gold" onClick={guardar} disabled={guardandoEntrada} style={{ opacity: guardandoEntrada ? 0.5 : 1, cursor: guardandoEntrada ? 'not-allowed' : 'pointer' }}>{guardandoEntrada ? '⏳ Registrando…' : '✅ Registrar entrada'}</button>
      </div>

      <div className="card">
        <div className="card-title">📋 Historial de ingresos ({historial.length})</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Código</th>
              <th>Tipo</th>
              <th>Proveedor</th>
              <th>Descripción</th>
              <th>Kg</th>
              <th>Precio/kg</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {pag.items.map(e => (
              editando === e.id ? (
                <tr key={e.id} style={{ background: 'rgba(201,168,76,0.08)' }}>
                  <td><input type="date" value={formEdit.fecha} max={fechaHoyARG()} onChange={x => setFormEdit(f => ({ ...f, fecha: x.target.value }))} style={{ ...inp, width: 130 }} /></td>
                  <td>{e.codigo_media ? <span style={{ background: 'var(--gold)', color: '#000', padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>{e.codigo_media}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{TIPOS[e.tipo] || e.tipo}</td>
                  <td><input value={formEdit.proveedor} onChange={x => setFormEdit(f => ({ ...f, proveedor: x.target.value }))} style={{ ...inp, width: 110 }} /></td>
                  <td><input value={formEdit.descripcion} onChange={x => setFormEdit(f => ({ ...f, descripcion: x.target.value }))} style={{ ...inp, width: 130 }} /></td>
                  <td><input type="number" step="0.1" value={formEdit.kg} onChange={x => setFormEdit(f => ({ ...f, kg: x.target.value }))} style={{ ...inp, width: 70, borderColor: 'var(--gold)' }} /></td>
                  <td><input type="number" value={formEdit.precioKg} onChange={x => setFormEdit(f => ({ ...f, precioKg: x.target.value }))} style={{ ...inp, width: 90 }} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => guardarEdicion(e)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>💾</button>
                      <button onClick={() => setEditando(null)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={e.id} style={{ background: e.eliminado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: e.eliminado ? 0.65 : 1 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{e.fecha}</div>
                    {/* Hora real de ingreso (created_at) para que el orden
                        cronologico dentro del mismo dia sea visible. Sin
                        esto, todas las entradas del mismo dia se veian
                        "iguales" aunque internamente esten bien ordenadas. */}
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtHora(e.created_at)}</div>
                  </td>
                  <td>{e.codigo_media ? <span style={{ background: 'var(--gold)', color: '#000', padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>{e.codigo_media}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td style={{ fontSize: 12 }}>{TIPOS[e.tipo] || e.tipo}</td>
                  <td>{e.proveedor_nombre}</td>
                  <td>
                    {e.descripcion}
                    {e.eliminado && <span style={{ marginLeft: 6, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO{e.eliminado_por ? ' por ' + e.eliminado_por : ''}</span>}
                  </td>
                  <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{(Number(e.kg_real) || Number(e.kg) || 0).toFixed(1)} kg</td>
                  <td style={{ color: 'var(--muted)' }}>{e.precio_kg > 0 ? '$' + Math.round(e.precio_kg).toLocaleString('es-AR') : '—'}</td>
                  <td>
                    {e.eliminado ? (
                      <span style={{ fontSize: 10, color: '#ff6b6b', fontWeight: 700 }}>❌ ANULADO</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => abrirEdicion(e)} style={{ background: 'var(--amber)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff' }}>✏️</button>
                        <button onClick={() => eliminar(e)} title="Anular ingreso" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#ff6b6b' }}>🗑️</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            ))}
            {historial.length === 0 && <tr><td colSpan={8} className="empty">Sin entradas registradas</td></tr>}
          </tbody>
        </table>
        <Paginador {...pag.controles} label="entradas" />
      </div>
    </div>
  )
}

export function SalidaForm({ onSaved, showAlert, onRemito, setTab }) {
  const [form, setForm] = useState({ destino: '', clienteId: '', clienteNombre: '', domicilio: '', fecha: fechaHoyARG(), categoria: '', productoId: '', kg: '', precio: '', cobro: 'cta_cte', notas: '' })
  // Pago dividido (cobro='mixto'): hasta 3 líneas { metodo, monto }. Solo se usa
  // cuando la venta se cobra en 2-3 formas distintas (ej. parte efectivo + parte
  // transferencia). Es 100% pagado: no genera deuda en cuenta corriente.
  const [pagosSplit, setPagosSplit] = useState([{ metodo: 'efectivo', monto: '' }, { metodo: 'transferencia', monto: '' }])
  const [items, setItems] = useState([])
  // Anti-doble-emisión: el ref bloquea de forma SÍNCRONA (un segundo click
  // entra antes de que React re-renderice con guardando=true), y el state
  // deshabilita el botón. Sin esto se emitían 2 remitos idénticos por
  // doble click (ver remitos 198/199 de Alvear).
  const [guardando, setGuardando] = useState(false)
  const guardandoRef = useRef(false)
  const [todosPrecios, setTodosPrecios] = useState([])
  const [clientes, setClientes] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [mostrarClientes, setMostrarClientes] = useState(false)
  const [mediasDisponibles, setMediasDisponibles] = useState([])
  const [mediaSeleccionada, setMediaSeleccionada] = useState(null)
  const [formManual, setFormManual] = useState({ descripcion: '', importe: '' })
  const [piezasDispVenta, setPiezasDispVenta] = useState([])
  const [piezaEnteraSeleccionada, setPiezaEnteraSeleccionada] = useState(null)
  // Cajas individuales disponibles (cajas_stock) — para Caja CB/PT
  const [cajasDispVenta, setCajasDispVenta] = useState([])
  const [cajaSeleccionada, setCajaSeleccionada] = useState(null)
  // Mapa { tipo: kg_disponible } cargado de stock_actual — se usa para mostrar
  // disponibilidad de cajas CB/PT al cajero y validar que no sobre-venda.
  const [stockMap, setStockMap] = useState({})
  const [ofertas, setOfertas] = useState([])   // ofertas vigentes para aplicar al precio del despacho
  async function recargarPiezasDispVenta() {
    const { data } = await supabase.from('piezas_stock').select('*').eq('estado', 'disponible').order('fecha_ingreso', { ascending: true }).order('id', { ascending: true })
    setPiezasDispVenta(data || [])
  }
  async function recargarCajasDispVenta() {
    const { data } = await supabase.from('cajas_stock').select('*').eq('estado', 'disponible').order('fecha_ingreso', { ascending: true }).order('id', { ascending: true })
    setCajasDispVenta(data || [])
  }
  async function recargarStockMap() {
    const { data } = await supabase.from('stock_actual').select('tipo, kg_disponible')
    const m = {}
    ;(data || []).forEach(r => { m[r.tipo] = Number(r.kg_disponible) || 0 })
    setStockMap(m)
  }
  useEffect(() => {
    supabase.from('precios').select('*').order('nombre').then(({ data }) => setTodosPrecios(data || []))
    supabase.from('clientes').select('*').order('nombre').then(({ data }) => setClientes(data || []))
    // Ofertas vigentes (activas y dentro del rango de fechas) para aplicar
    // el precio de oferta en los despachos, igual que en Caja Rápida.
    const hoyOf = fechaHoyARG()
    supabase.from('ofertas').select('*').eq('activa', true)
      .lte('fecha_inicio', hoyOf).gte('fecha_fin', hoyOf)
      .then(({ data }) => setOfertas(data || []))
  // Orden por created_at además de fecha: dos medias reses cargadas el mismo
  // día necesitan ordenarse por hora real de creación (la columna `fecha` es
  // DATE y `id` es UUID — ninguno sirve solo como criterio cronológico).
  supabase.from('entradas_deposito').select('*').eq('tipo', 'bovino_mr').eq('despostada', false).eq('eliminado', false).order('fecha', { ascending: false }).order('created_at', { ascending: false }).then(({ data }) => setMediasDisponibles(data || []))
  recargarPiezasDispVenta()
  recargarCajasDispVenta()
  recargarStockMap()
  }, [])

  // Categorías que se venden por UNIDAD (no por kg). Para estas el form
  // muestra "Cantidad" en vez de "Kg", el step es entero, y el carrito
  // muestra "X u" en vez de "X kg". Las cajas CB/PT además validan stock.
  const CATEGORIAS_POR_UNIDAD = new Set([
    'pollo_cajon',     // 🍗 Pollo Cajón
    'rebozado_cajon',  // 🧊 Rebozado Cajón
    'almacen',         // 🛒 Almacén
    'bebidas',         // 🥤 Bebidas
    'bovino_caja_cb',  // 📦 Caja CB
    'bovino_caja_pt',  // 📦 Caja PT
    'insumos',         // 🧰 Insumos (se venden por unidad, NO descuentan stock)
  ])
  const esUnidad = CATEGORIAS_POR_UNIDAD.has(form.categoria)
  const esCaja = form.categoria === 'bovino_caja_cb' || form.categoria === 'bovino_caja_pt'

const CATEGORIAS = {
    bovino_mr: '🐄 Media Reses',
    pieza_entera: '🍖 Pieza Entera (Piezas Bovinas)',
    bovino_corte: '🥩 Bovinos — Cortes',
    bovino_brosa: '🫀 Brosas',
    bovino_pieza: '🍖 Piezas',
    bovino_caja_cb: '📦 Cajas Bovinas CB',
    bovino_caja_pt: '📦 Cajas Bovinas PT',
    cerdo_corte: '🐷 Cerdo — Cortes',
    cerdo_pieza: '🐷 Cerdo — Piezas',
    embutido: '🌭 Embutidos',
    pollo: '🍗 Pollo x Kg',
    pollo_cajon: '🍗 Pollo x Cajón',
    rebozado: '🧊 Rebozado x Kg',
    rebozado_cajon: '🧊 Rebozado x Cajón',
    insumos: '🧰 Insumos',
  }
  // CATEGORIA_A_STOCK se movió a nivel de módulo (arriba) para que RemitosTab
  // también pueda usarlo al revertir el stock de un remito anulado.
  const DESTINOS_FRANQUICIA = { 'CENTRO': 'ALVEAR', 'MONTE CRISTO': 'MONTE CRISTO' }
  const categorias = [...new Set(todosPrecios.map(p => p.categoria))]
  // Una pieza SIEMPRE se vende entera del stock de piezas despostadas
  // (piezas_stock), eligiendo el precio de la lista PIEZAS BOVINAS. Por eso el
  // despacho usa la categoría virtual 'pieza_entera' y SE ELIMINA la categoría
  // por kg 'bovino_pieza' del dropdown (sus productos siguen existiendo, pero
  // solo como lista de precios para la pieza entera, no para vender kg sueltos).
  const categoriasDropdown = (() => {
    const lista = categorias.filter(c => c !== 'bovino_pieza' && c !== 'pieza_entera')
    const insertAt = lista.indexOf('bovino_mr') >= 0 ? lista.indexOf('bovino_mr') + 1 : 0
    lista.splice(insertAt, 0, 'pieza_entera')
    return lista
  })()
  // Para 'pieza_entera' el precio sale de la lista PIEZAS BOVINAS (categoría
  // bovino_pieza); para el resto, los productos de su propia categoría.
  const productosFiltrados = form.categoria === 'pieza_entera'
    ? todosPrecios.filter(p => p.categoria === 'bovino_pieza')
    : todosPrecios.filter(p => p.categoria === form.categoria)
  const clientesFiltrados = clientes.filter(c => c.nombre.toLowerCase().includes(busqueda.toLowerCase()))
  const esClienteExterno = ['carniceria', 'mayorista'].includes(form.destino)
  const esFranquicia = ['CENTRO', 'MONTE CRISTO'].includes(form.destino)

  // Lista de precios para el despacho.
  // Prioridad: si hay un cliente seleccionado con lista_precios definida
  // (incluyendo 'min' minorista), esa pisa el fallback del destino.
  // Esto permite que un cliente cuenta-corriente cargado como minorista
  // reciba precios minoristas aunque el despacho sea por "carnicería".
  function getLista(dest, clienteId = null) {
    if (clienteId) {
      const cli = clientes.find(c => c.id === clienteId)
      if (cli?.lista_precios) return getCampoPrecio(cli.lista_precios)
    }
    return dest === 'mayorista' ? 'precio_mayorista' : 'precio_carniceria'
  }

  // Mapa campo de lista → flag de la oferta que indica si aplica a esa lista
  const LISTA_A_FLAG_OFERTA = {
    precio_mayorista: 'aplica_mayorista',
    precio_carniceria: 'aplica_carniceria',
    precio_minorista: 'aplica_minorista',
  }

  // Resuelve el precio de un producto para una lista, aplicando la oferta
  // vigente si existe y aplica a esa lista. Igual que resolverPrecio en Caja:
  // si hay descuento_pct lo aplica sobre el precio base; si hay precio_oferta
  // fijo, usa ese. Si no hay oferta, devuelve el precio normal de la lista.
  function precioConOferta(prod, listaField) {
    if (!prod) return 0
    const base = Number(prod[listaField]) || Number(prod.precio_mayorista) || 0
    const flag = LISTA_A_FLAG_OFERTA[listaField] || 'aplica_mayorista'
    // Ofertas viejas sin flags se asumen aplicables (default DB es TRUE)
    const oferta = ofertas.find(o => o.precio_id === prod.id && o[flag] !== false)
    if (oferta) {
      if (oferta.descuento_pct != null && Number(oferta.descuento_pct) > 0) {
        return Math.round(base * (1 - Number(oferta.descuento_pct) / 100))
      }
      if (oferta.precio_oferta != null && Number(oferta.precio_oferta) > 0) {
        return Number(oferta.precio_oferta)
      }
    }
    return base
  }

  function seleccionarCliente(c) {
    setForm(f => ({ ...f, clienteId: c.id, clienteNombre: c.nombre, domicilio: c.domicilio || '' }))
    setBusqueda(c.nombre)
    setMostrarClientes(false)
    // Si ya había un producto seleccionado, recalcular el precio con la
    // lista del cliente recién elegido (puede tener lista distinta al destino),
    // aplicando la oferta vigente si corresponde.
    if (form.productoId) {
      const prod = todosPrecios.find(p => p.id === form.productoId)
      if (prod) {
        const precio = precioConOferta(prod, getLista(form.destino, c.id))
        setForm(f => ({ ...f, productoId: f.productoId, precio, clienteId: c.id, clienteNombre: c.nombre, domicilio: c.domicilio || '' }))
      }
    }
  }

  function onProductoChange(id) {
    if (!id) return
    const prod = todosPrecios.find(p => p.id === id)
    if (!prod) return
    // Precio según la lista del despacho, aplicando la oferta vigente si la hay
    const precio = precioConOferta(prod, getLista(form.destino, form.clienteId))
    setForm(f => ({ ...f, productoId: id, precio }))
  }

  // Normaliza para matchear nombres (minúsculas, sin acentos, espacios colapsados).
  function normalizarNombre(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
  }
  // Busca el producto de la lista PIEZAS BOVINAS que corresponde al tipo de una
  // pieza física (ej. tipo "Costillar Completo" → producto "Costillar Completo
  // (Costilla-Vacío-Matambre)"). Prioridad: exacto → empieza con → contiene.
  // Devuelve null si no hay match (ej. "Pierna" no tiene producto) → precio manual.
  function buscarProductoPorTipoPieza(tipoPieza) {
    const t = normalizarNombre(tipoPieza)
    if (!t) return null
    const prods = todosPrecios.filter(p => p.categoria === 'bovino_pieza')
    return prods.find(p => normalizarNombre(p.nombre) === t)
      || prods.find(p => normalizarNombre(p.nombre).startsWith(t))
      || prods.find(p => normalizarNombre(p.nombre).includes(t))
      || null
  }
  // Al elegir una pieza física: setea el kg y, si hay match en la lista, también
  // el producto (tipo) y el precio con oferta. El precio queda editable a mano.
  function seleccionarPiezaEntera(pz) {
    setPiezaEnteraSeleccionada(pz)
    const prodMatch = buscarProductoPorTipoPieza(pz.tipo_pieza)
    if (prodMatch) {
      const precio = precioConOferta(prodMatch, getLista(form.destino, form.clienteId))
      setForm(f => ({ ...f, kg: String(pz.kg), productoId: prodMatch.id, precio }))
    } else {
      setForm(f => ({ ...f, kg: String(pz.kg) }))
    }
  }
async function agregarItem() {
    const esUnidadLocal = CATEGORIAS_POR_UNIDAD.has(form.categoria)
    const unidadLabel = esUnidadLocal ? 'cantidad' : 'kg'
    const esCajaLocal = form.categoria === 'bovino_caja_cb' || form.categoria === 'bovino_caja_pt'
    // Pieza entera: primero exigimos elegir la pieza física del stock (de ahí
    // sale el kg) y el tipo de pieza de la lista PIEZAS BOVINAS (de ahí el precio).
    if (form.categoria === 'pieza_entera' && !piezaEnteraSeleccionada) { showAlert({ type: 'error', msg: 'Seleccioná la pieza del stock (abajo)' }); return }
    if (esCajaLocal && !cajaSeleccionada) { showAlert({ type: 'error', msg: 'Seleccioná una caja del stock' }); return }
    // Para cajas CB/PT: si hay una caja seleccionada del stock individual,
    // el kg viene de la caja (no del input del form). El precio sí del form.
    if (esCajaLocal && cajaSeleccionada) {
      if (!form.precio) { showAlert({ type: 'error', msg: 'Cargá el precio/kg' }); return }
    } else {
      if (!form.kg || !form.precio) { showAlert({ type: 'error', msg: `Completá ${unidadLabel} y precio` }); return }
    }
    // pieza_entera NO requiere producto: el precio se autocompleta al elegir la
    // pieza (si hay match en PIEZAS BOVINAS) pero también puede ponerse a mano.
    if (form.categoria !== 'bovino_mr' && form.categoria !== 'pieza_entera' && !esCajaLocal && !form.productoId) {
      showAlert({ type: 'error', msg: 'Seleccioná un producto' }); return
    }

    const prod = todosPrecios.find(p => p.id === form.productoId)
    let descripcion
    if (form.categoria === 'bovino_mr') {
      descripcion = mediaSeleccionada ? `Media Res — ${mediaSeleccionada.descripcion || mediaSeleccionada.proveedor_nombre}` : 'Media Res'
    } else if (form.categoria === 'pieza_entera') {
      descripcion = `${piezaEnteraSeleccionada.tipo_pieza} #${piezaEnteraSeleccionada.id} (${piezaEnteraSeleccionada.proveedor_origen || 's/proveedor'})`
    } else if (esCajaLocal && cajaSeleccionada) {
      descripcion = `Caja ${cajaSeleccionada.tipo_caja} #${cajaSeleccionada.id} — ${Number(cajaSeleccionada.kg).toFixed(1)} kg`
    } else {
      descripcion = prod?.nombre || ''
    }
    const prodItem = (form.categoria !== 'bovino_mr' && form.categoria !== 'pieza_entera') ? todosPrecios.find(p => p.id === form.productoId) : null
    // Para cajas: kg viene de la caja seleccionada, no del form
    // parseNumero acepta coma/punto (ej. "12,5" o "12.5" funcionan igual)
    const kgItem = esCajaLocal && cajaSeleccionada ? Number(cajaSeleccionada.kg) : parseNumero(form.kg)
    const precioItem = parseNumero(form.precio)
const item = {
  descripcion,
  kg: kgItem,
  precio: precioItem,
  importe: kgItem * precioItem,
  tipo: form.categoria,
  // 'u' para items vendidos por unidad (cajones, almacén, bebidas) y 'kg'
  // para items pesables. Las cajas individuales usan 'kg' porque la
  // unidad real de venta es el kg (cada caja tiene su peso propio).
  unidad: (esUnidadLocal && !esCajaLocal) ? 'u' : 'kg',
  stock_origen: form.categoria === 'pieza_entera' ? (piezaEnteraSeleccionada?.tipo_stock || bucketDePiezaBovina(piezaEnteraSeleccionada?.tipo_pieza)) : (prodItem?.stock_origen || null),
  kg_por_unidad: prodItem?.kg_por_unidad || null,
  media_res_id: mediaSeleccionada?.id || null,
  pieza_id: form.categoria === 'pieza_entera' ? piezaEnteraSeleccionada?.id : null,
  pieza_tipo: form.categoria === 'pieza_entera' ? piezaEnteraSeleccionada?.tipo_pieza : null,
  // caja_id: para cajas individuales — al guardar el remito se llama
  // venderCaja(caja_id) que la marca como 'vendida' en cajas_stock.
  caja_id: esCajaLocal ? cajaSeleccionada?.id : null,
  caja_tipo: esCajaLocal ? cajaSeleccionada?.tipo_caja : null,
}
    setItems(prev => [...prev, item])
    setForm(f => ({ ...f, kg: '', productoId: '', precio: '', categoria: '' }))
    // IMPORTANTE: ni media res ni cajas se descuentan del stock al agregarse
    // al carrito. Se marca como vendida recién en guardar() cuando se confirma.
    if (mediaSeleccionada) setMediaSeleccionada(null)
    if (piezaEnteraSeleccionada) setPiezaEnteraSeleccionada(null)
    if (cajaSeleccionada) setCajaSeleccionada(null)
  }
 
  function quitarItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  function agregarItemManual() {
    const desc = formManual.descripcion.trim()
    const imp = parseNumero(formManual.importe)
    if (!desc) { showAlert({ type: 'error', msg: 'Ingresá una descripción' }); return }
    if (!imp || imp <= 0) { showAlert({ type: 'error', msg: 'Ingresá un importe válido' }); return }
    setItems(prev => [...prev, {
      descripcion: desc,
      kg: 0,
      precio: 0,
      importe: imp,
      tipo: 'manual',
      stock_origen: null,
      media_res_id: null,
      manual: true
    }])
    setFormManual({ descripcion: '', importe: '' })
  }
  const total = items.reduce((s, i) => s + i.importe, 0)

  async function guardar() {
    // Bloqueo síncrono contra doble emisión (doble click / doble envío).
    if (guardandoRef.current) return
    if (items.length === 0) { showAlert({ type: 'error', msg: 'Agregá al menos un producto' }); return }
    if (!form.destino) { showAlert({ type: 'error', msg: 'Elegí un destino antes de despachar' }); return }
    if (esFechaFutura(form.fecha)) { showAlert({ type: 'error', msg: `⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})` }); return }
    // Guardia anti-"media res sin media física": una media res debe venderse
    // ELIGIÉNDOLA de la lista de "Medias Reses disponibles" (eso marca la MR-XXX
    // física como vendida y la saca del stock). Si se carga como producto genérico
    // "Media Res" de la lista de precios queda sin media_res_id y la media física
    // nunca se descuenta — sigue figurando "disponible" para siempre (bug Alvear
    // remito 434, 13/06: MR-098 quedó disponible tras venderse). Bloqueamos acá.
    if (items.some(it => it.tipo === 'bovino_mr' && !it.media_res_id)) {
      showAlert({ type: 'error', msg: '⚠️ La "Media Res" está cargada como producto suelto. Quitala del carrito y elegí la media física desde la lista de "Medias Reses disponibles", así se descuenta del stock y queda trazada.' })
      return
    }
    // Pago dividido (cobro='mixto'): 2+ formas con monto y la suma debe igualar
    // el total. Se guarda el desglose en remitos.pagos. Es 100% pagado → no
    // genera deuda en cuenta corriente (cobro != 'cta_cte').
    let pagosMixto = null
    if (form.cobro === 'mixto') {
      pagosMixto = pagosSplit
        .map(p => ({ metodo: p.metodo, monto: parseNumero(p.monto) }))
        .filter(p => p.monto > 0)
      if (pagosMixto.length < 2) {
        showAlert({ type: 'error', msg: 'El pago dividido necesita al menos 2 formas con monto cargado' }); return
      }
      const sumaPagos = pagosMixto.reduce((s, p) => s + p.monto, 0)
      if (Math.abs(sumaPagos - total) > 1) {
        showAlert({ type: 'error', msg: `Los pagos suman $${Math.round(sumaPagos).toLocaleString('es-AR')} pero el total es $${Math.round(total).toLocaleString('es-AR')}. Tienen que coincidir.` }); return
      }
    }
    guardandoRef.current = true
    setGuardando(true)
    try {
    let clienteId = form.clienteId
    let clienteNombre = form.clienteNombre || form.destino
    let domicilio = form.domicilio
    // Contacto adicional para el remito impreso (importante para el repartidor)
    let telefono = ''
    let localidad = ''
    // Si el cliente esta en el dropdown, traer telefono + localidad del registro
    if (clienteId) {
      const cliReg = clientes.find(c => c.id === clienteId)
      if (cliReg) {
        telefono  = cliReg.telefono  || ''
        localidad = cliReg.localidad || ''
      }
    }

    if (esFranquicia) {
      const nombreBuscar = DESTINOS_FRANQUICIA[form.destino]
      const { data: clienteFranquicia } = await supabase.from('clientes').select('*').ilike('nombre', `%${nombreBuscar}%`).single()
      if (clienteFranquicia) {
        clienteId = clienteFranquicia.id
        clienteNombre = clienteFranquicia.nombre
        domicilio = clienteFranquicia.domicilio || form.destino
        telefono  = clienteFranquicia.telefono  || telefono
        localidad = clienteFranquicia.localidad || localidad
      }
    }

    // Las salidas se crean acá (una por item) y se vinculan al remito apenas
    // este existe (más abajo). El vínculo remito_id es clave: al anular el
    // remito, sus salidas se borran con él. Sin esto quedaban vivas inflando
    // el Dashboard (bug Andrea Angaramo 13/06: remito x1000 anulado pero su
    // salida seguía sumando al podio mayorista).
    const salidaIds = []
    for (const item of items) {
      const { data: salIns } = await supabase.from('salidas_deposito').insert({
        fecha: form.fecha, cliente_nombre: clienteNombre,
        tipo: item.tipo, descripcion: item.descripcion,
        kg: item.kg, precio_kg: item.precio,
        total: item.importe, lista: getLista(form.destino, clienteId),
        cobro: form.cobro, notas: form.notas
      }).select('id').single()
      if (salIns?.id) salidaIds.push(salIns.id)
    }

    const kgPorTipo = {}
for (const item of items) {
  if (item.manual) continue  // los items manuales (descartables/insumos) no descuentan stock
  if (item.tipo === 'insumos') continue  // los insumos no tienen stock — solo se facturan
  // Cajas individuales: las marcamos vendidas con venderCaja() abajo, que
  // ya decrementa stock_actual.caja_cb/caja_pt por su peso individual.
  // Skipear acá para no descontar dos veces.
  if (item.caja_id) continue
  // resolverDescuentoStock maneja el caso especial de cajones (pollo_cajon /
  // rebozado_cajon) que descuentan kg del producto base, multiplicando
  // unidades × kg_por_cajón (parseado del nombre, ej. "X20KG").
  const { tipoStock, cantidad } = resolverDescuentoStock(item, CATEGORIA_A_STOCK)
  if (!tipoStock) continue  // categoría sin tracking de stock (ej. embutido sin stock_origen)
  kgPorTipo[tipoStock] = (kgPorTipo[tipoStock] || 0) + cantidad
}
   for (const [tipo, kg] of Object.entries(kgPorTipo)) {
      await actualizarStock(tipo, -kg)
    }
      // Recien aca marcamos las medias res como despostadas: el despacho ya se registro.
      const mediasIds = items.map(it => it.media_res_id).filter(Boolean)
      if (mediasIds.length > 0) {
        await supabase.from('entradas_deposito').update({ despostada: true }).in('id', mediasIds)
        // Marcar las medias como vendidas en medias_stock (no despostadas: en este
        // flujo de venta mayorista la media se va entera al cliente).
        await supabase.from('medias_stock').update({
          estado: 'vendida',
          cliente_nombre: clienteNombre,
          cliente_id: clienteId || null,
          fecha_salida: form.fecha,
          destino: form.destino,
        }).in('entrada_id', mediasIds)
      }
      setMediaSeleccionada(null)
      const { data: medias } = await supabase.from('entradas_deposito').select('*').eq('tipo', 'bovino_mr').eq('despostada', false).eq('eliminado', false).order('fecha', { ascending: false }).order('created_at', { ascending: false })
      setMediasDisponibles(medias || [])
    const { data: remitoData } = await supabase.from('remitos').insert({
      fecha: form.fecha, cliente_nombre: clienteNombre,
      cliente_id: clienteId || null,
      domicilio, telefono, localidad,
      items, total, cobro: form.cobro, pagos: pagosMixto, notas: form.notas
    }).select().single()

    // Vincular las salidas_deposito recién creadas con este remito (por id, no
    // por atributos) → al anularlo se borran con él y el Dashboard no se infla.
    if (salidaIds.length && remitoData?.id) {
      await supabase.from('salidas_deposito').update({ remito_id: remitoData.id }).in('id', salidaIds)
    }

    // Marcar cajas individuales como vendidas (cajas_stock) — venderCaja
    // también decrementa stock_actual.caja_cb / caja_pt automáticamente.
    const itemsCajas = items.filter(it => it.caja_id)
    for (const it of itemsCajas) {
      const { error: errCaja } = await venderCaja(it.caja_id, {
        destino: form.destino,
        clienteId: clienteId || null,
        clienteNombre,
        precioVentaKg: it.precio,
        totalVenta: it.importe,
        fechaSalida: form.fecha,
        notas: 'Vendida en remito N° ' + String(remitoData?.numero || remitoData?.id || '').padStart(5, '0'),
      })
      if (errCaja) console.warn('No se pudo marcar caja vendida:', errCaja)
    }
    if (itemsCajas.length > 0) await recargarCajasDispVenta()

    // Marcar piezas individuales vendidas (de cualquier item con tipo='pieza_entera')
    const itemsPiezaEntera = items.filter(it => it.tipo === 'pieza_entera' && it.pieza_id)
    for (const it of itemsPiezaEntera) {
      const { error: errVend } = await supabase.from('piezas_stock').update({
        estado: 'vendida',
        destino: form.destino,
        cliente_id: clienteId || null,
        cliente_nombre: clienteNombre,
        precio_venta_kg: it.precio,
        total_venta: it.importe,
        fecha_salida: form.fecha,
        notas_salida: 'Vendida entera en remito N° ' + String(remitoData?.numero || remitoData?.id || '').padStart(5, '0'),
      }).eq('id', it.pieza_id)
      if (errVend) console.warn('No se pudo marcar pieza vendida:', errVend.message)
    }
    if (itemsPiezaEntera.length > 0) await recargarPiezasDispVenta()

    // Solo los despachos a CUENTA CORRIENTE generan deuda en el ledger del
    // cliente. Si el cobro es contado (efectivo/transferencia/cheque/echeq) el
    // remito ya queda pago: NO se registra movimiento de cta cte ni se toca el
    // saldo. (Antes se cargaba la compra siempre → el cliente "debía" algo que
    // ya había pagado.)
    if (clienteId && form.cobro === 'cta_cte') {
      await supabase.from('movimientos_ctacte').insert({
        cliente_id: clienteId, fecha: form.fecha, tipo: 'compra',
        descripcion: `Remito N° ${String(remitoData?.numero || '').padStart(5, '0')} — ${items.map(i => i.descripcion).join(', ')}`,
        debe: total, haber: 0, saldo: 0, remito_id: remitoData?.id || null
      })
      // El saldo (del movimiento y del cliente) lo fija el recálculo desde el ledger.
      await recomputarSaldoCliente(clienteId)
    }

    showAlert({ type: 'success', msg: '✅ Despacho registrado — Stock descontado — Remito generado' })
    onRemito(remitoData)
    setItems([])
    setBusqueda('')
    setForm({ destino: 'MITRE', clienteId: '', clienteNombre: '', domicilio: '', fecha: fechaHoyARG(), categoria: '', productoId: '', kg: '', precio: '', cobro: 'cta_cte', notas: '' })
    setPagosSplit([{ metodo: 'efectivo', monto: '' }, { metodo: 'transferencia', monto: '' }])
    // Refrescar el stockMap para que las cajas/almacén/bebidas reflejen la
    // resta inmediatamente — sin esto, el cajero ve disponibilidad vieja
    // hasta que recarga la página.
    recargarStockMap()
    onSaved()
    setTimeout(() => { showAlert(null); setTab('remitos') }, 1500)
    } catch (err) {
      showAlert({ type: 'error', msg: '❌ Error al registrar el despacho: ' + (err?.message || err) })
    } finally {
      guardandoRef.current = false
      setGuardando(false)
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Registrar despacho</div>
        <div className="form-row">
          <div className="form-group"><label>Destino</label>
            <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value, clienteId: '', clienteNombre: '' }))}>
              <option value="">— Seleccioná destino —</option>
              <option value="CENTRO">🏪 Centro — Alvear (Roxana)</option>
              <option value="MONTE CRISTO">🏪 Monte Cristo (Agustín)</option>
              <option value="carniceria">Carnicería cliente</option>
              <option value="mayorista">Gastronómico / Mayorista</option>
            </select>
          </div>
          <div className="form-group"><label>Fecha</label>
            <input type="date" value={form.fecha} max={fechaHoyARG()} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          </div>
        </div>
{form.categoria === 'bovino_mr' && (() => {
  // Ocultar las medias que ya estan agregadas al carrito (sin descontarlas del stock).
  const idsEnCarrito = items.map(it => it.media_res_id).filter(Boolean)
  const mediasVisibles = mediasDisponibles.filter(m => !idsEnCarrito.includes(m.id))
  return (
  <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#7dff7d', marginBottom: 10 }}>🐄 Seleccioná la media res a despachar</div>
    <AvisoDuplicadas cantidad={idsConPosibleDuplicado(mediasVisibles).size} />
    {mediasVisibles.length === 0 ? (
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin medias reses disponibles</div>
    ) : (() => { const dupIds = idsConPosibleDuplicado(mediasVisibles); return mediasVisibles.map(e => (
      <div key={e.id} onClick={() => { setMediaSeleccionada(e); setForm(f => ({ ...f, kg: (e.kg_real || e.kg || 0).toString() })) }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer', border: `2px solid ${mediaSeleccionada?.id === e.id ? 'var(--gold)' : (dupIds.has(e.id) ? '#ffb86b' : 'var(--border)')}`, background: mediaSeleccionada?.id === e.id ? 'rgba(201,168,76,0.1)' : 'var(--surface2)' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>🐄 {e.descripcion || 'Media Res'}{dupIds.has(e.id) && <TagDuplicada />}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
        </div>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{(Number(e.kg_real) || Number(e.kg) || 0).toFixed(1)} kg</div>
      </div>
    )) })()}
  </div>
  )
})()}
{form.categoria === 'pieza_entera' && (() => {
  const idsEnCarrito = items.filter(it => it.tipo === 'pieza_entera').map(it => it.pieza_id).filter(Boolean)
  const piezasVisibles = piezasDispVenta.filter(p => !idsEnCarrito.includes(p.id))
  // agrupadas por tipo
  const porTipo = {}
  piezasVisibles.forEach(pz => { (porTipo[pz.tipo_pieza] = porTipo[pz.tipo_pieza] || []).push(pz) })
  return (
  <div style={{ background: '#2a1f1a', border: '1px solid #5a3d2d', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 10 }}>🥩 Seleccioná la pieza entera a vender</div>
    {piezasVisibles.length === 0 ? (
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin piezas individuales disponibles. Despostá una media res primero.</div>
    ) : Object.entries(porTipo).map(([tipo, lista]) => (
      <div key={tipo} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{tipo} ({lista.length})</div>
        {lista.map(pz => (
          <div key={pz.id}
            onClick={() => seleccionarPiezaEntera(pz)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, marginBottom: 4, cursor: 'pointer', border: `2px solid ${piezaEnteraSeleccionada?.id === pz.id ? 'var(--gold)' : 'var(--border)'}`, background: piezaEnteraSeleccionada?.id === pz.id ? 'rgba(201,168,76,0.12)' : 'var(--surface2)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12 }}>#{pz.id} · {pz.tipo_pieza}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pz.proveedor_origen || '—'} · MR del {pz.fecha_ingreso}{pz.modelo_desposte && ' · Mod. ' + pz.modelo_desposte}</div>
            </div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{(Number(pz.kg) || 0).toFixed(1)} kg</div>
          </div>
        ))}
      </div>
    ))}
  </div>
  )
})()}
        {esFranquicia && (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 600 }}>🏪 Franquicia — el remito se cargará automáticamente en su legajo</span>
          </div>
        )}

        {esClienteExterno && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Buscar cliente</label>
            <input value={busqueda}
              onChange={e => { setBusqueda(e.target.value); setMostrarClientes(true); setForm(f => ({ ...f, clienteId: '', clienteNombre: e.target.value })) }}
              onFocus={() => setMostrarClientes(true)}
              placeholder="Escribí el nombre del cliente..."
              style={{ background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }} />
            {mostrarClientes && clientesFiltrados.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                {clientesFiltrados.map(c => (
                  <div key={c.id} onClick={() => seleccionarCliente(c)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.tipo}</span>
                  </div>
                ))}
              </div>
            )}
            {form.clienteId && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>✅ Cliente vinculado</div>}
          </div>
        )}

        {!esFranquicia && (
          <div className="form-row">
            <div className="form-group"><label>Señor/a</label>
              <input placeholder="Nombre" value={form.clienteNombre} onChange={e => setForm(f => ({ ...f, clienteNombre: e.target.value }))} disabled={!!form.clienteId} style={{ opacity: form.clienteId ? 0.6 : 1 }} />
            </div>
            <div className="form-group"><label>Domicilio</label>
              <input placeholder="Dirección" value={form.domicilio} onChange={e => setForm(f => ({ ...f, domicilio: e.target.value }))} />
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group"><label>Categoría</label>
            <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, productoId: '', precio: '' }))}>
              <option value="">— Seleccioná —</option>
              {categoriasDropdown.map(c => <option key={c} value={c}>{CATEGORIAS[c] || c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>{form.categoria === 'pieza_entera' ? 'Tipo de pieza (precio)' : 'Producto'}</label>
            {esCaja ? (
              <div style={{ padding: '8px 12px', background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                ↓ Elegí una caja del stock individual abajo
              </div>
            ) : (
              <select value={form.productoId} onChange={e => onProductoChange(e.target.value)} disabled={!form.categoria}>
                <option value="">{form.categoria === 'pieza_entera' ? '— Tipo de pieza (precio PIEZAS BOVINAS) —' : '— Seleccioná producto —'}</option>
                {productosFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Selector de cajas individuales (CB / PT) — reemplaza el banner viejo.
            Cada caja tiene su peso propio cargado en el ingreso. Al seleccionar
            una, el form usa su kg automáticamente. Las cajas ya en el carrito
            (sin guardar todavía) se ocultan para no venderlas dos veces.
            Filtra por producto_id si el usuario eligió un producto específico:
            así "Bola de Lomo Caja PT" sólo muestra cajas de Bola de Lomo. */}
        {esCaja && (() => {
          const tipoCaja = CATEGORIA_A_TIPO_CAJA[form.categoria]
          const idsEnCarrito = items.filter(it => it.caja_id).map(it => it.caja_id)
          const cajasVisibles = cajasDispVenta.filter(c => {
            if (c.tipo_caja !== tipoCaja) return false
            if (idsEnCarrito.includes(c.id)) return false
            // Si el usuario eligió un producto, filtrar por ese producto
            // (mostrar también las "genericas" sin producto_id como fallback)
            if (form.productoId && c.producto_id && c.producto_id !== form.productoId) return false
            return true
          })
          return (
            <div style={{ background: '#1a2a3a', border: '1px solid #2d3a5a', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7db5ff' }}>
                  📦 Seleccioná la caja {tipoCaja} a despachar
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {cajasVisibles.length} disponible{cajasVisibles.length === 1 ? '' : 's'} en stock
                </div>
              </div>
              {cajasVisibles.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 0' }}>
                  Sin cajas {tipoCaja} disponibles en el depósito. Cargá nuevas desde Entradas.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                  {cajasVisibles.map(c => (
                    <div key={c.id}
                      onClick={() => { setCajaSeleccionada(c); setForm(f => ({ ...f, kg: String(c.kg) })) }}
                      style={{
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        border: `2px solid ${cajaSeleccionada?.id === c.id ? 'var(--gold)' : 'var(--border)'}`,
                        background: cajaSeleccionada?.id === c.id ? 'rgba(201,168,76,0.12)' : 'var(--surface2)',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>📦 Caja {c.tipo_caja} #{c.id}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.proveedor_origen || 's/proveedor'} · {c.fecha_ingreso}</div>
                        </div>
                        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{Number(c.kg).toFixed(1)} kg</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        <div className="form-row">
          <div className="form-group"><label>{esCaja ? 'Kg (auto desde la caja seleccionada)' : esUnidad ? 'Cantidad de unidades' : 'Kg'}</label>
            <input
              type="number"
              step={esUnidad && !esCaja ? '1' : '0.01'}
              min={esUnidad && !esCaja ? '1' : '0'}
              placeholder={esUnidad && !esCaja ? '1' : '0'}
              value={form.kg}
              onChange={e => setForm(f => ({ ...f, kg: e.target.value }))}
              disabled={esCaja && !!cajaSeleccionada}
              style={esCaja && !!cajaSeleccionada ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            />
          </div>
          <div className="form-group"><label>{esCaja ? 'Precio por kg ($)' : esUnidad ? 'Precio por unidad' : 'Precio/kg'}</label>
            <input type="number" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} style={{ borderColor: 'var(--gold)' }} />
            {(() => {
              // Indicador de oferta: si el producto seleccionado tiene oferta vigente
              // para la lista del despacho y el precio cargado es el de oferta.
              const prodSel = todosPrecios.find(p => p.id === form.productoId)
              if (!prodSel) return null
              const listaField = getLista(form.destino, form.clienteId)
              const base = Number(prodSel[listaField]) || 0
              const conOf = precioConOferta(prodSel, listaField)
              if (conOf < base && base > 0) {
                return (
                  <div style={{ fontSize: 11, color: '#7dff7d', marginTop: 4, fontWeight: 700 }}>
                    🏷️ Oferta aplicada — antes ${Math.round(base).toLocaleString('es-AR')}
                  </div>
                )
              }
              return null
            })()}
          </div>
        </div>

        <button className="btn btn-ghost" onClick={agregarItem} style={{ marginBottom: 12 }}>➕ Agregar producto al remito</button>

        <div style={{ background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📦 Otro ítem manual (descartables, insumos, etc.)</div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <div className="form-group" style={{ flex: 2 }}><label>Descripción</label>
              <input placeholder="Ej: Bolsas N°2, Cinta, Bandejas..." value={formManual.descripcion} onChange={e => setFormManual(f => ({ ...f, descripcion: e.target.value }))} onKeyDown={e => e.key === 'Enter' && agregarItemManual()} />
            </div>
            <div className="form-group" style={{ flex: 1 }}><label>Importe $</label>
              <input type="number" step="0.01" placeholder="0" value={formManual.importe} onChange={e => setFormManual(f => ({ ...f, importe: e.target.value }))} onKeyDown={e => e.key === 'Enter' && agregarItemManual()} />
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={agregarItemManual} className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}>➕ Agregar al remito</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>No descuenta stock — solo se suma al total del remito.</div>
        </div>

        {items.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <table>
              <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Importe</th><th></th></tr></thead>
              <tbody>
                {items.map((item, i) => {
                  // unidad: 'u' (cajón/caja/almacén/bebida) o 'kg' (peso).
                  // Para items viejos sin unidad explícita asumimos 'kg' (legacy).
                  const u = item.unidad || 'kg'
                  const cantidadTxt = u === 'u'
                    ? `${item.kg} ${item.kg === 1 ? 'unidad' : 'unidades'}`
                    : `${item.kg} kg`
                  const precioTxt = u === 'u'
                    ? `$${Math.round(item.precio).toLocaleString('es-AR')}/u`
                    : `$${Math.round(item.precio).toLocaleString('es-AR')}/kg`
                  return (
                    <tr key={i}>
                      <td>{item.manual && <span style={{ fontSize: 10, color: 'var(--muted)', marginRight: 4 }}>📦</span>}{item.descripcion}</td>
                      <td>{item.manual ? '—' : cantidadTxt}</td>
                      <td>{item.manual ? '—' : precioTxt}</td>
                      <td style={{ color: 'var(--gold)' }}>${Math.round(item.importe).toLocaleString('es-AR')}</td>
                      <td><button onClick={() => quitarItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', marginTop: 8 }}>
              TOTAL: ${Math.round(total).toLocaleString('es-AR')}
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group"><label>Forma de cobro</label>
            <select value={form.cobro} onChange={e => setForm(f => ({ ...f, cobro: e.target.value }))}>
              <option value="cta_cte">Cuenta corriente</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="echeq">E-cheq</option>
              <option value="mixto">💰 Pago dividido (2-3 formas)</option>
            </select>
          </div>
          <div className="form-group"><label>Notas</label>
            <input placeholder="Observaciones" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>
        </div>

        {/* Editor de pago dividido: una venta cobrada en 2-3 formas distintas.
            Los montos deben sumar el total. No genera deuda (es 100% pagado). */}
        {form.cobro === 'mixto' && (() => {
          const sumaPagos = pagosSplit.reduce((s, p) => s + (parseNumero(p.monto) || 0), 0)
          const restante = total - sumaPagos
          const ok = Math.abs(restante) <= 1
          return (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 10 }}>💰 Repartí el cobro entre 2 o 3 formas — total a cubrir: ${Math.round(total).toLocaleString('es-AR')}</div>
              {pagosSplit.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <select value={p.metodo} onChange={e => setPagosSplit(arr => arr.map((x, j) => j === i ? { ...x, metodo: e.target.value } : x))} style={{ flex: 1 }}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="cheque">Cheque</option>
                    <option value="echeq">E-cheq</option>
                  </select>
                  <input type="number" step="0.01" placeholder="$ monto" value={p.monto}
                    onChange={e => setPagosSplit(arr => arr.map((x, j) => j === i ? { ...x, monto: e.target.value } : x))}
                    style={{ width: 150 }} />
                  <button type="button" title="Autocompletar con lo que falta"
                    onClick={() => setPagosSplit(arr => arr.map((x, j) => j === i ? { ...x, monto: String(Math.max(0, Math.round((total - arr.reduce((s, y, k) => s + (k === i ? 0 : (parseNumero(y.monto) || 0)), 0)) * 100) / 100)) } : x))}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>↪ resto</button>
                  {pagosSplit.length > 2 && (
                    <button type="button" onClick={() => setPagosSplit(arr => arr.filter((_, j) => j !== i))}
                      style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, color: '#ff6b6b' }}>🗑️</button>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                {pagosSplit.length < 3
                  ? <button type="button" onClick={() => setPagosSplit(arr => [...arr, { metodo: 'efectivo', monto: '' }])} style={{ background: 'var(--surface)', border: '1px dashed var(--gold)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--gold)' }}>➕ Agregar forma</button>
                  : <span />}
                <div style={{ fontSize: 12, fontWeight: 700, color: ok ? 'var(--green)' : 'var(--red-light)' }}>
                  Suma ${Math.round(sumaPagos).toLocaleString('es-AR')} / ${Math.round(total).toLocaleString('es-AR')}
                  {ok ? ' ✅' : ` · falta $${Math.round(restante).toLocaleString('es-AR')}`}
                </div>
              </div>
            </div>
          )
        })()}

        <button className="btn btn-gold" onClick={guardar} disabled={guardando} style={{ opacity: guardando ? 0.5 : 1, cursor: guardando ? 'not-allowed' : 'pointer' }}>{guardando ? '⏳ Registrando…' : '📤 Registrar despacho y generar remito'}</button>
      </div>
    </div>
  )
}

export function RemitosTab({ remitoActual }) {
  const [remitos, setRemitos] = useState([])
  const [seleccionado, setSeleccionado] = useState(remitoActual)
  const [anulando, setAnulando] = useState(false)
  const [editando, setEditando] = useState(null)
  const [itemsEdit, setItemsEdit] = useState([])
  const [fechaEdit, setFechaEdit] = useState('')   // fecha de emisión editable
  const [alert, setAlert] = useState(null)
  const [todosPrecios, setTodosPrecios] = useState([])
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  const [nuevoProductoId, setNuevoProductoId] = useState('')
  const [nuevoKg, setNuevoKg] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')

  // ── Filtros del historial: rango de fechas + cliente ──────────────────
  // Sirve para responder "¿cuánto vendí esta semana a mayoristas?": muestra
  // todos los remitos emitidos dentro del período (o los de un cliente puntual)
  // y la suma total.
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [fCliente, setFCliente] = useState('todos')

  // Clientes presentes en los remitos (para el selector)
  const clientesRemito = useMemo(() => {
    const nombres = new Set()
    remitos.forEach(r => { if (r.cliente_nombre) nombres.add(r.cliente_nombre) })
    return [...nombres].sort((a, b) => a.localeCompare(b))
  }, [remitos])

  // Remitos que pasan los filtros (r.fecha es 'YYYY-MM-DD', comparable como string)
  const remitosFiltrados = useMemo(() => remitos.filter(r => {
    if (fDesde && (r.fecha || '') < fDesde) return false
    if (fHasta && (r.fecha || '') > fHasta) return false
    if (fCliente !== 'todos' && r.cliente_nombre !== fCliente) return false
    return true
  }), [remitos, fDesde, fHasta, fCliente])

  // El total vendido excluye los anulados (no son ventas reales); igual se
  // listan tachados para trazabilidad.
  const remitosValidos = remitosFiltrados.filter(r => !r.eliminado)
  const totalFiltrado = remitosValidos.reduce((s, r) => s + (Number(r.total) || 0), 0)
  const anuladosEnFiltro = remitosFiltrados.length - remitosValidos.length
  const hayFiltro = !!(fDesde || fHasta || fCliente !== 'todos')

  function setSemanaActual() { setFDesde(lunesDeLaSemana()); setFHasta(domingoDeLaSemana()) }
  function setSemanaAnterior() {
    setFDesde(fechaRelativaARG(-7, new Date(lunesDeLaSemana() + 'T12:00')))
    setFHasta(fechaRelativaARG(-7, new Date(domingoDeLaSemana() + 'T12:00')))
  }
  function setMesActual() { const h = fechaHoyARG(); setFDesde(h.substring(0, 7) + '-01'); setFHasta(h) }
  function limpiarFiltros() { setFDesde(''); setFHasta(''); setFCliente('todos') }

  // Paginación del historial de remitos (ya filtrado)
  const pagRemitos = usePaginacion(remitosFiltrados, 20)
 const CATEGORIAS = {
    bovino_mr: '🐄 Media Reses', bovino_corte: '🥩 Bovinos — Cortes',
    bovino_brosa: '🫀 Brosas', bovino_pieza: '🍖 Piezas',
    bovino_caja_cb: '📦 Cajas CB', bovino_caja_pt: '📦 Cajas PT',
    cerdo_corte: '🐷 Cerdo — Cortes',
    cerdo_pieza: '🐷 Cerdo — Piezas',
    embutido: '🌭 Embutidos',
    pollo: '🍗 Pollo', rebozado: '🧊 Rebozados',
  }
  useEffect(() => {
    cargarRemitos()
    supabase.from('precios').select('*').order('nombre').then(({ data }) => setTodosPrecios(data || []))
  }, [])

  useEffect(() => { if (remitoActual) setSeleccionado(remitoActual) }, [remitoActual])

  async function cargarRemitos() {
    // Sin .limit — paginamos en cliente para mostrar todos los remitos históricos
    // Orden por FECHA DE EMISIÓN (no por created_at): así un remito cargado hoy
    // pero con fecha de la semana pasada cae en su lugar cronológico, que es lo
    // que valida el cierre semanal. Más nuevo arriba; created_at desempata.
    const { data } = await supabase.from('remitos').select('*')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
    setRemitos(data || [])
  }
  async function eliminarRemito(remito) {
  if (anulando) return
  if (!confirm(`¿Eliminar Remito N° ${String(remito.numero).padStart(5,'0')} de ${remito.cliente_nombre} por $${Math.round(remito.total).toLocaleString('es-AR')}?`)) return
  
  setAnulando(true)
  const { data: remitoActual } = await supabase.from('remitos').select('eliminado').eq('id', remito.id).single()
  if (remitoActual?.eliminado) {
    showAlert('Este remito ya fue anulado', 'error')
    setAnulando(false)
    return
  }
  const { data: { user } } = await supabase.auth.getUser()
  const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).single()
  const eliminadoPor = perfil?.nombre || user.email
  await supabase.from('remitos').update({
    eliminado: true,
    eliminado_por: eliminadoPor,
    eliminado_en: new Date().toISOString()
  }).eq('id', remito.id)

  // Borrar las salidas_deposito de este remito (son el registro denormalizado
  // que alimenta el Dashboard: mayorista, canales, podio). Si no se borran, el
  // remito anulado sigue inflando el panel. Match por remito_id (mig 60); para
  // remitos viejos sin vínculo, fallback por created_at del propio remito.
  const { data: salsDelRemito } = await supabase.from('salidas_deposito').select('id').eq('remito_id', remito.id)
  if (salsDelRemito && salsDelRemito.length > 0) {
    await supabase.from('salidas_deposito').delete().eq('remito_id', remito.id)
  } else if (remito.created_at) {
    // Remito viejo (pre-mig 60): sus salidas se insertaron justo antes de él.
    const desde = new Date(new Date(remito.created_at).getTime() - 60000).toISOString()
    await supabase.from('salidas_deposito').delete()
      .is('remito_id', null)
      .eq('fecha', remito.fecha)
      .eq('cliente_nombre', remito.cliente_nombre)
      .gte('created_at', desde)
      .lte('created_at', remito.created_at)
  }
  if (remito.cliente_id) {
    // Borramos el movimiento del remito y recalculamos el saldo desde el ledger.
    // Un remito pagado al contado no tiene movimiento → el recálculo da igual y no
    // toca el saldo. (Antes se restaba a mano, frágil ante numeric=string.)
    await supabase.from('movimientos_ctacte').delete().eq('remito_id', remito.id)
    await recomputarSaldoCliente(remito.cliente_id)
  }
  // Revertir cajas individuales vendidas en este remito (vuelven a 'disponible')
  const itemsCajas = (remito.items || []).filter(it => it.caja_id)
  for (const it of itemsCajas) {
    const { error } = await revertirVentaCaja(it.caja_id)
    if (error) console.warn('No se pudo revertir caja vendida:', error)
  }

  // ── REVERTIR MEDIAS / PIEZAS / STOCK ───────────────────────────────────
  // Espejo de lo que hace SalidaForm.guardar() al despachar. Antes faltaba:
  // al anular un remito, las medias quedaban 'vendida' (no volvían a aparecer
  // como disponibles), las piezas enteras quedaban vendidas, y los kg seguían
  // descontados del stock_actual. Ahora se devuelve todo.

  // Medias res → vuelven a 'disponible' y la entrada se libera por completo:
  //   despostada=false  → reaparece para despachar/despostar
  //   reservada=false   → se suelta la reserva (flujo) hacia la franquicia, así
  //                       vuelve a la lista de "Medias Reses disponibles" del
  //                       Desposte (esa lista filtra reservada=false). Sin esto
  //                       la media figura disponible en el Historial pero NO se
  //                       puede despostar/vender.
  const mediasIds = (remito.items || []).map(it => it.media_res_id).filter(Boolean)
  if (mediasIds.length > 0) {
    await supabase.from('entradas_deposito').update({ despostada: false, reservada: false }).in('id', mediasIds)
    await supabase.from('medias_stock').update({
      estado: 'disponible',
      cliente_nombre: null, cliente_id: null, fecha_salida: null, destino: null,
    }).in('entrada_id', mediasIds)
  }

  // Piezas enteras → vuelven a 'disponible', limpiando los datos de la venta.
  const itemsPiezaEntera = (remito.items || []).filter(it => it.tipo === 'pieza_entera' && it.pieza_id)
  for (const it of itemsPiezaEntera) {
    const { error } = await supabase.from('piezas_stock').update({
      estado: 'disponible',
      destino: null, cliente_id: null, cliente_nombre: null,
      precio_venta_kg: null, total_venta: null, fecha_salida: null, notas_salida: null,
    }).eq('id', it.pieza_id)
    if (error) console.warn('No se pudo revertir pieza vendida:', error.message)
  }

  // Devolver el stock descontado. Mismo criterio que guardar(): se saltean
  // los items manuales (no descontaron stock) y las cajas individuales (ya se
  // revirtieron arriba con revertirVentaCaja, que ajusta stock_actual).
  const kgPorTipoDevolver = {}
  for (const it of (remito.items || [])) {
    if (it.manual) continue
    if (it.caja_id) continue
    const { tipoStock, cantidad } = resolverDescuentoStock(it, CATEGORIA_A_STOCK)
    if (!tipoStock || !cantidad) continue
    kgPorTipoDevolver[tipoStock] = (kgPorTipoDevolver[tipoStock] || 0) + cantidad
  }
  for (const [tipo, kg] of Object.entries(kgPorTipoDevolver)) {
    await actualizarStock(tipo, kg)
  }

  showAlert('🗑️ Remito anulado', 'success')
  setAnulando(false)
  cargarRemitos()
}
function showAlert(msg, type = 'success') { setAlert({ msg, type }); setTimeout(() => setAlert(null), 4000) }

  function abrirEdicion(remito) {
    setEditando(remito)
    setItemsEdit(JSON.parse(JSON.stringify(remito.items || [])))
    setFechaEdit(remito.fecha || '')
    setSeleccionado(null)
  }

  function editarItem(idx, campo, valor) {
    setItemsEdit(prev => {
      const items = [...prev]
      items[idx] = { ...items[idx], [campo]: parseFloat(valor) || valor }
      if (campo === 'kg' || campo === 'precio') {
        items[idx].importe = (parseFloat(items[idx].kg) || 0) * (parseFloat(items[idx].precio) || 0)
      }
      return items
    })
  }

  function quitarItemEdit(idx) { setItemsEdit(prev => prev.filter((_, i) => i !== idx)) }

  function agregarItemEdit() {
    if (!nuevoKg || !nuevoPrecio || !nuevoProductoId) return
    const prod = todosPrecios.find(p => p.id === nuevoProductoId)
    const item = {
      descripcion: prod?.nombre || '',
      kg: parseFloat(nuevoKg),
      precio: parseFloat(nuevoPrecio),
      importe: parseFloat(nuevoKg) * parseFloat(nuevoPrecio),
      tipo: nuevaCategoria
    }
    setItemsEdit(prev => [...prev, item])
    setNuevoKg(''); setNuevoPrecio(''); setNuevoProductoId(''); setNuevaCategoria('')
  }

  async function guardarEdicion() {
    if (itemsEdit.length === 0) { showAlert('Debe tener al menos un producto', 'error'); return }
    if (!fechaEdit) { showAlert('La fecha de emisión no puede estar vacía', 'error'); return }
    if (esFechaFutura(fechaEdit)) { showAlert(`⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})`, 'error'); return }
    const nuevoTotal = itemsEdit.reduce((s, i) => s + (parseFloat(i.importe) || 0), 0)
    const diferencia = nuevoTotal - (editando.total || 0)
    const fechaAnterior = editando.fecha
    const fechaCambio = fechaEdit !== fechaAnterior

    await supabase.from('remitos').update({ items: itemsEdit, total: nuevoTotal, fecha: fechaEdit }).eq('id', editando.id)

    // Si cambió la fecha de emisión, mover también las salidas_deposito que se
    // crearon JUNTO con este remito (no hay FK: las emparejamos por cliente +
    // misma fecha vieja + ventana de created_at alrededor del remito). Esto es
    // lo que hace que el CIERRE de la semana refleje la fecha corregida.
    if (fechaCambio && editando.created_at) {
      const t = new Date(editando.created_at).getTime()
      const lo = new Date(t - 120000).toISOString()
      const hi = new Date(t + 120000).toISOString()
      const { data: sals } = await supabase.from('salidas_deposito')
        .select('id')
        .eq('cliente_nombre', editando.cliente_nombre)
        .eq('fecha', fechaAnterior)
        .gte('created_at', lo).lte('created_at', hi)
      const ids = (sals || []).map(s => s.id)
      if (ids.length) await supabase.from('salidas_deposito').update({ fecha: fechaEdit }).in('id', ids)
    }

    // Movimiento de cuenta corriente del remito: ajustar importe (si cambió) y
    // fecha (si cambió), para que el extracto del cliente quede consistente.
    if (editando.cliente_id && (diferencia !== 0 || fechaCambio)) {
      const { data: movs } = await supabase.from('movimientos_ctacte').select('*').eq('remito_id', editando.id).maybeSingle()
      if (movs) {
        const upd = {}
        if (diferencia !== 0) {
          // El debe de un remito a cuenta corriente = su total nuevo (no sumar la
          // diferencia sobre el valor viejo: las columnas numeric pueden venir como
          // string y concatenar). El saldo lo recalcula recomputarSaldoCliente.
          upd.debe = nuevoTotal
          upd.descripcion = `Remito N° ${String(editando.numero || '').padStart(5, '0')} — ${itemsEdit.map(i => i.descripcion).join(', ')} ✏️ Editado`
        }
        if (fechaCambio) upd.fecha = fechaEdit
        await supabase.from('movimientos_ctacte').update(upd).eq('id', movs.id)
        // Recalcular el saldo del cliente y los acumulados desde el ledger (esto
        // arregla además los movimientos POSTERIORES, que antes quedaban stale al
        // editar un remito que no era el último).
        if (diferencia !== 0) await recomputarSaldoCliente(editando.cliente_id)
      }
    }

    showAlert(`✅ Remito N° ${String(editando.numero).padStart(5, '0')} actualizado${fechaCambio ? ' (fecha y cierre reubicados)' : ''}`)
    setEditando(null); setItemsEdit([]); setFechaEdit('')
    cargarRemitos()
  }

  function imprimir(remito) {
    const items = remito.items || []
    const html = `<html><head><title>Remito N° ${remito.numero}</title>
      <style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin: 0 auto; } .header { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; } table { width: 100%; border-collapse: collapse; margin: 12px 0; } th { border: 1px solid #000; padding: 4px; text-align: center; font-size: 10px; font-weight: 700; background: #f0f0f0; } td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 11px; } td.desc { text-align: left; } .total-box { border: 1px solid #000; padding: 6px 12px; font-size: 13px; font-weight: 700; } .firma { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; } @media print { body { padding: 10px; } }</style></head>
      <body>
        <div class="header"><div><div style="font-size:22px;font-weight:900;letter-spacing:2px">FABRICIUS</div><div style="font-size:9px;color:#555">CARNICERÍAS · PREMIUM QUALITY</div><div style="font-size:10px;color:#444;margin-top:4px">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div><div style="font-size:11px;font-weight:700;background:#000;color:#fff;padding:3px 8px;display:inline-block;border-radius:4px;margin-top:4px">📱 3574 400346</div></div><div style="text-align:right"><div style="font-size:10px;font-weight:700;border:1px solid #000;padding:2px 6px;margin-bottom:4px;text-align:center">X — DOCUMENTO NO VÁLIDO COMO FACTURA</div><div style="font-size:24px;font-weight:900;font-style:italic">REMITO</div><div style="font-size:13px;font-weight:700">N° ${String(remito.numero).padStart(5, '0')}</div></div></div>
        <div style="font-size:11px;margin-bottom:8px">Fecha: <strong>${remito.fecha}</strong></div>
        <div style="border-bottom:1px solid #000;margin-bottom:8px;padding-bottom:2px"><span style="font-size:10px;font-weight:700;margin-right:6px">Señor/a:</span>${remito.cliente_nombre || ''}</div>
        <table><thead><tr><th style="width:40%">DESCRIPCIÓN</th><th style="width:15%">KG</th><th style="width:22%">PRECIO UNITARIO</th><th style="width:23%">IMPORTE</th></tr></thead>
        <tbody>${items.map(item => `<tr><td class="desc">${item.descripcion}</td><td>${item.kg}</td><td>$${Math.round(item.precio).toLocaleString('es-AR')}</td><td>$${Math.round(item.importe).toLocaleString('es-AR')}</td></tr>`).join('')}${Array(Math.max(0, 10 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}</tbody></table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px"><div class="total-box">TOTAL: $${Math.round(remito.total).toLocaleString('es-AR')}</div></div>
        <div class="firma">Firma y aclaración: ________________________________</div>
      </body></html>`
    imprimirHTML(html)
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, boxSizing: 'border-box' }
  const categorias = [...new Set(todosPrecios.map(p => p.categoria))]
  const productosFiltrados = todosPrecios.filter(p => p.categoria === nuevaCategoria)

  if (editando) {
    const nuevoTotal = itemsEdit.reduce((s, i) => s + (parseFloat(i.importe) || 0), 0)
    return (
      <div>
        {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
        <button onClick={() => setEditando(null)} className="btn btn-ghost" style={{ marginBottom: 16 }}>← Volver a remitos</button>
        <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: 14 }}>✏️ Editando Remito N° {String(editando.numero).padStart(5, '0')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{editando.cliente_nombre} · {editando.fecha}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total original</div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--muted)', textDecoration: 'line-through' }}>${Math.round(editando.total).toLocaleString('es-AR')}</div>
          </div>
        </div>

        {/* EDITAR FECHA DE EMISIÓN */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">📅 Fecha de emisión</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group">
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha del remito</label>
              <input type="date" value={fechaEdit} max={fechaHoyARG()} onChange={e => setFechaEdit(e.target.value)} style={inp} />
            </div>
            {fechaEdit !== editando.fecha && (
              <div style={{ fontSize: 12, color: 'var(--amber)', paddingBottom: 8 }}>
                ⚠️ Cambia del {editando.fecha} al {fechaEdit} — se reubica en el historial y en el cierre de esa semana.
              </div>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            La hora no importa; lo que valida el cierre semanal es la fecha. Al guardar, también se mueven las salidas y el movimiento de cuenta corriente de este remito.
          </div>
        </div>

        <div className="card">
          <div className="card-title">Items del remito</div>
          <table>
            <thead><tr><th style={{ width: '35%' }}>Descripción</th><th>Kg</th><th>Precio/kg</th><th>Importe</th><th></th></tr></thead>
            <tbody>
              {itemsEdit.map((item, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{item.descripcion}</td>
                  <td><input type="number" step="0.1" value={item.kg} onChange={e => editarItem(i, 'kg', e.target.value)} style={{ ...inp, width: 70 }} /></td>
                  <td><input type="number" value={item.precio} onChange={e => editarItem(i, 'precio', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                  <td style={{ color: 'var(--gold)', fontWeight: 600 }}>${Math.round(item.importe || 0).toLocaleString('es-AR')}</td>
                  <td><button onClick={() => quitarItemEdit(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer', fontSize: 16 }}>🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 16, padding: 14, background: 'var(--surface2)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, fontWeight: 600 }}>➕ Agregar producto</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 100px auto', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Categoría</label>
                <select value={nuevaCategoria} onChange={e => { setNuevaCategoria(e.target.value); setNuevoProductoId('') }} style={{ ...inp, width: '100%' }}>
                  <option value="">— Seleccioná —</option>
                  {categorias.map(c => <option key={c} value={c}>{CATEGORIAS[c] || c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Producto</label>
                <select value={nuevoProductoId} onChange={e => { setNuevoProductoId(e.target.value); const prod = todosPrecios.find(p => p.id === e.target.value); if (prod) setNuevoPrecio((prod.precio_carniceria || prod.precio_mayorista || '').toString()) }} disabled={!nuevaCategoria} style={{ ...inp, width: '100%' }}>
                  <option value="">— Producto —</option>
                  {productosFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Kg</label><input type="number" step="0.1" placeholder="0" value={nuevoKg} onChange={e => setNuevoKg(e.target.value)} style={{ ...inp, width: '100%' }} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Precio/kg</label><input type="number" placeholder="0" value={nuevoPrecio} onChange={e => setNuevoPrecio(e.target.value)} style={{ ...inp, width: '100%', borderColor: 'var(--gold)' }} /></div>
              <button onClick={agregarItemEdit} className="btn btn-ghost" style={{ whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>➕</button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 0', borderTop: '2px solid var(--border)' }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Diferencia: </span>
              <span style={{ fontWeight: 700, color: nuevoTotal - editando.total >= 0 ? 'var(--green)' : 'var(--red-light)' }}>{nuevoTotal - editando.total >= 0 ? '+' : ''}{fmt(nuevoTotal - editando.total)}</span>
              {editando.cliente_id && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(se ajusta en cta. cte.)</span>}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--gold)' }}>TOTAL: ${Math.round(nuevoTotal).toLocaleString('es-AR')}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarEdicion}>💾 Guardar cambios</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {alert && <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
      {seleccionado && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
          <div className="card-title">🧾 Remito N° {String(seleccionado.numero).padStart(5, '0')} — {seleccionado.cliente_nombre}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-gold" onClick={() => imprimir(seleccionado)}>🖨️ Imprimir remito</button>
            <button className="btn btn-ghost" onClick={() => abrirEdicion(seleccionado)}>✏️ Editar remito</button>
            <button className="btn btn-ghost" onClick={() => setSeleccionado(null)}>✕ Cerrar</button>
          </div>
        </div>
      )}
      {/* FILTRO POR FECHA / CLIENTE + RESUMEN DE VENTAS */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🔎 Buscar remitos por fecha / cliente</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          Filtrá por período (y opcionalmente un cliente) para ver cuánto se vendió. La suma excluye remitos anulados.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Desde</label>
            <input type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Hasta</label>
            <input type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} style={inp} />
          </div>
          <div style={{ minWidth: 220 }}>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Cliente</label>
            <select value={fCliente} onChange={e => setFCliente(e.target.value)} style={{ ...inp, width: '100%' }}>
              <option value="todos">Todos los clientes</option>
              {clientesRemito.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={setSemanaActual}>Semana actual</button>
            <button className="btn btn-ghost btn-sm" onClick={setSemanaAnterior}>Semana anterior</button>
            <button className="btn btn-ghost btn-sm" onClick={setMesActual}>Mes en curso</button>
            {hayFiltro && <button className="btn btn-ghost btn-sm" onClick={limpiarFiltros}>✕ Limpiar</button>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
          <div style={{ flex: '1 1 220px', background: 'var(--surface2)', border: '1px solid var(--gold)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>
              {fCliente === 'todos' ? '💰 Total vendido' : `💰 Total — ${fCliente}`}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 30, color: 'var(--gold)' }}>{fmt(totalFiltrado)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {remitosValidos.length} remito(s){anuladosEnFiltro > 0 ? ` · ${anuladosEnFiltro} anulado(s) excluido(s)` : ''}
            </div>
          </div>
          <div style={{ flex: '1 1 220px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 600 }}>📅 Período</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>
              {(fDesde || fHasta) ? `${fDesde || '…'} → ${fHasta || '…'}` : 'Todos los remitos'}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Historial de remitos ({remitosFiltrados.length}{hayFiltro ? ` de ${remitos.length}` : ''})</div>
        <table>
          <thead><tr><th>N° Remito</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Acciones</th></tr></thead>
          <tbody>
            {pagRemitos.items.map(r => (
              <tr key={r.id} style={{ background: r.eliminado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: r.eliminado ? 0.7 : 1 }}>
                <td>
  <strong>N° {String(r.numero).padStart(5, '0')}</strong>
  {r.eliminado && <span style={{ marginLeft: 8, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO por {r.eliminado_por}</span>}
</td>
                <td>{r.fecha}</td>
                <td>{r.cliente_nombre}</td>
                <td style={{ color: 'var(--gold)' }}>
                  ${Math.round(r.total).toLocaleString('es-AR')}
                  {(() => {
                    const c = COBRO_LABEL[r.cobro] || COBRO_LABEL.cta_cte
                    const desglose = Array.isArray(r.pagos) && r.pagos.length
                      ? r.pagos.map(p => `${METODO_PAGO_LABEL[p.metodo] || p.metodo}: $${Math.round(p.monto).toLocaleString('es-AR')}`).join('  ·  ')
                      : null
                    return (
                      <div style={{ marginTop: 3 }}>
                        <span title={desglose || undefined} style={{ fontSize: 9, fontWeight: 700, color: c.color, background: c.bg, borderRadius: 4, padding: '1px 6px', letterSpacing: 0.3, cursor: desglose ? 'help' : 'default' }}>{c.txt}</span>
                        {desglose && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{desglose}</div>}
                      </div>
                    )
                  })()}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => imprimir(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button>
                     <button onClick={() => abrirEdicion(r)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: 'var(--amber)' }}>✏️</button>
{!r.eliminado && <button onClick={() => eliminarRemito(r)} disabled={anulando} style={{ background: anulando ? '#2a2a2a' : '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 10px', cursor: anulando ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12, color: '#ff6b6b', opacity: anulando ? 0.5 : 1 }}>🗑️</button>}
{r.eliminado && <span style={{ background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO</span>}
                  </div>
                </td>
              </tr>
            ))}          
{remitosFiltrados.length === 0 && <tr><td colSpan={5} className="empty">{hayFiltro ? 'Sin remitos para este filtro' : 'Sin remitos'}</td></tr>}
          </tbody>
        </table>
        <Paginador {...pagRemitos.controles} label="remitos" />
      </div>
    </div>
  )
}

function ProveedoresTab() {
  const [subtab, setSubtab] = useState('resumen')
  const [compras, setCompras] = useState([])
  const [pagos, setPagos] = useState([])
  const [entradas, setEntradas] = useState([])           // entradas_deposito para detalle de remito
  const [proveedoresDB, setProveedoresDB] = useState([])
  const [inicializados, setInicializados] = useState(new Set())  // proveedor_id con cuenta corriente
  const [ledgerTotales, setLedgerTotales] = useState({})         // proveedor_id → { debe, haber }
  const [alert, setAlert] = useState(null)
  const [nuevoProveedor, setNuevoProveedor] = useState('')
  const [legajoAbierto, setLegajoAbierto] = useState(null)
  const [editandoLegajo, setEditandoLegajo] = useState(false)
  const [editandoNombreId, setEditandoNombreId] = useState(null)
  const [nombreEditando, setNombreEditando] = useState('')
  const [formLegajo, setFormLegajo] = useState({ contacto: '', telefono: '', cuit: '', direccion: '', producto_principal: '', notas: '' })
  const [formCompra, setFormCompra] = useState({ fecha: fechaHoyARG(), semana_inicio: '', semana_fin: '', proveedor_nombre: '', producto: '', kg: '', importe: '' })
  const [formPago, setFormPago] = useState({ fecha: fechaHoyARG(), proveedor_nombre: '', percepcion: '', entrega: '', notas: '' })
  // Anti doble-submit para compra/pago (financiero) — bloqueo síncrono.
  const [procesandoProv, setProcesandoProv] = useState(false)
  const procesandoProvRef = useRef(false)
  const [pagosLedger, setPagosLedger] = useState([])  // movimientos tipo 'pago' para el historial global

  // Filtros y modal de detalle del nuevo buscador de compras
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [filtroProvSel, setFiltroProvSel] = useState('todos')
  const [filtroTexto, setFiltroTexto] = useState('')
  const [remitoDetalle, setRemitoDetalle] = useState(null)  // { compra, entrada } o null

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    // Sin .limit — paginamos en cliente para mostrar todo el historial
    const [{ data: c }, { data: p }, { data: prov }, { data: ent }, { data: movs }] = await Promise.all([
      supabase.from('compras_proveedores').select('*').order('fecha', { ascending: false }),
      supabase.from('pagos_proveedores_semanal').select('*').order('fecha', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('entradas_deposito').select('*').not('proveedor_nombre', 'is', null).order('fecha', { ascending: false }),
      // Cuenta corriente: movimientos completos para totales debe/haber,
      // saber quién está inicializado, y el historial global de pagos.
      supabase.from('movimientos_proveedores').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).then(r => r).catch(() => ({ data: null })),
    ])
    setCompras(c || [])
    setPagos(p || [])
    setProveedoresDB(prov || [])
    setEntradas(ent || [])
    // Totales debe/haber del ledger por proveedor + set de inicializados.
    // Los movimientos ANULADOS no suman al saldo (pero el proveedor sigue
    // inicializado aunque solo tenga movimientos anulados).
    const tot = {}
    ;(movs || []).forEach(m => {
      if (!tot[m.proveedor_id]) tot[m.proveedor_id] = { debe: 0, haber: 0 }
      if (m.anulado) return
      tot[m.proveedor_id].debe  += Number(m.debe) || 0
      tot[m.proveedor_id].haber += Number(m.haber) || 0
    })
    setLedgerTotales(tot)
    setInicializados(new Set(Object.keys(tot)))
    // Historial global de pagos = movimientos tipo 'pago' (ya vienen desc)
    setPagosLedger((movs || []).filter(m => m.tipo === 'pago'))
  }

  // Busca la entrada_deposito asociada a una compra por fecha + proveedor + importe.
  // Es un "best effort match" ya que no hay FK explicita entre las tablas.
  function getEntradaPara(compra) {
    if (!compra) return null
    return entradas.find(e =>
      e.fecha === compra.fecha &&
      (e.proveedor_nombre || '').toUpperCase() === (compra.proveedor_nombre || '').toUpperCase() &&
      Math.abs(Number(e.importe || 0) - Number(compra.importe || 0)) < 1
    ) || null
  }

  function abrirDetalleRemito(compra) {
    setRemitoDetalle({ compra, entrada: getEntradaPara(compra) })
  }

  // Lista de compras filtrada por los inputs de la sub-tab "Compras"
  const comprasFiltradas = useMemo(() => {
    return compras.filter(c => {
      if (filtroDesde && c.fecha < filtroDesde) return false
      if (filtroHasta && c.fecha > filtroHasta) return false
      if (filtroProvSel !== 'todos' && c.proveedor_nombre !== filtroProvSel) return false
      if (filtroTexto) {
        // Match por texto + sinónimos: "media res" trae NT, VQ, NOVILLITO, etc.
        if (!coincideTextoProducto(c, filtroTexto.toLowerCase().trim())) return false
      }
      return true
    })
  }, [compras, filtroDesde, filtroHasta, filtroProvSel, filtroTexto])

  // Los totales (kg y $) excluyen las compras ANULADAS — siguen visibles en la
  // lista marcadas, pero no cuentan.
  const sumaFiltrada = useMemo(() =>
    comprasFiltradas.filter(c => !c.anulado).reduce((s, c) => s + (Number(c.importe) || 0), 0),
    [comprasFiltradas])
  const kgFiltrados = useMemo(() =>
    comprasFiltradas.filter(c => !c.anulado).reduce((s, c) => s + (Number(c.kg) || 0), 0),
    [comprasFiltradas])

  function limpiarFiltros() {
    setFiltroDesde('')
    setFiltroHasta('')
    setFiltroProvSel('todos')
    setFiltroTexto('')
  }

  // Paginadores del tab Proveedores
  const pagCompras = usePaginacion(comprasFiltradas, 20)
  const pagPagos = usePaginacion(pagosLedger, 20)

  function showMsg(msg, type = 'success') { setAlert({ msg, type }); setTimeout(() => setAlert(null), 3000) }

  async function agregarProveedor() {
    if (!nuevoProveedor.trim()) return
    const nombre = nuevoProveedor.trim().toUpperCase()
    const { error } = await supabase.from('proveedores').insert({ nombre, activo: true })
    if (error) { showMsg('❌ Ya existe ese proveedor', 'error'); return }
    showMsg('✅ Proveedor agregado'); setNuevoProveedor(''); fetchAll()
  }

  async function eliminarProveedor(id, nombre) {
    if (!confirm(
      `⚠️ ELIMINAR PROVEEDOR "${nombre}"\n\n` +
      `Se va a borrar PARA SIEMPRE:\n` +
      `  • El proveedor\n` +
      `  • Toda su cuenta corriente (compras, pagos, ajustes, saldo)\n` +
      `  • Su historial de compras y pagos semanales\n\n` +
      `Las entradas al depósito (stock) NO se tocan.\n\n` +
      `Esta acción NO se puede deshacer. ¿Confirmás?`
    )) return
    // Segunda confirmación para una acción destructiva
    if (!confirm(`Última confirmación: ¿borrar definitivamente a "${nombre}" y todo su historial?`)) return
    // Cascada manual: no hay FK (proveedor_id es uuid sin REFERENCES, y
    // las otras tablas referencian por proveedor_nombre que es texto).
    await Promise.all([
      supabase.from('movimientos_proveedores').delete().eq('proveedor_id', id),
      supabase.from('compras_proveedores').delete().eq('proveedor_nombre', nombre),
      supabase.from('pagos_proveedores_semanal').delete().eq('proveedor_nombre', nombre),
      supabase.from('pagos_proveedores').delete().eq('proveedor_nombre', nombre),
    ])
    await supabase.from('proveedores').delete().eq('id', id)
    showMsg('🗑️ Proveedor y todo su historial eliminados')
    if (legajoAbierto?.id === id) setLegajoAbierto(null)
    fetchAll()
  }

  function iniciarEditarNombre(prov) {
    setEditandoNombreId(prov.id)
    setNombreEditando(prov.nombre)
  }

  function cancelarEditarNombre() {
    setEditandoNombreId(null)
    setNombreEditando('')
  }

  async function guardarNombreProveedor(prov) {
    const nuevoNombre = nombreEditando.trim().toUpperCase()
    if (!nuevoNombre) { showMsg('El nombre no puede estar vacío', 'error'); return }
    if (nuevoNombre === prov.nombre) { cancelarEditarNombre(); return }
    // Verificar duplicado
    const yaExiste = proveedoresDB.some(p => p.id !== prov.id && p.nombre.toUpperCase() === nuevoNombre)
    if (yaExiste) { showMsg('❌ Ya existe un proveedor con ese nombre', 'error'); return }
    if (!confirm(`¿Renombrar "${prov.nombre}" a "${nuevoNombre}"?\n\nSe actualizarán también las compras, pagos, entradas y cheques relacionados.`)) return

    const nombreAnterior = prov.nombre
    // 1. Actualizar la tabla principal
    const { error } = await supabase.from('proveedores').update({ nombre: nuevoNombre }).eq('id', prov.id)
    if (error) { showMsg('❌ Error al actualizar: ' + error.message, 'error'); return }

    // 2. Propagar el cambio a registros históricos (cascada manual porque proveedor_nombre es texto)
    await Promise.all([
      supabase.from('compras_proveedores').update({ proveedor_nombre: nuevoNombre }).eq('proveedor_nombre', nombreAnterior),
      supabase.from('pagos_proveedores_semanal').update({ proveedor_nombre: nuevoNombre }).eq('proveedor_nombre', nombreAnterior),
      supabase.from('entradas_deposito').update({ proveedor_nombre: nuevoNombre }).eq('proveedor_nombre', nombreAnterior),
      supabase.from('cheques').update({ proveedor_nombre: nuevoNombre }).eq('proveedor_nombre', nombreAnterior),
      supabase.from('pagos_proveedores').update({ proveedor_nombre: nuevoNombre }).eq('proveedor_nombre', nombreAnterior)
    ])

    showMsg('✅ Nombre actualizado en todos los registros')
    if (legajoAbierto?.id === prov.id) setLegajoAbierto({ ...legajoAbierto, nombre: nuevoNombre })
    cancelarEditarNombre()
    fetchAll()
  }

  function abrirLegajo(prov) {
    setLegajoAbierto(prov)
    setFormLegajo({ contacto: prov.contacto || '', telefono: prov.telefono || '', cuit: prov.cuit || '', direccion: prov.direccion || '', producto_principal: prov.producto_principal || '', notas: prov.notas || '' })
    setEditandoLegajo(false)
  }

  async function guardarLegajo() {
    await supabase.from('proveedores').update(formLegajo).eq('id', legajoAbierto.id)
    showMsg('✅ Legajo actualizado'); setEditandoLegajo(false)
    setLegajoAbierto({ ...legajoAbierto, ...formLegajo }); fetchAll()
  }

  async function guardarCompra() {
    if (!formCompra.proveedor_nombre) { showMsg('Seleccioná un proveedor', 'error'); return }
    if (esFechaFutura(formCompra.fecha)) { showMsg(`⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})`, 'error'); return }
    if (!(parseNumero(formCompra.importe) > 0)) { showMsg('⛔ Cargá el importe (precio) — debe ser mayor a 0', 'error'); return }
    if (procesandoProvRef.current) return       // anti doble-click
    procesandoProvRef.current = true; setProcesandoProv(true)
    try {
      await supabase.from('compras_proveedores').insert({ fecha: formCompra.fecha, semana_inicio: formCompra.semana_inicio || null, semana_fin: formCompra.semana_fin || null, proveedor_nombre: formCompra.proveedor_nombre, producto: formCompra.producto, kg: parseNumero(formCompra.kg), importe: parseNumero(formCompra.importe) })
      showMsg('✅ Compra registrada')
      setFormCompra(f => ({ ...f, producto: '', kg: '', importe: '', proveedor_nombre: '' })); fetchAll()
    } finally { procesandoProvRef.current = false; setProcesandoProv(false) }
  }

  // Registra un PAGO directo en la cuenta corriente del proveedor:
  //   entrega   → HABER (baja lo que le debemos)
  //   percepción → DEBE (la percepción aumenta lo que debemos, como en el modelo viejo)
  async function guardarPago() {
    if (!formPago.proveedor_nombre) { showMsg('Seleccioná un proveedor', 'error'); return }
    if (esFechaFutura(formPago.fecha)) { showMsg(`⛔ La fecha no puede ser futura (hoy es ${fechaHoyARG()})`, 'error'); return }
    const prov = proveedoresDB.find(p => p.nombre === formPago.proveedor_nombre)
    if (!prov) { showMsg('Proveedor no encontrado', 'error'); return }
    if (!inicializados.has(prov.id)) {
      showMsg(`⚠️ ${prov.nombre} no tiene cuenta corriente inicializada. Entrá a su legajo y cargá el saldo inicial primero.`, 'error')
      return
    }
    const entrega = parseNumero(formPago.entrega)
    const percepcion = parseNumero(formPago.percepcion)
    if (entrega <= 0 && percepcion <= 0) { showMsg('Ingresá una entrega o una percepción', 'error'); return }
    if (procesandoProvRef.current) return       // anti doble-click
    procesandoProvRef.current = true; setProcesandoProv(true)
    try {
      const { error } = await agregarMovimiento({
        proveedorId: prov.id, proveedorNombre: prov.nombre, fecha: formPago.fecha,
        tipo: 'pago',
        descripcion: `Pago${formPago.notas ? ' — ' + formPago.notas : ''}${percepcion > 0 ? ` (percepción ${fmt(percepcion)})` : ''}`,
        debe: percepcion, haber: entrega, notas: formPago.notas,
      })
      if (error) { showMsg('❌ ' + error, 'error'); return }
      showMsg('✅ Pago registrado en cuenta corriente')
      setFormPago({ fecha: fechaHoyARG(), proveedor_nombre: '', percepcion: '', entrega: '', notas: '' })
      fetchAll()
    } finally { procesandoProvRef.current = false; setProcesandoProv(false) }
  }

  // Elimina un pago de la cuenta corriente (recalcula el saldo del proveedor)
  async function eliminarPago(p) {
    if (!confirm(`¿Eliminar el pago de ${p.proveedor_nombre} del ${p.fecha} por ${fmt(p.haber)}?\n\nSe recalculará el saldo. Acción irreversible.`)) return
    const { error } = await eliminarMovimiento(p.id, p.proveedor_id)
    if (error) { showMsg('❌ Error al eliminar: ' + error, 'error'); return }
    showMsg('✅ Pago eliminado')
    fetchAll()
  }

  const proveedoresNombres = proveedoresDB.map(p => p.nombre)
  const getResumenProv = (nombre, provId = null) => {
    const comprasProv = compras.filter(c => c.proveedor_nombre?.toUpperCase().includes(nombre))
    const pagosProv = pagos.filter(p => p.proveedor_nombre?.toUpperCase().includes(nombre))
    const weeklyCompras = comprasProv.reduce((s, c) => s + (c.importe || 0), 0)
    const weeklyEntregado = pagosProv.reduce((s, p) => s + (p.entrega || 0), 0)
    const provReg = proveedoresDB.find(p => p.id === provId || p.nombre === nombre)
    const ledger = provReg ? ledgerTotales[provReg.id] : null
    const usaLedger = !!ledger
    // DEBE / HABER:
    //   - Inicializado (cuenta corriente) → Σdebe / Σhaber del ledger
    //   - No inicializado → fallback al modelo semanal viejo
    const debe = usaLedger ? ledger.debe : weeklyCompras
    const haber = usaLedger ? ledger.haber : weeklyEntregado
    // SALDO = DEBE − HABER (siempre). Coherente con las columnas mostradas.
    // No leemos proveedores.saldo_adeudado (esa columna no existe en prod);
    // el saldo se deriva directo de debe − haber.
    //   saldo > 0 le debemos · < 0 a favor · = 0 al día
    const saldo = debe - haber
    // totalCompras/totalEntregado quedan como alias para el header del legajo
    return { debe, haber, saldo, totalCompras: debe, totalEntregado: haber, comprasProv, pagosProv, usaLedger }
  }
  // Total adeudado = suma de saldos positivos (lo que realmente debemos).
  // Los saldos a favor (negativos) no restan a la deuda total mostrada.
  const totalDeuda = proveedoresDB.reduce((s, p) => s + Math.max(0, getResumenProv(p.nombre, p.id).saldo), 0)

  if (legajoAbierto) {
    const { totalCompras, totalEntregado, saldo, comprasProv, pagosProv } = getResumenProv(legajoAbierto.nombre, legajoAbierto.id)
    return (
      <div>
        <button onClick={() => setLegajoAbierto(null)} className="btn btn-ghost" style={{ marginBottom: 16 }}>← Volver a proveedores</button>
        {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
        <div style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%)', border: '1px solid var(--amber)', borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {editandoNombreId === legajoAbierto.id ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 32 }}>🏭</span>
                  <input
                    autoFocus
                    value={nombreEditando}
                    onChange={e => setNombreEditando(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') guardarNombreProveedor(legajoAbierto); if (e.key === 'Escape') cancelarEditarNombre() }}
                    style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--amber)', letterSpacing: 2, background: 'var(--surface)', border: '2px solid var(--gold)', borderRadius: 8, padding: '4px 12px', textTransform: 'uppercase', minWidth: 280 }}
                  />
                  <button onClick={() => guardarNombreProveedor(legajoAbierto)} title="Guardar" style={{ background: 'var(--green)', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 700, color: '#fff' }}>✓ Guardar</button>
                  <button onClick={cancelarEditarNombre} title="Cancelar" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 14, color: 'var(--muted)' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--amber)', letterSpacing: 2 }}>🏭 {legajoAbierto.nombre}</div>
                  <button onClick={() => iniciarEditarNombre(legajoAbierto)} title="Editar nombre" style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#000' }}>✏️ Editar nombre</button>
                </div>
              )}
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Legajo de proveedor</div>
              {legajoAbierto.producto_principal && <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>🥩 {legajoAbierto.producto_principal}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Saldo</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 36, color: saldo > 0 ? 'var(--red-light)' : saldo < 0 ? 'var(--green)' : 'var(--muted)' }}>{fmt(saldo)}</div>
              <div style={{ fontSize: 11, color: saldo > 0 ? 'var(--red-light)' : saldo < 0 ? 'var(--green)' : 'var(--muted)' }}>{saldo > 0 ? '⚠️ Le debemos' : saldo < 0 ? '✅ Saldo a favor' : '✅ Al día'}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Total compras</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--amber)' }}>{fmt(totalCompras)}</div></div>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Total pagado</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--green)' }}>{fmt(totalEntregado)}</div></div>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Compras registradas</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)' }}>{comprasProv.length}</div></div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title" style={{ margin: 0 }}>📋 Datos del proveedor</div>
              <button onClick={() => setEditandoLegajo(!editandoLegajo)} className="btn btn-ghost btn-sm">{editandoLegajo ? '✕ Cancelar' : '✏️ Editar'}</button>
            </div>
            {editandoLegajo ? (
              <div>
                {[['contacto', '👤 Contacto', 'Nombre del contacto'], ['telefono', '📱 Teléfono', 'Ej: 3574 000000'], ['cuit', '🆔 CUIT', 'XX-XXXXXXXX-X'], ['direccion', '📍 Dirección', 'Dirección del proveedor'], ['producto_principal', '🥩 Producto principal', 'Ej: Bovino Media Res'], ['notas', '📝 Notas', 'Observaciones, condiciones, etc.']].map(([campo, label, placeholder]) => (
                  <div key={campo} style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
                    <input value={formLegajo[campo]} onChange={e => setFormLegajo(f => ({ ...f, [campo]: e.target.value }))} placeholder={placeholder} style={inp} />
                  </div>
                ))}
                <button className="btn btn-gold" onClick={guardarLegajo} style={{ width: '100%', marginTop: 8 }}>💾 Guardar legajo</button>
              </div>
            ) : (
              <div>
                {[['👤 Contacto', legajoAbierto.contacto], ['📱 Teléfono', legajoAbierto.telefono], ['🆔 CUIT', legajoAbierto.cuit], ['📍 Dirección', legajoAbierto.direccion], ['🥩 Producto principal', legajoAbierto.producto_principal], ['📝 Notas', legajoAbierto.notas]].map(([label, valor]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: valor ? 'var(--text)' : 'var(--muted)', fontStyle: valor ? 'normal' : 'italic' }}>{valor || 'Sin datos'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <PagosProveedorPaginados pagos={pagosProv} fmt={fmt} />
          </div>
        </div>

        {/* CUENTA CORRIENTE (nuevo libro mayor DEBE/HABER/SALDO) */}
        <div style={{ marginBottom: 16 }}>
          <CuentaCorrienteProveedor
            proveedor={legajoAbierto}
            saldoSugerido={saldo}
            onSaldoChange={fetchAll}
          />
        </div>

        <div className="card">
          <ComprasProveedorPaginadas
            compras={comprasProv}
            fmt={fmt}
            onVerDetalle={abrirDetalleRemito}
          />
        </div>

        {/* Modal de detalle también disponible dentro del legajo */}
        {remitoDetalle && (
          <RemitoIngresoDetalle remitoDetalle={remitoDetalle} onClose={() => setRemitoDetalle(null)} fmt={fmt} />
        )}
      </div>
    )
  }

  return (
    <div>
      {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[{ id: 'resumen', label: '📊 Resumen' }, { id: 'compras', label: '📥 Compras' }, { id: 'pagos', label: '💰 Pagos' }, { id: 'gestionar', label: '⚙️ Gestionar proveedores' }].map(t => (
          <button key={t.id} onClick={() => setSubtab(t.id)} style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${subtab === t.id ? 'var(--amber)' : 'var(--border)'}`, background: subtab === t.id ? 'var(--amber)' : 'transparent', color: subtab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>{t.label}</button>
        ))}
      </div>

      {subtab === 'resumen' && (
        <div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
            <div className="stat"><div className="stat-label">Total adeudado proveedores</div><div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalDeuda)}</div></div>
            <div className="stat"><div className="stat-label">Proveedores activos</div><div className="stat-value" style={{ color: 'var(--gold)' }}>{proveedoresDB.length}</div></div>
          </div>
          <div className="card">
            <div className="card-title">Estado de cuenta por proveedor</div>
            <table>
              <thead><tr><th>Proveedor</th><th style={{ color: 'var(--amber)', textAlign: 'right' }}>Debe</th><th style={{ color: 'var(--green)', textAlign: 'right' }}>Haber</th><th style={{ textAlign: 'right' }}>Saldo</th><th style={{ textAlign: 'center' }}>Estado</th><th style={{ textAlign: 'center' }}>Legajo</th><th style={{ textAlign: 'center' }}>Eliminar</th></tr></thead>
              <tbody>
                {proveedoresDB.map(p => { const r = getResumenProv(p.nombre, p.id); const cSaldo = r.saldo > 0 ? 'var(--red-light)' : r.saldo < 0 ? 'var(--green)' : 'var(--muted)'; return (<tr key={p.id}><td><strong>{p.nombre}</strong>{!r.usaLedger && <span title="Cuenta corriente sin inicializar" style={{ marginLeft: 6, fontSize: 10, color: 'var(--amber)' }}>⏳</span>}</td><td style={{ color: 'var(--amber)', textAlign: 'right' }}>{fmt(r.debe)}</td><td style={{ color: 'var(--green)', textAlign: 'right' }}>{fmt(r.haber)}</td><td style={{ color: cSaldo, fontWeight: 700, textAlign: 'right' }}>{r.saldo < 0 ? `${fmt(r.saldo)} a favor` : fmt(r.saldo)}</td><td style={{ textAlign: 'center' }}><span style={{ background: r.saldo > 0 ? '#3a1a1a' : '#1a3a1a', color: cSaldo, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{r.saldo > 0 ? 'DEBE' : r.saldo < 0 ? '💚 A FAVOR' : '✅ AL DÍA'}</span></td><td style={{ textAlign: 'center' }}><button onClick={() => abrirLegajo(p)} style={{ background: 'var(--amber)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff' }}>📋 Ver legajo</button></td><td style={{ textAlign: 'center' }}><button onClick={() => eliminarProveedor(p.id, p.nombre)} title="Eliminar proveedor y todo su historial" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--red-light)' }}>🗑️</button></td></tr>) })}
                {proveedoresDB.length === 0 && <tr><td colSpan={7} className="empty">Sin proveedores registrados</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subtab === 'compras' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">➕ Registrar compra manual</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Las entradas al depósito se registran automáticamente.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Proveedor</label><select value={formCompra.proveedor_nombre} onChange={e => setFormCompra(f => ({ ...f, proveedor_nombre: e.target.value }))} style={inp}><option value="">— Seleccioná —</option>{proveedoresNombres.map(p => <option key={p}>{p}</option>)}</select></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Producto</label><input value={formCompra.producto} onChange={e => setFormCompra(f => ({ ...f, producto: e.target.value }))} placeholder="Ej: Bovino Media Res" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={formCompra.fecha} max={fechaHoyARG()} onChange={e => setFormCompra(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Kg</label><input type="number" value={formCompra.kg} onChange={e => setFormCompra(f => ({ ...f, kg: e.target.value }))} placeholder="0" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Importe ($)</label><input type="number" value={formCompra.importe} onChange={e => setFormCompra(f => ({ ...f, importe: e.target.value }))} placeholder="0" style={{ ...inp, borderColor: 'var(--gold)' }} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Semana</label><div style={{ display: 'flex', gap: 4 }}><input type="date" value={formCompra.semana_inicio} onChange={e => setFormCompra(f => ({ ...f, semana_inicio: e.target.value }))} style={{ ...inp, fontSize: 11 }} /><input type="date" value={formCompra.semana_fin} onChange={e => setFormCompra(f => ({ ...f, semana_fin: e.target.value }))} style={{ ...inp, fontSize: 11 }} /></div></div>
            </div>
            <button className="btn btn-gold" onClick={guardarCompra} disabled={procesandoProv} style={{ opacity: procesandoProv ? 0.5 : 1, cursor: procesandoProv ? 'not-allowed' : 'pointer' }}>{procesandoProv ? '⏳ Registrando…' : '✅ Registrar compra'}</button>
          </div>

          {/* BUSCADOR DE REMITOS DE INGRESO */}
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
            <div className="card-title">🔍 Buscar remitos de ingreso</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr auto', gap: 10, marginBottom: 12, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>📅 Desde</label>
                <input type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>📅 Hasta</label>
                <input type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>🏭 Proveedor</label>
                <select value={filtroProvSel} onChange={e => setFiltroProvSel(e.target.value)} style={inp}>
                  <option value="todos">Todos los proveedores</option>
                  {proveedoresNombres.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>🔎 Buscar texto</label>
                <input value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} placeholder="Producto, proveedor..." style={inp} />
              </div>
              <button onClick={limpiarFiltros} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>✕ Limpiar</button>
            </div>

            {/* KPIs del resultado filtrado */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 4 }}>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>REMITOS ENCONTRADOS</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--gold)' }}>{comprasFiltradas.length}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>KG TOTALES</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--amber)' }}>{kgFiltrados > 0 ? kgFiltrados.toFixed(0) + ' kg' : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,209,122,0.06)', border: '1px solid var(--amber)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>SUMA TOTAL $</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--amber)' }}>{fmt(sumaFiltrada)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              📥 Resultados ({comprasFiltradas.length}
              {comprasFiltradas.length !== compras.length ? ` de ${compras.length}` : ''})
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 700 }}>
                <thead><tr><th>Fecha</th><th>Proveedor</th><th>Producto</th><th>Kg</th><th style={{ textAlign: 'right' }}>Importe</th><th style={{ textAlign: 'center' }}>Detalle</th></tr></thead>
                <tbody>
                  {pagCompras.items.map(c => (
                    <tr key={c.id} style={{ background: c.anulado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: c.anulado ? 0.65 : 1 }}>
                      <td>{c.fecha}</td>
                      <td><strong>{c.proveedor_nombre}</strong></td>
                      <td>
                        {c.producto || '—'}
                        {c.anulado && <span style={{ marginLeft: 6, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADA{c.anulado_por ? ' por ' + c.anulado_por : ''}</span>}
                      </td>
                      <td style={{ color: c.anulado ? 'var(--muted)' : undefined, textDecoration: c.anulado ? 'line-through' : 'none' }}>{c.kg > 0 ? c.kg + ' kg' : '—'}</td>
                      <td style={{ color: c.anulado ? 'var(--muted)' : 'var(--amber)', fontWeight: 600, textAlign: 'right', textDecoration: c.anulado ? 'line-through' : 'none' }}>{fmt(c.importe)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={() => abrirDetalleRemito(c)}
                          style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>
                          🔍 Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                  {comprasFiltradas.length === 0 && <tr><td colSpan={6} className="empty">{compras.length === 0 ? 'Sin compras registradas' : 'Ningún remito coincide con esos filtros'}</td></tr>}
                </tbody>
              </table>
            </div>
            <Paginador {...pagCompras.controles} label="remitos" />
          </div>
        </div>
      )}

      {/* MODAL DETALLE DE REMITO */}
      {remitoDetalle && (
        <RemitoIngresoDetalle remitoDetalle={remitoDetalle} onClose={() => setRemitoDetalle(null)} fmt={fmt} />
      )}

      {subtab === 'pagos' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">💰 Registrar pago</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              El pago se registra en la cuenta corriente del proveedor (baja lo que le debemos).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Proveedor</label><select value={formPago.proveedor_nombre} onChange={e => setFormPago(f => ({ ...f, proveedor_nombre: e.target.value }))} style={inp}><option value="">— Seleccioná —</option>{proveedoresNombres.map(p => <option key={p}>{p}</option>)}</select></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={formPago.fecha} max={fechaHoyARG()} onChange={e => setFormPago(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Percepción ($)</label><input type="text" inputMode="decimal" value={formPago.percepcion} onChange={e => setFormPago(f => ({ ...f, percepcion: e.target.value }))} placeholder="0" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Lo que se entrega ($)</label><input type="text" inputMode="decimal" value={formPago.entrega} onChange={e => setFormPago(f => ({ ...f, entrega: e.target.value }))} placeholder="0" style={{ ...inp, borderColor: 'var(--green)' }} /></div>
              <div style={{ gridColumn: 'span 2' }}><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Notas</label><input value={formPago.notas} onChange={e => setFormPago(f => ({ ...f, notas: e.target.value }))} placeholder="Cheque nro., banco, etc." style={inp} /></div>
            </div>
            {(formPago.entrega || formPago.percepcion) && (
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>💵 Entrega (baja deuda): </span><strong style={{ color: 'var(--green)' }}>{fmt(parseNumero(formPago.entrega))}</strong></div>
                {parseNumero(formPago.percepcion) > 0 && <div style={{ fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>📋 Percepción (sube deuda): </span><strong style={{ color: 'var(--amber)' }}>{fmt(parseNumero(formPago.percepcion))}</strong></div>}
              </div>
            )}
            <button className="btn btn-gold" onClick={guardarPago} disabled={procesandoProv} style={{ opacity: procesandoProv ? 0.5 : 1, cursor: procesandoProv ? 'not-allowed' : 'pointer' }}>{procesandoProv ? '⏳ Registrando…' : '✅ Registrar pago'}</button>
          </div>
          <div className="card">
            <div className="card-title">Historial de pagos ({pagosLedger.length})</div>
            <table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Percep.</th><th>Entrega</th><th>Saldo</th><th>Acciones</th></tr></thead>
            <tbody>{pagPagos.items.map(p => (
              <tr key={p.id}>
                <td>{p.fecha}</td>
                <td><strong>{p.proveedor_nombre}</strong></td>
                <td>{Number(p.debe) > 0 ? fmt(p.debe) : '—'}</td>
                <td style={{ color: 'var(--green)' }}>{fmt(p.haber)}</td>
                <td style={{ color: Number(p.saldo) > 0 ? 'var(--red-light)' : Number(p.saldo) < 0 ? 'var(--green)' : 'var(--muted)', fontWeight: 700 }}>{fmt(p.saldo)}{Number(p.saldo) < 0 ? ' a favor' : ''}</td>
                <td>
                  <button onClick={() => eliminarPago(p)} title="Eliminar pago" style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', color: 'var(--red-light)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>🗑️</button>
                </td>
              </tr>
            ))}{pagosLedger.length === 0 && <tr><td colSpan={6} className="empty">Sin pagos registrados</td></tr>}</tbody></table>
            <Paginador {...pagPagos.controles} label="pagos" />
          </div>
        </div>
      )}

      {subtab === 'gestionar' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">➕ Agregar nuevo proveedor</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Nombre del proveedor</label><input value={nuevoProveedor} onChange={e => setNuevoProveedor(e.target.value)} onKeyDown={e => e.key === 'Enter' && agregarProveedor()} placeholder="Ej: GARCIA, SAN MARTIN..." style={{ ...inp, borderColor: 'var(--gold)', textTransform: 'uppercase' }} /></div>
              <button onClick={agregarProveedor} className="btn btn-gold" style={{ whiteSpace: 'nowrap' }}>➕ Agregar</button>
            </div>
          </div>
          <div className="card">
            <div className="card-title">📋 Proveedores activos ({proveedoresDB.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {proveedoresDB.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', border: editandoNombreId === p.id ? '1px solid var(--gold)' : '1px solid var(--border)' }}>
                  {editandoNombreId === p.id ? (
                    <>
                      <input
                        autoFocus
                        value={nombreEditando}
                        onChange={e => setNombreEditando(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') guardarNombreProveedor(p); if (e.key === 'Escape') cancelarEditarNombre() }}
                        style={{ ...inp, flex: 1, marginRight: 6, textTransform: 'uppercase', borderColor: 'var(--gold)' }}
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => guardarNombreProveedor(p)} title="Guardar" style={{ background: 'var(--green)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff' }}>✓</button>
                        <button onClick={cancelarEditarNombre} title="Cancelar" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>✕</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{p.nombre}</div>{p.producto_principal && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.producto_principal}</div>}</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => iniciarEditarNombre(p)} title="Editar nombre" style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>✏️</button>
                        <button onClick={() => abrirLegajo(p)} title="Ver legajo" style={{ background: 'var(--amber)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#fff' }}>📋</button>
                        <button onClick={() => eliminarProveedor(p.id, p.nombre)} title="Eliminar" style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer', fontSize: 16 }}>🗑️</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {proveedoresDB.length === 0 && <div className="empty" style={{ gridColumn: '1/-1' }}>Sin proveedores registrados</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================
// HISTORIAL DE COMPRAS DEL PROVEEDOR (paginado + ver detalle)
// =============================================
function ComprasProveedorPaginadas({ compras, fmt, onVerDetalle }) {
  const pag = usePaginacion(compras || [], 15)
  const totalImporte = (compras || []).reduce((s, c) => s + (Number(c.importe) || 0), 0)
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>📥 Historial de compras ({(compras || []).length})</div>
        {compras.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Total: <strong style={{ color: 'var(--amber)' }}>{fmt(totalImporte)}</strong>
          </div>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ minWidth: 540 }}>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Kg</th><th style={{ textAlign: 'right' }}>Importe</th><th style={{ textAlign: 'center' }}>Detalle</th></tr></thead>
          <tbody>
            {pag.items.map(c => (
              <tr key={c.id}>
                <td>{c.fecha}</td>
                <td>{c.producto || '—'}</td>
                <td>{c.kg > 0 ? c.kg + ' kg' : '—'}</td>
                <td style={{ color: 'var(--amber)', fontWeight: 600, textAlign: 'right' }}>{fmt(c.importe)}</td>
                <td style={{ textAlign: 'center' }}>
                  <button onClick={() => onVerDetalle(c)}
                    style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#000' }}>
                    🔍 Ver
                  </button>
                </td>
              </tr>
            ))}
            {compras.length === 0 && <tr><td colSpan={5} className="empty">Sin compras registradas</td></tr>}
          </tbody>
        </table>
      </div>
      <Paginador {...pag.controles} label="compras" />
    </>
  )
}

// =============================================
// HISTORIAL DE PAGOS DEL PROVEEDOR (paginado)
// =============================================
function PagosProveedorPaginados({ pagos, fmt }) {
  const pag = usePaginacion(pagos || [], 10)
  const totalEntregado = (pagos || []).reduce((s, p) => s + (Number(p.entrega) || 0), 0)
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>💰 Historial de pagos ({(pagos || []).length})</div>
        {pagos.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Total entregado: <strong style={{ color: 'var(--green)' }}>{fmt(totalEntregado)}</strong>
          </div>
        )}
      </div>
      {pagos.length === 0 ? (
        <div className="empty">Sin pagos registrados</div>
      ) : (
        <>
          {pag.items.map(p => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.fecha}</span>
                <span style={{ fontSize: 12, color: p.saldo_adeudado > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 600 }}>Saldo: {fmt(p.saldo_adeudado)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                <span>Compra: {fmt(p.importe_compra)}{Number(p.percepcion) > 0 ? ` (+perc. ${fmt(p.percepcion)})` : ''}</span>
                <span style={{ color: 'var(--green)' }}>Entrega: {fmt(p.entrega)}</span>
              </div>
              {p.notas && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{p.notas}</div>}
            </div>
          ))}
          <Paginador {...pag.controles} label="pagos" />
        </>
      )}
    </>
  )
}

// =============================================
// MODAL DETALLE DE REMITO DE INGRESO
// =============================================
// Muestra la info de la compra + si encontramos la entrada_deposito
// asociada, todos los detalles del remito real (tipo, descripcion,
// kg_real, merma, precio_kg, destino, etc).
function RemitoIngresoDetalle({ remitoDetalle, onClose, fmt }) {
  const { compra, entrada } = remitoDetalle
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 2 }}>📥 REMITO DE INGRESO</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {compra.fecha} · {compra.proveedor_nombre}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {/* Datos de la compra (siempre disponible) */}
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            💰 Registro de compra
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <DetalleItem label="Producto" valor={compra.producto || '—'} />
            <DetalleItem label="Fecha" valor={compra.fecha} />
            <DetalleItem label="Kg" valor={compra.kg > 0 ? compra.kg + ' kg' : '—'} />
            <DetalleItem label="Importe" valor={fmt(compra.importe)} highlight />
            {compra.semana_inicio && <DetalleItem label="Semana" valor={`${compra.semana_inicio} → ${compra.semana_fin || '—'}`} />}
          </div>
        </div>

        {/* Datos extra de la entrada al depósito (si la encontramos) */}
        {entrada ? (
          <div style={{ background: 'rgba(255,209,122,0.04)', border: '1px solid var(--gold)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              🏭 Detalle del remito (Entrada Depósito #{entrada.id})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <DetalleItem label="Tipo" valor={entrada.tipo || '—'} />
              <DetalleItem label="Descripción" valor={entrada.descripcion || '—'} />
              <DetalleItem label="Kg declarado" valor={entrada.kg > 0 ? `${entrada.kg} kg` : '—'} />
              <DetalleItem label="Kg real" valor={entrada.kg_real > 0 ? `${entrada.kg_real} kg` : '—'} />
              {Number(entrada.merma_pct) > 0 && (
                <DetalleItem label="Merma" valor={`${Number(entrada.merma_pct).toFixed(1)}%`} />
              )}
              <DetalleItem label="Precio $/kg" valor={fmt(entrada.precio_kg)} />
              <DetalleItem label="Importe" valor={fmt(entrada.importe)} highlight />
              {entrada.cantidad > 1 && <DetalleItem label="Cantidad" valor={entrada.cantidad} />}
              {entrada.destino && <DetalleItem label="Destino" valor={entrada.destino} />}
            </div>
          </div>
        ) : (
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 14, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            ℹ️ No se encontró una entrada al depósito asociada a este registro.
            <div style={{ fontSize: 11, marginTop: 4 }}>
              (Probablemente sea una compra cargada manualmente sin pasar por el form de entrada al depósito)
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="btn btn-gold">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

function DetalleItem({ label, valor, highlight }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 6, padding: '6px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: highlight ? 700 : 500, color: highlight ? 'var(--gold)' : 'var(--text)' }}>{valor}</div>
    </div>
  )
}

// =============================================
// PESTAÑA HISTORIAL/STOCK DE PIEZAS INDIVIDUALES
// =============================================
function PiezasTab() {
  const [piezas, setPiezas] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('todas')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroProveedor, setFiltroProveedor] = useState('todos')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const { data, error } = await supabase
      .from('piezas_stock')
      .select('*')
      .order('fecha_ingreso', { ascending: false })
      .order('id', { ascending: false })
    if (error) console.warn('Error cargando piezas_stock:', error.message)
    setPiezas(data || [])
    setLoading(false)
  }

  const ESTADO_INFO = {
    disponible:        { label: 'Disponible',   color: 'var(--green)',     bg: 'rgba(60,180,75,0.12)' },
    convertida_cortes: { label: 'A cortes',     color: 'var(--blue)',      bg: 'rgba(41,128,185,0.12)' },
    vendida:           { label: 'Vendida',      color: 'var(--gold)',      bg: 'rgba(201,168,76,0.12)' },
    anulada:           { label: 'Anulada',      color: 'var(--muted)',     bg: 'rgba(127,127,127,0.10)' },
  }

  // datos derivados para filtros
  const tiposUnicos = [...new Set(piezas.map(p => p.tipo_pieza).filter(Boolean))].sort()
  const proveedoresUnicos = [...new Set(piezas.map(p => p.proveedor_origen).filter(Boolean))].sort()

  const piezasFiltradas = piezas.filter(p => {
    if (filtroEstado !== 'todas' && p.estado !== filtroEstado) return false
    if (filtroTipo !== 'todos' && p.tipo_pieza !== filtroTipo) return false
    if (filtroProveedor !== 'todos' && p.proveedor_origen !== filtroProveedor) return false
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      const blob = [p.tipo_pieza, p.proveedor_origen, p.descripcion_origen, p.cliente_nombre, p.destino, p.notas_salida, p.id].filter(Boolean).join(' ').toLowerCase()
      if (!blob.includes(q)) return false
    }
    return true
  })

  // stats agregadas
  const stats = {
    total: piezas.length,
    disponibles: piezas.filter(p => p.estado === 'disponible').length,
    convertidas: piezas.filter(p => p.estado === 'convertida_cortes').length,
    vendidas:    piezas.filter(p => p.estado === 'vendida').length,
    kgDisp:      piezas.filter(p => p.estado === 'disponible').reduce((s, p) => s + (Number(p.kg) || 0), 0),
    kgConv:      piezas.filter(p => p.estado === 'convertida_cortes').reduce((s, p) => s + (Number(p.kg) || 0), 0),
    kgVend:      piezas.filter(p => p.estado === 'vendida').reduce((s, p) => s + (Number(p.kg) || 0), 0),
    valorVend:   piezas.filter(p => p.estado === 'vendida').reduce((s, p) => s + (Number(p.total_venta) || 0), 0),
  }

  const card = { background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' }
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)', fontSize: 12, width: '100%' }

  return (
    <div>
      {/* Stats top */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={card}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Total piezas registradas</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28 }}>{stats.total}</div>
        </div>
        <div style={{ ...card, borderColor: 'var(--green)' }}>
          <div style={{ fontSize: 11, color: 'var(--green)', marginBottom: 4 }}>Disponibles</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--green)' }}>{stats.disponibles}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{stats.kgDisp.toFixed(1)} kg en stock</div>
        </div>
        <div style={{ ...card, borderColor: 'var(--blue)' }}>
          <div style={{ fontSize: 11, color: 'var(--blue)', marginBottom: 4 }}>Convertidas a cortes</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--blue)' }}>{stats.convertidas}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{stats.kgConv.toFixed(1)} kg</div>
        </div>
        <div style={{ ...card, borderColor: 'var(--gold)' }}>
          <div style={{ fontSize: 11, color: 'var(--gold)', marginBottom: 4 }}>Vendidas enteras</div>
          <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--gold)' }}>{stats.vendidas}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{stats.kgVend.toFixed(1)} kg · ${Math.round(stats.valorVend).toLocaleString('es-AR')}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🔎 Filtros</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Estado</label>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={inp}>
              <option value="todas">Todas</option>
              <option value="disponible">Disponibles</option>
              <option value="convertida_cortes">A cortes</option>
              <option value="vendida">Vendidas</option>
              <option value="anulada">Anuladas</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo de pieza</label>
            <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={inp}>
              <option value="todos">Todos</option>
              {tiposUnicos.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Proveedor origen</label>
            <select value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)} style={inp}>
              <option value="todos">Todos</option>
              {proveedoresUnicos.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Buscar</label>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="ID, cliente, notas..." style={inp} />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-title">📋 {piezasFiltradas.length} {piezasFiltradas.length === 1 ? 'pieza' : 'piezas'} {piezasFiltradas.length !== piezas.length && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(de {piezas.length} totales)</span>}</div>
        {loading ? <div className="empty">Cargando...</div> : piezasFiltradas.length === 0 ? <div className="empty">Sin piezas con los filtros aplicados</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tipo</th>
                  <th>Kg</th>
                  <th>Origen (MR)</th>
                  <th>Ingreso</th>
                  <th>Estado</th>
                  <th>Destino / Cliente</th>
                  <th>Salida</th>
                  <th>$ Venta</th>
                </tr>
              </thead>
              <tbody>
                {piezasFiltradas.map(p => {
                  const info = ESTADO_INFO[p.estado] || ESTADO_INFO.anulada
                  const disabled = p.estado !== 'disponible'
                  return (
                    <tr key={p.id} style={{ opacity: disabled ? 0.65 : 1 }}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>#{p.id}</td>
                      <td style={{ fontWeight: 600 }}>{p.tipo_pieza}</td>
                      <td style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 16, color: 'var(--gold)' }}>{(Number(p.kg) || 0).toFixed(1)}</td>
                      <td style={{ fontSize: 11 }}>
                        <div style={{ color: 'var(--text)' }}>{p.proveedor_origen || '—'}</div>
                        <div style={{ color: 'var(--muted)' }}>{p.descripcion_origen || ''}{p.modelo_desposte && ' · Mod. ' + p.modelo_desposte}</div>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{p.fecha_ingreso || '—'}</td>
                      <td>
                        <span style={{ background: info.bg, color: info.color, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {info.label}
                        </span>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {p.estado === 'anulada'
                          ? <span style={{ color: '#ff6b6b', fontWeight: 700 }}>❌ Anulada{p.anulada_por ? ' por ' + p.anulada_por : ''}</span>
                          : <>
                              {p.destino === 'cortes' && <span style={{ color: 'var(--blue)' }}>→ Bovino Cortes</span>}
                              {p.destino && p.destino !== 'cortes' && (
                                <div>
                                  <div style={{ color: 'var(--text)', fontWeight: 600 }}>{p.cliente_nombre || p.destino}</div>
                                  <div style={{ color: 'var(--muted)' }}>{p.destino !== p.cliente_nombre ? p.destino : ''}</div>
                                </div>
                              )}
                              {!p.destino && <span style={{ color: 'var(--muted)' }}>—</span>}
                            </>}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{p.fecha_salida || '—'}</td>
                      <td style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
                        {p.total_venta ? '$' + Math.round(p.total_venta).toLocaleString('es-AR') : (p.precio_venta_kg ? '$' + Math.round(p.precio_venta_kg).toLocaleString('es-AR') + '/kg' : '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--surface2)', borderRadius: 8, fontSize: 11, color: 'var(--muted)' }}>
            ℹ️ Las piezas convertidas o vendidas se mantienen en este historial pero no pueden seleccionarse para nuevas operaciones (están bloqueadas, solo lectura). Esto te da trazabilidad completa de cada pieza desde que entró hasta que salió.
          </div>
        )}
      </div>
    </div>
  )
}
