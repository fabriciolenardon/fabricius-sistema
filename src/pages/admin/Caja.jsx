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
import { kgPorUnidadDeProducto, bucketPiezaBovina } from '../../lib/stockHelpers'
import { cargarCajasDisponibles, venderCaja, CATEGORIA_A_TIPO_CAJA } from '../../lib/cajasStock'
import { fmtPrecio, fmtKg, parseNumero } from '../../lib/formatos'
import HistorialCaja from './HistorialCaja'
import HistorialDiaCaja from './HistorialDiaCaja'
import ArqueoCaja from './ArqueoCaja'

// Wrapper que mantiene la firma vieja `fmt(n)` (precio con $) pero usa el
// formatter centralizado — ahora muestra decimales si el numero los tiene
// (ej. $4.445,50 en vez de $4.446) y siempre con coma decimal AR.
const fmt = n => fmtPrecio(Math.abs(Number(n) || 0))

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
  // Promo Mundial: -X% en compras pagadas 100% con efectivo y/o transferencia.
  // Mientras está activa las ofertas se IGNORAN en la Caja para no acumular
  // doble descuento. Se prende/apaga desde Precios → Ofertas (config_sistema,
  // clave 'promo_mundial') y llega acá por el realtime de config_sistema.
  const [promoMundial, setPromoMundial] = useState({ activa: false, descuento_pct: 10 })
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
  // Descuento Blangino: convenio con la firma — 10% al empleado, registrando
  // nombre + legajo para el control y el reintegro posterior de la empresa.
  const [blangino, setBlangino] = useState({ activo: false, empleado: '', legajo: '' })
  const [mostrarCierre, setMostrarCierre] = useState(false)
  const [guardandoVenta, setGuardandoVenta] = useState(false) // Anti-duplicado: bloquea doble click / Enter repetido en cerrarVenta()
  const ventaClientIdRef = useRef(null)                       // UUID generado al abrir cobro — clave de idempotencia en DB
  // Selector de cajas individuales (CB/PT) — modal que abre al escanear/seleccionar
  // un producto de categoría bovino_caja_cb o bovino_caja_pt
  const [selectorCaja, setSelectorCaja] = useState(null)      // { producto } | null
  const [cajasDisp, setCajasDisp] = useState([])              // cajas con estado='disponible'
  // Selector de pieza entera bovina — modal que abre al elegir un producto
  // con flag vende_por_pieza=true (típicamente piernas, cuartos, costillares
  // que tienen tracking individual en piezas_stock).
  const [selectorPieza, setSelectorPieza] = useState(null)    // { producto } | null
  const [piezasDisp, setPiezasDisp] = useState([])            // piezas disponibles
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [ventasHoy, setVentasHoy] = useState([])
  const [vistaCaja, setVistaCaja] = useState('vender') // 'vender' | 'historial' | 'arqueo'
  // Combos armados (bolsones) — botón que agrega todos sus productos al
  // carrito repartiendo el precio fijo del combo. Se administran en
  // Precios → Combos (tabla combos_venta). Ver agregarCombo().
  const [combos, setCombos] = useState([])

  const codigoRef = useRef(null)
  const busquedaRef = useRef(null)
  const efectivoRef = useRef(null)

  // ---- Carga inicial ----
  useEffect(() => { cargarTodo() }, [])

  // Realtime: cuando el admin actualiza precios/ofertas o cuando el
  // depostero suma piezas/cajas al stock, la Caja Rapida se entera al
  // instante y refresca su catalogo. Asi la cajera nunca vende un
  // producto con precio viejo ni intenta vender una caja que ya no
  // existe.
  // Debounce de 400ms para evitar tormentas de reloads cuando se hace
  // un cambio masivo (ej. actualizacion masiva de precios).
  useEffect(() => {
    let timer = null
    const debouncedReload = () => {
      clearTimeout(timer)
      timer = setTimeout(() => cargarTodo(), 400)
    }
    const canal = supabase.channel('caja-catalogo-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'precios' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ofertas' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config_sistema' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cajas_stock' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'piezas_stock' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'combos_venta' }, debouncedReload)
      .subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(canal)
    }
  }, [])

  async function cargarTodo() {
    const hoy = fechaHoyARG()  // Hora local ARG, NO UTC. Ver lib/fechas.js
    const [{ data: pre }, { data: cfg }, { data: ventas }, { data: ofs }, { data: cajas }, { data: piezas }, { data: promo }, { data: cbs }] = await Promise.all([
      supabase.from('precios').select('*').order('nombre'),
      supabase.from('config_sistema').select('*').eq('clave', 'ean13_formato').maybeSingle(),
      supabase.from('ventas_minoristas').select('*')
        .eq('fecha', hoy)
        .eq('origen', 'caja').order('created_at', { ascending: false }),
      supabase.from('ofertas').select('*')
        .eq('activa', true)
        .lte('fecha_inicio', hoy)
        .gte('fecha_fin', hoy),
      // Cajas individuales disponibles para venta (CB + PT)
      supabase.from('cajas_stock').select('*').eq('estado', 'disponible')
        .order('fecha_ingreso', { ascending: true }).order('id', { ascending: true }),
      // Piezas bovinas individuales disponibles (para productos con vende_por_pieza=true)
      supabase.from('piezas_stock').select('*').eq('estado', 'disponible')
        .order('fecha_ingreso', { ascending: true }).order('id', { ascending: true }),
      supabase.from('config_sistema').select('*').eq('clave', 'promo_mundial').maybeSingle(),
      // Combos disponibles para vender (los pausados no se muestran).
      supabase.from('combos_venta').select('*').eq('disponible', true).order('orden').order('nombre'),
    ])
    setPrecios(pre || [])
    if (cfg?.valor) setConfigEAN(cfg.valor)
    setVentasHoy(ventas || [])
    setOfertas(ofs || [])
    setCajasDisp(cajas || [])
    setPiezasDisp(piezas || [])
    setPromoMundial(promo?.valor || { activa: false, descuento_pct: 10 })
    setCombos(cbs || [])
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
    // Con Promo Mundial activa las ofertas quedan PAUSADAS: el -X% se aplica
    // sobre el total al cobrar, y si además aplicáramos la oferta sería doble
    // descuento (pérdida de plata).
    const oferta = promoMundial?.activa
      ? null
      : ofertas.find(o => o.precio_id === producto.id && o[flagLista] !== false)

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
    // Interceptar productos de categoría caja CB/PT: en vez de agregar al
    // carrito directo, abrir el selector de caja individual del stock.
    if (producto?.categoria === 'bovino_caja_cb' || producto?.categoria === 'bovino_caja_pt') {
      setSelectorCaja({ producto, precioOverride })
      return
    }
    // Interceptar productos marcados como "vende por pieza entera": abrir
    // el selector de piezas individuales del stock (piezas_stock).
    if (producto?.vende_por_pieza) {
      setSelectorPieza({ producto, precioOverride })
      return
    }

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
      // Para bovino_pieza sin stock_origen configurado, resolver el bucket
      // por nombre (pieza_costillar, pieza_pierna…): el desposte acredita a
      // esos buckets y el genérico 'bovino_pieza' quedaría negativo.
      stock_origen: producto.stock_origen
        || (producto.categoria === 'bovino_pieza' ? bucketPiezaBovina(producto.nombre) : null),
      // kg por unidad para cajones (pollo_cajon, rebozado_cajon). Si está
      // null, el helper hace fallback al parseo del nombre. Cargado desde
      // /admin/precios al crear el producto.
      kg_por_unidad: producto.kg_por_unidad || null,
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

  // Agrega una caja específica seleccionada del modal al carrito.
  // El kg es el de la caja física; el precio sale de la lista (kg×precio_kg).
  function agregarCajaAlCarrito(caja, producto) {
    const resuelto = resolverPrecio(producto)
    const precio = resuelto.precio  // precio por kg
    const tieneOferta = !!resuelto.oferta && precio < resuelto.precioBase
    const kg = Number(caja.kg) || 0
    setCarrito(c => [...c, {
      id: Date.now() + Math.random(),
      producto_id: producto.id,
      descripcion: `${producto.nombre} — Caja #${caja.id} (${kg.toFixed(1)} kg)`,
      categoria: producto.categoria,
      stock_origen: null,
      kg_por_unidad: null,
      kg,
      unidad: 'kg',
      precio: parseFloat(precio),
      precio_base: parseFloat(resuelto.precioBase),
      tiene_oferta: tieneOferta,
      oferta_pct: tieneOferta && resuelto.oferta?.descuento_pct ? Number(resuelto.oferta.descuento_pct) : null,
      lista: listaPrecio,
      importe: kg * parseFloat(precio),
      // Marcadores específicos de caja individual — usados en cerrarVenta
      // para llamar venderCaja(caja_id) y persistido en items[] de la venta.
      caja_id: caja.id,
      caja_tipo: caja.tipo_caja,
    }])
    setSelectorCaja(null)
    showMsg(`✅ Caja ${caja.tipo_caja} #${caja.id} — ${kg.toFixed(1)} kg`)
  }

  // Agrega una pieza entera específica seleccionada del modal al carrito.
  // Mismo patrón que agregarCajaAlCarrito — el kg sale de la pieza física
  // y el precio del producto. La pieza se marca como 'vendida' en cerrarVenta.
  function agregarPiezaAlCarrito(pieza, producto) {
    const resuelto = resolverPrecio(producto)
    const precio = resuelto.precio
    const tieneOferta = !!resuelto.oferta && precio < resuelto.precioBase
    const kg = Number(pieza.kg) || 0
    setCarrito(c => [...c, {
      id: Date.now() + Math.random(),
      producto_id: producto.id,
      descripcion: `${producto.nombre} — Pieza #${pieza.id} ${pieza.tipo_pieza ? `(${pieza.tipo_pieza})` : ''} (${kg.toFixed(1)} kg)`,
      categoria: producto.categoria,
      stock_origen: null,
      kg_por_unidad: null,
      kg,
      unidad: 'kg',
      precio: parseFloat(precio),
      precio_base: parseFloat(resuelto.precioBase),
      tiene_oferta: tieneOferta,
      oferta_pct: tieneOferta && resuelto.oferta?.descuento_pct ? Number(resuelto.oferta.descuento_pct) : null,
      lista: listaPrecio,
      importe: kg * parseFloat(precio),
      // Marcador de pieza individual — al cerrar venta marcamos 'vendida'
      // en piezas_stock (igual que SalidaForm hace para mayorista).
      pieza_id: pieza.id,
      pieza_tipo: pieza.tipo_pieza,
    }])
    setSelectorPieza(null)
    showMsg(`✅ Pieza #${pieza.id} (${pieza.tipo_pieza || 'pieza'}) — ${kg.toFixed(1)} kg`)
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

  // ---- Agregar un combo armado al carrito ----
  // Agrega CADA producto del combo como una línea normal del carrito (para
  // que el stock se descuente igual que una venta común vía cerrarVenta),
  // pero reparte el precio FIJO del combo entre las líneas en proporción a
  // su valor minorista normal. Así Σ importe = precio del combo, no la suma
  // de los precios sueltos. Las líneas quedan marcadas con combo_id/combo_nombre
  // para excluirlas de Promo Mundial / Blangino (el precio del combo YA es la oferta).
  function agregarCombo(combo) {
    const items = Array.isArray(combo?.items) ? combo.items : []
    if (!items.length) { showMsg('❌ El combo no tiene productos cargados', 'error'); return }
    // Resolver cada ítem contra el catálogo actual — de ahí salen categoria y
    // stock_origen reales (NO se adivina el bucket de stock, ver memoria).
    const resueltos = items.map(it => ({ it, prod: precios.find(p => p.id === it.producto_id) }))
    const faltan = resueltos.filter(r => !r.prod)
    if (faltan.length) {
      const nombres = faltan.map(r => r.it.nombre || '¿?').join(', ')
      showMsg(`❌ Combo ${combo.nombre}: faltan productos en el catálogo (${nombres}). Revisalo en Precios → Combos.`, 'error', 5000)
      return
    }
    const comboPrecio = Number(combo.precio) || 0
    // Valor "suelto" de cada línea a precio minorista normal, para repartir.
    const valores = resueltos.map(({ it, prod }) =>
      (Number(it.kg) || 0) * Number(prod.precio_minorista || prod.precio_carniceria || 0))
    const totalNormal = valores.reduce((a, b) => a + b, 0)
    const comboInst = Date.now() + Math.random()  // instancia única (por si carga 2 combos iguales)
    let acumulado = 0
    const lineas = resueltos.map(({ it, prod }, idx) => {
      const kg = Number(it.kg) || 0
      // Reparto proporcional; la última línea se lleva el resto para que la
      // suma dé EXACTO el precio del combo (sin centavos perdidos por redondeo).
      let share
      if (idx === resueltos.length - 1) {
        share = comboPrecio - acumulado
      } else {
        share = totalNormal > 0
          ? Math.round(comboPrecio * (valores[idx] / totalNormal))
          : Math.round(comboPrecio / resueltos.length)
        acumulado += share
      }
      const precioUnit = kg > 0 ? share / kg : share
      return {
        id: Date.now() + Math.random() + idx,
        producto_id: prod.id,
        descripcion: prod.nombre,
        categoria: prod.categoria,
        stock_origen: prod.stock_origen
          || (prod.categoria === 'bovino_pieza' ? bucketPiezaBovina(prod.nombre) : null),
        kg_por_unidad: prod.kg_por_unidad || null,
        kg,
        unidad: 'kg',
        precio: precioUnit,
        precio_base: precioUnit,
        tiene_oferta: false,
        oferta_pct: null,
        lista: 'minorista',
        importe: share,
        // Marca de combo — excluye la línea de Promo/Blangino y la agrupa en el carrito.
        combo_id: combo.id,
        combo_nombre: combo.nombre,
        combo_inst: comboInst,
      }
    })
    setCarrito(c => [...c, ...lineas])
    showMsg(`✅ Combo ${combo.emoji || ''} ${combo.nombre} — ${fmt(comboPrecio)}`)
  }

  function quitarItem(id) {
    setCarrito(c => c.filter(item => item.id !== id))
  }

  // Quita TODAS las líneas de una instancia de combo de una sola vez.
  function quitarCombo(comboInst) {
    setCarrito(c => c.filter(item => item.combo_inst !== comboInst))
  }

  function editarKg(id, nuevoKg) {
    setCarrito(c => c.map(item => {
      if (item.id !== id) return item
      // parseNumero acepta "2,5" o "2.5" sin distinción
      const kg = parseNumero(nuevoKg)
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
  // parseNumero acepta "1500,50" o "1500.50" — el cajero puede tipear
  // con coma o punto sin preocuparse del formato.
  const total = carrito.reduce((s, i) => s + i.importe, 0)
  // Los combos ya vienen con su precio de oferta: NO se les aplica Promo
  // Mundial ni Blangino. La base descontable es el total SIN las líneas de combo.
  const totalCombos = carrito.reduce((s, i) => s + (i.combo_id ? i.importe : 0), 0)
  const baseDescuento = total - totalCombos
  const cobrado = parseNumero(pago.efectivo) + parseNumero(pago.debito) + parseNumero(pago.transferencia)
  // ── Promo Mundial ──────────────────────────────────────────
  // El descuento aplica SOLO si el pago es 100% efectivo y/o transferencia.
  // Apenas el cajero carga algo en débito, el descuento desaparece y se
  // cobra el total completo (la promo no cubre débito).
  const promoPct = Number(promoMundial?.descuento_pct) || 10
  const pagaConDebito = parseNumero(pago.debito) > 0
  // ── Descuento Blangino (convenio) ──────────────────────────
  // Empleado de la firma Blangino: 10% en CUALQUIER medio de pago.
  // Pisa la Promo Mundial para no aplicar doble descuento.
  const BLANGINO_PCT = 10
  const blanginoDescuento = blangino.activo ? Math.round(baseDescuento * BLANGINO_PCT / 100) : 0
  // ── Promo Mundial ──────────────────────────────────────────
  // Aplica SOLO si NO hay Blangino y el pago es 100% efectivo/transferencia.
  const promoDescuento = (!blangino.activo && promoMundial?.activa && !pagaConDebito)
    ? Math.round(baseDescuento * promoPct / 100)
    : 0
  const descuentoAplicado = blanginoDescuento || promoDescuento
  const descuentoPctAplicado = blanginoDescuento > 0 ? BLANGINO_PCT : (promoDescuento > 0 ? promoPct : 0)
  // Montos para los botones rápidos. Blangino aplica a todos los medios;
  // la Promo Mundial solo a efectivo/transferencia (no a débito).
  const promoFull = promoMundial?.activa ? Math.round(baseDescuento * promoPct / 100) : 0
  const fillEfvoTransf = total - (blangino.activo ? blanginoDescuento : promoFull)
  const fillDebito     = total - blanginoDescuento
  const totalACobrar = total - descuentoAplicado
  const vuelto = cobrado - totalACobrar
  const blanginoIncompleto = blangino.activo && (!blangino.empleado.trim() || !blangino.legajo.trim())

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
    if (blanginoIncompleto) {
      showMsg('❌ Descuento Blangino: completá nombre y legajo del empleado', 'error', 4000)
      return
    }
    if (cobrado < totalACobrar) {
      showMsg(`❌ Falta cobrar ${fmt(totalACobrar - cobrado)}`, 'error')
      return
    }
    // TOPE de seguridad: una venta de mostrador de más de $1.000.000 pide el CÓDIGO
    // de seguridad (240697) para confirmar. Cubre tanto ventas grandes legítimas (se
    // confirman con el código) como errores de tipeo en el monto (ej. $2.000.000.000
    // de efectivo en una venta de $13.392): un typo no va a tener el código.
    const TOPE_CAJA = 1000000
    const montoMax = Math.max(totalACobrar, cobrado, parseNumero(pago.efectivo), parseNumero(pago.debito), parseNumero(pago.transferencia))
    if (montoMax > TOPE_CAJA) {
      const codigo = prompt(`⚠️ Esta venta supera $1.000.000 (${fmt(montoMax)}).\n\nIngresá el código de seguridad para confirmar:`)
      if (codigo !== '240697') { showMsg('🚫 Código incorrecto — la venta NO se registró.', 'error', 6000); return }
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
        // Persistido para anular ventas viejas de cajones: necesitamos
        // saber cuántos kg pesa cada cajón aunque el producto haya cambiado.
        kg_por_unidad: i.kg_por_unidad || null,
        // Caja individual (CB/PT) — al anular venta llamamos revertirVentaCaja
        // para volver la caja a estado 'disponible'.
        caja_id: i.caja_id || null,
        caja_tipo: i.caja_tipo || null,
        // Pieza entera individual (piezas_stock) — al anular venta marcamos
        // la pieza de vuelta como 'disponible' en piezas_stock.
        pieza_id: i.pieza_id || null,
        pieza_tipo: i.pieza_tipo || null,
        // Combo del que salió esta línea (si aplica) — solo trazabilidad;
        // el descuento de stock y la anulación usan categoria/stock_origen/kg.
        combo_id: i.combo_id || null,
        combo_nombre: i.combo_nombre || null,
      })),
      // total = lo efectivamente cobrado (con Promo Mundial ya descontada).
      // La suma de items.importe puede ser mayor: la diferencia queda
      // registrada en descuento_monto para auditoría/reportes.
      total: totalACobrar,
      descuento_pct: descuentoAplicado > 0 ? descuentoPctAplicado : null,
      descuento_monto: descuentoAplicado > 0 ? descuentoAplicado : null,
      // Convenio Blangino: empleado + legajo para el control y el reintegro.
      convenio: blangino.activo ? 'blangino' : null,
      convenio_empleado: blangino.activo ? blangino.empleado.trim() : null,
      convenio_legajo: blangino.activo ? blangino.legajo.trim() : null,
      efectivo: parseNumero(pago.efectivo),
      debito: parseNumero(pago.debito),
      transferencia: parseNumero(pago.transferencia),
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
        setBlangino({ activo: false, empleado: '', legajo: '' })
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
    // mapearStock se movió a nivel de módulo (después del componente) para
    // que el Ticket Manual descuente stock con exactamente las mismas reglas.
    for (const item of carrito) {
      // Caja individual: la maneja venderCaja() abajo, que ya decrementa
      // stock_actual.caja_cb / caja_pt por su peso individual.
      if (item.caja_id) continue
      // Pieza entera: además de marcarla 'vendida' en piezas_stock (abajo),
      // descontamos su kg del agregado stock_actual.bovino_pieza — que es lo
      // que el Dashboard muestra como "Piezas Bovinas". El desposte sumó ese
      // kg al agregado al despostar; la venta lo resta (igual que el remito de
      // Depósito). Sin esto el Dashboard quedaría inflado por las piezas vendidas.
      if (item.pieza_id) {
        // Descontar del bucket PROPIO de la pieza (pieza_pierna, pieza_cortito…),
        // no del genérico. El bucket sale del stock_origen del item o, si no,
        // del tipo_stock de la pieza en piezas_stock.
        let bucketPz = item.stock_origen
        if (!bucketPz) {
          const { data: pz } = await supabase.from('piezas_stock').select('tipo_stock').eq('id', item.pieza_id).maybeSingle()
          bucketPz = pz?.tipo_stock || 'bovino_pieza'
        }
        const { data: stkPz } = await supabase.from('stock_actual').select('*').eq('tipo', bucketPz).maybeSingle()
        if (stkPz) {
          await supabase.from('stock_actual')
            .update({ kg_disponible: (stkPz.kg_disponible || 0) - (item.kg || 0) })
            .eq('tipo', bucketPz)
        }
        continue
      }
      const tipoStock = mapearStock(item.categoria, item.stock_origen)
      if (!tipoStock) continue  // categoría sin tracking de stock → saltar
      // Para cajones de pollo/rebozado: multiplicar unidades × kg_por_cajón.
      // kgPorUnidadDeProducto usa primero item.kg_por_unidad (cargado en
      // precios), fallback al parseo del nombre.
      const esCajonAConvertir = item.categoria === 'pollo_cajon' || item.categoria === 'rebozado_cajon'
      const cantidad = esCajonAConvertir
        ? (item.kg || 0) * (kgPorUnidadDeProducto(item) || 1)
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

    // Marcar cajas individuales vendidas (cajas_stock)
    for (const item of carrito) {
      if (!item.caja_id) continue
      const { error: errCaja } = await venderCaja(item.caja_id, {
        destino: 'caja_minorista',
        clienteId: null,
        clienteNombre: 'Caja Rápida',
        precioVentaKg: item.precio,
        totalVenta: item.importe,
        fechaSalida: fechaHoyARG(ahora),
        notas: `Vendida en Caja Rápida #${data.id}`,
      })
      if (errCaja) console.warn('No se pudo marcar caja vendida:', errCaja)
    }

    // Marcar piezas enteras vendidas (piezas_stock) — mismo patrón que cajas
    for (const item of carrito) {
      if (!item.pieza_id) continue
      const { error: errPieza } = await supabase.from('piezas_stock').update({
        estado: 'vendida',
        destino: 'caja_minorista',
        cliente_id: null,
        cliente_nombre: 'Caja Rápida',
        precio_venta_kg: item.precio,
        total_venta: item.importe,
        fecha_salida: fechaHoyARG(ahora),
        notas_salida: `Vendida en Caja Rápida #${data.id}`,
      }).eq('id', item.pieza_id)
      if (errPieza) console.warn('No se pudo marcar pieza vendida:', errPieza.message)
    }

    setUltimaVenta({ ...venta, vuelto: cobrado - totalACobrar, id: data.id })
    setCarrito([])
    setPago({ efectivo: '', debito: '', transferencia: '' })
    setBlangino({ activo: false, empleado: '', legajo: '' })
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
          { id: 'ticket_manual', label: '📝 Ticket manual' },
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
      {vistaCaja === 'ticket_manual' && <TicketManualCaja onGuardado={cargarTodo} />}
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
        {promoMundial?.activa ? (
          <div style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: '#7ec8ff',
            background: '#16243a', border: '1px solid #3a6ea5', borderRadius: 8,
            padding: '6px 14px', letterSpacing: 0.5,
          }}>
            ⚽ PROMO MUNDIAL −{promoPct}% efectivo/transferencia
            {ofertas.length > 0 && <span style={{ color: '#ffb86b', fontWeight: 600 }}> · ofertas pausadas</span>}
          </div>
        ) : ofertas.length > 0 && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
            🏷️ {ofertas.length} oferta(s) vigente(s)
          </div>
        )}
      </div>

      {/* ============ COMBOS ARMADOS (BOLSONES) ============ */}
      {combos.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>
            🍱 COMBOS — un toque agrega todos sus productos al precio del combo
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {combos.map(combo => (
              <button key={combo.id} onClick={() => agregarCombo(combo)}
                style={{
                  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--gold)',
                  background: 'linear-gradient(135deg,#1a1408,#0a0a08)', color: 'var(--text)',
                  cursor: 'pointer', textAlign: 'left', minWidth: 130,
                }}
                onMouseOver={e => { e.currentTarget.style.background = 'rgba(201,168,76,0.12)' }}
                onMouseOut={e => { e.currentTarget.style.background = 'linear-gradient(135deg,#1a1408,#0a0a08)' }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{combo.emoji} {combo.nombre}</div>
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--gold)', lineHeight: 1.1 }}>{fmt(combo.precio)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

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
                          {item.combo_nombre && (
                            <div style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 700, marginTop: 2 }}>
                              🍱 {item.combo_nombre}
                              <button onClick={() => quitarCombo(item.combo_inst)}
                                title="Quitar el combo completo"
                                style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: 10, marginLeft: 6, padding: 0, textDecoration: 'underline' }}>
                                quitar combo
                              </button>
                            </div>
                          )}
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

          {/* Historial del día — cada venta del turno, clickeable para ver el detalle */}
          <HistorialDiaCaja ventas={ventasHoy} onChange={cargarTodo} />
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
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--green)' }}>{fmtKg(kgTotalHoy)}</div>
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
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--green)', marginLeft: 8 }}>{fmtKg(p.kg, { decimales: 2 })}</div>
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
              {ultimaVenta.descuento_monto > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#7ec8ff', marginBottom: 4 }}>
                  <span>{ultimaVenta.convenio === 'blangino' ? '🔵 Descuento Blangino' : '⚽ Promo Mundial'} −{ultimaVenta.descuento_pct}%:</span>
                  <span>−{fmt(ultimaVenta.descuento_monto)}</span>
                </div>
              )}
              {ultimaVenta.convenio === 'blangino' && (
                <div style={{ fontSize: 11, color: '#7ec8ff', marginBottom: 4 }}>
                  👤 {ultimaVenta.convenio_empleado} · Legajo {ultimaVenta.convenio_legajo}
                </div>
              )}
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

      {/* ============ MODAL SELECTOR DE CAJA CB/PT ============ */}
      {selectorCaja && (() => {
        const tipoCaja = CATEGORIA_A_TIPO_CAJA[selectorCaja.producto.categoria]
        const productoId = selectorCaja.producto.id
        const idsEnCarrito = carrito.filter(i => i.caja_id).map(i => i.caja_id)
        // Filtrar: tipo correcto + no esté en carrito + producto match
        // (cajas con producto_id null = legacy = se muestran como fallback).
        const cajasVisibles = cajasDisp.filter(c => {
          if (c.tipo_caja !== tipoCaja) return false
          if (idsEnCarrito.includes(c.id)) return false
          if (c.producto_id && c.producto_id !== productoId) return false
          return true
        })
        return (
          <div onClick={() => setSelectorCaja(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 640, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>📦 Elegí la caja {tipoCaja} a vender</div>
                <button onClick={() => setSelectorCaja(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                {selectorCaja.producto.nombre} · {fmtPrecio(resolverPrecio(selectorCaja.producto).precio)}/kg
                {' · '}{cajasVisibles.length} caja{cajasVisibles.length === 1 ? '' : 's'} disponible{cajasVisibles.length === 1 ? '' : 's'}
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {cajasVisibles.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                    Sin cajas {tipoCaja} disponibles. Cargá nuevas desde Depósito → Entradas.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                    {cajasVisibles.map(c => {
                      const importe = Number(c.kg) * resolverPrecio(selectorCaja.producto).precio
                      return (
                        <div key={c.id} onClick={() => agregarCajaAlCarrito(c, selectorCaja.producto)}
                          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: '2px solid var(--border)', background: 'var(--surface2)' }}
                          onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'rgba(201,168,76,0.08)' }}
                          onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface2)' }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>📦 Caja {c.tipo_caja} #{c.id}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.proveedor_origen || 's/proveedor'} · {c.fecha_ingreso}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{fmtKg(c.kg)}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{fmtPrecio(importe)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ============ MODAL SELECTOR DE PIEZA ENTERA ============ */}
      {selectorPieza && (() => {
        const idsEnCarrito = carrito.filter(i => i.pieza_id).map(i => i.pieza_id)
        // Mostrar todas las piezas disponibles (no filtramos por tipo —
        // así el cajero ve TODO el stock y elige por kg/proveedor/fecha).
        const piezasVisibles = piezasDisp.filter(p => !idsEnCarrito.includes(p.id))
        // Agrupar por tipo_pieza para que sea más fácil escanear
        const porTipo = {}
        piezasVisibles.forEach(p => { (porTipo[p.tipo_pieza || 'Otra'] = porTipo[p.tipo_pieza || 'Otra'] || []).push(p) })
        const precioKg = resolverPrecio(selectorPieza.producto).precio
        return (
          <div onClick={() => setSelectorPieza(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 720, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>🥩 Elegí la pieza a vender</div>
                <button onClick={() => setSelectorPieza(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                {selectorPieza.producto.nombre} · {fmtPrecio(precioKg)}/kg
                {' · '}{piezasVisibles.length} pieza{piezasVisibles.length === 1 ? '' : 's'} disponible{piezasVisibles.length === 1 ? '' : 's'}
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {piezasVisibles.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                    Sin piezas disponibles. Despostá una media res primero desde Depósito.
                  </div>
                ) : (
                  Object.entries(porTipo).map(([tipo, lista]) => (
                    <div key={tipo} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        {tipo} ({lista.length})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                        {lista.map(p => {
                          const importe = Number(p.kg) * precioKg
                          return (
                            <div key={p.id} onClick={() => agregarPiezaAlCarrito(p, selectorPieza.producto)}
                              style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: '2px solid var(--border)', background: 'var(--surface2)' }}
                              onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'rgba(201,168,76,0.08)' }}
                              onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface2)' }}>
                              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>🥩 Pieza #{p.id}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{p.proveedor_origen || 's/proveedor'} · {p.fecha_ingreso}{p.modelo_desposte ? ` · Mod. ${p.modelo_desposte}` : ''}</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                                <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{fmtKg(p.kg)}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{fmtPrecio(importe)}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
              {descuentoAplicado > 0 ? (
                <>
                  <div style={{ fontSize: 16, color: 'var(--muted)', textDecoration: 'line-through' }}>{fmt(total)}</div>
                  <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 48, color: '#7ec8ff' }}>{fmt(totalACobrar)}</div>
                  <div style={{ fontSize: 12, color: '#7ec8ff', fontWeight: 700 }}>
                    {blanginoDescuento > 0
                      ? `🔵 Descuento Blangino −${BLANGINO_PCT}%: ahorra ${fmt(blanginoDescuento)}`
                      : `⚽ Promo Mundial −${promoPct}%: ahorra ${fmt(promoDescuento)}`}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 48, color: 'var(--gold)' }}>{fmt(totalACobrar)}</div>
              )}
              {!blangino.activo && promoMundial?.activa && pagaConDebito && (
                <div style={{ fontSize: 11, color: '#ffb86b', fontWeight: 700, marginTop: 4 }}>
                  ⚠️ Con débito NO aplica la Promo Mundial — se cobra el total completo
                </div>
              )}
            </div>

            {/* ── Descuento Blangino (convenio empleados de la firma) ── */}
            <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, border: `1px solid ${blangino.activo ? '#3a6ea5' : 'var(--border)'}`, background: blangino.activo ? 'rgba(122,200,255,0.07)' : 'transparent' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14, color: blangino.activo ? '#7ec8ff' : 'var(--text)' }}>
                <input type="checkbox" checked={blangino.activo}
                  onChange={e => setBlangino(b => ({ ...b, activo: e.target.checked }))}
                  style={{ width: 18, height: 18, cursor: 'pointer' }} />
                🔵 Descuento Blangino (−{BLANGINO_PCT}%)
              </label>
              {blangino.activo && (
                <>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input value={blangino.empleado} onChange={e => setBlangino(b => ({ ...b, empleado: e.target.value }))}
                      placeholder="Nombre del empleado" style={{ ...inp, flex: 2 }} />
                    <input value={blangino.legajo} onChange={e => setBlangino(b => ({ ...b, legajo: e.target.value }))}
                      placeholder="Legajo" style={{ ...inp, flex: 1 }} />
                  </div>
                  {blanginoIncompleto && (
                    <div style={{ fontSize: 11, color: '#ffb86b', marginTop: 6 }}>
                      Completá nombre y legajo del empleado para confirmar la venta.
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>💵 EFECTIVO</label>
                <input ref={efectivoRef} type="number" value={pago.efectivo}
                  onChange={e => setPago(p => ({ ...p, efectivo: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && cobrado >= totalACobrar && !guardandoVenta && cerrarVenta()}
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
              {/* Con Blangino el 10% aplica a todos los medios; con Promo Mundial
                  solo a efectivo/transferencia (el débito va sin descuento). */}
              <button onClick={() => setPago(p => ({ ...p, efectivo: fillEfvoTransf.toString(), debito: '', transferencia: '' }))}
                style={{ flex: 1, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                ✋ Justo efectivo
              </button>
              <button onClick={() => setPago(p => ({ ...p, debito: fillDebito.toString(), efectivo: '', transferencia: '' }))}
                style={{ flex: 1, padding: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                💳 Solo débito
              </button>
              <button onClick={() => setPago(p => ({ ...p, transferencia: fillEfvoTransf.toString(), efectivo: '', debito: '' }))}
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
              <button onClick={cerrarVenta} disabled={cobrado < totalACobrar || guardandoVenta}
                style={{ flex: 2, padding: 14, background: guardandoVenta ? 'var(--surface2)' : (cobrado >= totalACobrar ? 'var(--green)' : 'var(--surface2)'), color: guardandoVenta ? 'var(--muted)' : (cobrado >= totalACobrar ? '#000' : 'var(--muted)'), border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 800, cursor: (cobrado >= totalACobrar && !guardandoVenta) ? 'pointer' : 'not-allowed', fontFamily: "'Bebas Neue',cursive", letterSpacing: 2 }}>
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

// Función que decide a qué tipo de stock_actual va una venta. A nivel de
// módulo porque la usan DOS flujos: la venta normal de Caja Rápida y el
// Ticket Manual (mismas reglas exactas, sin duplicar lógica).
// Para cerdo_corte/cerdo_pieza SIEMPRE se usa el stock_origen del producto
// (ej. cerdo_bondiola, cerdo_pierna). Ya no existe el bucket genérico
// 'cerdo_pieza' (eliminado): si un producto de cerdo no tiene stock_origen
// configurado, NO se descuenta de ningún stock (return null) para no
// resucitar el bucket buggy. NUNCA descuenta de 'cerdo' (capones) — esos
// sólo bajan al despostar.
function mapearStock(cat, stockOrigen) {
  if (!cat) return null
  if (stockOrigen) return stockOrigen
  if (cat === 'bovino_mr')        return 'bovino_mr'
  if (cat === 'bovino_corte')     return 'bovino_corte'
  // bovino_pieza: los productos de pieza llegan con stock_origen resuelto
  // por nombre al agregarse al carrito (pieza_costillar, pieza_pierna…),
  // así que este fallback solo aplica a nombres no reconocidos (medias
  // res). Se mantiene el genérico para no perder el tracking y quedar
  // simétrico con la anulación (mapearStockTipo en anularVenta.js).
  if (cat === 'bovino_pieza')     return 'bovino_pieza'
  if (cat === 'bovino_brosa')     return 'bovino_brosa'
  if (cat === 'cerdo')            return 'cerdo'         // capón entero
  if (cat === 'cerdo_corte')      return null            // sin origen → no descontar (no recrear cerdo_pieza)
  if (cat === 'cerdo_pieza')      return null
  if (cat === 'pollo')            return 'pollo'
  if (cat === 'pollo_cajon')      return 'pollo'         // unidad × kg_por_cajón
  if (cat === 'rebozado')         return 'rebozado'
  if (cat === 'rebozado_cajon')   return 'rebozado'      // unidad × kg_por_cajón
  // embutido: los de elaboración propia llegan con stock_origen (emb_*,
  // mig 60); el resto no trackea stock — el bucket genérico se eliminó
  if (cat === 'embutido')         return null
  if (cat === 'almacen')          return 'almacen'
  if (cat === 'bebidas')          return 'bebidas'
  if (cat === 'bovino_caja_cb')   return 'caja_cb'
  if (cat === 'bovino_caja_pt')   return 'caja_pt'
  return null
}

// ============================================================
// TICKET MANUAL — cargar una venta que no se registró en su momento
// ------------------------------------------------------------
// Para los tickets "olvidados": se cobró en el mostrador pero no se
// cargó en la Caja (sistema caído, apuro, etc.). Se registra con la
// FECHA REAL de la venta para que el día cierre bien en historial,
// cierre semanal y reportes. Entra como origen 'caja' (venta minorista
// normal) y DESCUENTA STOCK igual que una venta de Caja Rápida: los
// ítems son productos reales de la lista (mapearStock + stock_origen
// persistido, así la anulación revierte al mismo bucket). También se
// puede sumar una línea libre (categoría 'manual') que no toca stock.
// ============================================================
function TicketManualCaja({ onGuardado }) {
  const [form, setForm] = useState({ fecha: fechaHoyARG(), hora: '12:00', medio: 'efectivo' })
  const [items, setItems] = useState([])
  const [precios, setPrecios] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [kgInput, setKgInput] = useState('')
  const [prodSel, setProdSel] = useState(null)
  const [libre, setLibre] = useState({ descripcion: '', importe: '' })
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('precios')
      .select('id, nombre, categoria, precio_minorista, stock_origen, kg_por_unidad')
      .order('nombre')
      .then(({ data }) => setPrecios((data || []).filter(p => !p.nombre?.startsWith('ZZ_'))))
  }, [])

  const inp = {
    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 8, padding: '10px 14px', fontFamily: "'DM Sans',sans-serif", fontSize: 14,
    width: '100%', boxSizing: 'border-box',
  }

  const resultados = busqueda.trim().length >= 2
    ? precios.filter(p => p.nombre.toLowerCase().includes(busqueda.toLowerCase())).slice(0, 8)
    : []

  // Mismo criterio que el carrito de Caja Rápida: los productos de pieza
  // bovina resuelven su bucket específico por nombre (PR #236).
  function stockOrigenDe(p) {
    if (p.stock_origen) return p.stock_origen
    if (p.categoria === 'bovino_pieza') return bucketPiezaBovina(p.nombre) || null
    return null
  }

  function agregarProducto() {
    if (!prodSel) { setMsg({ t: 'error', m: '❌ Elegí un producto de la lista' }); return }
    const kg = parseNumero(kgInput)
    if (!(kg > 0)) { setMsg({ t: 'error', m: '❌ Ingresá los kg (o unidades) vendidos' }); return }
    const precio = Number(prodSel.precio_minorista) || 0
    setItems(prev => [...prev, {
      descripcion: prodSel.nombre,
      categoria: prodSel.categoria,
      kg,
      precio,
      importe: Math.round(kg * precio * 100) / 100,
      producto_id: prodSel.id,
      stock_origen: stockOrigenDe(prodSel),
      kg_por_unidad: prodSel.kg_por_unidad || null,
    }])
    setProdSel(null); setBusqueda(''); setKgInput(''); setMsg(null)
  }

  function agregarLibre() {
    const importe = parseNumero(libre.importe)
    if (!(importe > 0)) { setMsg({ t: 'error', m: '❌ Ingresá el importe de la línea libre' }); return }
    setItems(prev => [...prev, {
      descripcion: (libre.descripcion || '').trim() || 'Ítem manual',
      categoria: 'manual',
      kg: 0,
      precio: null,
      importe,
      producto_id: null,
      stock_origen: null,
    }])
    setLibre({ descripcion: '', importe: '' }); setMsg(null)
  }

  function setImporteItem(i, val) {
    setItems(prev => prev.map((it, k) => k === i ? { ...it, importe: parseNumero(val) } : it))
  }

  const total = items.reduce((s, i) => s + (Number(i.importe) || 0), 0)

  async function guardar() {
    const hoy = fechaHoyARG()
    if (!items.length) { setMsg({ t: 'error', m: '❌ Agregá al menos un ítem al ticket' }); return }
    if (!(total > 0)) { setMsg({ t: 'error', m: '❌ El total tiene que ser mayor a 0' }); return }
    if (!form.fecha || form.fecha > hoy) { setMsg({ t: 'error', m: '❌ La fecha no puede ser futura' }); return }
    setGuardando(true)
    const hora = form.hora || '12:00'
    const { error } = await supabase.from('ventas_minoristas').insert({
      fecha: form.fecha,
      hora,
      turno: (parseInt(hora, 10) || 12) < 14 ? 'mañana' : 'tarde',
      origen: 'caja',
      items,
      total,
      efectivo: form.medio === 'efectivo' ? total : 0,
      debito: form.medio === 'debito' ? total : 0,
      transferencia: form.medio === 'transferencia' ? total : 0,
      notas: `Ticket cargado manualmente el ${hoy} (venta no registrada en su momento)`,
    })
    if (error) { setGuardando(false); setMsg({ t: 'error', m: '❌ ' + error.message }); return }
    // Descontar stock — mismas reglas que la venta normal de Caja Rápida
    // (mapearStock + cajones × kg_por_unidad). Las líneas libres no tocan stock.
    for (const item of items) {
      const tipoStock = mapearStock(item.categoria, item.stock_origen)
      if (!tipoStock) continue
      const esCajon = item.categoria === 'pollo_cajon' || item.categoria === 'rebozado_cajon'
      const cantidad = esCajon ? (item.kg || 0) * (item.kg_por_unidad || kgPorUnidadDeProducto(item) || 1) : (item.kg || 0)
      const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
      if (stock) {
        await supabase.from('stock_actual')
          .update({ kg_disponible: (stock.kg_disponible || 0) - cantidad })
          .eq('tipo', tipoStock)
      } else {
        await supabase.from('stock_actual').insert({ tipo: tipoStock, kg_disponible: -cantidad })
      }
    }
    setGuardando(false)
    setMsg({ t: 'ok', m: `✅ Ticket de ${fmt(total)} registrado con fecha ${form.fecha} — stock descontado` })
    setItems([])
    setForm({ fecha: fechaHoyARG(), hora: '12:00', medio: 'efectivo' })
    onGuardado?.()
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card">
        <div className="card-title">📝 Cargar ticket manual (venta olvidada)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Para ventas que se cobraron en el mostrador pero no se registraron en su momento.
          Se guarda con la fecha real y <strong>descuenta stock</strong> igual que una venta normal.
        </div>
        <div className="form-row">
          <div className="form-group"><label>Fecha de la venta</label>
            <input type="date" max={fechaHoyARG()} value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={inp} />
          </div>
          <div className="form-group"><label>Hora (aprox.)</label>
            <input type="time" value={form.hora} onChange={e => setForm(f => ({ ...f, hora: e.target.value }))} style={inp} />
          </div>
          <div className="form-group"><label>Medio de pago</label>
            <select value={form.medio} onChange={e => setForm(f => ({ ...f, medio: e.target.value }))} style={inp}>
              <option value="efectivo">💵 Efectivo</option>
              <option value="debito">💳 Débito</option>
              <option value="transferencia">🏦 Transferencia</option>
            </select>
          </div>
        </div>

        {/* Agregar producto real (descuenta stock) */}
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>🥩 Agregar producto (descuenta stock)</div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <input placeholder="Buscá el producto por nombre… (mín. 2 letras)" value={busqueda}
              onChange={e => { setBusqueda(e.target.value); setProdSel(null) }} style={inp} />
            {resultados.length > 0 && !prodSel && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                {resultados.map(p => (
                  <div key={p.id} onClick={() => { setProdSel(p); setBusqueda(p.nombre) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {p.nombre} <span style={{ color: 'var(--muted)', fontSize: 11 }}>· {fmt(p.precio_minorista)}/kg</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" step="0.001" min="0" placeholder="Kg / unidades" value={kgInput} onChange={e => setKgInput(e.target.value)}
              style={{ ...inp, width: 140, borderColor: 'var(--gold)' }} />
            {prodSel && parseNumero(kgInput) > 0 && (
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>= <strong style={{ color: 'var(--gold)' }}>{fmt(parseNumero(kgInput) * (Number(prodSel.precio_minorista) || 0))}</strong></span>
            )}
            <button className="btn btn-gold" onClick={agregarProducto} style={{ marginLeft: 'auto' }}>➕ Agregar</button>
          </div>
        </div>

        {/* Línea libre (no descuenta stock) */}
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>✍️ Línea libre (no descuenta stock)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Descripción (ej: varios)" value={libre.descripcion} onChange={e => setLibre(l => ({ ...l, descripcion: e.target.value }))} style={{ ...inp, flex: 2 }} />
            <input type="number" step="0.01" min="0" placeholder="$" value={libre.importe} onChange={e => setLibre(l => ({ ...l, importe: e.target.value }))} style={{ ...inp, flex: 1 }} />
            <button className="btn" onClick={agregarLibre}>➕</button>
          </div>
        </div>

        {/* Ítems del ticket */}
        {items.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ flex: 1 }}>{it.descripcion}{it.categoria === 'manual' ? ' ✍️' : ''}</span>
                {it.kg > 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtKg(it.kg)}</span>}
                <input type="number" step="0.01" value={it.importe} onChange={e => setImporteItem(i, e.target.value)}
                  title="Importe cobrado por esta línea (editalo si difiere del precio de lista)"
                  style={{ ...inp, width: 110, padding: '5px 8px', textAlign: 'right', fontWeight: 700 }} />
                <button onClick={() => setItems(prev => prev.filter((_, k) => k !== i))}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', color: 'var(--red-light)' }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', paddingTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>TOTAL</span>
              <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 26, color: 'var(--gold)' }}>{fmt(total)}</span>
            </div>
          </div>
        )}

        {msg && (
          <div style={{ background: msg.t === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${msg.t === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: msg.t === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600, fontSize: 13 }}>
            {msg.m}
          </div>
        )}
        <button className="btn btn-gold" onClick={guardar} disabled={guardando || items.length === 0} style={{ width: '100%', fontSize: 15, padding: '12px' }}>
          {guardando ? '⏳ Guardando…' : `📝 Registrar ticket${total > 0 ? ` — ${fmt(total)}` : ''}`}
        </button>
        <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#7db5ff', marginTop: 14 }}>
          ℹ️ Los productos de la lista <strong>descuentan stock</strong> igual que una venta normal (y la anulación lo devuelve).
          Las líneas libres ✍️ no tocan stock. Si el día ya tenía el arqueo cerrado, ese arqueo no se recalcula —
          la venta suma igual al historial y al cierre semanal.
        </div>
      </div>
    </div>
  )
}
