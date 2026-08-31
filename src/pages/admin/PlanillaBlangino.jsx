// ============================================================
// PLANILLA BLANGINO — registro de ventas con el convenio
// ============================================================
// Pedido de Fabricio (31/08/2026): un módulo en Caja, al lado del
// Ticket Manual, que vaya anotando cada venta hecha con el descuento
// Blangino. Por venta muestra: total de la venta (sin descuento), lo
// cobrado con el −10%, y el desglose del 10% mitad y mitad:
//   · 5% FAB (lo absorbe Fabricius)
//   · 5% BLAN (se le pasa a Blangino y lo reintegra)
// Ej.: venta $90.000 → 10% = $9.000 → cliente paga $81.000 →
// $4.500 Fabricius + $4.500 Blangino.
// Con los totales del período y export CSV/impresión, armar la
// planilla para Blangino es leer la última fila.
//
// Fuente: ventas_minoristas con convenio='blangino'. Las anuladas se
// BORRAN de la tabla (lib/anularVenta), así que acá no aparecen.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { fechaHoyARG } from '../../lib/fechas'
import { fmtPrecio } from '../../lib/formatos'

const fmt = v => fmtPrecio(Number(v) || 0, { decimales: 2 })

// Rangos rápidos — semana lun→dom con reloj ARG (regla de la casa).
function rangoRapido(modo) {
  const hoy = fechaHoyARG()
  const d = new Date(hoy + 'T12:00:00')
  const iso = f => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
  if (modo === 'semana') {
    const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return { desde: iso(lunes), hasta: hoy }
  }
  if (modo === 'semana_ant') {
    const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7)
    const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6)
    return { desde: iso(lunes), hasta: iso(domingo) }
  }
  if (modo === 'mes_ant') {
    const primero = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    const ultimo = new Date(d.getFullYear(), d.getMonth(), 0)
    return { desde: iso(primero), hasta: iso(ultimo) }
  }
  // mes en curso
  return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
}

const ddmm = f => f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : ''

export default function PlanillaBlangino() {
  const [modo, setModo] = useState('mes')
  const [rango, setRango] = useState(rangoRapido('mes'))
  const [ventas, setVentas] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      // fetchAllRows: un período largo puede pasar las 1000 filas y el
      // total de la planilla quedaría corto en silencio.
      const { data, error } = await fetchAllRows(() => supabase
        .from('ventas_minoristas').select('id, fecha, hora, total, descuento_monto, convenio_empleado, convenio_legajo')
        .eq('convenio', 'blangino')
        .gte('fecha', rango.desde).lte('fecha', rango.hasta)
        .order('fecha', { ascending: false }).order('hora', { ascending: false }))
      if (!vivo) return
      if (error) console.error(error)
      setVentas(data || [])
      setCargando(false)
    }
    cargar()
    return () => { vivo = false }
  }, [rango.desde, rango.hasta])

  // Números de cada venta. `total` guarda lo COBRADO (neto, con el −10% ya
  // hecho) y `descuento_monto` guarda los $ del 10% — ver cerrarVenta en Caja.
  const filas = ventas.map(v => {
    const cobrado = Number(v.total) || 0
    const descuento = Number(v.descuento_monto) || 0
    return {
      ...v,
      cobrado,
      descuento,
      totalVenta: cobrado + descuento,
      fab: descuento / 2,
      blan: descuento / 2,
    }
  })
  const tot = filas.reduce((a, f) => ({
    totalVenta: a.totalVenta + f.totalVenta, cobrado: a.cobrado + f.cobrado,
    descuento: a.descuento + f.descuento, fab: a.fab + f.fab, blan: a.blan + f.blan,
  }), { totalVenta: 0, cobrado: 0, descuento: 0, fab: 0, blan: 0 })

  function elegirModo(m) {
    setModo(m)
    if (m !== 'custom') setRango(rangoRapido(m))
  }

  function exportarCSV() {
    const header = 'Fecha;Hora;Empleado;Legajo;Total venta;Descuento 10%;Cobrado;5% Fabricius;5% Blangino\n'
    const num = n => String((Number(n) || 0).toFixed(2)).replace('.', ',')
    const rows = filas.map(f =>
      `${f.fecha};${f.hora || ''};"${f.convenio_empleado || ''}";"${f.convenio_legajo || ''}";${num(f.totalVenta)};${num(f.descuento)};${num(f.cobrado)};${num(f.fab)};${num(f.blan)}`
    ).join('\n')
    const totales = `\nTOTALES;;;;${num(tot.totalVenta)};${num(tot.descuento)};${num(tot.cobrado)};${num(tot.fab)};${num(tot.blan)}`
    const blob = new Blob(['﻿' + header + rows + totales], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Planilla_Blangino_${rango.desde}_${rango.hasta}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function imprimir() {
    const w = window.open('', '_blank')
    if (!w) return
    const filasHtml = filas.map(f => `<tr>
      <td>${ddmm(f.fecha)} ${String(f.hora || '').slice(0, 5)}</td>
      <td>${f.convenio_empleado || ''} (Leg. ${f.convenio_legajo || '—'})</td>
      <td class="r">${fmt(f.totalVenta)}</td>
      <td class="r">${fmt(f.descuento)}</td>
      <td class="r">${fmt(f.cobrado)}</td>
      <td class="r">${fmt(f.fab)}</td>
      <td class="r">${fmt(f.blan)}</td>
    </tr>`).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Planilla Blangino</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 24px; }
        h2 { margin: 0 0 2px; } .sub { color: #555; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #999; padding: 5px 8px; }
        th { background: #eee; text-align: left; } .r { text-align: right; }
        tfoot td { font-weight: bold; background: #f5f5f5; }
      </style></head><body>
      <h2>Carnicerías Fabricius — Convenio Blangino</h2>
      <div class="sub">Período ${ddmm(rango.desde)} al ${ddmm(rango.hasta)} · ${filas.length} venta(s) · El 5% Blangino es el monto a reintegrar por la firma.</div>
      <table><thead><tr><th>Fecha</th><th>Empleado</th><th class="r">Total venta</th><th class="r">Desc. 10%</th><th class="r">Cobrado</th><th class="r">5% Fabricius</th><th class="r">5% Blangino</th></tr></thead>
      <tbody>${filasHtml}</tbody>
      <tfoot><tr><td colspan="2">TOTALES</td><td class="r">${fmt(tot.totalVenta)}</td><td class="r">${fmt(tot.descuento)}</td><td class="r">${fmt(tot.cobrado)}</td><td class="r">${fmt(tot.fab)}</td><td class="r">${fmt(tot.blan)}</td></tr></tfoot>
      </table></body></html>`)
    w.document.close()
    w.print()
  }

  const th = { textAlign: 'right', fontSize: 11, color: 'var(--muted)', padding: '8px 10px', letterSpacing: 0.5, whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' }
  const btn = activo => ({
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
    fontFamily: "'DM Sans',sans-serif",
    background: activo ? '#3a6ea5' : 'var(--surface2)', color: activo ? '#fff' : 'var(--text)',
    border: `1px solid ${activo ? '#3a6ea5' : 'var(--border)'}`,
  })

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-title" style={{ color: '#7ec8ff' }}>🔵 Planilla Blangino</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        Ventas con el convenio (−10%). El descuento se reparte mitad y mitad: el <strong>5% Blangino</strong> es lo que reintegra la firma, el <strong>5% Fabricius</strong> lo absorbemos nosotros.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button style={btn(modo === 'semana')} onClick={() => elegirModo('semana')}>Semana actual</button>
        <button style={btn(modo === 'semana_ant')} onClick={() => elegirModo('semana_ant')}>Semana anterior</button>
        <button style={btn(modo === 'mes')} onClick={() => elegirModo('mes')}>Mes en curso</button>
        <button style={btn(modo === 'mes_ant')} onClick={() => elegirModo('mes_ant')}>Mes anterior</button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 4 }}>
          <input type="date" value={rango.desde} onChange={e => { setModo('custom'); setRango(r => ({ ...r, desde: e.target.value })) }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 8px', fontSize: 12 }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
          <input type="date" value={rango.hasta} onChange={e => { setModo('custom'); setRango(r => ({ ...r, hasta: e.target.value })) }}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 8px', fontSize: 12 }} />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={btn(false)} onClick={exportarCSV} disabled={!filas.length}>📥 CSV</button>
          <button style={btn(false)} onClick={imprimir} disabled={!filas.length}>🖨️ Imprimir</button>
        </div>
      </div>

      {cargando ? (
        <div className="empty">Cargando ventas Blangino…</div>
      ) : !filas.length ? (
        <div className="empty">No hay ventas con descuento Blangino entre el {ddmm(rango.desde)} y el {ddmm(rango.hasta)}.</div>
      ) : (
        <>
          {/* Resumen del período — el número que se le pasa a Blangino, arriba de todo */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {[
              ['Ventas', String(filas.length), 'var(--text)'],
              ['Total vendido', fmt(tot.totalVenta), 'var(--text)'],
              ['Descuento 10%', fmt(tot.descuento), '#7ec8ff'],
              ['5% Fabricius', fmt(tot.fab), 'var(--gold)'],
              ['5% Blangino (a reintegrar)', fmt(tot.blan), '#7dff7d'],
            ].map(([label, valor, color]) => (
              <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 16px', minWidth: 130 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 0.5 }}>{label.toUpperCase()}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color }}>{valor}</div>
              </div>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Fecha</th>
                  <th style={{ ...th, textAlign: 'left' }}>Empleado</th>
                  <th style={th}>Total venta</th>
                  <th style={th}>Desc. 10%</th>
                  <th style={th}>Cobrado (−10%)</th>
                  <th style={th}>5% FAB</th>
                  <th style={th}>5% BLAN</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }}>{ddmm(f.fecha)} {String(f.hora || '').slice(0, 5)}</td>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>
                      {f.convenio_empleado || '—'}
                      <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}> · Leg. {f.convenio_legajo || '—'}</span>
                    </td>
                    <td style={td}>{fmt(f.totalVenta)}</td>
                    <td style={{ ...td, color: '#7ec8ff' }}>−{fmt(f.descuento)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmt(f.cobrado)}</td>
                    <td style={{ ...td, color: 'var(--gold)' }}>{fmt(f.fab)}</td>
                    <td style={{ ...td, color: '#7dff7d' }}>{fmt(f.blan)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 800 }} colSpan={2}>TOTALES · {filas.length} venta{filas.length === 1 ? '' : 's'}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{fmt(tot.totalVenta)}</td>
                  <td style={{ ...td, fontWeight: 800, color: '#7ec8ff' }}>−{fmt(tot.descuento)}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{fmt(tot.cobrado)}</td>
                  <td style={{ ...td, fontWeight: 800, color: 'var(--gold)' }}>{fmt(tot.fab)}</td>
                  <td style={{ ...td, fontWeight: 800, color: '#7dff7d' }}>{fmt(tot.blan)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
