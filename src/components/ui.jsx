// ============================================================
// PIEZAS COMUNES — para que las pantallas se vean de la misma familia
// ============================================================
// Hoy cada pantalla arma su encabezado, sus KPIs y sus tablas a mano:
// hay más de 5.000 `style={{…}}` sueltos solo en /admin, y por eso dos
// pantallas que hacen lo mismo se ven un poco distinto. Estas piezas son
// el molde compartido: se usan de a poco, pantalla por pantalla.
//
// NO cambian ninguna cuenta ni ninguna consulta. Son presentación.
//
// Reglas de la casa que respetan:
//  · Los `numeric` de Supabase llegan como STRING → todo pasa por Number()
//    antes de formatear (nunca .toFixed directo). Regla 1.
//  · Los importes y los kilos van en monoespaciada tabular: así la coma
//    decimal cae siempre en la misma columna y una cifra se lee de un
//    vistazo sin tener que contar dígitos.
//
// El "tono" es el estado del número, y es el mismo vocabulario en todas
// las piezas (KPI, Chip y Barra):
//    ''      neutro
//    'oro'   el número principal de la pantalla
//    'bien'  como tiene que estar
//    'ojo'   para mirar
//    'mal'   hay un problema
// ============================================================
import { fmtPrecio, fmtKg } from '../lib/formatos'

// Encabezado de módulo: ícono, título, bajada y los botones a la derecha.
// Que todas las pantallas abran igual — aprender una es aprender el resto.
export function Pagina({ icon, titulo, bajada, acciones, children }) {
  return (
    <div className="fx-pagina">
      <div className="fx-pagina-head">
        {icon && <div className="fx-pagina-icon">{icon}</div>}
        <div className="fx-pagina-txt">
          <h1>{titulo}</h1>
          {bajada && <p>{bajada}</p>}
        </div>
        {acciones && <div className="fx-pagina-acc">{acciones}</div>}
      </div>
      {children}
    </div>
  )
}

// Fila de números grandes.
export function KPIs({ children }) {
  return <div className="fx-kpis">{children}</div>
}

// Un número grande.
//
// `tono` pinta el borde Y el número (es el estado: bien / ojo / mal).
// `color` existe para los KPIs cuyo color NO es un estado sino una
// categoría — "cajas CB" en celeste, "fijos" en ámbar — y en ese caso
// pisa solo el color del número, sin tocar el borde.
export function KPI({ label, valor, sub, tono = '', color }) {
  return (
    <div className={`fx-kpi ${tono}`}>
      <div className="fx-kpi-label">{label}</div>
      <div className="fx-kpi-valor" style={color ? { color } : undefined}>{valor}</div>
      {sub && <div className="fx-kpi-sub">{sub}</div>}
    </div>
  )
}

// Panel con título — para agrupar sin inventar una pantalla nueva.
// Es el reemplazo de .card + .card-title, con lugar para algo a la derecha.
export function Bloque({ titulo, extra, children, className = '' }) {
  return (
    <section className={`fx-bloque ${className}`}>
      {(titulo || extra) && (
        <div className="fx-bloque-head">
          {titulo && <h2>{titulo}</h2>}
          {extra && <div className="fx-bloque-extra">{extra}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

// Tabla estándar. `cols` = [{ k, label, ancho, num, render }]
//  · num: alinea a la derecha y usa la monoespaciada (para plata y kilos)
//  · render: recibe la fila y devuelve lo que va en la celda
export function Tabla({ cols, filas, vacio = 'Sin datos en el período.', onFila }) {
  if (!filas || !filas.length) return <div className="fx-vacio">{vacio}</div>
  return (
    <div className="fx-tabla-wrap">
      <table className="fx-tabla">
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.k} className={c.num ? 'num' : ''} style={c.ancho ? { width: c.ancho } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr
              key={f.id ?? i}
              className={onFila ? 'clic' : ''}
              onClick={onFila ? () => onFila(f) : undefined}
            >
              {cols.map(c => (
                <td key={c.k} className={c.num ? 'num' : ''}>
                  {c.render ? c.render(f) : f[c.k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Estado de una fila: al día, vencido, anulado, en cartera…
export function Chip({ children, tono = '' }) {
  return <span className={`fx-chip ${tono}`}>{children}</span>
}

// Barra de proporción — rankings y comparativas.
// Mínimo 2% de ancho para que una fila con valor chico igual se vea.
export function Barra({ valor, max, tono = 'oro' }) {
  const v = Number(valor) || 0
  const m = Number(max) || 0
  const pct = m > 0 ? Math.max(2, Math.min(100, Math.round((v / m) * 100))) : 0
  return (
    <div className="fx-barra">
      <div className={`fx-barra-fill ${tono}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// Lo que el sistema todavía no hace o la salvedad de un número, dicho en
// la pantalla y no en un comentario del código.
export function Nota({ children }) {
  return <div className="fx-nota">{children}</div>
}

// Atajos de formato, con Number() adentro (regla 1: los numeric llegan string)
export const money = n => fmtPrecio(Number(n) || 0)
export const kilos = n => fmtKg(Number(n) || 0)
export const pct = n => `${(Number(n) || 0).toFixed(1)}%`
