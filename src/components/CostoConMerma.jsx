// ============================================================
// COSTO CON MERMA — a cuánto queda el kilo después de despostar
// ============================================================
// Para las franquicias, sobre todo: le compran a la central a un precio por
// kilo, pero ese NO es lo que les cuesta el kilo que venden. Al despostar se
// va hueso, grasa y recorte, así que la misma plata queda repartida entre
// menos kilos.
//
//     costo real del kilo = precio pagado ÷ (1 − merma)
//
// DE DÓNDE SALE EL PRECIO (confirmado por Fabricio, 06/09/2026):
//   · Una SUCURSAL le compra a la central, así que su precio es el de la lista
//     `precio_carniceria` del catálogo compartido — el mismo que le sale en el
//     remito. NO sale de sus entradas: las piezas le llegan por remito de la
//     central y no las carga como ingreso, así que ahí no hay nada.
//   · La CENTRAL le compra al frigorífico: su precio es el de su última compra
//     en entradas_deposito. Para ella `precio_carniceria` es precio de VENTA,
//     no de costo, y usarlo daría un número sin sentido.
//
// Los % son los que define la central y acá se muestran de SÓLO LECTURA.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtPrecio, parseNumero } from '../lib/formatos'
import { useAuth } from '../context/AuthContext'

// Nombre de la pieza en la config de mermas → cómo reconocer su producto en la
// lista de precios y con qué tipo entra al stock. El match del producto es por
// palabra clave normalizada para que aguante un cambio de nombre.
const PIEZAS = {
  'Pierna':              { kw: 'PIERNA',     tipo: 'pieza_pierna' },
  'Cuarto Pistola':      { kw: 'CUARTO',     tipo: 'pieza_cuarto_pistola' },
  'Costillar Completo':  { kw: 'COSTILLARCOMPLETO', tipo: 'pieza_costillar' },
  'Cortito':             { kw: 'CORTITO',    tipo: 'pieza_cortito' },
  'Costeletal con Lomo': { kw: 'COSTELETAL', tipo: 'pieza_costeletal' },
  'Parrillero':          { kw: 'PARRILLERO', tipo: 'pieza_parrillero' },
  'Paleta':              { kw: 'PALETA',     tipo: 'pieza_paleta' },
}
const norm = s => String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '')

export default function CostoConMerma({ config }) {
  const { isSucursal } = useAuth()
  const [precios, setPrecios] = useState({})     // { clave: { precio, nota } }
  const [editados, setEditados] = useState({})
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const out = {}
      if (isSucursal) {
        // Lo que le cobra la central: la lista de carnicerías del catálogo
        // compartido (sucursal_id NULL). Es el precio del remito.
        const { data } = await supabase.from('precios')
          .select('nombre, categoria, precio_carniceria')
          .in('categoria', ['bovino_mr', 'bovino_pieza'])
          .is('sucursal_id', null)
        const lista = (data || []).filter(p => Number(p.precio_carniceria) > 0)
        const mr = lista.find(p => p.categoria === 'bovino_mr')
        if (mr) out.bovino_mr = { precio: Number(mr.precio_carniceria), nota: 'lista de carnicerías' }
        Object.entries(PIEZAS).forEach(([nombre, def]) => {
          const prod = lista.find(p => p.categoria === 'bovino_pieza' && norm(p.nombre).includes(def.kw))
          if (prod) out['pz_' + nombre] = { precio: Number(prod.precio_carniceria), nota: 'lista de carnicerías' }
        })
      } else {
        // La central compra al frigorífico: su costo es su última entrada.
        const { data } = await supabase.from('entradas_deposito')
          .select('tipo, precio_kg, fecha')
          .eq('eliminado', false).gt('precio_kg', 0)
          .order('fecha', { ascending: false }).limit(400)
        const ultimo = {}
        ;(data || []).forEach(e => {
          // Los numeric de Supabase llegan como STRING.
          if (!ultimo[e.tipo]) ultimo[e.tipo] = { precio: Number(e.precio_kg) || 0, fecha: e.fecha }
        })
        if (ultimo.bovino_mr) out.bovino_mr = { precio: ultimo.bovino_mr.precio, nota: 'tu última compra ' + fFecha(ultimo.bovino_mr.fecha) }
        Object.entries(PIEZAS).forEach(([nombre, def]) => {
          const u = ultimo[def.tipo]
          if (u) out['pz_' + nombre] = { precio: u.precio, nota: 'tu última compra ' + fFecha(u.fecha) }
        })
      }
      if (!vivo) return
      setPrecios(out)
      setCargando(false)
    }
    cargar()
    return () => { vivo = false }
  }, [isSucursal])

  const filas = useMemo(() => {
    const out = []
    ;(config?.media_res || []).forEach(m => {
      out.push({
        clave: 'mr_' + m.id, grupo: '🐄 Media res a cortes', nombre: m.label,
        merma: Number(m.merma) || 0, ref: precios.bovino_mr, propio: !!m.propio,
      })
    })
    Object.entries(config?.piezas || {}).forEach(([nombre, pct]) => {
      out.push({
        clave: 'pz_' + nombre, grupo: '🍖 Pieza a cortes', nombre,
        merma: Number(pct) || 0, ref: precios['pz_' + nombre],
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
        despostar se va hueso, grasa y recorte, y la misma plata queda repartida entre menos kilos.
        <br />
        El <strong>%</strong> lo define la central y no se toca. El <strong>precio</strong> viene{' '}
        {isSucursal ? 'de la lista con la que te vende la central' : 'de tu última compra'} y lo
        podés cambiar para sacar cuentas.
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
                  const base = f.ref?.precio || 0
                  const precio = texto !== undefined ? parseNumero(texto) : base
                  // El guard evita un Infinity en pantalla si alguien carga un
                  // disparate en el %.
                  const factor = f.merma < 100 ? 1 - f.merma / 100 : 0
                  const costo = factor > 0 ? precio / factor : 0
                  const recargo = precio > 0 && costo > 0 ? ((costo / precio) - 1) * 100 : 0
                  return (
                    <tr key={f.clave}>
                      <td style={{ ...td, fontWeight: 600 }}>
                        {f.nombre}
                        {f.propio && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}> · tuyo</span>}
                        {f.ref?.nota && texto === undefined && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{f.ref.nota}</div>
                        )}
                        {!f.ref && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>sin precio cargado — poné el tuyo</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{f.merma}%</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input type="text" inputMode="decimal" style={inp}
                          value={texto !== undefined ? texto : (base || '')}
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
        La cuenta es <strong>precio ÷ (1 − merma)</strong>. Ese es el número sobre el que va tu
        ganancia, no el del remito.
      </div>
    </div>
  )
}

function fFecha(f) {
  if (!f || !/^\d{4}-\d{2}-\d{2}/.test(String(f))) return ''
  const [y, m, d] = String(f).slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}
