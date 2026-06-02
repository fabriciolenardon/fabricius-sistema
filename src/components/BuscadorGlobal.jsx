// ============================================================
// BuscadorGlobal (Ctrl+K)
// ============================================================
// Modal de búsqueda universal. Se abre con Ctrl+K (Cmd+K en Mac)
// o desde un botón. Busca en: productos/precios, clientes,
// contrapartes, facturas y ventas. Resultados clickeables que
// navegan directo a la pantalla correspondiente.
// ============================================================
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fmtPrecio } from '../lib/formatos'

export default function BuscadorGlobal() {
  const [abierto, setAbierto] = useState(false)
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState([])
  const [cargando, setCargando] = useState(false)
  const [indiceSel, setIndiceSel] = useState(0)
  const inputRef = useRef()
  const navigate = useNavigate()

  // Atajo de teclado Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAbierto(a => !a)
      }
      if (e.key === 'Escape' && abierto) {
        setAbierto(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abierto])

  // Auto-focus al abrir
  useEffect(() => {
    if (abierto) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResultados([])
      setIndiceSel(0)
    }
  }, [abierto])

  // Debounce de búsqueda
  useEffect(() => {
    if (!abierto || !query.trim()) {
      setResultados([])
      return
    }
    const timer = setTimeout(() => buscar(query.trim()), 200)
    return () => clearTimeout(timer)
  }, [query, abierto])

  async function buscar(q) {
    setCargando(true)
    const qLower = q.toLowerCase()
    const qLike = `%${q}%`
    try {
      const [precios, clientes, contrapartes, facturas, ventas] = await Promise.all([
        supabase.from('precios').select('id, nombre, categoria, codigo_balanza, precio_minorista').ilike('nombre', qLike).limit(8),
        supabase.from('clientes').select('id, nombre, telefono, saldo').or(`nombre.ilike.${qLike},telefono.ilike.${qLike}`).limit(5),
        supabase.from('contrapartes').select('id, nombre, cuit').or(`nombre.ilike.${qLike},cuit.ilike.${qLike}`).limit(5).then(r => r).catch(() => ({ data: [] })),
        supabase.from('facturas').select('id, numero, monto_total, fecha, contraparte_nombre').or(`numero.ilike.${qLike},contraparte_nombre.ilike.${qLike}`).limit(5).then(r => r).catch(() => ({ data: [] })),
        supabase.from('ventas_minoristas').select('id, total, fecha, hora').ilike('id::text', qLike).limit(3).then(r => r).catch(() => ({ data: [] })),
      ])

      const items = []
      ;(precios.data || []).forEach(p => items.push({
        tipo: 'producto', icono: '🏷️', titulo: p.nombre,
        sub: `${p.categoria || ''} ${p.codigo_balanza ? `· PLU ${p.codigo_balanza}` : ''} · ${fmtPrecio(p.precio_minorista || 0)}/kg`,
        accion: () => navigate('/admin/precios'),
      }))
      ;(clientes.data || []).forEach(c => items.push({
        tipo: 'cliente', icono: '👤', titulo: c.nombre,
        sub: `${c.telefono || '—'} · Saldo: ${fmtPrecio(c.saldo || 0)}`,
        accion: () => navigate('/admin/clientes'),
      }))
      ;(contrapartes.data || []).forEach(c => items.push({
        tipo: 'contraparte', icono: '🏭', titulo: c.nombre,
        sub: `CUIT ${c.cuit || '—'}`,
        accion: () => navigate('/admin/facturacion'),
      }))
      ;(facturas.data || []).forEach(f => items.push({
        tipo: 'factura', icono: '🧾', titulo: `Factura ${f.numero || `#${f.id}`}`,
        sub: `${f.contraparte_nombre || '—'} · ${f.fecha} · ${fmtPrecio(f.monto_total || 0)}`,
        accion: () => navigate('/admin/facturacion'),
      }))
      ;(ventas.data || []).forEach(v => items.push({
        tipo: 'venta', icono: '💵', titulo: `Venta #${v.id}`,
        sub: `${v.fecha} ${v.hora?.slice(0, 5) || ''} · ${fmtPrecio(v.total || 0)}`,
        accion: () => navigate('/admin/caja'),
      }))

      // Navegación rápida por palabras clave
      const navegacion = [
        { kw: ['dashboard', 'panel'],            ruta: '/admin/dashboard',   nombre: 'Dashboard',   icono: '📊' },
        { kw: ['caja', 'vender', 'venta'],       ruta: '/admin/caja',        nombre: 'Caja Rápida', icono: '💵' },
        { kw: ['mayorista', 'ventas'],           ruta: '/admin/ventas',      nombre: 'Mayorista',   icono: '📋' },
        { kw: ['deposito', 'desposte', 'stock'], ruta: '/admin/deposito',    nombre: 'Depósito',    icono: '🏭' },
        { kw: ['precios', 'oferta'],             ruta: '/admin/precios',     nombre: 'Precios',     icono: '💲' },
        { kw: ['etiquetas'],                     ruta: '/admin/etiquetas',   nombre: 'Etiquetas',   icono: '🏷️' },
        { kw: ['clientes'],                      ruta: '/admin/clientes',    nombre: 'Clientes',    icono: '👥' },
        { kw: ['pedidos'],                       ruta: '/admin/pedidos',     nombre: 'Pedidos',     icono: '📥' },
        { kw: ['franquicia'],                    ruta: '/admin/franquicias', nombre: 'Franquicias', icono: '🏪' },
        { kw: ['cheques'],                       ruta: '/admin/cheques',     nombre: 'Cheques',     icono: '📄' },
        { kw: ['sueldos', 'empleados', 'paga'],  ruta: '/admin/sueldos',     nombre: 'Sueldos',     icono: '💰' },
        { kw: ['gastos'],                        ruta: '/admin/gastos',      nombre: 'Gastos',      icono: '💸' },
        { kw: ['facturacion', 'cuenta', 'mono', 'iva'], ruta: '/admin/facturacion', nombre: 'Facturación', icono: '📑' },
        { kw: ['cierre', 'semanal'],             ruta: '/admin/cierre',      nombre: 'Cierre',      icono: '📋' },
      ]
      navegacion.forEach(n => {
        if (n.kw.some(k => k.includes(qLower) || qLower.includes(k))) {
          items.unshift({
            tipo: 'navegacion', icono: n.icono, titulo: `Ir a ${n.nombre}`,
            sub: n.ruta, accion: () => navigate(n.ruta),
          })
        }
      })

      setResultados(items)
      setIndiceSel(0)
    } catch (e) {
      console.warn('Error en búsqueda:', e)
    }
    setCargando(false)
  }

  function onSubmit(e) {
    e.preventDefault()
    const item = resultados[indiceSel]
    if (item) {
      item.accion()
      setAbierto(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceSel(i => Math.min(resultados.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceSel(i => Math.max(0, i - 1))
    }
  }

  if (!abierto) return null

  return (
    <div onClick={() => setAbierto(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, width: '90%', maxWidth: 640, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        <form onSubmit={onSubmit} style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔍</span>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Buscar productos, clientes, facturas, ir a una sección..."
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 17, fontFamily: "'DM Sans',sans-serif" }} />
            <kbd style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 10, color: 'var(--muted)' }}>ESC</kbd>
          </div>
        </form>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {cargando && <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Buscando...</div>}
          {!cargando && query && resultados.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Sin resultados para "<strong>{query}</strong>"
            </div>
          )}
          {!cargando && !query && (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>
              💡 Buscá por nombre de producto, cliente, número de factura, o tipeá "caja", "precios", "facturación" para ir directo a esa sección.
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <kbd style={kbdStyle}>↑↓</kbd> navegar · <kbd style={kbdStyle}>Enter</kbd> abrir · <kbd style={kbdStyle}>Esc</kbd> cerrar
              </div>
            </div>
          )}
          {resultados.map((r, i) => (
            <div key={i} onClick={() => { r.accion(); setAbierto(false) }}
              onMouseEnter={() => setIndiceSel(i)}
              style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                       background: indiceSel === i ? 'var(--surface2)' : 'transparent',
                       borderLeft: indiceSel === i ? '3px solid var(--gold)' : '3px solid transparent' }}>
              <span style={{ fontSize: 22 }}>{r.icono}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.sub}</div>
              </div>
              <span style={{ background: 'var(--surface2)', color: 'var(--muted)', fontSize: 9, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{r.tipo}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const kbdStyle = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '1px 6px', fontSize: 10, color: 'var(--muted)', marginRight: 4,
}
