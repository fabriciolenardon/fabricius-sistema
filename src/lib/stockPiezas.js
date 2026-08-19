// ============================================================
// STOCK POR PIEZA — kilos de cada bucket y de dónde salió cada movimiento
// ============================================================
// Sirve para dos familias que hasta ahora no tenían dónde mirarse:
//
//   🐷 CERDO      la central compra CAPONES y los desposta, así que ve los
//                 kilos de cada pieza aparecer solos. Una sucursal no recibe
//                 capones sino las piezas ya despostadas: carga una pierna y
//                 después no tiene dónde ver cuánto le queda.
//   🌭 EMBUTIDOS  la central los ELABORA; la sucursal se los COMPRA a la
//                 central. En los dos casos entran al mismo bucket `emb_*`.
//
// El stock ya existía y estaba bien; lo que faltaba era poder VERLO con su
// historial.
//
// EL HISTORIAL SALE DE CUATRO LADOS, y cada uno guarda la pieza distinto:
//   entradas_deposito ........ `tipo` ES el bucket ('cerdo_pierna','emb_morcilla')
//   ventas_minoristas ........ items[].stock_origen
//   remitos .................. items[].stock_origen
//   elaboraciones_embutidos .. piezas_usadas[]     = lo que CONSUMIÓ (cerdo)
//                              productos_finales[] = lo que PRODUJO (embutidos)
//
// Esa última es la diferencia entre las dos familias: la misma elaboración que
// descuenta paleta de cerdo acredita chorizo. Por eso cada familia declara si
// la elaboración le suma o le resta.
//
// Se arma en el cliente y no con una consulta sola porque tres de las cuatro
// fuentes tienen la pieza adentro de un JSON.
//
// El filtro por sucursal NO se pone acá: lo hace el RLS (migración 93). Si se
// filtrara a mano y alguien se olvidara, se mezclaría el stock de los dos
// negocios.
// ============================================================
import { supabase, fetchAllRows } from './supabase'

// Las piezas en las que se desposta un capón. `cerdo` (el capón entero) NO
// está acá: es materia prima previa, no una pieza, y una sucursal ni lo ve.
export const BUCKETS_CERDO = {
  cerdo_pierna:     '🦵 Pierna',
  cerdo_paleta:     '🥩 Paleta',
  cerdo_carre:      '🥩 Carré',
  cerdo_pechito:    '🍖 Pechito',
  cerdo_matambre:   '🥩 Matambre',
  cerdo_bondiola:   '🥩 Bondiola',
  cerdo_parrillero: '🥩 Carnaza',
  cerdo_tocino:     '🧀 Tocino',
  cerdo_huesos:     '🦴 Huesos',
  cerdo_cuero:      '🟫 Cuero',
  cerdo_cabeza:     '💀 Cabeza',
}

// Embutidos con bucket propio. El genérico 'embutido' (comprados sin
// clasificar) queda afuera: no es un producto de la lista.
export const BUCKETS_EMBUTIDO = {
  emb_chorizo_parrillero:   '🌭 Chorizo Parrillero',
  emb_chorizo_saborizado:   '🌭 Chorizo Saborizado',
  emb_chorizo_colorado:     '🌶️ Chorizo Colorado',
  emb_salchicha_parrillera: '🌭 Salchicha Parrillera',
  emb_morcilla:             '🖤 Morcilla',
  emb_salame_comun:         '🥩 Salame Común',
  emb_salame_holanda:       '🧀 Salame Holanda',
  emb_salame_rockeford:     '🧀 Salame Rockeford',
}

// `elaboraciones_embutidos.productos_finales` guarda el tipo SIN el prefijo
// (`chorizo_parrillero`), no el bucket. Este mapa los empareja.
const TIPO_ELAB_A_BUCKET = {
  chorizo_parrillero: 'emb_chorizo_parrillero',
  chorizo_saborizado: 'emb_chorizo_saborizado',
  chorizo_colorado: 'emb_chorizo_colorado',
  salchicha_parrillera: 'emb_salchicha_parrillera',
  morcilla: 'emb_morcilla',
  salame_comun: 'emb_salame_comun',
  salame_rockeford: 'emb_salame_rockeford',
  salame_holanda: 'emb_salame_holanda',
}

// Las dos familias que sabe mostrar la pantalla.
export const FAMILIAS = {
  cerdo: {
    titulo: '🐷 Stock de cerdo por pieza',
    buckets: BUCKETS_CERDO,
    // La elaboración CONSUME piezas de cerdo.
    elaboracion: { campo: 'piezas_usadas', signo: -1, mapa: null },
    vacio: 'Sin movimientos de cerdo en este período. Cuando cargues una compra en Ingresos o vendas un corte, aparece acá.',
  },
  embutido: {
    titulo: '🌭 Stock de embutidos por producto',
    buckets: BUCKETS_EMBUTIDO,
    // La elaboración PRODUCE embutidos.
    elaboracion: { campo: 'productos_finales', signo: +1, mapa: TIPO_ELAB_A_BUCKET },
    vacio: 'Sin movimientos de embutidos en este período. Cuando cargues una compra en Ingresos o vendas, aparece acá.',
  },
}

const n = v => Number(v) || 0

// Kilos actuales de cada bucket de la familia.
export async function cargarStockFamilia(familia) {
  const { buckets } = FAMILIAS[familia]
  const { data } = await supabase.from('stock_actual').select('tipo, kg_disponible')
  const mapa = {}
  for (const t of Object.keys(buckets)) mapa[t] = 0
  for (const fila of data || []) {
    if (fila.tipo in buckets) mapa[fila.tipo] = n(fila.kg_disponible)
  }
  return mapa
}

// Todos los movimientos de la familia en un rango, unificados y ordenados del
// más nuevo al más viejo. `kg` positivo = entra al depósito; negativo = sale.
export async function cargarMovimientos(familia, { desde, hasta }) {
  const cfg = FAMILIAS[familia]
  const { buckets } = cfg
  const esDeLaFamilia = t => !!t && t in buckets

  const [entradas, ventas, remitos, elaboraciones] = await Promise.all([
    fetchAllRows(() => supabase.from('entradas_deposito')
      .select('id, fecha, tipo, kg, kg_real, proveedor_nombre, descripcion, destino, eliminado')
      .gte('fecha', desde).lte('fecha', hasta)),
    fetchAllRows(() => supabase.from('ventas_minoristas')
      .select('id, fecha, items').gte('fecha', desde).lte('fecha', hasta)),
    fetchAllRows(() => supabase.from('remitos')
      .select('id, fecha, numero, cliente_nombre, items, eliminado')
      .gte('fecha', desde).lte('fecha', hasta)),
    fetchAllRows(() => supabase.from('elaboraciones_embutidos')
      .select('id, fecha, tipo, tipo_embutido, piezas_usadas, productos_finales')
      .gte('fecha', desde).lte('fecha', hasta)),
  ])

  const movs = []

  // ── INGRESOS ──
  // Las entradas con destino 'desposte'/'elaboracion' son internas: no son una
  // compra, es mercadería que ya estaba y se transformó. Para el stock de la
  // pieza igual son un ingreso real, así que se muestran, pero etiquetadas
  // distinto para que se entienda de dónde vino.
  for (const e of (entradas.data || [])) {
    if (e.eliminado) continue
    if (!esDeLaFamilia(e.tipo)) continue
    const kg = n(e.kg_real) || n(e.kg)
    if (!kg) continue
    const interna = e.destino === 'desposte' || e.destino === 'elaboracion'
    movs.push({
      id: 'e' + e.id, fecha: e.fecha, bucket: e.tipo, kg,
      clase: interna ? 'interna' : 'ingreso',
      detalle: interna
        ? (e.descripcion || 'Producción propia')
        : (e.proveedor_nombre || e.descripcion || 'Compra'),
    })
  }

  // ── VENTAS POR MOSTRADOR ──
  for (const v of (ventas.data || [])) {
    for (const it of (Array.isArray(v.items) ? v.items : [])) {
      if (!esDeLaFamilia(it.stock_origen)) continue
      const kg = n(it.kg)
      if (!kg) continue
      movs.push({
        id: 'v' + v.id + (it.descripcion || ''), fecha: v.fecha, bucket: it.stock_origen,
        kg: -kg, clase: 'venta', detalle: it.descripcion || 'Venta en caja',
      })
    }
  }

  // ── REMITOS ──
  for (const r of (remitos.data || [])) {
    if (r.eliminado) continue
    for (const it of (Array.isArray(r.items) ? r.items : [])) {
      if (!esDeLaFamilia(it.stock_origen)) continue
      const kg = n(it.kg)
      if (!kg) continue
      movs.push({
        id: 'r' + r.id + (it.descripcion || ''), fecha: r.fecha, bucket: it.stock_origen,
        kg: -kg, clase: 'remito',
        detalle: `${r.cliente_nombre || 'Remito'}${r.numero ? ` · N° ${String(r.numero).padStart(5, '0')}` : ''}`,
      })
    }
  }

  // ── ELABORACIONES ──
  // La misma fila descuenta cerdo y acredita embutido; qué mira cada familia
  // lo dice su config.
  const { campo, signo, mapa } = cfg.elaboracion
  for (const el of (elaboraciones.data || [])) {
    for (const p of (Array.isArray(el[campo]) ? el[campo] : [])) {
      const bucket = mapa ? mapa[p.tipo] : p.tipo
      if (!esDeLaFamilia(bucket)) continue
      const kg = n(p.kg)
      if (!kg) continue
      movs.push({
        id: 'x' + el.id + bucket, fecha: el.fecha, bucket, kg: signo * kg,
        clase: signo > 0 ? 'elaborado' : 'elaboracion',
        detalle: signo > 0
          ? 'Elaboración propia'
          : `Elaboración${el.tipo_embutido ? ' · ' + String(el.tipo_embutido).replace(/_/g, ' ') : ''}`,
      })
    }
  }

  return movs.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
}

// Resumen del período por bucket: cuánto entró y cuánto salió.
export function resumirPorBucket(familia, movs) {
  const r = {}
  for (const t of Object.keys(FAMILIAS[familia].buckets)) r[t] = { entro: 0, salio: 0 }
  for (const m of movs) {
    if (!r[m.bucket]) continue
    if (m.kg > 0) r[m.bucket].entro += m.kg
    else r[m.bucket].salio += Math.abs(m.kg)
  }
  return r
}
