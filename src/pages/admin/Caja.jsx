// ============================================================
// CAJA RÁPIDA — Modo punto de venta con lector de código de barras
// ============================================================
// Flujo:
//  1. El cajero hace foco en el input de código (auto-focus permanente)
//  2. Escanea la etiqueta impresa por la balanza Cuora Max
//  3. El sistema decodifica PLU + peso, busca el producto y agrega al carrito
//  4. Repite hasta terminar la venta
//  5. Selecciona forma de pago y cierra
// ============================================================
import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { decodificarEANBalanza, esCodigoBalanza } from '../../lib/balanzaEAN'
import { fechaHoyARG, horaHoyARG, horaNumARG } from '../../lib/fechas'
import { kgPorUnidadDeNombre } from '../../lib/stockHelpers'
import HistorialCaja from './HistorialCaja'
import ArqueoCaja from './ArqueoCaja'

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')

// Categorías que por defecto NO se venden por kg (se venden por unidad/paquete)
const CATEGORIAS_NO_PESABLES = new Set([
  'almacen', 'bebidas',
  'pollo_cajon', 'rebozado_cajon',
  'bovino_caja_cb', 'bovino_caja_pt',
])

function esPesable(producto) {
  if (!producto) return true
  // Si el flag está explícito en BD, respetarlo
  if (producto.pesable === false) return false
  if (producto.pesable === true) return true
  // Fallback por categoría
  return !CATEGORIAS_NO_PESABLES.has(producto.categoria)
}

const CATEGORIAS = {
  bovino_corte: '🥩 Bovino Cortes',
  bovino_pieza: '🍖 Piezas',
  bovino_brosa: '🫀 Brosa',
  cerdo: '🐷 Cerdo',
  pollo: '🍗 Pollo',
  embutido: '🌭 Embutidos',
}

export default function Caja() {
  const [precios, setPrecios] = useState([])
  const [ofertas, setOfertas] = useState([])
  const [listaPrecio, setListaPrecio] = useState('minorista') // 'minorista' | 'mayorista'
  const [configEAN, setConfigEAN] = useState({
    // Formato REAL Cuora Max Fabricius — verificado con tickets el 2026-05-22:
    // "2" + PLU(6) + IMPORTE_PESOS(5) + check = 13 dígitos
    // Ej: "2 000003 07227 5" = COSTILLA (PLU 3), $7227
    prefijo: '2', plu_digitos: 6, tipo: 'precio_pesos', campo_digitos: 5
  })
  const [carrito, setCarrito] = useState([])
  const [codigoInput, setCodigoInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [mostrarBuscador, setMostrarBuscador] = useState(false)
  const [msg, setMsg] = useState(null)
  const [pago, setPago] = useState({ efectivo: '', debito: '', transferencia: '' })
  const [mostrarCierre, setMostrarCierre] = useState(false)
  const [guardandoVenta, setGuardandoVenta] = useState(false) // Anti-duplicado: bloquea doble click / Enter repetido en cerrarVenta()
  const ventaClientIdRef = useRef(null)                       // UUID generado al abrir cobro — clave de idempotencia en DB
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [ventasHoy, setVentasHoy] = useState([])
  const [vistaCaja, setVistaCaja] = useState('vender') // 'vender' | 'historial' | 'arqueo'

  const codigoRef = useRef(null)
  const busquedaRef = useRef(null)
  const efectivoRef = useRef(null)

  // ---- Carga inicial ----
  useEffect(() => { cargarTodo() }, [])

  async function cargarTodo() {
    const hoy = fechaHoyARG()  // Hora local ARG, NO UTC. Ver lib/fechas.js
    const [{ data: pre }, { data: cfg }, { data: ventas }, { data: ofs }] = await Promise.all([
      supabase.from('precios').select('*').order('nombre'),
      supabase.from('config_sistema').select('*').eq('clave', 'ean13_formato').maybeSingle(),
      supabase.from('ventas_minoristas').select('*')
        .eq('fecha', hoy)
        .eq('origen', 'caja').order('created_at', { ascending: false }),
      supabase.from('ofertas').select('*')
        .eq('activa', true)
        .lte('fecha_inicio', hoy)
        .gte('fecha_fin', hoy),
    ])
    setPrecios(pre || [])
    if (cfg?.valor) setConfigEAN(cfg.valor)
    setVentasHoy(ventas || [])
    setOfertas(ofs || [])
  }

  // ---- Resuelve el precio final de un producto según lista activa + ofertas ----
  // Devuelve { precio, precioBase, oferta }. Si hay oferta vigente que aplica a la
  // lista activa, descuenta usando descuento_pct (si existe) o usa precio_oferta.
  function resolverPrecio(producto) {
    if (!producto) return { precio: 0, precioBase: 0, oferta: null }
    const precioBase = listaPrecio === 'mayorista'
      ? Number(producto.precio_mayorista || producto.precio_minorista || producto.precio_carniceria || 0)
      : Number(producto.precio_minorista || producto.precio_carniceria || 0)

    const flagLista = listaPrecio === 'mayorista' ? 'aplica_mayorista' : 'aplica_minorista'
    // Ofertas viejas sin flags se asumen aplicables (default DB es TRUE).
    const oferta = ofertas.find(o => o.precio_id === producto.id && o[flagLista] !== false)

    let precio = precioBase
    if (oferta) {
      if (oferta.descuento_pct != null && Number(oferta.descuento_pct) > 0) {
        precio = Math.round(precioBase * (1 - Number(oferta.descuento_pct) / 100))
      } else if (oferta.precio_oferta != null && Number(oferta.precio_oferta) > 0) {
        precio = Number(oferta.precio_oferta)
      }
    }
    return { precio, precioBase, oferta }
  }

  // ---- Auto-focus en input de código ----
  useEffect(() => {
    if (!mostrarCierre && !mostrarBuscador) codigoRef.current?.focus()
  }, [carrito, mostrarCierre, mostrarBuscador])

  function showMsg(texto, type = 'success', ms = 2500) {
    setMsg({ texto, type })
    setTimeout(() => setMsg(null), ms)
  }

  // ---- Procesar código escaneado ----
  function procesarCodigo(codigo) {
    const clean = String(codigo).trim()
    if (!clean) return

    // 0) Protección: el código del TOTAL del ticket (prefijo "22") no se escanea.
    //    Si el cajero lo lee por accidente, mostrar mensaje claro y NO sumar nada.
    if (/^22\d{11}$/.test(clean)) {
      showMsg('⚠️ Ese es el código del TOTAL del ticket, no se escanea. Escaneá solo los códigos de cada producto.', 'error', 4000)
      return
    }

    // 1) Intentar decodificar como código de balanza
    if (esCodigoBalanza(clean, configEAN)) {
      const decoded = decodificarEANBalanza(clean, configEAN)
      if (decoded?.error) {
        showMsg(`❌ Código inválido: ${decoded.error}`, 'error')
        return
      }
      // Buscar producto por PLU
      const prod = precios.find(p => p.codigo_balanza === decoded.plu)
      if (!prod) {
        showMsg(`❌ PLU ${decoded.plu} no encontrado. Asignalo en Precios.`, 'error', 4000)
        return
      }
      // Importante: usamos SIEMPRE el precio del SISTEMA (que respeta lista
      // activa + ofertas), no el precio que tiene cargado la balanza. La balanza
      // solo nos sirve para obtener el PESO real del producto.
      if (configEAN.tipo === 'precio' || configEAN.tipo === 'precio_pesos') {
        // La balanza nos dio el importe — derivamos el peso usando SU precio
        // (asumimos que la balanza está sincronizada con precio_minorista del sistema).
        const importeBalanza = decoded.precio || 0
        const precioMinoristaSistema = Number(prod.precio_minorista || prod.precio_carniceria || 0)
        const kg = precioMinoristaSistema > 0 ? importeBalanza / precioMinoristaSistema : 0
        agregarItem(prod, kg)
      } else {
        agregarItem(prod, decoded.peso_kg)
      }
      return
    }

    // 2) Si no es código de balanza, intentar buscar por EAN común
    const prod = precios.find(p => p.ean === clean)
    if (prod) {
      const unidadLabel = esPesable(prod) ? 'kg' : 'unidades'
      const cant = prompt(`Producto: ${prod.nombre}\n¿Cantidad en ${unidadLabel}?`, '1')
      if (cant && parseFloat(cant) > 0) {
        agregarItem(prod, parseFloat(cant))
      }
      return
    }

    showMsg(`❌ Código ${clean} no reconocido`, 'error', 3000)
  }

  function agregarItem(producto, cantidad, precioOverride = null) {
    const resuelto = resolverPrecio(producto)
    const precio = precioOverride != null ? Number(precioOverride) : resuelto.precio
    const tieneOferta = !!resuelto.oferta && precio < resuelto.precioBase
    const pesable = esPesable(producto)
    const cant = parseFloat(cantidad)
    setCarrito(c => [...c, {
      id: Date.now() + Math.random(),
      producto_id: producto.id,
      descripcion: producto.nombre,
      categoria: producto.categoria,
      // stock_origen del producto — usado en cerrarVenta para descontar
      // del cut específico (ej. 'cerdo_bondiola') en lugar de la categoría
      // genérica. Permite que productos como "Bondiola de cerdo" toquen
      // stock_actual.cerdo_bondiola en vez del bucket cerdo_pieza general.
      stock_origen: producto.stock_origen || null,
      kg: cant,            // se sigue llamando "kg" para no romper el resto; representa la cantidad
      unidad: pesable ? 'kg' : 'u',
      precio: parseFloat(precio),
      precio_base: parseFloat(resuelto.precioBase),
      tiene_oferta: tieneOferta,
      oferta_pct: tieneOferta && resuelto.oferta?.descuento_pct ? Number(resuelto.oferta.descuento_pct) : null,
      lista: listaPrecio,
      importe: cant * parseFloat(precio),
    }])
    const unidadTxt = pesable ? `${cant.toFixed(3)} kg` : `${cant} u`
    const badge = tieneOferta ? ' 🏷️ OFERTA' : ''
    const listaTxt = listaPrecio === 'mayorista' ? ' [MAY]' : ''
    showMsg(`✅ ${producto.nombre} — ${unidadTxt}${badge}${listaTxt}`)
  }

  // Cuando la balanza embebe el importe (no el peso), usamos esta función
  // que respeta el importe exacto de la balanza y deriva el peso
  function agregarItemConImporte(producto, kg, precioKg, importe) {
    setCarrito(c => [...c, {
      id: Date.now() + Math.random(),
      producto_id: producto.id,
      descripcion: producto.nombre,
      categoria: producto.categoria,
      kg: parseFloat(kg.toFixed(3)),
      precio: parseFloat(precioKg),
      importe: parseFloat(importe),  // respetamos el importe exacto de la balanza
    }])
    showMsg(`✅ ${producto.nombre} — ${kg.toFixed(3)} kg → $${importe.toFixed(2)}`)
  }

  function quitarItem(id) {
    setCarrito(c => c.filter(item => item.id !== id))
  }

  function editarKg(id, nuevoKg) {
    setCarrito(c => c.map(item => {
      if (item.id !== id) return item
      const kg = parseFloat(nuevoKg) || 0
      return { ...item, kg, importe: kg * item.precio }
    }))
  }

  function limpiarCarrito() {
    if (carrito.length === 0) return
    if (!confirm('¿Vaciar todo el carrito?')) return
    setCarrito([])
  }

  // ---- Búsqueda manual ----
  const productosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return precios.slice(0, 30)
    const q = busqueda.toLowerCase().trim()
    return precios.filter(p =>
      p.nombre?.toLowerCase().includes(q) ||
      String(p.codigo_balanza || '').includes(q)
    ).slice(0, 30)
  }, [busqueda, precios])

  function agregarManual(producto) {
    const unidadLabel = esPesable(producto) ? 'kg' : 'unidades'
    const cant = prompt(`Producto: ${producto.nombre}\n¿Cantidad en ${unidadLabel}?`, '1')
    if (cant && parseFloat(cant) > 0) {
      agregarItem(producto, parseFloat(cant))
      setMostrarBuscador(false)
      setBusqueda('')
    }
  }

  // ---- Totales ----
  const total = carrito.reduce((s, i) => s + i.importe, 0)
  const cobrado = (parseFloat(pago.efectivo) || 0) +
                  (parseFloat(pago.debito) || 0) +
                  (parseFloat(pago.transferencia) || 0)
  const vuelto = cobrado - total

  // Al cerrar el modal (cancelación o éxito) liberamos el client_id
  // para que la próxima venta nazca con un UUID nuevo. Cubre las
  // tres salidas: ESC, click fuera y botón Cancelar.
  useEffect(() => {
    if (!mostrarCierre) {
      ventaClientIdRef.current = null
    }
  }, [mostrarCierre])

  // ---- Cerrar venta ----
  async function cerrarVenta() {
    // ── Guardia anti-duplicado ──────────────────────────────
    // Si ya estamos guardando, ignoramos el segundo trigger.
    // Esto cubre: doble click en CONFIRMAR, Enter repetido en
    // el campo efectivo, lag de red + reintentos del cajero.
    if (guardandoVenta) return
    if (carrito.length === 0) {
      showMsg('❌ El carrito está vacío', 'error')
      return
    }
    if (cobrado < total) {
      showMsg(`❌ Falta cobrar ${fmt(total - cobrado)}`, 'error')
      return
    }

    setGuardandoVenta(true)
    try {
    // Generar client_id sólo si no existe ya uno para este modal.
    // Si el insert falla por red y el cajero reintenta, va el mismo
    // UUID y la UNIQUE constraint del servidor garantiza idempotencia.
    if (!ventaClientIdRef.current) {
      ventaClientIdRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }

    const ahora = new Date()
    const venta = {
      // Siempre hora local Argentina, NO UTC. Antes había bug: ventas
      // hechas después de las 21hs ARG quedaban con fecha del día siguiente.
      fecha: fechaHoyARG(ahora),
      hora: horaHoyARG(ahora),
      turno: horaNumARG(ahora) < 14 ? 'mañana' : 'tarde',
      origen: 'caja',
      client_id: ventaClientIdRef.current,
      items: carrito.map(i => ({
        descripcion: i.descripcion,
        categoria: i.categoria,
        kg: i.kg,
        precio: i.precio,
        importe: i.importe,
        producto_id: i.producto_id,
        // Persistido para que anular-venta pueda revertir contra el cut
        // específico (cerdo_bondiola, cerdo_pierna, etc.) en lugar de
        // contra el bucket genérico cerdo_pieza.
        stock_origen: i.stock_origen || null,
      })),
      total,
      efectivo: parseFloat(pago.efectivo) || 0,
      debito: parseFloat(pago.debito) || 0,
      transferencia: parseFloat(pago.transferencia) || 0,
    }

    const { data, error } = await supabase
      .from('ventas_minoristas')
      .insert(venta)
      .select()
      .single()

    if (error) {
      // Si pegó la UNIQUE constraint (23505), la venta ya quedó registrada
      // en un intento previo — no es un error real, es la protección actuando.
      if (error.code === '23505' && error.message?.includes('client_id')) {
        showMsg('⚠️ Esta venta ya estaba registrada (anti-duplicado)', 'error', 4000)
        setCarrito([])
        setPago({ efectivo: '', debito: '', transferencia: '' })
        setMostrarCierre(false)
        ventaClientIdRef.current = null
        cargarTodo()
      } else {
        showMsg(`❌ Error: ${error.message}`, 'error', 4000)
      }
      return
    }

    // Descontar stock — mapeo explícito de cada categoría a su tipo en stock_actual.
    // Tres casos:
    //   1) Carne x kg → descuenta kg del tipo correspondiente
    //   2) Almacén/bebidas/cajas → descuenta unidades del tipo correspondiente
    //      (el campo kg_disponible guarda cantidad para estos tipos)
    //   3) Cajones de pollo/rebozado → descuenta KG DEL PRODUCTO BASE
    //      multiplicando unidades × kg_por_cajón (parseado del nombre,
    //      ej. "X20KG" → 20 kg por cada cajón vendido).
    // Función que decide a qué tipo de stock_actual va una venta.
    // Para cerdo_corte/cerdo_pieza usa el stock_origen del producto si está
    // configurado (ej. cerdo_bondiola); sino cae en cerdo_pieza (bucket
    // genérico que ya se suma al display "Cerdo Piezas" del dashboard).
    // NUNCA descuenta de 'cerdo' (capones) — esos sólo bajan al despostar.
    function mapearStock(cat, stockOrigen) {
      if (!cat) return null
      if (stockOrigen) return stockOrigen
      if (cat === 'bovino_mr')        return 'bovino_mr'
      if (cat === 'bovino_corte')     return 'bovino_corte'
      if (cat === 'bovino_pieza')     return 'bovino_pieza'
      if (cat === 'bovino_brosa')     return 'bovino_brosa'
      if (cat === 'cerdo')            return 'cerdo'         // capón entero
      if (cat === 'cerdo_corte')      return 'cerdo_pieza'   // bucket genérico de piezas
      if (cat === 'cerdo_pieza')      return 'cerdo_pieza'
      if (cat === 'pollo')            return 'pollo'
      if (cat === 'pollo_cajon')      return 'pollo'         // unidad × kg_por_cajón
      if (cat === 'rebozado')         return 'rebozado'
      if (cat === 'rebozado_cajon')   return 'rebozado'      // unidad × kg_por_cajón
      if (cat === 'embutido')         return 'embutido'
      if (cat === 'almacen')          return 'almacen'
      if (cat === 'bebidas')          return 'bebidas'
      if (cat === 'bovino_caja_cb')   return 'caja_cb'
      if (cat === 'bovino_caja_pt')   return 'caja_pt'
      return null
    }
    for (const item of carrito) {
      const tipoStock = mapearStock(item.categoria, item.stock_origen)
      if (!tipoStock) continue  // categoría sin tracking de stock → saltar
      // Para cajones de pollo/rebozado: multiplicar unidades × kg_por_cajón
      const esCajonAConvertir = item.categoria === 'pollo_cajon' || item.categoria === 'rebozado_cajon'
      const cantidad = esCajonAConvertir
        ? (item.kg || 0) * (kgPorUnidadDeNombre(item.descripcion) || 1)
        : (item.kg || 0)
      const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
      if (stock) {
        await supabase.from('stock_actual')
          .update({ kg_disponible: (stock.kg_disponible || 0) - cantidad })
          .eq('tipo', tipoStock)
      } else {
        // Si el tipo no existe todavía (ej. primera venta de cerdo_pieza),
        // crear la fila con valor negativo — actualizarStock-style behavior.
        await supabase.from('stock_actual').insert({ tipo: tipoStock, kg_disponible: -cantidad })
      }
    }

    setUltimaVenta({ ...venta, vuelto: cobrado - total, id: data.id })
    setCarrito([])
    setPago({ efectivo: '', debito: '', transferencia: '' })
    setMostrarCierre(false)
    ventaClientIdRef.current = null  // Liberar el UUID — la próxima venta usa uno nuevo
    cargarTodo()
    showMsg(`✅ Venta #${data.id} registrada`, 'success', 4000)
    } finally {
      // Garantizar que el flag se libere incluso si hubo un error inesperado
      setGuardandoVenta(false)
    }
  }

  // ---- Atajos de teclado ----
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F2') { e.preventDefault(); setMostrarBuscador(v => !v) }
      if (e.key === 'F4') { e.preventDefault(); if (carrito.length > 0) setMostrarCierre(true) }
      if (e.key === 'Escape') {
        setMostrarBuscador(false)
        setMostrarCierre(false)
        setBusqueda('')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [carrito])

  // ---- Resumen del turno ----
  const totalHoy = ventasHoy.reduce((s, v) => s + (v.total || 0), 0)
  const cantHoy = ventasHoy.length
  const kgTotalHoy = ventasHoy.reduce((s, v) => s + (v.items || []).reduce((ss, i) => ss + (i.kg || 0), 0), 0)

  // Ranking de productos por kg vendidos hoy
  const rankingProductos = useMemo(() => {
    const acc = {}
    ventasHoy.forEach(v => (v.items || []).forEach(it => {
      const key = it.descripcion || 'Sin nombre'
      if (!acc[key]) acc[key] = { kg: 0, importe: 0, ops: 0, categoria: it.categoria }
      acc[key].kg += (it.kg || 0)
      acc[key].importe += (it.importe || 0)
      acc[key].ops += 1
    }))
    return Object.entries(acc)
      .map(([nombre, d]) => ({ nombre, ...d }))
      .sort((a, b) => b.kg - a.kg)
  }, [ventasHoy])

  // Kg vendidos por tipo de stock (mapeo igual al que descuenta del stock).
  // Antes había un fallback `return 'bovino_corte'` que metía ventas de
  // almacén/bebidas dentro del cubo "Bovino Cortes" en el panel lateral.
  // Ahora cada categoría va a su propio cubo y las desconocidas se ignoran
  // (retornar null = no aparece en el panel).
  const kgPorStock = useMemo(() => {
    const acc = {}
    function mapearCat(cat) {
      if (!cat) return null
      if (cat === 'bovino_mr') return 'bovino_mr'
      if (cat === 'bovino_corte') return 'bovino_corte'
      if (cat === 'bovino_pieza' || cat === 'bovino_caja_cb' || cat === 'bovino_caja_pt') return 'bovino_pieza'
      if (cat === 'bovino_brosa') return 'bovino_brosa'
      if (cat === 'cerdo' || cat === 'cerdo_corte' || cat === 'cerdo_pieza') return 'cerdo'
      if (cat === 'pollo' || cat === 'pollo_cajon') return 'pollo'
      if (cat === 'embutido') return 'embutido'
      if (cat === 'almacen') return 'almacen'
      if (cat === 'bebidas') return 'bebidas'
      if (cat === 'rebozado' || cat === 'rebozado_cajon') return 'rebozado'
      return null
    }
    ventasHoy.forEach(v => (v.items || []).forEach(it => {
      const k = mapearCat(it.categoria)
      if (!k) return
      acc[k] = (acc[k] || 0) + (it.kg || 0)
    }))
    return acc
  }, [ventasHoy])

  // ---- Estilos comunes ----
  const inp = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 8, padding: '10px 14px',
    fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%',
    boxSizing: 'border-box', outline: 'none',
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 100px)' }}>
      <div className="page-title">🛒 CAJA RÁPIDA</div>
      <div className="page-sub">
        {vistaCaja === 'vender'
          ? 'Escaneá la etiqueta de la balanza · F2 buscar · F4 cobrar · ESC cancelar'
          : 'Historial de ventas minoristas con desglose por categoría y forma de pago'}
      </div>

      {/* Tabs Vender / Historial / Arqueo */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {[
          { id: 'vender',    label: '💵 Vender' },
          { id: 'historial', label: '📊 Historial' },
          { id: 'arqueo',    label: '🧾 Arqueo' },
        ].map(t => (
          <button key={t.id} onClick={() => setVistaCaja(t.id)}
            style={{
              padding: '9px 20px', borderRadius: 8, border: 'none',
              background: vistaCaja === t.id ? 'var(--gold)' : 'var(--surface)',
              color: vistaCaja === t.id ? '#000' : 'var(--muted)',
              cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: "'DM Sans',sans-serif",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {vistaCaja === 'historial' && <HistorialCaja />}
      {vistaCaja === 'arqueo' && <ArqueoCaja />}
      {/* Vista vender: se oculta con display:none para no desmontar el estado/foco */}
      <div style={{ display: vistaCaja === 'vender' ? 'block' : 'none' }}>

      {/* ============ TOGGLE LISTA DE PRECIO ============ */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12,
        padding: '10px 14px', background: 'var(--surface)', borderRadius: 10,
        border: `1px solid ${listaPrecio === 'mayorista' ? '#7a9dff' : 'var(--gold)'}`,
      }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1 }}>LISTA:</div>
        <button onClick={() => setListaPrecio('minorista')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: listaPrecio === 'minorista' ? 'var(--gold)' : 'var(--surface2)',
            color: listaPrecio === 'minorista' ? '#000' : 'var(--muted)',
            cursor: 'pointer', fontWeight: 800, fontSize: 13, letterSpacing: 1,
            fontFamily: "'DM Sans',sans-serif",
          }}>
          🛍️ MINORISTA
        </button>
        <button onClick={() => setListaPrecio('mayorista')}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none',
            background: listaPrecio === 'mayorista' ? '#7a9dff' : 'var(--surface2)',
            color: listaPrecio === 'mayorista' ? '#000' : 'var(--muted)',
            cursor: 'pointer', fontWeight: 800, fontSize: 13, letterSpacing: 1,
            fontFamily: "'DM Sans',sans-serif",
          }}>
          📦 MAYORISTA
        </button>
        {carrito.length > 0 && (
          <div style={{ fontSize: 10, color: '#ffb86b', marginLeft: 6 }}>
            ⚠️ cambiar lista no recalcula los items ya cargados
          </div>
        )}
        {ofertas.length > 0 && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
            🏷️ {ofertas.length} oferta(s) vigente(s)
          </div>
        )}
      </div>

      {msg && (
        <div style={{
          position: 'fixed', top: 70, right: 20, zIndex: 1000,
          background: msg.type === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.type === 'error' ? '#ff6b6b' : '#7dff7d'}`,
          borderRadius: 8, padding: '14px 22px',
          color: msg.type === 'error' ? '#ff6b6b' : '#7dff7d',
          fontWeight: 700, fontSize: 14, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          maxWidth: 380,
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}>
        {/* ============ COLUMNA IZQUIERDA: CARRITO ============ */}
        <div className="card" style={{ padding: 16 }}>
          {/* Input de código de barras */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4, letterSpacing: 1 }}>
              📷 CÓDIGO DE BARRAS (escaneá o tipeá)
            </label>
            <input
              ref={codigoRef}
              type="text"
              value={codigoInput}
              onChange={e => setCodigoInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && codigoInput) {
                  procesarCodigo(codigoInput)
                  setCodigoInput('')
                }
              }}
              placeholder="Escaneá aquí..."
              autoFocus
              style={{
                ...inp,
                fontSize: 18, fontFamily: 'monospace',
                letterSpacing: 2, padding: '14px 18px',
                borderColor: 'var(--gold)', borderWidth: 2,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => { setMostrarBuscador(true); setTimeout(() => busquedaRef.current?.focus(), 50) }}
                style={{ flex: 1, padding: '8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                🔍 Buscar producto (F2)
              </button>
              <button
                onClick={limpiarCarrito}
                disabled={carrito.length === 0}
                style={{ padding: '8px 14px', background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#ff6b6b', cursor: carrito.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: carrito.length === 0 ? 0.4 : 1 }}>
                🗑️ Vaciar
              </button>
            </div>
          </div>

          {/* Carrito */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            {carrito.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🛒</div>
                <div>Carrito vacío</div>
                <div style={{ fontSize: 11, marginTop: 6 }}>Escaneá un producto para empezar</div>
              </div>
            ) : (
              <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg)' }}>
                    <tr>
                      <th style={{ textAlign: 'left', fontSize: 10, color: 'var(--muted)', padding: '6px 4px' }}>PRODUCTO</th>
                      <th style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)', padding: '6px 4px' }}>CANT</th>
                      <th style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)', padding: '6px 4px' }}>PRECIO</th>
                      <th style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted)', padding: '6px 4px' }}>IMPORTE</th>
                      <th style={{ width: 30 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {carrito.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 4px', fontSize: 13, fontWeight: 600 }}>
                          {item.descripcion}
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{CATEGORIAS[item.categoria] || item.categoria}</div>
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <input
                              type="number" step={item.unidad === 'u' ? '1' : '0.001'} value={item.kg}
                              onChange={e => editarKg(item.id, e.target.value)}
                              style={{ width: 70, textAlign: 'right', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 6px', fontSize: 13 }}
                            />
                            <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 18 }}>{item.unidad || 'kg'}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 4px', fontSize: 13 }}>
                          {item.tiene_oferta && item.precio_base > item.precio ? (
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', textDecoration: 'line-through' }}>{fmt(item.precio_base)}</div>
                              <div style={{ color: '#7dff7d', fontWeight: 700 }}>{fmt(item.precio)}</div>
                              {item.oferta_pct ? (
                                <div style={{ fontSize: 9, color: '#7dff7d' }}>🏷️ -{item.oferta_pct}%</div>
                              ) : (
                                <div style={{ fontSize: 9, color: '#7dff7d' }}>🏷️ OFERTA</div>
                              )}
                            </div>
                          ) : (
                            <>
                              {fmt(item.precio)}
                              {item.lista === 'mayorista' && (
                                <div style={{ fontSize: 9, color: '#7a9dff' }}>📦 MAY</div>
                              )}
                            </>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', padding: '8px 4px', fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>{fmt(item.importe)}</td>
                        <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                          <button onClick={() => quitarItem(item.id)} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: 16 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Total y botón cobrar */}
          {carrito.length > 0 && (
            <div style={{ marginTop: 14, padding: 16, background: 'linear-gradient(135deg,#1a1408,#0a0a08)', border: '1px solid var(--gold)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>TOTAL ({carrito.length} items)</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 42, color: 'var(--gold)', lineHeight: 1 }}>{fmt(total)}</div>
              </div>
              <button
                onClick={() => { setMostrarCierre(true); setTimeout(() => efectivoRef.current?.focus(), 100) }}
                style={{ width: '100%', padding: '14px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 10, fontSize: 18, fontWeight: 800, cursor: 'pointer', fontFamily: "'Bebas Neue',cursive", letterSpacing: 2 }}>
                💵 COBRAR — F4
              </button>
            </div>
          )}
        </div>

        {/* ============ COLUMNA DERECHA: STATS + ÚLTIMA VENTA ============ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Resumen del turno */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 6 }}>📊 TURNO ACTUAL (CAJA)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Operaciones</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--amber)' }}>{cantHoy}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Kg total</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--green)' }}>{kgTotalHoy.toFixed(1)}</div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Facturado</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{fmt(totalHoy)}</div>
              </div>
            </div>
          </div>

          {/* Kg descontados de stock */}
          {Object.keys(kgPorStock).length > 0 && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>📉 STOCK DESCONTADO HOY</div>
              {Object.entries(kgPorStock).sort((a, b) => b[1] - a[1]).map(([tipo, kg]) => {
                // Etiqueta legible del cubo. Incluye almacen/bebidas/rebozado
                // (antes el panel los mostraba mal como "Bovino Cortes").
                const LABELS = {
                  bovino_mr: '🐄 Media Reses',
                  bovino_corte: '🥩 Bovino Cortes',
                  bovino_pieza: '🍖 Piezas',
                  bovino_brosa: '🫀 Brosa',
                  cerdo: '🐷 Cerdo',
                  pollo: '🍗 Pollo',
                  embutido: '🌭 Embutidos',
                  almacen: '🛒 Almacén',
                  bebidas: '🥤 Bebidas',
                  rebozado: '🧊 Rebozados',
                }
                // Para almacen/bebidas/rebozado lo correcto es "unidades" no kg
                const esPorUnidad = tipo === 'almacen' || tipo === 'bebidas' || tipo === 'rebozado'
                const unidad = esPorUnidad ? 'u' : 'kg'
                return (
                  <div key={tipo} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', background: 'var(--surface2)', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>{LABELS[tipo] || tipo}</span>
                    <strong style={{ color: 'var(--green)' }}>-{kg.toFixed(2)} {unidad}</strong>
                  </div>
                )
              })}
            </div>
          )}

          {/* Ranking de productos del día */}
          {rankingProductos.length > 0 && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>🏆 KG VENDIDOS HOY POR PRODUCTO</div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {rankingProductos.slice(0, 15).map((p, idx) => (
                  <div key={p.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: idx === 0 ? '#1a1408' : 'var(--surface2)', borderRadius: 6, marginBottom: 4, border: idx === 0 ? '1px solid var(--gold)' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {idx === 0 && '🥇 '}{idx === 1 && '🥈 '}{idx === 2 && '🥉 '}{p.nombre}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{p.ops} {p.ops === 1 ? 'venta' : 'ventas'} · {fmt(p.importe)}</div>
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--green)', marginLeft: 8 }}>{p.kg.toFixed(2)} kg</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Última venta */}
          {ultimaVenta && (
            <div className="card" style={{ padding: 16, borderColor: 'var(--green)' }}>
              <div style={{ fontSize: 11, color: 'var(--green)', letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>✅ ÚLTIMA VENTA #{ultimaVenta.id}</div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                {ultimaVenta.items.length} producto(s) · {ultimaVenta.hora}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: 'var(--muted)' }}>Total:</span>
                <strong style={{ color: 'var(--gold)' }}>{fmt(ultimaVenta.total)}</strong>
              </div>
              {ultimaVenta.efectivo > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>Efectivo:</span><span>{fmt(ultimaVenta.efectivo)}</span></div>}
              {ultimaVenta.debito > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>Débito:</span><span>{fmt(ultimaVenta.debito)}</span></div>}
              {ultimaVenta.transferencia > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>Transfer.:</span><span>{fmt(ultimaVenta.transferencia)}</span></div>}
              {ultimaVenta.vuelto > 0 && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--surface2)', borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>VUELTO</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--amber)' }}>{fmt(ultimaVenta.vuelto)}</div>
                </div>
              )}
            </div>
          )}

          {/* Atajos rápidos */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>⌨️ ATAJOS</div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div><kbd style={kbdStyle}>F2</kbd> Buscar producto manualmente</div>
              <div><kbd style={kbdStyle}>F4</kbd> Cobrar / cerrar venta</div>
              <div><kbd style={kbdStyle}>Enter</kbd> Confirmar código escaneado</div>
              <div><kbd style={kbdStyle}>Esc</kbd> Cancelar / cerrar modal</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============ MODAL BUSCADOR ============ */}
      {mostrarBuscador && (
        <div onClick={() => setMostrarBuscador(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 560, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>🔍 Buscar producto</div>
              <button onClick={() => setMostrarBuscador(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <input
              ref={busquedaRef}
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Nombre o PLU..."
              style={{ ...inp, marginBottom: 10 }}
            />
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {productosFiltrados.map(p => (
                <div key={p.id} onClick={() => agregarManual(p)}
                  style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, background: 'var(--surface2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onMouseOver={e => e.currentTarget.style.background = '#2a2a26'}
                  onMouseOut={e => e.currentTarget.style.background = 'var(--surface2)'}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {CATEGORIAS[p.categoria] || p.categoria}
                      {p.codigo_balanza ? ` · PLU ${p.codigo_balanza}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {(() => {
                      const r = resolverPrecio(p)
                      const hayOferta = r.oferta && r.precio < r.precioBase
                      return (
                        <>
                          {hayOferta && (
                            <div style={{ fontSize: 10, color: 'var(--muted)', textDecoration: 'line-through' }}>
                              {fmt(r.precioBase)}
                            </div>
                          )}
                          <div style={{ fontWeight: 700, color: hayOferta ? '#7dff7d' : 'var(--gold)', fontSize: 14 }}>
                            {fmt(r.precio)}/kg
                            {hayOferta && r.oferta?.descuento_pct ? ` 🏷️ -${r.oferta.descuento_pct}%` : (hayOferta ? ' 🏷️' : '')}
                          </div>
                          <div style={{ fontSize: 9, color: listaPrecio === 'mayorista' ? '#7a9dff' : 'var(--muted)' }}>
                            {listaPrecio === 'mayorista' ? '📦 MAYORISTA' : '🛍️ MINORISTA'}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              ))}
              {productosFiltrados.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin resultados</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ MODAL COBRO ============ */}
      {mostrarCierre && (
        <div onClick={() => setMostrarCierre(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%' }}>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 28, color: 'var(--gold)', marginBottom: 16, textAlign: 'center', letterSpacing: 2 }}>💵 COBRAR</div>

            <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>TOTAL A COBRAR</div>
              <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 48, color: 'var(--gold)' }}>{fmt(total)}</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💵 EFECTIVO</label>
                <input ref={efectivoRef} type="number" value={pago.efectivo}
                  onChange={e => setPago(p => ({ ...p, efectivo: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && cobrado >= total && !guardandoVenta && cerrarVenta()}
                  style={{ ...inp, fontSize: 18, textAlign: 'right' }} placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💳 DÉBITO</label>
                <input type="number" value={pago.debito}
                  onChange={e => setPago(p => ({ ...p, debito: e.target.value }))}
                  style={{ ...inp, fontSize: 18, textAlign: 'right' }} placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📲 TRANSFERENCIA</label>
                <input type="number" value={pago.transferencia}
                  onChange={e => setPago(p => ({ ...p, transferencia: e.target.value }))}
                  style={{ ...inp, fontSize: 18, textAlign: 'right' }} placeholder="0" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => setPago(p => ({ ...p, efectivo: total.toString(), debito: '', transferencia: '' }))}
                style={{ flex: 1, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                ✋ Justo efectivo
              </button>
              <button onClick={() => setPago(p => ({ ...p, debito: total.toString(), efectivo: '', transferencia: '' }))}
                style={{ flex: 1, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                💳 Solo débito
              </button>
              <button onClick={() => setPago(p => ({ ...p, transferencia: total.toString(), efectivo: '', debito: '' }))}
                style={{ flex: 1, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                📲 Transfer.
              </button>
            </div>

            {cobrado > 0 && (
              <div style={{ padding: 10, background: vuelto < 0 ? '#3a1a1a' : '#1a2a1a', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
                {vuelto < 0
                  ? <div style={{ color: '#ff6b6b', fontWeight: 600 }}>Falta cobrar: {fmt(-vuelto)}</div>
                  : <div><span style={{ color: 'var(--muted)', fontSize: 12 }}>VUELTO: </span><strong style={{ color: 'var(--amber)', fontSize: 22, fontFamily: "'Bebas Neue',cursive" }}>{fmt(vuelto)}</strong></div>
                }
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setMostrarCierre(false)}
                style={{ flex: 1, padding: 14, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--muted)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                Cancelar
              </button>
              <button onClick={cerrarVenta} disabled={cobrado < total || guardandoVenta}
                style={{ flex: 2, padding: 14, background: guardandoVenta ? 'var(--surface2)' : (cobrado >= total ? 'var(--green)' : 'var(--surface2)'), color: guardandoVenta ? 'var(--muted)' : (cobrado >= total ? '#000' : 'var(--muted)'), border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 800, cursor: (cobrado >= total && !guardandoVenta) ? 'pointer' : 'not-allowed', fontFamily: "'Bebas Neue',cursive", letterSpacing: 2 }}>
                {guardandoVenta ? '⏳ GUARDANDO…' : '✅ CONFIRMAR VENTA'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

const kbdStyle = {
  display: 'inline-block', minWidth: 28, padding: '2px 6px', background: 'var(--surface2)',
  border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'monospace',
  fontSize: 11, fontWeight: 700, color: 'var(--gold)', marginRight: 8, textAlign: 'center',
}
