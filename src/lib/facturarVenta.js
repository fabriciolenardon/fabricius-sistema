// ============================================================
// FACTURAR UNA VENTA QUE YA ESTÁ CARGADA
// ============================================================
// El sistema ya sabe cuánto se vendió y qué se vendió. Hasta ahora, para
// sacarle el CAE a una venta había que ir a Facturación y volver a
// escribir todo a mano. Esto arma el puente: agarra la venta (del
// mostrador) o el remito (mayorista) y devuelve el formulario de ARCA ya
// completo, para revisar y emitir.
//
// El vínculo se guarda en facturas.venta_id / facturas.remito_id
// (migración 143), y ahí está el candado contra la factura repetida: la
// base tiene un índice único, así que no hay forma de que la misma venta
// termine con dos CAE por un doble click o dos pestañas abiertas.
//
// NO toca stock, ni cuenta corriente, ni el arqueo. Solo lee la venta y
// escribe el vínculo después de que ARCA autorizó.
// ============================================================
import { supabase, fetchAllRows } from './supabase'

// La carne va al 10,5%. El almacén y las bebidas, al 21%. Es el error
// clásico del sistema genérico: mandar todo al 21% porque es el default.
const CATEGORIAS_21 = new Set(['almacen', 'bebidas', 'insumo', 'insumos'])
export const IVA_CARNE = 4   // 10,5%
export const IVA_GENERAL = 5 // 21%

export function ivaDeCategoria(categoria) {
  return CATEGORIAS_21.has(String(categoria || '').toLowerCase()) ? IVA_GENERAL : IVA_CARNE
}

// Los `numeric` de Supabase llegan como STRING (regla 1): todo lo que se
// sume o se muestre pasa por acá primero.
const num = v => Number(v) || 0
const redondear = n => Math.round(n * 100) / 100
// Los kilos van con TRES decimales, que es como pesa la balanza. Con dos,
// 0,675 kg se convertía en 0,68 y la factura salía $75 más cara que la
// venta: el cliente pagaba una cosa y se llevaba un comprobante por otra.
const redondearKg = n => Math.round(n * 1000) / 1000

// ── Qué falta facturar ──────────────────────────────────────────────
//
// Ventas del mostrador y remitos mayoristas del período que todavía no
// tienen comprobante. Devuelve las dos listas ya ordenadas, de la más
// nueva a la más vieja.
//
// Paginado con fetchAllRows: un sábado del mostrador pasa las 1000 filas
// sin despeinarse y Supabase corta ahí en silencio (regla 3).
export async function cargarSinFacturar({ desde, hasta }) {
  const [ventasR, remitosR, facturasR] = await Promise.all([
    fetchAllRows(() => supabase
      .from('ventas_minoristas')
      .select('id, fecha, hora, total, items, cajero, origen')
      .eq('origen', 'caja')
      .gte('fecha', desde).lte('fecha', hasta)),
    fetchAllRows(() => supabase
      .from('remitos')
      .select('id, numero, fecha, cliente_id, cliente_nombre, total, items, cobro')
      .eq('eliminado', false)
      .eq('es_cobranza_terceros', false)
      .gte('fecha', desde).lte('fecha', hasta)),
    // Solo las que YA tienen origen: son las únicas que pueden tachar algo
    // de la lista. Traer las miles de facturas sueltas sería al pedo.
    fetchAllRows(() => supabase
      .from('facturas')
      .select('venta_id, remito_id')
      .or('venta_id.not.is.null,remito_id.not.is.null')),
  ])

  const facturadas = facturasR.data || []
  const ventasHechas = new Set(facturadas.map(f => f.venta_id).filter(Boolean))
  const remitosHechos = new Set(facturadas.map(f => f.remito_id).filter(Boolean))

  const ventas = (ventasR.data || [])
    .filter(v => !ventasHechas.has(v.id) && num(v.total) > 0)
    .sort((a, b) => (b.fecha + (b.hora || '')).localeCompare(a.fecha + (a.hora || '')))

  const remitos = (remitosR.data || [])
    .filter(r => !remitosHechos.has(r.id) && num(r.total) > 0)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.numero - a.numero))

  return { ventas, remitos }
}

// ── ¿Esta venta ya se facturó? ──────────────────────────────────────
//
// Se pregunta justo ANTES de pedirle el CAE a ARCA, no después: un CAE
// emitido no se borra, se anula con nota de crédito. Cubre el caso de
// la otra pestaña que facturó la misma venta hace diez segundos.
export async function yaTieneFactura({ ventaId, remitoId }) {
  const campo = ventaId ? 'venta_id' : 'remito_id'
  const valor = ventaId || remitoId
  if (!valor) return null
  const { data } = await supabase
    .from('facturas')
    .select('id, punto_venta, numero, tipo_comprobante, cae')
    .eq(campo, valor)
    .maybeSingle()
  return data || null
}

// ── Los ítems de la venta, como los quiere ARCA ─────────────────────
//
// La venta guarda { descripcion, kg, precio, importe }. El comprobante
// quiere { descripcion, cantidad, precio_unit, iva_id }. La cantidad es
// el kg (o las unidades, en almacén: ahí `kg` ya viene en unidades).
function itemsParaArca(items) {
  return (items || [])
    .filter(i => num(i.importe) > 0 || num(i.precio) > 0)
    .map(i => {
      const cantidad = num(i.kg) || 1
      // Si el precio unitario no está, se deduce del importe: así una
      // línea vieja sin precio no entra en cero.
      const precio = num(i.precio) || (cantidad > 0 ? num(i.importe) / cantidad : 0)
      return {
        descripcion: String(i.descripcion || 'Producto').trim(),
        cantidad: redondearKg(cantidad),
        precio_unit: redondear(precio),
        iva_id: ivaDeCategoria(i.categoria || i.tipo),
      }
    })
}

// Lo que suman los ítems una vez pasados a cantidad × precio. Puede no
// dar exactamente igual al total de la venta por los redondeos de la
// balanza, y por eso la pantalla muestra las dos cifras en vez de
// asumir que cierran.
export function totalDeItems(items) {
  return redondear(itemsParaArca(items).reduce((s, i) => s + i.cantidad * i.precio_unit, 0))
}

// ── La precarga del formulario ──────────────────────────────────────
//
// Devuelve los campos que hay que pisarle al form de Facturación. La
// cuenta no se elige acá: la sugiere la pantalla, que es la que sabe
// cómo viene cada monotributo contra su tope.
export function precargaDesdeVenta(venta) {
  const items = itemsParaArca(venta.items)
  return {
    origen: { tipo: 'venta', id: venta.id, etiqueta: `Venta del ${venta.fecha}${venta.hora ? ` ${String(venta.hora).slice(0, 5)}` : ''}` },
    totalOriginal: num(venta.total),
    form: {
      fecha: venta.fecha,
      items: items.length ? items : [{ descripcion: 'Venta mostrador', cantidad: 1, precio_unit: redondear(num(venta.total)), iva_id: IVA_CARNE }],
      iva_id: IVA_CARNE,
      concepto: `Venta mostrador del ${venta.fecha}`,
      condicion_pago: 'contado',
      // Mostrador: el que pide factura casi siempre es consumidor final.
      // Si el cliente da su CUIT, se cambia en el mismo modal.
      contraparte_iva: 'consumidor_final',
      contraparte_nombre: '',
      contraparte_cuit: '',
      doc_tipo: 99,
      doc_nro: '',
      cond_iva_receptor: 5,
    },
  }
}

export async function precargaDesdeRemito(remito, cliente) {
  const items = itemsParaArca(remito.items)
  const cuit = String(cliente?.cuit || '').replace(/\D/g, '')
  const tieneCuit = cuit.length === 11
  // La contraparte fiscal se busca por CUIT en su propia tabla. Si el cliente
  // no esta dado de alta ahi, la factura se guarda igual con nombre y CUIT.
  let contraparteId = null
  if (tieneCuit) {
    const { data: cp } = await supabase.from('contrapartes')
      .select('id').eq('cuit', cuit).limit(1).maybeSingle()
    contraparteId = cp?.id ?? null
  }
  return {
    origen: { tipo: 'remito', id: remito.id, etiqueta: `Remito #${remito.numero} · ${remito.cliente_nombre || 'sin cliente'}` },
    totalOriginal: num(remito.total),
    form: {
      fecha: remito.fecha,
      items: items.length ? items : [{ descripcion: `Remito #${remito.numero}`, cantidad: 1, precio_unit: redondear(num(remito.total)), iva_id: IVA_CARNE }],
      iva_id: IVA_CARNE,
      concepto: `Remito #${remito.numero}`,
      // Mayorista: casi siempre va a cuenta corriente.
      condicion_pago: remito.cobro === 'ctacte' ? 'cuenta_corriente' : 'contado',
      // OJO: NO va cliente.id. `clientes.id` es un UUID y
      // `facturas.contraparte_id` es un INTEGER que apunta a `contrapartes`,
      // que es otra tabla. Mandarle el uuid hacia que ARCA diera el CAE y
      // despues explotara el guardado local ("invalid input syntax for type
      // integer"), dejando la factura emitida y sin registrar. Los datos del
      // receptor viajan igual por nombre/cuit/condicion, asi que el vinculo
      // se resuelve por CUIT mas abajo y si no aparece queda en null.
      contraparte_id: contraparteId,
      contraparte_nombre: remito.cliente_nombre || cliente?.nombre || '',
      contraparte_cuit: tieneCuit ? cuit : '',
      contraparte_iva: cliente?.condicion_iva || (tieneCuit ? 'responsable_inscripto' : 'consumidor_final'),
      doc_tipo: tieneCuit ? 80 : 99,
      doc_nro: tieneCuit ? cuit : '',
    },
  }
}

// ── Guardar de dónde salió la factura ───────────────────────────────
//
// Se llama con el CAE ya en la mano. Si esto fallara, el comprobante
// existe igual (ARCA lo autorizó) y lo único que falta es el vínculo:
// por eso devuelve el error en vez de tragárselo, para que la pantalla
// lo pueda decir con el número de comprobante a la vista.
export async function vincularOrigen(facturaId, origen) {
  if (!facturaId || !origen?.id) return { ok: true }
  const campo = origen.tipo === 'venta' ? 'venta_id' : 'remito_id'
  const { error } = await supabase
    .from('facturas')
    .update({ [campo]: origen.id })
    .eq('id', facturaId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
