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
  const [ultimaVenta, setUltimaVenta] = useState(null)
  const [ventasHoy, setVentasHoy] = useState([])
  const [vistaCaja, setVistaCaja] = useState('vender') // 'vender' | 'historial' | 'arqueo'

  const codigoRef = useRef(null)
  const busquedaRef = useRef(null)
  const efectivoRef = useRef(null)

  // ---- Carga inicial ----
  useEffect(() => { cargarTodo() }, [])

  async function cargarTodo() {
    const [{ data: pre }, { data: cfg }, { data: ventas }] = await Promise.all([
      supabase.from('precios').select('*').order('nombre'),
      supabase.from('config_sistema').select('*').eq('clave', 'ean13_formato').maybeSingle(),
      supabase.from('ventas_minoristas').select('*')
        .eq('fecha', new Date().toISOString().split('T')[0])
        .eq('origen', 'caja').order('created_at', { ascending: false }),
    ])
    setPrecios(pre || [])
    if (cfg?.valor) setConfigEAN(cfg.valor)
    setVentasHoy(ventas || [])
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
      const precioKg = prod.precio_minorista || prod.precio_carniceria || 0
      if (configEAN.tipo === 'precio' || configEAN.tipo === 'precio_pesos') {
        // La balanza nos dio el importe total — calculamos kg al revés
        const importe = decoded.precio || 0
        const kg = precioKg > 0 ? importe / precioKg : 0
        agregarItemConImporte(prod, kg, precioKg, importe)
      } else {
        // Peso embebido — calculamos importe
        agregarItem(prod, decoded.peso_kg, precioKg)
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
    const precio = precioOverride || producto.precio_minorista || producto.precio_carniceria || 0
    const pesable = esPesable(producto)
    const cant = parseFloat(cantidad)
    setCarrito(c => [...c, {
      id: Date.now() + Math.random(),
      producto_id: producto.id,
      descripcion: producto.nombre,
      categoria: producto.categoria,
      kg: cant,            // se sigue llamando "kg" para no romper el resto; representa la cantidad
      unidad: pesable ? 'kg' : 'u',
      precio: parseFloat(precio),
      importe: cant * parseFloat(precio),
    }])
    const unidadTxt = pesable ? `${cant.toFixed(3)} kg` : `${cant} u`
    showMsg(`✅ ${producto.nombre} — ${unidadTxt}`)
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

  // ---- Cerrar venta ----
  async function cerrarVenta() {
    if (carrito.length === 0) {
      showMsg('❌ El carrito está vacío', 'error')
      return
    }
    if (cobrado < total) {
      showMsg(`❌ Falta cobrar ${fmt(total - cobrado)}`, 'error')
      return
    }

    const ahora = new Date()
    const venta = {
      fecha: ahora.toISOString().split('T')[0],
      hora: ahora.toTimeString().slice(0, 8),
      turno: ahora.getHours() < 14 ? 'mañana' : 'tarde',
      origen: 'caja',
      items: carrito.map(i => ({
        descripcion: i.descripcion,
        categoria: i.categoria,
        kg: i.kg,
        precio: i.precio,
        importe: i.importe,
        producto_id: i.producto_id,
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
      showMsg(`❌ Error: ${error.message}`, 'error', 4000)
      return
    }

    // Descontar stock — mapeo explícito de cada categoría a su tipo en stock_actual.
    // Para almacén y bebidas, la unidad es "cantidad" (no kg). Para carnes es kg.
    // En ambos casos se suma/resta sobre el mismo campo kg_disponible.
    function mapearStock(cat) {
      if (!cat) return null
      if (cat === 'bovino_mr')        return 'bovino_mr'
      if (cat === 'bovino_corte')     return 'bovino_corte'
      if (cat === 'bovino_pieza')     return 'bovino_pieza'
      if (cat === 'bovino_brosa')     return 'bovino_brosa'
      if (cat === 'cerdo_corte' || cat === 'cerdo_pieza' || cat === 'cerdo') return 'cerdo'
      if (cat === 'pollo')            return 'pollo'
      if (cat === 'embutido')         return 'embutido'
      if (cat === 'almacen')          return 'almacen'
      if (cat === 'bebidas')          return 'bebidas'
      // Sin tracking todavía: bovino_caja_cb, bovino_caja_pt,
      // pollo_cajon, rebozado, rebozado_cajon (manejados por separado).
      return null
    }
    for (const item of carrito) {
      const tipoStock = mapearStock(item.categoria)
      if (!tipoStock) continue  // categoría sin tracking de stock → saltar
      const { data: stock } = await supabase.from('stock_actual').select('*').eq('tipo', tipoStock).maybeSingle()
      if (stock) {
        await supabase.from('stock_actual')
          .update({ kg_disponible: (stock.kg_disponible || 0) - item.kg })
          .eq('tipo', tipoStock)
      }
    }

    setUltimaVenta({ ...venta, vuelto: cobrado - total, id: data.id })
    setCarrito([])
    setPago({ efectivo: '', debito: '', transferencia: '' })
    setMostrarCierre(false)
    cargarTodo()
    showMsg(`✅ Venta #${data.id} registrada`, 'success', 4000)
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

  // Kg vendidos por tipo de stock (mapeo igual al que descuenta del stock)
  const kgPorStock = useMemo(() => {
    const acc = {}
    function mapearCat(cat) {
      if (!cat) return 'bovino_corte'
      if (cat === 'bovino_mr') return 'bovino_mr'
      if (cat === 'bovino_pieza' || cat === 'bovino_caja_cb' || cat === 'bovino_caja_pt') return 'bovino_pieza'
      if (cat === 'bovino_brosa') return 'bovino_brosa'
      if (cat === 'cerdo' || cat === 'cerdo_corte' || cat === 'cerdo_pieza') return 'cerdo'
      if (cat === 'pollo') return 'pollo'
      if (cat === 'embutido') return 'embutido'
      return 'bovino_corte'
    }
    ventasHoy.forEach(v => (v.items || []).forEach(it => {
      const k = mapearCat(it.categoria)
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
                        <td style={{ textAlign: 'right', padding: '8px 4px', fontSize: 13 }}>{fmt(item.precio)}</td>
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
              {Object.entries(kgPorStock).sort((a, b) => b[1] - a[1]).map(([tipo, kg]) => (
                <div key={tipo} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', background: 'var(--surface2)', borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{tipo === 'bovino_corte' ? '🥩 Bovino Cortes' : tipo === 'bovino_pieza' ? '🍖 Piezas' : tipo === 'bovino_brosa' ? '🫀 Brosa' : tipo === 'cerdo' ? '🐷 Cerdo' : tipo === 'pollo' ? '🍗 Pollo' : tipo === 'embutido' ? '🌭 Embutidos' : tipo === 'bovino_mr' ? '🐄 Media Reses' : tipo}</span>
                  <strong style={{ color: 'var(--green)' }}>-{kg.toFixed(2)} kg</strong>
                </div>
              ))}
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
                  <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 14 }}>
                    {fmt(p.precio_minorista || p.precio_carniceria || 0)}/kg
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
                  onKeyDown={e => e.key === 'Enter' && cobrado >= total && cerrarVenta()}
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
              <button onClick={cerrarVenta} disabled={cobrado < total}
                style={{ flex: 2, padding: 14, background: cobrado >= total ? 'var(--green)' : 'var(--surface2)', color: cobrado >= total ? '#000' : 'var(--muted)', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 800, cursor: cobrado >= total ? 'pointer' : 'not-allowed', fontFamily: "'Bebas Neue',cursive", letterSpacing: 2 }}>
                ✅ CONFIRMAR VENTA
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
