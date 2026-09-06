// ============================================================
// COSTO CON MERMA — a cuánto queda el kilo después de despostar
// ============================================================
// Para las franquicias, sobre todo: le compran las piezas a la central a un
// precio por kilo, pero ese NO es lo que les cuesta el kilo que venden. Al
// romper la pieza en cortes se va hueso, grasa y recorte, así que la misma
// plata queda repartida entre menos kilos.
//
//     costo real del kilo = precio pagado ÷ (1 − merma)
//
// Los % son los que define la central: acá se muestran de SÓLO LECTURA. Lo
// único que se toca es el precio, que es propio de cada boca — la central paga
// más barato y la sucursal, que le recompra, calcula sobre lo que ella pagó.
//
// El precio viene precargado con la última compra de esa pieza (la entrada más
// reciente de ESTA boca, que la RLS ya filtra), y se puede editar para simular.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtPrecio, parseNumero } from '../lib/formatos'

// Nombre de la pieza en la config de mermas → tipo con el que entra al stock.
const TIPO_DE_PIEZA = {
  'Pierna': 'pieza_pierna',
  'Cuarto Pistola': 'pieza_cuarto_pistola',
  'Costillar Completo': 'pieza_costillar',
  'Cortito': 'pieza_cortito',
  'Costeletal con Lomo': 'pieza_costeletal',
  'Parrillero': 'pieza_parrillero',
  'Paleta': 'pieza_paleta',
}

export default function CostoConMerma({ config }) {
  const [precios, setPrecios] = useState({})     // { tipo: precio_kg de la última compra }
  const [editados, setEditados] = useState({})   // { clave: texto tipeado }
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      // Última compra de cada tipo. Se piden las entradas recientes y se toma
      // la primera de cada tipo: una sola consulta en vez de una por pieza.
      const { data } = await supabase.from('entradas_deposito')
        .select('tipo, precio_kg, fecha')
        .eq('eliminado', false)
        .gt('precio_kg', 0)
        .order('fecha', { ascending: false })
        .limit(400)
      if (!vivo) return
      const ultimo = {}
      ;(data || []).forEach(e => {
        // Los numeric de Supabase llegan como STRING.
        if (!ultimo[e.tipo]) ultimo[e.tipo] = { precio: Number(e.precio_kg) || 0, fecha: e.fecha }
      })
      setPrecios(ultimo)
      setCargando(false)
    }
    cargar()
    return () => { vivo = false }
  }, [])

  const filas = useMemo(() => {
    const out = []
    // Media res entera → cortes
    ;(config?.media_res || []).forEach(m => {
      const clave = 'mr_' + m.id
      out.push({
        clave, grupo: '🐄 Media res a cortes', nombre: m.label,
        merma: Number(m.merma) || 0,
        precioSugerido: precios['bovino_mr']?.precio || 0,
        fecha: precios['bovino_mr']?.fecha || null,
        propio: !!m.propio,
      })
    })
    // Pieza → cortes
    Object.entries(config?.piezas || {}).forEach(([nombre, pct]) => {
      const tipo = TIPO_DE_PIEZA[nombre]
      out.push({
        clave: 'pz_' + nombre, grupo: '🍖 Pieza a cortes', nombre,
        merma: Number(pct) || 0,
        precioSugerido: (tipo && precios[tipo]?.precio) || 0,
        fecha: (tipo && precios[tipo]?.fecha) || null,
      })
    })
    return out
  }, [config, precios])

  const grupos = useMemo(() => {
    const g = {}
    filas.forEach(f => { (g[f.grupo] = g[f.grupo] || []).push(f) })
    return g
  }, [filas])

  const th = { textAlign: 'left', padding: '7px 8px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)' }
  const td = { padding: '8px 8px', fontSize: 13, borderTop: '1px solid var(--border)' }
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 8px', fontSize: 13, width: 100, textAlign: 'right', boxSizing: 'border-box' }

  if (cargando) return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Cargando…</div>

  return (
    <div className="card">
      <div className="card-title">💲 Costo con merma</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
        Lo que pagás por kilo <strong>no</strong> es lo que te cuesta el kilo que vendés: al
        despostar se va hueso, grasa y recorte, y la misma plata queda repartida entre menos
        kilos. Acá ves a cuánto te queda el kilo real de cada cosa.
        <br />
        El <strong>%</strong> lo define la central y no se toca. El <strong>precio</strong> es tuyo:
        viene con el de tu última compra y lo podés cambiar para sacar cuentas.
      </div>

      {Object.entries(grupos).map(([grupo, items]) => (
        <div key={grupo} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{grupo}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Producto</th>
                <th style={{ ...th, textAlign: 'center' }}>Merma</th>
                <th style={{ ...th, textAlign: 'right' }}>Lo pagás a</th>
                <th style={{ ...th, textAlign: 'right' }}>Te queda a</th>
                <th style={{ ...th, textAlign: 'right' }}>Diferencia</th>
              </tr></thead>
              <tbody>
                {items.map(f => {
                  const texto = editados[f.clave]
                  const precio = texto !== undefined ? parseNumero(texto) : f.precioSugerido
                  // La merma nunca llega a 100, pero el guard evita un Infinity
                  // en pantalla si alguien carga un disparate.
                  const factor = f.merma < 100 ? 1 - f.merma / 100 : 0
                  const costo = factor > 0 ? precio / factor : 0
                  const recargo = precio > 0 && costo > 0 ? ((costo / precio) - 1) * 100 : 0
                  return (
                    <tr key={f.clave}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {f.nombre}
                        {f.propio && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}> · tuyo</span>}
                        {f.fecha && precio > 0 && texto === undefined && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>última compra {f.fecha.slice(8, 10)}/{f.fecha.slice(5, 7)}</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{f.merma}%</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input type="text" inputMode="decimal" style={inp}
                          value={texto !== undefined ? texto : (f.precioSugerido || '')}
                          placeholder="0"
                          onChange={e => setEditados(x => ({ ...x, [f.clave]: e.target.value }))} />
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: costo > 0 ? 'var(--gold)' : 'var(--muted)', fontSize: 15 }}>
                        {costo > 0 ? fmtPrecio(costo) : '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {costo > 0 ? `+${fmtPrecio(costo - precio)} · +${recargo.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        La cuenta es <strong>precio ÷ (1 − merma)</strong>. Con una pierna a {fmtPrecio(10000)} y 29% de
        merma, el kilo de corte te sale {fmtPrecio(10000 / 0.71)} — no {fmtPrecio(10000)}. Ese es el número
        sobre el que tenés que poner tu ganancia, no el de la factura.
      </div>
    </div>
  )
}
