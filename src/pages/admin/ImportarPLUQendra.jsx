// ============================================================
// IMPORTAR PLUs DESDE CSV DE QENDRA
// ============================================================
// Permite subir el CSV que Fabri importa a la balanza vía Qendra
// (formato: SECTOR;PLU;NOMBRE;...;PRECIO1;PRECIO2;...) y asigna el PLU
// a cada producto correspondiente en la tabla `precios` por matching
// de nombre.
//
// Regla estricta:
//   - NO crea productos nuevos
//   - NO modifica precios
//   - NO toca productos que no estén en el CSV
//   - SOLO asigna codigo_balanza a productos existentes con nombre
//     similar (matching estricto: nombre idéntico normalizado, prefijo
//     exacto, o primeros 2 tokens significativos coincidentes con
//     tolerancia singular/plural).
//
// Para los productos del CSV que NO encuentren match automático, Fabri
// puede asignarlos manualmente con un dropdown de productos del sistema,
// o saltarlos (después los asigna desde la UI clásica).
// ============================================================
import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// === Utilidades de normalización (mismas que LimpiezaDuplicados) ===
function normalizarFuerte(nombre) {
  return (nombre || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokensRaizIgual(a, b) {
  if (a === b) return true
  if (a.length < 5 || b.length < 5) return false
  const prefLen = Math.min(a.length, b.length) - 1
  if (prefLen < 6) return false
  if (a.slice(0, prefLen) !== b.slice(0, prefLen)) return false
  return Math.abs(a.length - b.length) <= 2
}

function esMatchEstricto(nombreA, nombreB) {
  const na = normalizarFuerte(nombreA)
  const nb = normalizarFuerte(nombreB)
  if (!na || !nb) return false
  if (na === nb) return true
  const ta = na.split(' ').filter(t => t.length >= 4)
  const tb = nb.split(' ').filter(t => t.length >= 4)
  if (ta.length === 0 || tb.length === 0) return false
  if (na.startsWith(nb + ' ') || nb.startsWith(na + ' ')) return true
  if (na.startsWith(nb) && (na.length - nb.length) <= 3) return true
  if (nb.startsWith(na) && (nb.length - na.length) <= 3) return true
  if (!tokensRaizIgual(ta[0], tb[0])) return false
  if (ta.length === 1 || tb.length === 1) return true
  if (tokensRaizIgual(ta[1], tb[1])) return true
  return false
}

// Tokens significativos (3+ caracteres) para similitud Jaccard
function tokensSignif(nombre) {
  return normalizarFuerte(nombre).split(' ').filter(t => t.length >= 3)
}

// Score de similitud para ranking del dropdown (0..1, mayor = más parecido)
function scoreSimilitud(nombreA, nombreB) {
  const ta = new Set(tokensSignif(nombreA))
  const tb = new Set(tokensSignif(nombreB))
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / new Set([...ta, ...tb]).size
}

// === Parser CSV Qendra ===
// Formato: SECTOR;PLU;NOMBRE;...
// Separador `;`. Maneja BOM. Comillas dobles para campos con `;` dentro.
function parsearCSV(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  return lineas.map(linea => {
    // Parser simple respetando comillas dobles
    const campos = []
    let actual = ''
    let dentroComillas = false
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i]
      if (c === '"') { dentroComillas = !dentroComillas; continue }
      if (c === ';' && !dentroComillas) { campos.push(actual); actual = ''; continue }
      actual += c
    }
    campos.push(actual)
    return campos
  }).filter(c => c.length >= 3 && /^\d+$/.test(c[1].trim()))
    .map(c => ({
      plu: parseInt(c[1].trim(), 10),
      nombre: (c[2] || '').trim(),
      sector: (c[0] || '').trim(),
    }))
}

export default function ImportarPLUQendra() {
  const [productos, setProductos] = useState([])
  const [csvFilas, setCsvFilas] = useState([])
  const [asignaciones, setAsignaciones] = useState({}) // { plu: productoId }
  const [loading, setLoading] = useState(false)
  const [importando, setImportando] = useState(false)
  const [progreso, setProgreso] = useState({ procesados: 0, total: 0, exitos: 0, errores: 0 })
  const [msg, setMsg] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [filtroSinMatch, setFiltroSinMatch] = useState(false)
  const [busquedaProducto, setBusquedaProducto] = useState({}) // { plu: query }

  async function cargarProductos() {
    setLoading(true)
    const { data, error } = await supabase.from('precios').select('id,nombre,categoria,codigo_balanza,precio_minorista,precio_mayorista').order('nombre')
    if (error) { showMsg('❌ ' + error.message, 'error') }
    setProductos(data || [])
    setLoading(false)
  }

  function showMsg(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 4000)
  }

  async function onArchivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const texto = await file.text()
    let filas
    try { filas = parsearCSV(texto) }
    catch (err) { showMsg('❌ Error parseando: ' + err.message, 'error'); return }

    if (filas.length === 0) {
      showMsg('❌ El CSV no tiene filas válidas (formato esperado: SECTOR;PLU;NOMBRE;...)', 'error')
      return
    }

    // Cargar productos del sistema si no están
    if (productos.length === 0) await cargarProductos()
    setCsvFilas(filas)

    // Pre-matching automático
    const prods = productos.length > 0 ? productos : (await supabase.from('precios').select('id,nombre,categoria,codigo_balanza,precio_minorista,precio_mayorista').order('nombre')).data || []
    if (productos.length === 0) setProductos(prods)

    const auto = {}
    for (const fila of filas) {
      const match = prods.find(p => p.codigo_balanza == null && esMatchEstricto(p.nombre, fila.nombre))
      if (match) auto[fila.plu] = match.id
    }
    setAsignaciones(auto)
    showMsg(`✅ CSV cargado: ${filas.length} filas. ${Object.keys(auto).length} matches automáticos.`, 'success')
  }

  // Datos derivados
  const sinPLUDisponibles = useMemo(() =>
    productos.filter(p => p.codigo_balanza == null && !p.nombre?.startsWith('ZZ_')),
    [productos]
  )

  const filasFiltradas = useMemo(() => {
    if (!filtroSinMatch) return csvFilas
    return csvFilas.filter(f => !asignaciones[f.plu])
  }, [csvFilas, asignaciones, filtroSinMatch])

  function getProducto(id) {
    return productos.find(p => p.id === id)
  }

  function cambiarAsignacion(plu, productoId) {
    setAsignaciones(a => ({ ...a, [plu]: productoId || undefined }))
  }

  function candidatosParaPlu(filaCsv, query) {
    const q = (query || '').toLowerCase().trim()
    // Si hay query, filtrar por substring (búsqueda manual del usuario)
    if (q) {
      return sinPLUDisponibles
        .filter(p => p.nombre.toLowerCase().includes(q))
        .slice(0, 30)
    }
    // Sin query: ordenar por similitud al nombre del CSV (los más parecidos arriba)
    return sinPLUDisponibles
      .map(p => ({ ...p, _score: scoreSimilitud(p.nombre, filaCsv.nombre) }))
      .sort((a, b) => {
        // Primero por similitud descendente
        if (b._score !== a._score) return b._score - a._score
        // Después por nombre
        return a.nombre.localeCompare(b.nombre)
      })
      .slice(0, 30)
  }

  async function aplicar() {
    const asignacionesValidas = Object.entries(asignaciones).filter(([, id]) => id)
    if (asignacionesValidas.length === 0) {
      showMsg('No hay ningún match para aplicar.', 'error')
      return
    }
    if (!confirm(
      `Asignar ${asignacionesValidas.length} PLU a productos del sistema.\n\n` +
      `NO se modifican precios ni categorías. Solo se asigna codigo_balanza.\n\n` +
      `¿Continuar?`
    )) return

    setImportando(true)
    setProgreso({ procesados: 0, total: asignacionesValidas.length, exitos: 0, errores: 0 })

    let exitos = 0, errores = 0
    const erroresDetalle = []

    for (let i = 0; i < asignacionesValidas.length; i++) {
      const [pluStr, productoId] = asignacionesValidas[i]
      const plu = parseInt(pluStr, 10)
      try {
        const { error } = await supabase.from('precios')
          .update({ codigo_balanza: plu, updated_at: new Date().toISOString() })
          .eq('id', productoId)
        if (error) throw error
        exitos++
      } catch (e) {
        errores++
        const prod = getProducto(productoId)
        erroresDetalle.push(`PLU ${plu} → "${prod?.nombre}": ${e.message}`)
      }
      setProgreso({ procesados: i + 1, total: asignacionesValidas.length, exitos, errores })
    }

    setImportando(false)
    await cargarProductos()
    let resumen = `✅ Listo: ${exitos} PLUs asignados, ${errores} con error.`
    if (errores > 0) {
      resumen += '\n\nDetalle:\n' + erroresDetalle.slice(0, 10).join('\n')
      alert(resumen)
    } else {
      showMsg(resumen, 'success')
    }
  }

  function limpiar() {
    if (!confirm('Limpiar el CSV cargado y las asignaciones pendientes?')) return
    setCsvFilas([]); setAsignaciones({}); setFileName(null); setBusquedaProducto({})
  }

  // Estilos
  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: "'DM Sans',sans-serif" }
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 12 }

  const totalAsig = Object.values(asignaciones).filter(Boolean).length

  return (
    <div>
      {msg && (
        <div style={{
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${msg.tipo === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600,
        }}>{msg.texto}</div>
      )}

      {/* Instrucciones */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📥 Importar PLUs desde CSV de Qendra</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
          Subí el CSV que importás a Qendra para la balanza (formato <code>SECTOR;PLU;NOMBRE;...</code>). El sistema busca cada producto en tu lista por nombre y le asigna el PLU correspondiente.
        </p>
        <ul style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 18 }}>
          <li>✅ <strong>NO crea productos nuevos</strong> — si un nombre no aparece en tu lista, queda sin asignar.</li>
          <li>✅ <strong>NO modifica precios</strong> — solo asigna el campo <code>codigo_balanza</code>.</li>
          <li>✅ Para los que no matchean automáticamente, podés elegir el producto a mano con el buscador.</li>
        </ul>
      </div>

      {/* Subir archivo */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">1️⃣ Subir CSV</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ padding: '10px 20px', background: 'var(--gold)', color: '#000', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            📂 Elegir archivo CSV
            <input type="file" accept=".csv,text/csv" onChange={onArchivo} style={{ display: 'none' }} />
          </label>
          {fileName && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fileName} · {csvFilas.length} filas</span>}
          {csvFilas.length > 0 && (
            <button onClick={limpiar} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              ✕ Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Preview y asignación */}
      {csvFilas.length > 0 && (
        <>
          <div className="card" style={{ marginBottom: 16, background: 'linear-gradient(180deg, rgba(125,255,125,0.04), transparent)', border: '1px solid #2d5a2d' }}>
            <div className="card-title">2️⃣ Revisar y aplicar</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{totalAsig}</strong> / {csvFilas.length} con producto asignado
              </div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={filtroSinMatch} onChange={e => setFiltroSinMatch(e.target.checked)} />
                Mostrar solo sin match
              </label>
              <button
                onClick={aplicar}
                disabled={importando || totalAsig === 0}
                style={{ padding: '10px 20px', background: '#7dff7d', color: '#000', border: 'none', borderRadius: 8, cursor: importando ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13, opacity: importando ? 0.6 : 1 }}>
                ✅ Aplicar asignaciones ({totalAsig})
              </button>
            </div>
            {importando && (
              <div style={{ padding: '10px 14px', background: 'rgba(125,255,125,0.08)', border: '1px solid #2d5a2d', borderRadius: 8, marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>⏳ Asignando PLUs...</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {progreso.procesados} / {progreso.total} · ✅ {progreso.exitos} OK · ❌ {progreso.errores} con error
                </div>
                <div style={{ background: '#222', borderRadius: 4, height: 6, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ background: 'var(--gold)', height: '100%', width: `${progreso.total > 0 ? (progreso.procesados / progreso.total * 100) : 0}%`, transition: 'width 0.2s' }} />
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>PLU</th>
                  <th>Nombre en CSV</th>
                  <th>→ Producto del sistema (asignación)</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map(fila => {
                  const idAsignado = asignaciones[fila.plu]
                  const prodAsig = getProducto(idAsignado)
                  const query = busquedaProducto[fila.plu] || ''
                  const candidatos = candidatosParaPlu(fila, query)
                  return (
                    <tr key={fila.plu} style={{ background: prodAsig ? 'rgba(125,255,125,0.05)' : 'transparent' }}>
                      <td><span style={{ background: 'var(--gold)', color: '#000', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{fila.plu}</span></td>
                      <td style={{ fontSize: 13 }}>{fila.nombre}</td>
                      <td>
                        {prodAsig ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: '#7dff7d', fontWeight: 600, fontSize: 13 }}>✓ {prodAsig.nombre}</span>
                            <button onClick={() => cambiarAsignacion(fila.plu, null)} style={{ padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
                              cambiar
                            </button>
                          </div>
                        ) : (
                          <div>
                            <input
                              type="text"
                              placeholder="Buscar producto..."
                              value={query}
                              onChange={e => setBusquedaProducto(b => ({ ...b, [fila.plu]: e.target.value }))}
                              style={{ ...inp, width: '50%', marginBottom: 4 }}
                            />
                            <select
                              onChange={e => cambiarAsignacion(fila.plu, parseInt(e.target.value, 10) || null)}
                              value={idAsignado || ''}
                              style={{ ...inp, width: '100%' }}>
                              <option value="">— Sin asignar —</option>
                              {candidatos.map(p => {
                                const pctTxt = p._score > 0 ? ` — ${Math.round(p._score * 100)}% match` : ''
                                return (
                                  <option key={p.id} value={p.id}>
                                    {p.nombre} ({p.categoria}){pctTxt}
                                  </option>
                                )
                              })}
                            </select>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
