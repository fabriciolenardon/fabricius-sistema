// ============================================================
// SIN FACTURAR — lo que se vendió y todavía no tiene comprobante
// ============================================================
// Vive arriba del listado de comprobantes, en Facturación → Facturas.
// Muestra las ventas del mostrador y los remitos mayoristas del período
// que no tienen factura, y con un botón abre el formulario de ARCA ya
// completo con los ítems y el importe de esa venta.
//
// Solo lee. El comprobante lo emite el formulario de siempre, contra la
// misma edge function de ARCA de siempre.
// ============================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fechaHoyARG, fechaRelativaARG } from '../lib/fechas'
import { fmtPrecio } from '../lib/formatos'
import { cargarSinFacturar, precargaDesdeVenta, precargaDesdeRemito } from '../lib/facturarVenta'
import { KPI, Bloque, Tabla, Chip } from './ui'

const PERIODOS = [
  { id: 'hoy', label: 'Hoy', dias: 0 },
  { id: '7d', label: '7 días', dias: 6 },
  { id: '30d', label: '30 días', dias: 29 },
]

const fmt$ = n => fmtPrecio(Number(n) || 0)

export default function SinFacturar({ onFacturar, recargar }) {
  const [periodo, setPeriodo] = useState('hoy')
  const [datos, setDatos] = useState({ ventas: [], remitos: [] })
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const hasta = fechaHoyARG()
    const dias = PERIODOS.find(p => p.id === periodo)?.dias || 0
    const desde = dias === 0 ? hasta : fechaRelativaARG(-dias)
    const [res, cli] = await Promise.all([
      cargarSinFacturar({ desde, hasta }),
      supabase.from('clientes').select('id, nombre, cuit, tipo'),
    ])
    setDatos(res)
    setClientes(cli.data || [])
    setCargando(false)
  }, [periodo])

  useEffect(() => { cargar() }, [cargar, recargar])

  // Las dos listas en una sola tabla: al que factura le da lo mismo si
  // salió del mostrador o de un remito, quiere verlo todo junto.
  const filas = useMemo(() => {
    const deVentas = datos.ventas.map(v => ({
      id: `v-${v.id}`,
      tipo: 'venta',
      fecha: v.fecha,
      hora: v.hora ? String(v.hora).slice(0, 5) : '',
      quien: v.cajero || 'Mostrador',
      detalle: (v.items || []).map(i => i.descripcion).filter(Boolean).join(', ') || 'Venta mostrador',
      total: Number(v.total) || 0,
      original: v,
    }))
    const deRemitos = datos.remitos.map(r => ({
      id: `r-${r.id}`,
      tipo: 'remito',
      fecha: r.fecha,
      hora: '',
      quien: r.cliente_nombre || 'Sin cliente',
      detalle: `Remito #${r.numero}` + ((r.items || []).length ? ` · ${(r.items || []).map(i => i.descripcion).filter(Boolean).join(', ')}` : ''),
      total: Number(r.total) || 0,
      original: r,
    }))
    return [...deVentas, ...deRemitos]
      .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora))
  }, [datos])

  const totalPendiente = filas.reduce((s, f) => s + f.total, 0)

  // async: la precarga del remito resuelve la contraparte fiscal por CUIT
  // contra la base antes de abrir el formulario.
  async function facturar(fila) {
    if (fila.tipo === 'venta') {
      onFacturar(precargaDesdeVenta(fila.original))
    } else {
      const cliente = clientes.find(c => c.id === fila.original.cliente_id)
      onFacturar(await precargaDesdeRemito(fila.original, cliente))
    }
  }

  const botonPeriodo = p => (
    <button key={p.id} onClick={() => setPeriodo(p.id)}
      style={{
        background: periodo === p.id ? 'var(--gold)' : 'var(--surface2)',
        color: periodo === p.id ? '#000' : 'var(--muted)',
        border: '1px solid ' + (periodo === p.id ? 'var(--gold)' : 'var(--border)'),
        borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
      }}>
      {p.label}
    </button>
  )

  return (
    <Bloque
      titulo="🧾 Sin facturar"
      extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {PERIODOS.map(botonPeriodo)}
          <button onClick={() => setAbierto(a => !a)}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
            {abierto ? '▲ Ocultar' : '▼ Ver'}
          </button>
        </div>
      }
    >
      {abierto && (
        <>
          <div className="fx-kpis">
            <KPI label="Ventas sin comprobante" valor={cargando ? '…' : filas.length}
                 sub={PERIODOS.find(p => p.id === periodo)?.label}
                 tono={filas.length ? 'ojo' : 'bien'} />
            <KPI label="Suman" valor={cargando ? '…' : fmt$(totalPendiente)}
                 sub="lo que todavía no se facturó" tono="oro" />
          </div>

          {cargando ? (
            <div className="fx-vacio">Buscando…</div>
          ) : (
            <Tabla
              filas={filas}
              vacio="Todo lo del período ya tiene su comprobante. ✅"
              cols={[
                { k: 'fecha', label: 'Fecha', ancho: 110, render: f => (
                  <div>
                    <b>{f.fecha.slice(8, 10)}/{f.fecha.slice(5, 7)}</b>
                    {f.hora && <span style={{ color: 'var(--muted)' }}> {f.hora}</span>}
                  </div>
                ) },
                { k: 'tipo', label: 'Origen', ancho: 110, render: f => (
                  <Chip tono={f.tipo === 'remito' ? 'oro' : ''}>
                    {f.tipo === 'remito' ? 'remito' : 'mostrador'}
                  </Chip>
                ) },
                { k: 'quien', label: 'Quién', ancho: 150, render: f => (
                  <span style={{ fontWeight: 600 }}>{f.quien}</span>
                ) },
                { k: 'detalle', label: 'Detalle', render: f => (
                  <span style={{
                    color: 'var(--muted)', fontSize: 12, display: 'block',
                    maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={f.detalle}>
                    {f.detalle}
                  </span>
                ) },
                { k: 'total', label: 'Total', num: true, ancho: 130, render: f => (
                  <b style={{ color: 'var(--gold)' }}>{fmt$(f.total)}</b>
                ) },
                { k: 'acc', label: '', ancho: 110, render: f => (
                  <button onClick={() => facturar(f)} className="btn btn-gold btn-sm">
                    Facturar
                  </button>
                ) },
              ]}
            />
          )}
        </>
      )}
    </Bloque>
  )
}
