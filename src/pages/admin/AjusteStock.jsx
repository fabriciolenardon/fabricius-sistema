// ============================================================
// AJUSTE DE STOCK — Conteo físico y corrección manual
// ============================================================
// Permite al admin/dueño:
//   1) Ver todos los tipos de stock en una sola pantalla
//   2) Cargar el conteo físico real al lado del valor del sistema
//   3) Ver la diferencia (sobrante / faltante) y guardarla
//   4) Cada ajuste queda registrado en auditoría con motivo + valores
//      antes/después, así no se "pierde" cómo llegó el stock a ese número.
//
// Uso típico:
//   - El dueño hace conteo físico el sábado al cerrar
//   - Abre esta pantalla, escribe los kg / unidades reales
//   - Aprieta "Guardar ajustes" → quedan stocks limpios para el lunes
// ============================================================
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { puedeAjustarStock } from '../../lib/permisos'
import Paginador, { usePaginacion } from '../../components/Paginador'
import { logAuditoria } from '../../lib/auditoria'
import { EPSILON_STOCK, stockNormalizado, redondearStock, excedeTopeStock, TOPE_STOCK } from '../../lib/stockHelpers'
import { imprimirHTML } from '../../lib/imprimir'

// Etiquetas legibles para cada tipo. Si llega un tipo desconocido se muestra
// el `tipo` crudo como fallback.
const LABELS = {
  bovino_mr: '🐄 Media Reses',
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas Bovinas',
  bovino_brosa: '🫀 Brosa (genérico legacy — repartir y dejar en 0)',
  brosa_chinchulin: '🫀 Brosa — Chinchulín',
  brosa_corazon: '🫀 Brosa — Corazón',
  brosa_entrana: '🫀 Brosa — Entraña de Costillar',
  brosa_higado: '🫀 Brosa — Hígado',
  brosa_lengua: '🫀 Brosa — Lengua',
  brosa_molleja: '🫀 Brosa — Molleja',
  brosa_mondongo: '🫀 Brosa — Mondongo',
  brosa_rabo: '🫀 Brosa — Rabo',
  brosa_rinon: '🫀 Brosa — Riñón',
  brosa_sesos: '🫀 Brosa — Sesos (por unidad)',
  brosa_tripa_gorda: '🫀 Brosa — Tripa Gorda',
  cerdo: '🐷 Cerdo (capón entero)',
  cerdo_pierna: '🦵 Cerdo — Piernas',
  cerdo_carre: '🥩 Cerdo — Carré',
  cerdo_pechito: '🍖 Cerdo — Pechitos',
  cerdo_matambre: '🥩 Cerdo — Matambre',
  cerdo_paleta: '🥩 Cerdo — Paleta',
  cerdo_parrillero: '🥩 Cerdo — Carnaza',
  cerdo_bondiola: '🥩 Cerdo — Bondiola',
  cerdo_tocino: '🧀 Cerdo — Tocino',
  cerdo_cuero: '🟫 Cerdo — Cuero',
  cerdo_cabeza: '💀 Cerdo — Cabeza',
  cerdo_huesos: '🦴 Cerdo — Huesos',
  pollo: '🍗 Pollo',
  embutido: '🌭 Embutidos (legacy — bucket eliminado, no usar)',
  emb_chorizo_parrillero: '🌭 Chorizo Parrillero (elab.)',
  emb_chorizo_saborizado: '🌭 Chorizo Saborizado (elab.)',
  emb_chorizo_colorado: '🌶️ Chorizo Colorado (elab.)',
  emb_salchicha_parrillera: '🌭 Salchicha Parrillera (elab.)',
  emb_morcilla: '🖤 Morcilla (elab.)',
  emb_salame_comun: '🥩 Salame Común Casero (elab.)',
  emb_salame_holanda: '🧀 Salame Holanda (elab.)',
  emb_salame_rockeford: '🧀 Salame Rockeford (elab.)',
  mila_carne: '🍢 Milanesas de Carne (elab.)',
  mila_cerdo: '🍢 Milanesas de Cerdo (elab.)',
  mila_pollo: '🍢 Milanesas de Pollo (elab.)',
  hamb_carne: '🍔 Hamburguesas de Carne (elab.)',
  hamb_pollo: '🍔 Hamburguesas de Pollo (elab.)',
  hamb_cerdo: '🍔 Hamburguesas de Cerdo (elab.)',
  rebozado: '🧊 Rebozados',
  almacen: '🛒 Almacén',
  bebidas: '🥤 Bebidas',
  pieza_pierna: '🦵 Pieza — Pierna',
  pieza_cuarto_pistola: '🥩 Pieza — Cuarto pistola',
  pieza_costillar: '🍖 Pieza — Costillar Completo',
  pieza_cortito: '🥩 Pieza — Cortito',
  pieza_costeletal: '🥩 Pieza — Costeletal con Lomo',
  pieza_paleta: '🥩 Pieza — Paleta',
  pieza_parrillero: '🥩 Pieza — Parrillero',
  insumos: '🧰 Insumos',
  cerdo_corte: '🐷 Cerdo — Cortes (bucket viejo)',
  caja_cb: '📦 Caja CB',
  caja_pt: '📦 Caja PT',
}

// Buckets que NO se listan salvo que esa boca ya tenga la fila:
//   - legacy: viejos que ya no se usan; aparecen sólo si les quedó saldo, para
//     poder repartirlo y dejarlos en cero. Nunca se crean de nuevo.
//   - mila_*: son de las franquicias, que elaboran la milanesa (mig 99). La
//     central vende milanesa descontando bovino_corte directo, así que no
//     tiene por qué ver esas tres líneas en su conteo.
const TIPOS_SOLO_SI_EXISTEN = new Set([
  'embutido', 'bovino_brosa', 'bovino_pieza', 'cerdo_corte',
  'mila_carne', 'mila_cerdo', 'mila_pollo',
  // Los insumos los vende la central a sus carnicerías; la sucursal los compra
  // y no los revende (PR #332), así que tampoco los cuenta.
  'insumos',
])

// Tipos que se manejan por unidad (no por kg). La columna kg_disponible
// guarda la cantidad de unidades para estos. Se muestra "u" en vez de "kg".
// brosa_sesos: el producto "SESOS (la unidad)" se vende por unidad (no
// pesable), así que su bucket también cuenta unidades.
const TIPOS_POR_UNIDAD = new Set(['almacen', 'bebidas', 'pollo', 'caja_cb', 'caja_pt', 'rebozado', 'brosa_sesos'])

// ── PLANILLA DE CONTEO ────────────────────────────────────────────────
// Lo que NO va a la planilla de papel (sí sigue en la pantalla de ajuste):
//   - almacen / bebidas: no se cuentan en este conteo diario
//   - buckets viejos que ya no se usan y quedaron en 0
const TIPOS_FUERA_PLANILLA = new Set([
  'almacen', 'bebidas',
  'bovino_pieza', 'bovino_brosa', 'embutido', 'caja_cb',
])

// Agrupado por sector, para que se pueda recorrer la cámara de una sin ir y
// volver. El `test` es por prefijo a propósito: si mañana se agrega un
// brosa_* o un emb_* nuevo, cae solo en su grupo sin tocar esto.
//
// `col` es en qué columna de la hoja va cada grupo ('a' izquierda, 'b'
// derecha). Está puesto a mano y no calculado: así queda parejo (26 y 26
// líneas) y sobre todo estable — que un grupo no salte de columna solo porque
// se cargó un producto nuevo.
const GRUPOS_PLANILLA = [
  { titulo: '🐄 BOVINO',             col: 'a', test: t => t === 'bovino_mr' || t === 'bovino_corte' },
  { titulo: '🍖 PIEZAS BOVINAS',     col: 'a', test: t => t.startsWith('pieza_') },
  { titulo: '🫀 BROSAS / ACHURAS',   col: 'a', test: t => t.startsWith('brosa_') },
  { titulo: '🍗 POLLO Y REBOZADOS',  col: 'a', test: t => t === 'pollo' || t === 'rebozado' || t.startsWith('caja_') },
  { titulo: '🐷 CERDO',              col: 'b', test: t => t === 'cerdo' || t.startsWith('cerdo_') },
  { titulo: '🌭 EMBUTIDOS',          col: 'b', test: t => t.startsWith('emb_') },
  { titulo: '🍔 HAMBURGUESAS',       col: 'b', test: t => t.startsWith('hamb_') },
  { titulo: '🍢 MILANESAS',          col: 'b', test: t => t.startsWith('mila_') },
]

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Reparte las filas en los grupos. Lo que no matchea ningún grupo cae en
// "OTROS" — nunca se pierde una fila de la planilla por no estar mapeada.
function agruparParaPlanilla(filas) {
  const resto = filas.filter(f => !TIPOS_FUERA_PLANILLA.has(f.tipo))
  const usados = new Set()
  const grupos = GRUPOS_PLANILLA.map(g => {
    const items = resto.filter(f => g.test(f.tipo))
    items.forEach(f => usados.add(f.tipo))
    return { titulo: g.titulo, col: g.col, items }
  }).filter(g => g.items.length > 0)
  const otros = resto.filter(f => !usados.has(f.tipo))
  if (otros.length > 0) grupos.push({ titulo: '📦 OTROS', items: otros })
  return grupos
}

// Reparte los grupos en 2 columnas para que todo entre en UNA hoja. La columna
// de cada grupo viene fija de GRUPOS_PLANILLA; solo los grupos sin columna
// asignada (OTROS: productos nuevos que todavía no están mapeados) se acomodan
// en la que tenga menos líneas, para no desbalancear la hoja.
function repartirEnDosColumnas(grupos) {
  const peso = g => g.items.length + 1  // +1 por el título del grupo
  const a = grupos.filter(g => g.col === 'a')
  const b = grupos.filter(g => g.col === 'b')
  const suma = col => col.reduce((s, g) => s + peso(g), 0)
  for (const g of grupos.filter(g => !g.col)) {
    (suma(a) <= suma(b) ? a : b).push(g)
  }
  return [a, b]
}

// Planilla en papel para el conteo físico diario. Entra en UNA hoja A4: dos
// columnas y sin columna de observaciones. Por defecto va CIEGA (sin la
// cantidad del sistema): si el papel ya trae el número, el que cuenta lo copia
// y el control no sirve para nada. `conSistema` lo agrega para cuando se quiere
// usar como chequeo rápido en vez de conteo a ciegas.
function planillaHTML(filas, { conSistema = false } = {}) {
  const grupos = agruparParaPlanilla(filas)
  const [colA, colB] = repartirEnDosColumnas(grupos)
  const hoy = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  const nCols = conSistema ? 4 : 3

  const tabla = grupos => grupos.length === 0 ? '' : `
    <table>
      <thead><tr>
        <th style="text-align:left; padding-left:5px">PRODUCTO</th>
        <th class="th-uni">UNID.</th>
        ${conSistema ? '<th class="th-sis">SIST.</th>' : ''}
        <th class="th-cont">CONTADO</th>
      </tr></thead>
      ${grupos.map(g => `
        <tbody class="grupo">
          <tr><td class="grupo-tit" colspan="${nCols}">${esc(g.titulo)}</td></tr>
          ${g.items.map(f => `
            <tr>
              <td class="prod">${esc(f.label)}</td>
              <td class="uni">${esc(f.unidad)}</td>
              ${conSistema ? `<td class="sis">${fmt(f.actual)}</td>` : ''}
              <td class="escribir"></td>
            </tr>`).join('')}
        </tbody>`).join('')}
    </table>`

  const secciones = `<div class="cols"><div class="col">${tabla(colA)}</div><div class="col">${tabla(colB)}</div></div>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Planilla de conteo</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; padding: 16px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
      .logo-title { font-size: 20px; font-weight: 900; letter-spacing: 2px; }
      .logo-sub { font-size: 8px; color: #555; letter-spacing: 1px; }
      .doc-title { font-size: 17px; font-weight: 900; font-style: italic; text-align: right; }
      .doc-sub { font-size: 9px; color: #444; text-align: right; }
      .datos { display: flex; gap: 14px; margin-bottom: 8px; }
      .campo { flex: 1; font-size: 10px; font-weight: 700; }
      .campo .linea { border-bottom: 1px solid #000; height: 20px; margin-top: 2px; }
      .instrucciones { border: 1px solid #000; padding: 5px 8px; font-size: 9.5px; line-height: 1.45; margin-bottom: 8px; }
      .cols { display: flex; gap: 14px; align-items: flex-start; }
      .col { flex: 1; min-width: 0; }
      table { width: 100%; border-collapse: collapse; }
      th { border: 1px solid #000; background: #e8e8e8; font-size: 7.5px; padding: 3px 2px; letter-spacing: .4px; }
      .th-uni { width: 26px; } .th-sis { width: 44px; } .th-cont { width: 62px; }
      /* Renglon alto: entra igual en una A4 vertical y queda comodo para
         escribir a lapicera. */
      td { border: 1px solid #000; font-size: 10px; padding: 0 4px; height: 28px; }
      .grupo-tit { background: #000; color: #fff; font-size: 8.5px; font-weight: 900; letter-spacing: 1.2px; height: 20px; padding: 0 5px; }
      .prod { font-weight: 600; }
      .uni { text-align: center; font-size: 8px; color: #555; }
      .sis { text-align: right; font-family: monospace; font-size: 9px; color: #333; }
      .escribir { background: #fafafa; }
      tbody.grupo { page-break-inside: avoid; }
      .firmas { display: flex; gap: 40px; margin-top: 30px; page-break-inside: avoid; }
      .firma { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 8.5px; text-align: center; letter-spacing: .04em; }
      @media print {
        body { padding: 0; }
        @page { size: A4 portrait; margin: 10mm; }
      }
    </style></head>
    <body>
      <div class="header">
        <div>
          <div class="logo-title">FABRICIUS</div>
          <div class="logo-sub">CARNICERÍAS · PREMIUM QUALITY</div>
        </div>
        <div>
          <div class="doc-title">PLANILLA DE CONTEO FÍSICO</div>
          <div class="doc-sub">Uso interno · ${esc(hoy)}</div>
        </div>
      </div>

      <div class="datos">
        <div class="campo">FECHA DEL CONTEO<div class="linea"></div></div>
        <div class="campo">QUIÉN CONTÓ<div class="linea"></div></div>
        <div class="campo">HORA INICIO<div class="linea"></div></div>
        <div class="campo">HORA FIN<div class="linea"></div></div>
      </div>

      <div class="instrucciones">
        <b>Anotá lo que HAY, no lo que debería haber.</b> Si un producto está en cero, escribí <b>0</b> —
        no lo dejes vacío. Una línea vacía se lee como "no se contó" y queda sin cargar.
        Ojo con la columna UNID.: <b>kg</b> es kilos y <b>u</b> es unidades (pollo, rebozados, sesos, cajas).
      </div>

      ${secciones}

      <div class="firmas">
        <div class="firma">FIRMA DE QUIEN CONTÓ</div>
        <div class="firma">ACLARACIÓN</div>
      </div>
    </body></html>`
}

// ── COMPROBANTE DE AJUSTE ─────────────────────────────────────────────
// Se imprime apenas se guarda un ajuste: qué había en el sistema, en cuánto
// quedó y la diferencia. Queda el papel del movimiento, que si no solo vive
// en el log de auditoría.
function comprobanteHTML({ cambios, motivo, usuario, fechaHora }) {
  const conSigno = n => (n > 0 ? '+' : '') + fmt(n)
  // Los kg y las unidades no se pueden sumar juntos: se totaliza por separado.
  const totalPor = unidad => cambios
    .filter(c => c.unidad === unidad)
    .reduce((s, c) => s + c.diferencia, 0)
  const totKg = totalPor('kg')
  const totU = totalPor('u')
  const sobrantes = cambios.filter(c => c.diferencia > 0).length
  const faltantes = cambios.filter(c => c.diferencia < 0).length

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comprobante de ajuste de stock</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; padding: 0; }
      .encabezado { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 11px; }
      .marca { font-size: 21px; font-weight: 900; letter-spacing: 2.5px; line-height: 1; }
      .marca-sub { font-size: 7.5px; color: #555; letter-spacing: 1.4px; margin-top: 3px; }
      .doc-tit { font-size: 16px; font-weight: 900; font-style: italic; text-align: right; line-height: 1.15; }
      .doc-sub { font-size: 8.5px; color: #444; text-align: right; margin-top: 2px; }
      .datos { display: flex; gap: 12px; margin-bottom: 11px; }
      .campo { flex: 1; }
      .campo .et { font-size: 8px; font-weight: 800; letter-spacing: .1em; color: #555; text-transform: uppercase; }
      .campo .vl { font-size: 11.5px; font-weight: 700; border-bottom: 1px solid #000; padding: 2px 0 3px; word-break: break-word; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      th { border: 1px solid #000; background: #e8e8e8; font-size: 8px; padding: 4px 3px; letter-spacing: .5px; }
      td { border: 1px solid #000; font-size: 10.5px; padding: 5px 6px; }
      .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .prod { font-weight: 600; }
      .dif { font-weight: 800; }
      .resumen { border: 1px solid #000; padding: 8px 11px; font-size: 10.5px; line-height: 1.6; }
      .resumen b { font-weight: 800; }
      .firmas { display: flex; gap: 40px; margin-top: 34px; }
      .firma { flex: 1; border-top: 1px solid #000; padding-top: 3px; font-size: 8.5px; text-align: center; letter-spacing: .04em; }
      @media print { @page { size: A4 portrait; margin: 12mm; } }
    </style></head>
    <body>
      <div class="encabezado">
        <div>
          <div class="marca">FABRICIUS</div>
          <div class="marca-sub">CARNICERÍAS · PREMIUM QUALITY</div>
        </div>
        <div>
          <div class="doc-tit">COMPROBANTE DE AJUSTE DE STOCK</div>
          <div class="doc-sub">Uso interno · ${esc(fechaHora)}</div>
        </div>
      </div>

      <div class="datos">
        <div class="campo"><div class="et">Fecha y hora</div><div class="vl">${esc(fechaHora)}</div></div>
        <div class="campo"><div class="et">Ajustó</div><div class="vl">${esc(usuario)}</div></div>
        <div class="campo" style="flex:2"><div class="et">Motivo</div><div class="vl">${esc(motivo)}</div></div>
      </div>

      <table>
        <thead><tr>
          <th style="text-align:left; padding-left:6px">PRODUCTO</th>
          <th style="width:78px">HABÍA</th>
          <th style="width:78px">QUEDÓ</th>
          <th style="width:88px">DIFERENCIA</th>
        </tr></thead>
        <tbody>
          ${cambios.map(c => `
            <tr>
              <td class="prod">${esc(c.label)}</td>
              <td class="num">${fmt(c.actual)} ${esc(c.unidad)}</td>
              <td class="num">${fmt(c.contado)} ${esc(c.unidad)}</td>
              <td class="num dif">${conSigno(c.diferencia)} ${esc(c.unidad)}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      <div class="resumen">
        <b>${cambios.length}</b> producto${cambios.length === 1 ? '' : 's'} ajustado${cambios.length === 1 ? '' : 's'} ·
        <b>${sobrantes}</b> con sobrante · <b>${faltantes}</b> con faltante<br>
        Diferencia neta: <b>${conSigno(totKg)} kg</b>${totU !== 0 ? ` · <b>${conSigno(totU)} u</b>` : ''}
        <div style="color:#555; margin-top:3px">
          Diferencia = lo contado − lo que decía el sistema. Positivo = sobró mercadería · Negativo = faltó.
        </div>
      </div>

      <div class="firmas">
        <div class="firma">FIRMA DE QUIEN AJUSTÓ</div>
        <div class="firma">ACLARACIÓN</div>
      </div>
    </body></html>`
}

const fmt = n => Math.round((Number(n) || 0) * 100) / 100
const fFecha = s => s ? new Date(s).toLocaleString('es-AR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
}) : '—'

export default function AjusteStock() {
  // Ajusta stock el DUEÑO DEL DEPÓSITO, no cualquier admin: reescribir el
  // stock a mano borra el rastro de qué pasó.
  //   · en la central  → solo Fabricio (Ariel y Giuliana también son admin)
  //   · en una sucursal → su dueño, sobre SU propio depósito
  // El aislamiento lo garantiza la base (supabase/93): una sucursal no puede
  // ni ver ni tocar el stock de la otra. Ver lib/permisos.js.
  const { profile, user } = useAuth()
  const puedeAjustar = puedeAjustarStock(profile, user)
  const [stocks, setStocks] = useState([])
  const [historial, setHistorial] = useState([])  // ajustes registrados (auditoría) = desfasajes
  const [loading, setLoading] = useState(true)
  const [contados, setContados] = useState({}) // { tipo: 'string del input' }
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [filtro, setFiltro] = useState('todos') // 'todos' | 'negativos' | 'modificados'
  // Confirmaciones INLINE (nada de window.confirm: en iPhone/PWA lo suprimen sin
  // error y la acción se pierde en silencio — regla de oro N°4).
  const [confirmLimpiar, setConfirmLimpiar] = useState(false)
  const [confirmGuardar, setConfirmGuardar] = useState(null) // { cambios, motivo }
  const [planillaConSistema, setPlanillaConSistema] = useState(false) // planilla ciega por defecto
  const [ultimoComprobante, setUltimoComprobante] = useState(null)    // para reimprimir el último ajuste

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data, error }, { data: hist }] = await Promise.all([
      supabase.from('stock_actual').select('*').order('tipo'),
      // Cada ajuste de stock quedó logueado en auditoría = un desfasaje histórico.
      supabase.from('auditoria_log')
        .select('id, fecha, entidad_id, valores_antes, valores_despues, descripcion, usuario_nombre')
        .eq('entidad', 'stock_actual')
        .order('fecha', { ascending: false })
        .limit(500),
    ])
    if (error) console.error(error)
    setStocks(data || [])
    setHistorial(hist || [])
    setContados({})
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success', ms = 3500) {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), ms)
  }

  // Lista de filas con la diferencia ya calculada (memo para no recalcular en cada tecla).
  //
  // Se listan TODOS los buckets conocidos, no sólo los que ya tienen fila en
  // `stock_actual`. Esa tabla se puebla recién cuando entra o sale mercadería,
  // así que una boca nueva veía apenas un puñado de líneas: Monte Cristo tenía
  // 4 (bovino_corte y las 3 de milanesas) y no podía cargar el conteo del resto
  // — ni siquiera aparecían el pollo, las piezas, los embutidos o las brosas.
  // El que no existe se muestra en 0 y, si se le carga un conteo, se crea al
  // guardar (con su sucursal, que la pone el trigger).
  const filas = useMemo(() => {
    const porTipo = new Map((stocks || []).map(s => [s.tipo, s]))
    const tipos = [...new Set([...Object.keys(LABELS), ...porTipo.keys()])]
      .filter(t => !TIPOS_SOLO_SI_EXISTEN.has(t) || porTipo.has(t))
      .sort()
    return tipos.map(t => porTipo.get(t) || { tipo: t, kg_disponible: 0, _nueva: true })
  }, [stocks])

  const filasCalculadas = useMemo(() => filas.map(s => {
    // stockNormalizado: un bucket vaciado queda con residuo de float
    // (-0,0000000000000036) que se muestra como 0 pero es < 0 — se pintaba en
    // rojo, contaba como negativo y "0 → 0" daba un ajuste fantasma de +0.
    const actual = stockNormalizado(s.kg_disponible)
    const contadoStr = contados[s.tipo]
    const tieneInput = contadoStr !== undefined && contadoStr !== ''
    const contado = tieneInput ? Number(contadoStr) : null
    const diferencia = tieneInput ? (contado - actual) : null
    return {
      ...s,
      label: LABELS[s.tipo] || s.tipo,
      unidad: TIPOS_POR_UNIDAD.has(s.tipo) ? 'u' : 'kg',
      actual,
      contado,
      diferencia,
      // Una diferencia que se muestra como 0 no es un ajuste: no tiene sentido
      // escribir en stock_actual (ni loguear en auditoría) un cambio de 0.
      modificado: tieneInput && !Number.isNaN(contado) && Math.abs(diferencia) >= EPSILON_STOCK,
    }
  }), [filas, contados])

  // Filtro de la tabla
  const filasVisibles = useMemo(() => {
    if (filtro === 'negativos') return filasCalculadas.filter(f => f.actual < 0)
    if (filtro === 'modificados') return filasCalculadas.filter(f => f.modificado)
    return filasCalculadas
  }, [filasCalculadas, filtro])

  // ── Historial de desfasajes: cada ajuste registrado = un desfasaje (físico − sistema) ──
  const desfasajes = useMemo(() => (historial || []).map(r => {
    const tipo = r.entidad_id
    // Normalizado también acá: hay ajustes viejos cuyo "antes" es el residuo
    // de float (-0,0000000000000036) y se listaban como un desfasaje de +0.
    const antes = stockNormalizado(r.valores_antes?.kg_disponible)
    const despues = stockNormalizado(r.valores_despues?.kg_disponible)
    return {
      id: r.id, tipo,
      label: LABELS[tipo] || tipo,
      unidad: TIPOS_POR_UNIDAD.has(tipo) ? 'u' : 'kg',
      antes, despues, dif: stockNormalizado(despues - antes),
      motivo: r.valores_despues?.motivo || '—',
      fecha: r.fecha, usuario: r.usuario_nombre || '—',
    }
  }).filter(d => d.tipo), [historial])

  // Antes se mostraban solo los 80 más recientes y al resto no se llegaba.
  // La consulta ya trae hasta 500, así que se paginan y están todos.
  const pagDesf = usePaginacion(desfasajes, 20)

  // Acumulado por producto (para detectar desfasajes recurrentes vs puntuales)
  const resumenDesfasajes = useMemo(() => {
    const m = new Map()
    for (const d of desfasajes) {
      const cur = m.get(d.tipo) || { tipo: d.tipo, label: d.label, unidad: d.unidad, n: 0, total: 0, ultimo: null }
      cur.n += 1; cur.total += d.dif
      if (!cur.ultimo || d.fecha > cur.ultimo) cur.ultimo = d.fecha
      m.set(d.tipo, cur)
    }
    return [...m.values()].map(x => ({ ...x, prom: x.n ? x.total / x.n : 0 }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  }, [desfasajes])

  const cantModificados = filasCalculadas.filter(f => f.modificado).length

  function setContado(tipo, val) {
    // Si estaba abierta una confirmación, la invalidamos: lo que se muestra en
    // el panel tiene que ser siempre lo que se va a guardar.
    setConfirmGuardar(null)
    setContados(c => ({ ...c, [tipo]: val }))
  }

  function limpiar() {
    if (cantModificados === 0) return
    setConfirmGuardar(null)
    setConfirmLimpiar(true)
  }

  function ejecutarLimpiar() {
    setContados({})
    setMotivo('')
    setConfirmLimpiar(false)
  }

  // Paso 1: validar y abrir el panel de confirmación inline con el resumen.
  function pedirGuardar() {
    if (!puedeAjustar) {
      showMsg('Solo el dueño del negocio puede ajustar stock', 'error')
      return
    }
    const cambios = filasCalculadas.filter(f => f.modificado)
    if (cambios.length === 0) {
      showMsg('No hay valores nuevos para guardar', 'error')
      return
    }
    if (!motivo.trim()) {
      showMsg('Cargá un motivo del ajuste (ej: "Conteo físico fin de semana")', 'error')
      return
    }
    // El stock se guarda con 4 enteros + 3 decimales: más de 9.999,999 lo
    // rechaza la base. Avisamos acá para que se vea el typo (96000 en vez de
    // 960) en vez de que falle el guardado.
    const pasados = cambios.filter(c => excedeTopeStock(c.contado))
    if (pasados.length > 0) {
      showMsg(`El tope por producto es ${TOPE_STOCK} — revisá: ${pasados.map(c => c.label).join(', ')}`, 'error', 8000)
      return
    }
    setConfirmLimpiar(false)
    setConfirmGuardar({ cambios, motivo: motivo.trim() })
  }

  // Paso 2: escribir en stock_actual lo que se mostró en el panel.
  async function guardarAjustes() {
    if (!confirmGuardar) return
    const { cambios, motivo: motivoTxt } = confirmGuardar

    setGuardando(true)
    const errores = []
    const guardados = []   // solo los que realmente se escribieron → van al comprobante
    for (const c of cambios) {
      // El stock se guarda al gramo — la auditoría tiene que registrar el
      // valor que realmente quedó, no el que se tipeó.
      const guardado = redondearStock(c.contado)

      // 1) Actualizar el stock. Si el bucket todavía no tenía fila en esta boca
      //    (`_nueva`), se crea: la sucursal la pone el trigger. Sin esto, el
      //    UPDATE no encontraba nada y el ajuste se perdía en silencio.
      const { error } = c._nueva
        ? await supabase.from('stock_actual').insert({ tipo: c.tipo, kg_disponible: guardado })
        : await supabase.from('stock_actual').update({ kg_disponible: guardado }).eq('tipo', c.tipo)
      if (error) { errores.push(`${c.label}: ${error.message}`); continue }
      guardados.push({ ...c, contado: guardado })

      // 2) Loguear el ajuste en auditoría — no bloquea si falla
      const signo = c.diferencia > 0 ? '+' : ''
      await logAuditoria({
        accion: 'update',
        modulo: 'deposito',
        entidad: 'stock_actual',
        entidad_id: c.tipo,
        descripcion: `Ajuste de stock "${c.label}": ${c.actual} → ${guardado} (${signo}${fmt(c.diferencia)} ${c.unidad}). Motivo: ${motivoTxt}`,
        valoresAntes: { tipo: c.tipo, kg_disponible: c.actual },
        valoresDespues: { tipo: c.tipo, kg_disponible: guardado, motivo: motivoTxt },
      })
    }
    setGuardando(false)
    setConfirmGuardar(null)

    // Comprobante del ajuste: se imprime solo apenas se guarda, y queda el
    // botón para reimprimirlo por si se cerró el diálogo de impresión.
    if (guardados.length > 0) {
      const comprobante = {
        cambios: guardados,
        motivo: motivoTxt,
        usuario: profile?.nombre || user?.email || '—',
        fechaHora: new Date().toLocaleString('es-AR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: 'America/Argentina/Buenos_Aires',
        }),
      }
      setUltimoComprobante(comprobante)
      imprimirHTML(comprobanteHTML(comprobante))
    }

    if (errores.length > 0) {
      showMsg(`Se guardaron ${cambios.length - errores.length} de ${cambios.length}. Errores: ${errores.join('; ')}`, 'error', 8000)
    } else {
      showMsg(`✅ ${cambios.length} ajuste(s) guardado(s) y registrado(s) en auditoría`, 'success', 5000)
    }
    setContados({})
    setMotivo('')
    await cargar()
  }

  if (!puedeAjustar) {
    return (
      <div style={{ padding: 20, background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#ff6b6b' }}>
        🔒 El ajuste de stock lo hace el dueño del negocio.
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          Si contaste stock y no coincide con el sistema, pasale el detalle
          (producto, kg contados y por qué) para que lo corrija.
        </div>
      </div>
    )
  }

  const inp = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 6, padding: '6px 10px',
    fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%',
    boxSizing: 'border-box', textAlign: 'right',
  }
  const thL = { textAlign: 'left', padding: '8px 10px', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }
  const thR = { ...thL, textAlign: 'right' }
  const tdR = { padding: '6px 10px', textAlign: 'right' }
  const colorDif = v => v < 0 ? '#ff8b8b' : v > 0 ? '#7dff7d' : 'var(--muted)'

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

      {/* El comprobante del último ajuste se imprime solo al guardar; esto es
          por si se cerró el diálogo de impresión sin querer. */}
      {ultimoComprobante && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
        }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            🧾 Último ajuste: <b style={{ color: 'var(--text)' }}>{ultimoComprobante.cambios.length} producto{ultimoComprobante.cambios.length === 1 ? '' : 's'}</b> · {ultimoComprobante.fechaHora}
          </span>
          <button onClick={() => imprimirHTML(comprobanteHTML(ultimoComprobante))}
            style={{ padding: '5px 12px', background: 'transparent', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            🖨️ Reimprimir comprobante
          </button>
          <button onClick={() => setUltimoComprobante(null)}
            style={{ padding: '5px 10px', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>
            ✕
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🔧 Ajuste manual de stock</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
          Cargá el conteo físico real al lado del valor del sistema. Solo se guardan las filas
          donde escribiste algo nuevo y distinto. Cada cambio queda registrado en auditoría con
          tu nombre, fecha, el motivo y los valores antes/después.
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#ffd17a', background: 'rgba(255,209,122,0.06)', border: '1px solid #6a5a2a', padding: '8px 12px', borderRadius: 6 }}>
          ⚠️ Esto edita directamente el stock — no genera entradas ni salidas. Para sumar mercadería comprada usá Depósito → Entradas.
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          { id: 'todos', label: `Todos (${filasCalculadas.length})` },
          { id: 'negativos', label: `🚨 Negativos (${filasCalculadas.filter(f => f.actual < 0).length})` },
          { id: 'modificados', label: `✏️ Modificados (${cantModificados})` },
        ].map(b => (
          <button key={b.id} onClick={() => setFiltro(b.id)}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: `1px solid ${filtro === b.id ? 'var(--gold)' : 'var(--border)'}`,
              background: filtro === b.id ? 'var(--gold)' : 'transparent',
              color: filtro === b.id ? '#000' : 'var(--muted)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>
            {b.label}
          </button>
        ))}
        <button onClick={() => imprimirHTML(planillaHTML(filasCalculadas, { conSistema: planillaConSistema }))}
          title="Imprime la lista de todos los productos para contar a mano"
          style={{ padding: '6px 14px', background: 'transparent', border: '1px solid var(--gold)', color: 'var(--gold)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, marginLeft: 'auto' }}>
          🖨️ Planilla de conteo
        </button>
        <label title="Por defecto va en blanco: si el papel trae el número del sistema, el que cuenta lo copia y el control no sirve"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={planillaConSistema} onChange={e => setPlanillaConSistema(e.target.checked)} />
          con cantidades del sistema
        </label>
        <button onClick={cargar} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
          🔄 Recargar
        </button>
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando stocks...</p>}

      {!loading && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Tipo</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Sistema</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', width: 140 }}>Conteo físico</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', width: 130 }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin filas para mostrar</td></tr>
                )}
                {filasVisibles.map(f => {
                  const colorActual = f.actual < 0 ? '#ff6b6b' : f.actual === 0 ? 'var(--muted)' : 'var(--text)'
                  // f.modificado ya trae la tolerancia: una diferencia que
                  // redondea a 0 se muestra neutra, no como "+0" en verde.
                  const colorDif = !f.modificado ? 'var(--muted)'
                    : f.diferencia > 0 ? '#7dff7d'
                    : '#ff8b8b'
                  return (
                    <tr key={f.tipo} style={{ borderTop: '1px solid var(--border)', background: f.modificado ? 'rgba(201,168,76,0.04)' : 'transparent' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                        {f.label}
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{f.tipo}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: colorActual }}>
                        {fmt(f.actual)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{f.unidad}</span>
                      </td>
                      <td style={{ padding: '6px 12px' }}>
                        <input
                          type="number" step="0.01"
                          value={contados[f.tipo] ?? ''}
                          onChange={e => setContado(f.tipo, e.target.value)}
                          placeholder={String(fmt(f.actual))}
                          style={{ ...inp, borderColor: f.modificado ? 'var(--gold)' : 'var(--border)' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: colorDif }}>
                        {f.diferencia == null ? '—'
                          : !f.modificado ? '0'
                          : (f.diferencia > 0 ? '+' : '') + fmt(f.diferencia)
                        }
                        {f.diferencia != null && f.modificado && (
                          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{f.unidad}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer con motivo + guardar.
          La confirmación es INLINE (window.confirm no se muestra en iOS/PWA y el
          ajuste se perdía en silencio). Mientras está abierto el panel se oculta
          el form para que lo que se ve sea exactamente lo que se va a escribir. */}
      <div className="card" style={{ marginTop: 16, padding: 16 }}>
        {confirmGuardar ? (
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
              📋 Confirmar {confirmGuardar.cambios.length} ajuste{confirmGuardar.cambios.length === 1 ? '' : 's'} de stock
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
              Revisá los cambios antes de escribirlos en el stock. Esto edita el stock directamente
              y queda registrado en auditoría con tu nombre.
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
                  <thead><tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0 }}>
                    <th style={thL}>Producto</th>
                    <th style={thR}>Sistema → Contado</th>
                    <th style={thR}>Diferencia</th>
                  </tr></thead>
                  <tbody>
                    {confirmGuardar.cambios.map(c => (
                      <tr key={c.tipo} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 600 }}>{c.label}</td>
                        <td style={{ ...tdR, whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                          {fmt(c.actual)} → <b style={{ color: 'var(--text)' }}>{fmt(c.contado)}</b> {c.unidad}
                        </td>
                        <td style={{ ...tdR, color: colorDif(c.diferencia), fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {c.diferencia > 0 ? '+' : ''}{fmt(c.diferencia)} {c.unidad}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Motivo</div>
              <div style={{ fontSize: 13, fontWeight: 700, wordBreak: 'break-word' }}>{confirmGuardar.motivo}</div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={guardarAjustes} disabled={guardando}
                style={{ padding: '12px 20px', background: guardando ? 'var(--surface2)' : 'var(--gold)', color: guardando ? 'var(--muted)' : '#000', border: 'none', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 800 }}>
                {guardando ? '⏳ Guardando…' : '✅ Sí, guardar'}
              </button>
              <button onClick={() => setConfirmGuardar(null)} disabled={guardando}
                style={{ padding: '12px 20px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: guardando ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Motivo del ajuste (obligatorio)
              </label>
              <input
                value={motivo}
                onChange={e => { setConfirmGuardar(null); setMotivo(e.target.value) }}
                placeholder="Ej: Conteo físico fin de semana · Carga inicial almacén · Corrección venta mal cargada"
                style={{ ...inp, textAlign: 'left' }}
              />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Queda guardado en el log de auditoría para poder rastrear el cambio después.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {confirmLimpiar ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>¿Descartar todo?</span>
                  <button onClick={ejecutarLimpiar}
                    style={{ padding: '10px 14px', background: '#3a1a1a', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 800 }}>
                    Sí, descartar
                  </button>
                  <button onClick={() => setConfirmLimpiar(false)}
                    style={{ padding: '10px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button onClick={limpiar} disabled={cantModificados === 0}
                  style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: cantModificados === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: cantModificados === 0 ? 0.4 : 1 }}>
                  ✕ Limpiar
                </button>
              )}
              <button onClick={pedirGuardar} disabled={guardando || cantModificados === 0}
                style={{ padding: '10px 20px', background: cantModificados > 0 && !guardando ? 'var(--gold)' : 'var(--surface2)', color: cantModificados > 0 && !guardando ? '#000' : 'var(--muted)', border: 'none', borderRadius: 8, cursor: (guardando || cantModificados === 0) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 800 }}>
                {guardando ? '⏳ Guardando…' : `💾 Guardar ${cantModificados} ajuste${cantModificados === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HISTORIAL DE DESFASAJES — de los ajustes registrados */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">📉 Historial de desfasajes</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>
          Cada ajuste que guardaste (físico vs sistema) queda acá. <b>Diferencia = físico − sistema.</b>{' '}
          Recurrente del mismo signo = probable <b>merma</b> o tema del sistema · Puntual y grande = probable <b>error de carga</b>.
        </div>

        {desfasajes.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>
            Todavía no hay ajustes registrados. Cuando guardes un conteo físico arriba, aparece acá.
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>📊 Acumulado por producto</div>
            <div style={{ overflowX: 'auto', marginBottom: 18 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                <thead><tr style={{ background: 'var(--surface2)' }}>
                  <th style={thL}>Producto</th><th style={thR}>Ajustes</th>
                  <th style={thR}>Desfasaje acum.</th><th style={thR}>Promedio</th><th style={thR}>Último</th>
                </tr></thead>
                <tbody>
                  {resumenDesfasajes.map(r => (
                    <tr key={r.tipo} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600 }}>{r.label}</td>
                      <td style={tdR}>{r.n}</td>
                      <td style={{ ...tdR, color: colorDif(r.total), fontWeight: 700 }}>{r.total > 0 ? '+' : ''}{fmt(r.total)} {r.unidad}</td>
                      <td style={{ ...tdR, color: 'var(--muted)' }}>{r.prom > 0 ? '+' : ''}{fmt(r.prom)} {r.unidad}</td>
                      <td style={{ ...tdR, color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{fFecha(r.ultimo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🕒 Detalle ({desfasajes.length})</div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 660 }}>
                <thead><tr style={{ background: 'var(--surface2)', position: 'sticky', top: 0 }}>
                  <th style={thL}>Fecha</th><th style={thL}>Producto</th><th style={thR}>Sistema → Físico</th>
                  <th style={thR}>Dif.</th><th style={thL}>Motivo</th><th style={thL}>Por</th>
                </tr></thead>
                <tbody>
                  {pagDesf.items.map(d => (
                    <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fFecha(d.fecha)}</td>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{d.label}</td>
                      <td style={{ ...tdR, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmt(d.antes)} → {fmt(d.despues)}</td>
                      <td style={{ ...tdR, color: colorDif(d.dif), fontWeight: 700, whiteSpace: 'nowrap' }}>{d.dif > 0 ? '+' : ''}{fmt(d.dif)} {d.unidad}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{d.motivo}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{d.usuario}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginador {...pagDesf.controles} />
          </>
        )}
      </div>
    </div>
  )
}
