// ============================================================
// FACTURACIÓN — Módulo de control fiscal multi-cuenta
// ============================================================
// Maneja varias cuentas (monotributistas + SAS), permite:
//   - Crear / editar cuentas con CUIT y datos clave
//   - Cargar facturas emitidas/recibidas por cuenta
//   - Cargar impuestos y tasas pagados
//   - Alertas automáticas cuando una cuenta se acerca al tope
//     de monotributo (semáforo 70/85/95%)
//   - Importador CSV opcional para volcado del contador
// ============================================================
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import Paginador, { usePaginacion } from '../../components/Paginador'
import {
  CATEGORIAS, TOPE_MAX_ABSOLUTO, PRECIO_UNITARIO_MAX,
  VIGENCIA_DESDE, VIGENCIA_HASTA,
  categoriaSugerida, cuotaMensual, topeAnual, estadoSemaforo,
  proximaRecategorizacion,
} from '../../lib/monotributo2026'

const fmt$ = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')
const fmtPct = n => (n || 0).toFixed(1) + '%'
const fmtFecha = d => d ? new Date(d).toLocaleDateString('es-AR') : '—'
const hoyISO = () => new Date().toISOString().split('T')[0]
const haceUnAno = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 12)
  return d.toISOString().split('T')[0]
}

const TIPOS_CUENTA = [
  { v: 'monotributo',           l: '📘 Monotributo' },
  { v: 'responsable_inscripto', l: '📕 Responsable Inscripto' },
  { v: 'sas',                   l: '🏢 SAS' },
  { v: 'exento',                l: '🟢 Exento' },
]

const CONCEPTOS_IMPUESTO = [
  { v: 'monotributo',         l: '📘 Cuota Monotributo' },
  { v: 'iva',                 l: '📕 IVA (DDJJ)' },
  { v: 'ganancias',           l: '📕 Ganancias' },
  { v: 'iibb',                l: '🏛️ IIBB Local' },
  { v: 'iibb_convenio',       l: '🏛️ IIBB Convenio Multilateral' },
  { v: 'seguridad_higiene',   l: '🏢 Seguridad e Higiene' },
  { v: 'tasa_municipal',      l: '🏢 Tasa Municipal' },
  { v: 'sicore',              l: '💳 SICORE' },
  { v: 'sircreb',             l: '💳 SIRCREB' },
  { v: 'otro',                l: '— Otro' },
]

const TIPOS_COMPROBANTE = ['A','B','C','E','M','Ticket','NCA','NCB','NCC','NDA','NDB','NDC','Otro']

const inp = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif",
  fontSize: 14, width: '100%', boxSizing: 'border-box',
}

export default function Facturacion() {
  const [tab, setTab] = useState('cuentas') // 'cuentas' | 'facturas' | 'impuestos' | 'importar'
  const [cuentas, setCuentas] = useState([])
  const [facturas, setFacturas] = useState([])
  const [impuestos, setImpuestos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarTodo() }, [])

  async function cargarTodo() {
    setLoading(true)
    const [{ data: cs }, { data: fs }, { data: ps }] = await Promise.all([
      supabase.from('cuentas_fiscales').select('*').order('nombre'),
      supabase.from('facturas').select('*').order('fecha', { ascending: false }),
      supabase.from('impuestos_pagados').select('*').order('fecha_pago', { ascending: false }),
    ])
    setCuentas(cs || [])
    setFacturas(fs || [])
    setImpuestos(ps || [])
    setLoading(false)
  }

  // Calcula facturación últimos 12 meses por cuenta
  const facturacionPorCuenta = useMemo(() => {
    const desdeISO = haceUnAno()
    const map = {}
    cuentas.forEach(c => { map[c.id] = { emitido: 0, recibido: 0, cantEmitidas: 0, cantRecibidas: 0 } })
    facturas.forEach(f => {
      if (!map[f.cuenta_id]) return
      if (f.fecha < desdeISO) return
      const monto = Number(f.monto_total) || 0
      if (f.tipo === 'emitida') {
        map[f.cuenta_id].emitido += monto
        map[f.cuenta_id].cantEmitidas += 1
      } else {
        map[f.cuenta_id].recibido += monto
        map[f.cuenta_id].cantRecibidas += 1
      }
    })
    return map
  }, [cuentas, facturas])

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} key={id}
      style={{
        padding: '9px 20px', borderRadius: 8, border: 'none',
        background: tab === id ? 'var(--gold)' : 'var(--surface)',
        color: tab === id ? '#000' : 'var(--muted)',
        cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13,
      }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">📑 FACTURACIÓN</div>
      <div className="page-sub">
        Control fiscal multi-cuenta · Alertas de tope de monotributo · Vigencia valores: {VIGENCIA_DESDE} → {VIGENCIA_HASTA}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {tabBtn('cuentas', '🏛️ Cuentas')}
        {tabBtn('facturas', '🧾 Facturas')}
        {tabBtn('impuestos', '💸 Impuestos pagados')}
        {tabBtn('importar', '📥 Importar CSV')}
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Cargando...</p>}

      {!loading && tab === 'cuentas' && (
        <TabCuentas
          cuentas={cuentas}
          facturacionPorCuenta={facturacionPorCuenta}
          onChange={cargarTodo}
        />
      )}
      {!loading && tab === 'facturas' && (
        <TabFacturas cuentas={cuentas} facturas={facturas} onChange={cargarTodo} />
      )}
      {!loading && tab === 'impuestos' && (
        <TabImpuestos cuentas={cuentas} impuestos={impuestos} onChange={cargarTodo} />
      )}
      {!loading && tab === 'importar' && (
        <TabImportar cuentas={cuentas} onChange={cargarTodo} />
      )}
    </div>
  )
}

// ============================================================
// TAB CUENTAS — listado de cuentas con semáforo + alta/edición
// ============================================================
function TabCuentas({ cuentas, facturacionPorCuenta, onChange }) {
  const [editando, setEditando] = useState(null)
  const [mostrarForm, setMostrarForm] = useState(false)

  function nueva() {
    setEditando(null)
    setMostrarForm(true)
  }

  function editar(c) {
    setEditando(c)
    setMostrarForm(true)
  }

  async function eliminar(c) {
    if (!confirm(`¿Eliminar la cuenta "${c.nombre}"?\nLas facturas asociadas la mantienen como referencia y bloquean el borrado.`)) return
    const { error } = await supabase.from('cuentas_fiscales').delete().eq('id', c.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  return (
    <div>
      {/* Alertas globales */}
      <AlertasGlobales cuentas={cuentas} facturacionPorCuenta={facturacionPorCuenta} />

      {/* Lista de cuentas con semáforo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {cuentas.length} cuenta{cuentas.length === 1 ? '' : 's'} registrada{cuentas.length === 1 ? '' : 's'}
        </div>
        <button onClick={nueva}
          style={{ padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          + Nueva cuenta
        </button>
      </div>

      {cuentas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
          Todavía no hay cuentas cargadas. Apretá <strong>+ Nueva cuenta</strong> para agregar los 4 monotributos y la SAS.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
          {cuentas.map(c => (
            <CuentaCard
              key={c.id}
              cuenta={c}
              datos={facturacionPorCuenta[c.id] || { emitido: 0, recibido: 0 }}
              onEditar={() => editar(c)}
              onEliminar={() => eliminar(c)}
            />
          ))}
        </div>
      )}

      {mostrarForm && (
        <FormCuenta
          cuenta={editando}
          onCerrar={() => { setMostrarForm(false); setEditando(null) }}
          onGuardado={() => { setMostrarForm(false); setEditando(null); onChange() }}
        />
      )}
    </div>
  )
}

function AlertasGlobales({ cuentas, facturacionPorCuenta }) {
  const alertas = useMemo(() => {
    const arr = []
    cuentas.forEach(c => {
      if (c.tipo !== 'monotributo') return
      const f = facturacionPorCuenta[c.id]
      if (!f) return
      const tope = TOPE_MAX_ABSOLUTO
      const pct = (f.emitido / tope) * 100
      if (pct >= 70) {
        const sem = estadoSemaforo(pct)
        arr.push({ ...sem, cuenta: c.nombre, pct, facturado: f.emitido })
      }
    })
    return arr.sort((a, b) => b.pct - a.pct)
  }, [cuentas, facturacionPorCuenta])

  if (alertas.length === 0) return null

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: alertas[0].color }}>
      <div className="card-title" style={{ color: alertas[0].color }}>⚠️ Alertas de tope</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {alertas.map((a, i) => (
          <div key={i} style={{ padding: 10, background: 'var(--surface2)', borderLeft: `4px solid ${a.color}`, borderRadius: 6, fontSize: 13 }}>
            <strong style={{ color: a.color }}>{a.cuenta}</strong> · facturó {fmt$(a.facturado)} en los últimos 12 meses ({fmtPct(a.pct)} del tope K).
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CuentaCard({ cuenta, datos, onEditar, onEliminar }) {
  const esMono = cuenta.tipo === 'monotributo'
  const tope = esMono ? TOPE_MAX_ABSOLUTO : null
  const pct = esMono && tope ? (datos.emitido / tope) * 100 : 0
  const sem = esMono ? estadoSemaforo(pct) : null
  const catSugerida = esMono ? categoriaSugerida(datos.emitido) : null
  const cuotaActual = esMono && cuenta.categoria_monotributo
    ? cuotaMensual(cuenta.categoria_monotributo, cuenta.actividad || 'comercio')
    : 0

  return (
    <div className="card" style={{ padding: 14, borderColor: sem?.color || 'var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{cuenta.nombre}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            CUIT {cuenta.cuit} ·  {TIPOS_CUENTA.find(t => t.v === cuenta.tipo)?.l || cuenta.tipo}
            {esMono && cuenta.categoria_monotributo && ` · Cat ${cuenta.categoria_monotributo}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onEditar}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
            ✏️
          </button>
          <button onClick={onEliminar}
            style={{ background: 'transparent', border: '1px solid #5a2a2a', color: '#ff8b8b', borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
            🗑️
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, padding: 10, background: 'var(--surface2)', borderRadius: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>FACTURADO ÚLTIMOS 12 MESES</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--gold)', fontFamily: "'Bebas Neue',cursive" }}>{fmt$(datos.emitido)}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {datos.cantEmitidas || 0} factura{(datos.cantEmitidas || 0) === 1 ? '' : 's'} · recibido {fmt$(datos.recibido)}
        </div>
      </div>

      {esMono && (
        <>
          {/* Barra de progreso del tope */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: sem.color, fontWeight: 700 }}>{fmtPct(pct)} del tope K</span>
              <span style={{ color: 'var(--muted)' }}>{fmt$(datos.emitido)} / {fmt$(tope)}</span>
            </div>
            <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: sem.color, transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 10, color: sem.color, marginTop: 4 }}>{sem.label}</div>
          </div>

          {/* Categoría sugerida vs actual */}
          {catSugerida && (
            <div style={{ marginTop: 10, padding: 8, background: 'var(--surface2)', borderRadius: 6, fontSize: 12 }}>
              <div>
                <span style={{ color: 'var(--muted)' }}>Categoría sugerida:</span>{' '}
                <strong style={{ color: catSugerida.cat === cuenta.categoria_monotributo ? '#7dff7d' : '#ffd17a' }}>
                  {catSugerida.cat}
                </strong>
                {catSugerida.cat !== cuenta.categoria_monotributo && (
                  <span style={{ color: '#ffd17a', marginLeft: 4 }}>(actual: {cuenta.categoria_monotributo || '—'})</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Cuota mensual {cuenta.actividad === 'servicios' ? 'servicios' : 'comercio'}: {fmt$(cuotaActual)}
              </div>
            </div>
          )}

          {pct >= 100 && (
            <div style={{ marginTop: 8, padding: 8, background: '#3a1a1a', color: '#ff8b8b', borderRadius: 6, fontSize: 12, textAlign: 'center', fontWeight: 700 }}>
              🚨 EXCEDIDO — Pasaste el tope K. Hablalo YA con tu contador.
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FormCuenta({ cuenta, onCerrar, onGuardado }) {
  const VACIO = {
    nombre: '', razon_social: '', cuit: '',
    tipo: 'monotributo', categoria_monotributo: 'A', actividad: 'comercio',
    inscripto_iibb: false, iibb_numero: '', iibb_regimen: 'local', alicuota_iibb_pct: '',
    inscripto_municipal: false, alicuota_municipal_pct: '',
    condicion_iva: 'monotributo',
    fecha_inicio_actividad: '', domicilio_fiscal: '', email: '', telefono: '', notas: '', activa: true,
  }
  const [form, setForm] = useState(cuenta || VACIO)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!form.nombre.trim()) return alert('Nombre obligatorio')
    if (!form.cuit.trim()) return alert('CUIT obligatorio')
    setGuardando(true)
    const datos = {
      ...form,
      alicuota_iibb_pct: form.alicuota_iibb_pct === '' ? null : Number(form.alicuota_iibb_pct),
      alicuota_municipal_pct: form.alicuota_municipal_pct === '' ? null : Number(form.alicuota_municipal_pct),
      fecha_inicio_actividad: form.fecha_inicio_actividad || null,
      categoria_monotributo: form.tipo === 'monotributo' ? form.categoria_monotributo : null,
      updated_at: new Date().toISOString(),
    }
    let error
    if (cuenta?.id) {
      const r = await supabase.from('cuentas_fiscales').update(datos).eq('id', cuenta.id)
      error = r.error
    } else {
      const r = await supabase.from('cuentas_fiscales').insert(datos)
      error = r.error
    }
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  const esMono = form.tipo === 'monotributo'

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {cuenta ? '✏️ Editar cuenta' : '+ Nueva cuenta'}
          </div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Nombre interno *"><input value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder='Ej: "Mono Fabri"' style={inp} /></Campo>
          <Campo label="Razón social"><input value={form.razon_social} onChange={e => set('razon_social', e.target.value)} placeholder="Razón social legal" style={inp} /></Campo>
          <Campo label="CUIT *"><input value={form.cuit} onChange={e => set('cuit', e.target.value)} placeholder="20-12345678-9" style={inp} /></Campo>
          <Campo label="Tipo de cuenta *">
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={inp}>
              {TIPOS_CUENTA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Campo>
          {esMono && (
            <>
              <Campo label="Categoría actual">
                <select value={form.categoria_monotributo} onChange={e => set('categoria_monotributo', e.target.value)} style={inp}>
                  {CATEGORIAS.map(c => (
                    <option key={c.cat} value={c.cat}>
                      {c.cat} — hasta {fmt$(c.tope_anual)}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Actividad">
                <select value={form.actividad} onChange={e => set('actividad', e.target.value)} style={inp}>
                  <option value="comercio">Comercio / venta de cosas muebles</option>
                  <option value="servicios">Servicios</option>
                </select>
              </Campo>
            </>
          )}
          <Campo label="Condición IVA">
            <select value={form.condicion_iva} onChange={e => set('condicion_iva', e.target.value)} style={inp}>
              <option value="monotributo">Monotributo</option>
              <option value="responsable_inscripto">Responsable Inscripto</option>
              <option value="exento">Exento</option>
              <option value="consumidor_final">Consumidor Final</option>
            </select>
          </Campo>
          <Campo label="Fecha inicio actividad"><input type="date" value={form.fecha_inicio_actividad || ''} onChange={e => set('fecha_inicio_actividad', e.target.value)} style={inp} /></Campo>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>🏛️ INGRESOS BRUTOS (IIBB)</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={form.inscripto_iibb} onChange={e => set('inscripto_iibb', e.target.checked)} />
            Está inscripto en IIBB
          </label>
          {form.inscripto_iibb && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Campo label="Número IIBB"><input value={form.iibb_numero || ''} onChange={e => set('iibb_numero', e.target.value)} style={inp} /></Campo>
              <Campo label="Régimen">
                <select value={form.iibb_regimen || 'local'} onChange={e => set('iibb_regimen', e.target.value)} style={inp}>
                  <option value="local">Local (Misiones)</option>
                  <option value="convenio_multilateral">Convenio Multilateral</option>
                  <option value="simplificado">Simplificado</option>
                </select>
              </Campo>
              <Campo label="Alícuota IIBB %"><input type="number" step="0.01" value={form.alicuota_iibb_pct} onChange={e => set('alicuota_iibb_pct', e.target.value)} placeholder="Ej: 3.50" style={inp} /></Campo>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>🏢 MUNICIPAL (Posadas)</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
            <input type="checkbox" checked={form.inscripto_municipal} onChange={e => set('inscripto_municipal', e.target.checked)} />
            Paga Tasa Municipal / Seguridad e Higiene
          </label>
          {form.inscripto_municipal && (
            <Campo label="Alícuota municipal %"><input type="number" step="0.01" value={form.alicuota_municipal_pct} onChange={e => set('alicuota_municipal_pct', e.target.value)} placeholder="Ej: 0.60" style={inp} /></Campo>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>📞 CONTACTO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Campo label="Domicilio fiscal"><input value={form.domicilio_fiscal || ''} onChange={e => set('domicilio_fiscal', e.target.value)} style={inp} /></Campo>
            <Campo label="Email"><input value={form.email || ''} onChange={e => set('email', e.target.value)} style={inp} /></Campo>
            <Campo label="Teléfono"><input value={form.telefono || ''} onChange={e => set('telefono', e.target.value)} style={inp} /></Campo>
          </div>
          <Campo label="Notas"><textarea value={form.notas || ''} onChange={e => set('notas', e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} /></Campo>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : (cuenta ? '✅ Guardar cambios' : '✅ Crear cuenta')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  )
}

// ============================================================
// TAB FACTURAS — listado paginado + form de alta
// ============================================================
function TabFacturas({ cuentas, facturas, onChange }) {
  const [filtroCuenta, setFiltroCuenta] = useState('todas')
  const [filtroTipo, setFiltroTipo] = useState('todas')
  const [mostrarForm, setMostrarForm] = useState(false)

  const filtradas = useMemo(() => {
    return facturas.filter(f => {
      if (filtroCuenta !== 'todas' && f.cuenta_id !== Number(filtroCuenta)) return false
      if (filtroTipo !== 'todas' && f.tipo !== filtroTipo) return false
      return true
    })
  }, [facturas, filtroCuenta, filtroTipo])

  const pag = usePaginacion(filtradas, 20)

  const totales = useMemo(() => {
    const t = { emitido: 0, recibido: 0, ivaEmitido: 0, ivaRecibido: 0 }
    filtradas.forEach(f => {
      const m = Number(f.monto_total) || 0
      const iva = Number(f.monto_iva) || 0
      if (f.tipo === 'emitida') { t.emitido += m; t.ivaEmitido += iva }
      else { t.recibido += m; t.ivaRecibido += iva }
    })
    return t
  }, [filtradas])

  async function borrar(f) {
    if (!confirm(`¿Borrar factura ${f.tipo} #${f.numero || ''} de ${fmtFecha(f.fecha)}?`)) return
    const { error } = await supabase.from('facturas').delete().eq('id', f.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  function nombreCuenta(id) {
    return cuentas.find(c => c.id === id)?.nombre || `#${id}`
  }

  if (cuentas.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
        Primero cargá al menos una cuenta en la pestaña <strong>🏛️ Cuentas</strong>.
      </div>
    )
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)} style={{ ...inp, width: 220 }}>
          <option value="todas">Todas las cuentas</option>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ ...inp, width: 180 }}>
          <option value="todas">Emitidas + Recibidas</option>
          <option value="emitida">Solo emitidas</option>
          <option value="recibida">Solo recibidas</option>
        </select>
        <button onClick={() => setMostrarForm(true)}
          style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          + Cargar factura
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <KPI label="💵 Emitido" value={fmt$(totales.emitido)} sub={`IVA débito ${fmt$(totales.ivaEmitido)}`} color="var(--gold)" />
        <KPI label="📥 Recibido" value={fmt$(totales.recibido)} sub={`IVA crédito ${fmt$(totales.ivaRecibido)}`} color="#7a9dff" />
        <KPI label="📊 Resultado IVA" value={fmt$(totales.ivaEmitido - totales.ivaRecibido)} sub="Débito − Crédito" color={totales.ivaEmitido >= totales.ivaRecibido ? '#7dff7d' : '#ff8b8b'} />
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Cuenta</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Tipo</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Comp.</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Número</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Contraparte</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Neto</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>IVA</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Total</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {pag.items.map(f => (
                <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 6px' }}>{fmtFecha(f.fecha)}</td>
                  <td style={{ padding: '6px 6px', fontWeight: 600 }}>{nombreCuenta(f.cuenta_id)}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                    <span style={{ background: f.tipo === 'emitida' ? 'var(--gold)22' : '#7a9dff22', color: f.tipo === 'emitida' ? 'var(--gold)' : '#7a9dff', borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                      {f.tipo === 'emitida' ? '↗ EMI' : '↙ REC'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--muted)' }}>{f.tipo_comprobante || '—'}</td>
                  <td style={{ padding: '6px 6px', fontFamily: 'monospace', fontSize: 11 }}>{f.punto_venta ? `${f.punto_venta}-` : ''}{f.numero || '—'}</td>
                  <td style={{ padding: '6px 6px' }}>{f.contraparte_nombre || '—'}</td>
                  <td style={{ textAlign: 'right', padding: '6px 6px' }}>{fmt$(f.monto_neto)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 6px', color: 'var(--muted)' }}>{fmt$(f.monto_iva)}</td>
                  <td style={{ textAlign: 'right', padding: '6px 6px', fontWeight: 700, color: 'var(--gold)' }}>{fmt$(f.monto_total)}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                    <button onClick={() => borrar(f)}
                      style={{ background: 'transparent', border: 'none', color: '#ff8b8b', cursor: 'pointer', fontSize: 12 }}>
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan="10" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin facturas con esos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 10 }}>
          <Paginador {...pag.controles} label="facturas" />
        </div>
      </div>

      {mostrarForm && (
        <FormFactura cuentas={cuentas} onCerrar={() => setMostrarForm(false)} onGuardado={() => { setMostrarForm(false); onChange() }} />
      )}
    </div>
  )
}

function FormFactura({ cuentas, onCerrar, onGuardado }) {
  const VACIO = {
    cuenta_id: cuentas[0]?.id || '',
    tipo: 'emitida',
    fecha: hoyISO(),
    punto_venta: '0001',
    numero: '',
    tipo_comprobante: 'C',
    monto_neto: '',
    monto_iva: '',
    monto_otros: '',
    monto_total: '',
    contraparte_nombre: '',
    contraparte_cuit: '',
    contraparte_iva: 'consumidor_final',
    concepto: '',
    condicion_pago: 'contado',
    notas: '',
  }
  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Auto-calcular total si dejaron el campo en blanco
  function calcularTotal() {
    const n = Number(form.monto_neto) || 0
    const i = Number(form.monto_iva) || 0
    const o = Number(form.monto_otros) || 0
    set('monto_total', String(Math.round((n + i + o) * 100) / 100))
  }

  async function guardar() {
    if (!form.cuenta_id) return alert('Elegí una cuenta')
    if (!form.fecha) return alert('Fecha obligatoria')
    const total = Number(form.monto_total) || 0
    if (total <= 0) return alert('El total debe ser mayor a 0')
    setGuardando(true)
    const datos = {
      ...form,
      cuenta_id: Number(form.cuenta_id),
      monto_neto: Number(form.monto_neto) || 0,
      monto_iva: Number(form.monto_iva) || 0,
      monto_otros: Number(form.monto_otros) || 0,
      monto_total: total,
    }
    const { error } = await supabase.from('facturas').insert(datos)
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>+ Nueva factura</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Campo label="Cuenta *">
            <select value={form.cuenta_id} onChange={e => set('cuenta_id', e.target.value)} style={inp}>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Tipo *">
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={inp}>
              <option value="emitida">↗ Emitida (venta)</option>
              <option value="recibida">↙ Recibida (compra)</option>
            </select>
          </Campo>
          <Campo label="Fecha *">
            <input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Comprobante">
            <select value={form.tipo_comprobante} onChange={e => set('tipo_comprobante', e.target.value)} style={inp}>
              {TIPOS_COMPROBANTE.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Campo>
          <Campo label="Punto venta">
            <input value={form.punto_venta} onChange={e => set('punto_venta', e.target.value)} placeholder="0001" style={inp} />
          </Campo>
          <Campo label="Número">
            <input value={form.numero} onChange={e => set('numero', e.target.value)} placeholder="00012345" style={inp} />
          </Campo>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>👤 CONTRAPARTE</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <Campo label="Nombre / razón social"><input value={form.contraparte_nombre} onChange={e => set('contraparte_nombre', e.target.value)} style={inp} /></Campo>
            <Campo label="CUIT"><input value={form.contraparte_cuit} onChange={e => set('contraparte_cuit', e.target.value)} style={inp} /></Campo>
            <Campo label="Condición IVA">
              <select value={form.contraparte_iva} onChange={e => set('contraparte_iva', e.target.value)} style={inp}>
                <option value="responsable_inscripto">RI</option>
                <option value="monotributo">Mono</option>
                <option value="exento">Exento</option>
                <option value="consumidor_final">CF</option>
                <option value="no_aplica">N/A</option>
              </select>
            </Campo>
          </div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, letterSpacing: 1 }}>💰 IMPORTES</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
            <Campo label="Neto"><input type="number" step="0.01" value={form.monto_neto} onChange={e => set('monto_neto', e.target.value)} onBlur={calcularTotal} style={inp} /></Campo>
            <Campo label="IVA"><input type="number" step="0.01" value={form.monto_iva} onChange={e => set('monto_iva', e.target.value)} onBlur={calcularTotal} style={inp} /></Campo>
            <Campo label="Otros"><input type="number" step="0.01" value={form.monto_otros} onChange={e => set('monto_otros', e.target.value)} onBlur={calcularTotal} style={inp} /></Campo>
            <Campo label="Total *"><input type="number" step="0.01" value={form.monto_total} onChange={e => set('monto_total', e.target.value)} style={{ ...inp, borderColor: 'var(--gold)', fontWeight: 700 }} /></Campo>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            Al salir del campo "Otros" se autocalcula Total = Neto + IVA + Otros. Podés editarlo manualmente si querés.
          </div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Campo label="Concepto / descripción">
              <input value={form.concepto} onChange={e => set('concepto', e.target.value)} placeholder="Ej: venta carne semana, compra ganado..." style={inp} />
            </Campo>
            <Campo label="Condición de pago">
              <select value={form.condicion_pago} onChange={e => set('condicion_pago', e.target.value)} style={inp}>
                <option value="contado">Contado</option>
                <option value="cuenta_corriente">Cuenta corriente</option>
                <option value="cheque">Cheque</option>
                <option value="transferencia">Transferencia</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
          </div>
          <Campo label="Notas">
            <input value={form.notas} onChange={e => set('notas', e.target.value)} style={inp} />
          </Campo>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : '✅ Registrar factura'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TAB IMPUESTOS — listado paginado + form
// ============================================================
function TabImpuestos({ cuentas, impuestos, onChange }) {
  const [filtroCuenta, setFiltroCuenta] = useState('todas')
  const [filtroConcepto, setFiltroConcepto] = useState('todos')
  const [mostrarForm, setMostrarForm] = useState(false)

  const filtrados = useMemo(() => {
    return impuestos.filter(p => {
      if (filtroCuenta !== 'todas' && p.cuenta_id !== Number(filtroCuenta)) return false
      if (filtroConcepto !== 'todos' && p.concepto !== filtroConcepto) return false
      return true
    })
  }, [impuestos, filtroCuenta, filtroConcepto])

  const pag = usePaginacion(filtrados, 20)
  const totalPagado = filtrados.reduce((s, p) => s + (Number(p.monto) || 0), 0)

  function nombreCuenta(id) {
    return cuentas.find(c => c.id === id)?.nombre || `#${id}`
  }

  async function borrar(p) {
    if (!confirm(`¿Borrar pago de ${CONCEPTOS_IMPUESTO.find(c => c.v === p.concepto)?.l || p.concepto} de ${fmtFecha(p.fecha_pago)}?`)) return
    const { error } = await supabase.from('impuestos_pagados').delete().eq('id', p.id)
    if (error) alert('❌ ' + error.message)
    else onChange()
  }

  if (cuentas.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
        Primero cargá al menos una cuenta en la pestaña <strong>🏛️ Cuentas</strong>.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)} style={{ ...inp, width: 220 }}>
          <option value="todas">Todas las cuentas</option>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={filtroConcepto} onChange={e => setFiltroConcepto(e.target.value)} style={{ ...inp, width: 240 }}>
          <option value="todos">Todos los conceptos</option>
          {CONCEPTOS_IMPUESTO.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
        <button onClick={() => setMostrarForm(true)}
          style={{ marginLeft: 'auto', padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
          + Cargar pago
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <KPI label="💸 Total pagado en la vista" value={fmt$(totalPagado)} sub={`${filtrados.length} pago${filtrados.length === 1 ? '' : 's'}`} color="#ff8b8b" />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, minWidth: 800 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Cuenta</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Concepto</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Período</th>
                <th style={{ textAlign: 'right', padding: '8px 6px' }}>Monto</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Comprobante</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {pag.items.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 6px' }}>{fmtFecha(p.fecha_pago)}</td>
                  <td style={{ padding: '6px 6px', fontWeight: 600 }}>{nombreCuenta(p.cuenta_id)}</td>
                  <td style={{ padding: '6px 6px' }}>{CONCEPTOS_IMPUESTO.find(c => c.v === p.concepto)?.l || p.concepto}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px', color: 'var(--muted)' }}>
                    {p.periodo_mes ? `${String(p.periodo_mes).padStart(2, '0')}/${p.periodo_anio}` : p.periodo_anio}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 6px', fontWeight: 700, color: '#ff8b8b' }}>{fmt$(p.monto)}</td>
                  <td style={{ padding: '6px 6px', fontSize: 11, color: 'var(--muted)' }}>{p.comprobante || '—'}</td>
                  <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                    <button onClick={() => borrar(p)}
                      style={{ background: 'transparent', border: 'none', color: '#ff8b8b', cursor: 'pointer', fontSize: 12 }}>
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>Sin pagos registrados con esos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 10 }}>
          <Paginador {...pag.controles} label="pagos" />
        </div>
      </div>

      {mostrarForm && (
        <FormImpuesto cuentas={cuentas} onCerrar={() => setMostrarForm(false)} onGuardado={() => { setMostrarForm(false); onChange() }} />
      )}
    </div>
  )
}

function FormImpuesto({ cuentas, onCerrar, onGuardado }) {
  const hoy = new Date()
  const VACIO = {
    cuenta_id: cuentas[0]?.id || '',
    concepto: 'monotributo',
    periodo_anio: hoy.getFullYear(),
    periodo_mes: hoy.getMonth() + 1,
    monto: '',
    fecha_pago: hoyISO(),
    comprobante: '',
    notas: '',
  }
  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function guardar() {
    if (!form.cuenta_id) return alert('Elegí cuenta')
    if (!form.monto || Number(form.monto) <= 0) return alert('Monto debe ser > 0')
    setGuardando(true)
    const { error } = await supabase.from('impuestos_pagados').insert({
      ...form,
      cuenta_id: Number(form.cuenta_id),
      monto: Number(form.monto),
      periodo_anio: Number(form.periodo_anio),
      periodo_mes: form.periodo_mes ? Number(form.periodo_mes) : null,
    })
    setGuardando(false)
    if (error) return alert('❌ ' + error.message)
    onGuardado()
  }

  return (
    <div onClick={onCerrar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: 12, padding: 20, maxWidth: 540, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>+ Registrar pago de impuesto</div>
          <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Campo label="Cuenta *">
            <select value={form.cuenta_id} onChange={e => set('cuenta_id', e.target.value)} style={inp}>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Concepto *">
            <select value={form.concepto} onChange={e => set('concepto', e.target.value)} style={inp}>
              {CONCEPTOS_IMPUESTO.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Campo>
          <Campo label="Período año">
            <input type="number" value={form.periodo_anio} onChange={e => set('periodo_anio', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Período mes (vacío = anual)">
            <select value={form.periodo_mes || ''} onChange={e => set('periodo_mes', e.target.value)} style={inp}>
              <option value="">— Anual —</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Monto *">
            <input type="number" step="0.01" value={form.monto} onChange={e => set('monto', e.target.value)} style={{ ...inp, borderColor: 'var(--gold)', fontWeight: 700 }} />
          </Campo>
          <Campo label="Fecha de pago *">
            <input type="date" value={form.fecha_pago} onChange={e => set('fecha_pago', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Comprobante (VEP/ticket)">
            <input value={form.comprobante} onChange={e => set('comprobante', e.target.value)} style={inp} />
          </Campo>
          <Campo label="Notas">
            <input value={form.notas} onChange={e => set('notas', e.target.value)} style={inp} />
          </Campo>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCerrar} style={{ flex: 1, padding: 12, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando}
            style={{ flex: 2, padding: 12, background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, letterSpacing: 1 }}>
            {guardando ? '⏳ Guardando...' : '✅ Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// TAB IMPORTAR — bulk CSV de facturas
// ============================================================
function TabImportar({ cuentas, onChange }) {
  const [texto, setTexto] = useState('')
  const [preview, setPreview] = useState([])
  const [resultado, setResultado] = useState(null)
  const [cargando, setCargando] = useState(false)

  function parsear() {
    setResultado(null)
    const lineas = texto.trim().split(/\r?\n/).filter(l => l.trim())
    if (lineas.length < 2) { alert('Pegá el contenido del CSV con encabezado en la primera fila'); return }

    const headers = lineas[0].split(',').map(h => h.trim().toLowerCase())
    const required = ['cuenta', 'tipo', 'fecha', 'monto_total']
    const faltan = required.filter(r => !headers.includes(r))
    if (faltan.length > 0) {
      alert(`Faltan columnas obligatorias: ${faltan.join(', ')}\nColumnas detectadas: ${headers.join(', ')}`)
      return
    }

    const out = []
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split(',').map(c => c.trim())
      const row = {}
      headers.forEach((h, idx) => row[h] = cols[idx] || '')

      const cuenta = cuentas.find(c =>
        c.nombre.toLowerCase() === row.cuenta?.toLowerCase() ||
        c.cuit === row.cuenta
      )
      out.push({
        ok: !!cuenta && ['emitida', 'recibida'].includes(row.tipo?.toLowerCase()),
        cuentaResuelta: cuenta,
        raw: row,
      })
    }
    setPreview(out)
  }

  async function importar() {
    const validos = preview.filter(p => p.ok)
    if (validos.length === 0) { alert('No hay filas válidas'); return }
    if (!confirm(`Importar ${validos.length} factura(s)?`)) return
    setCargando(true)
    const filas = validos.map(p => ({
      cuenta_id: p.cuentaResuelta.id,
      tipo: p.raw.tipo.toLowerCase(),
      fecha: p.raw.fecha,
      punto_venta: p.raw.punto_venta || null,
      numero: p.raw.numero || null,
      tipo_comprobante: p.raw.tipo_comprobante || null,
      monto_neto: Number(p.raw.monto_neto) || 0,
      monto_iva: Number(p.raw.monto_iva) || 0,
      monto_otros: Number(p.raw.monto_otros) || 0,
      monto_total: Number(p.raw.monto_total) || 0,
      contraparte_nombre: p.raw.contraparte_nombre || null,
      contraparte_cuit: p.raw.contraparte_cuit || null,
      concepto: p.raw.concepto || null,
    }))
    const { error } = await supabase.from('facturas').insert(filas)
    setCargando(false)
    if (error) {
      setResultado({ ok: false, msg: error.message })
      return
    }
    setResultado({ ok: true, msg: `✅ ${filas.length} factura(s) importada(s)` })
    setTexto(''); setPreview([])
    onChange()
  }

  const EJEMPLO = `cuenta,tipo,fecha,tipo_comprobante,punto_venta,numero,monto_neto,monto_iva,monto_total,contraparte_nombre,contraparte_cuit,concepto
Mono Fabri,emitida,2026-05-01,C,0001,00012345,1500000,0,1500000,Cliente Tal,20-12345678-9,Venta semana
SAS Fabricius,recibida,2026-05-05,A,0003,00056789,800000,168000,968000,Frigorífico X,30-11111111-1,Compra ganado`

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📥 Importar facturas desde CSV</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
          Pegá un CSV separado por comas. La primera fila debe tener los encabezados.
          Las columnas obligatorias son: <code>cuenta</code> (nombre interno o CUIT), <code>tipo</code> (emitida/recibida), <code>fecha</code>, <code>monto_total</code>.
          Opcionales: <code>tipo_comprobante</code>, <code>punto_venta</code>, <code>numero</code>, <code>monto_neto</code>, <code>monto_iva</code>, <code>monto_otros</code>, <code>contraparte_nombre</code>, <code>contraparte_cuit</code>, <code>concepto</code>.
        </div>
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--gold)', fontSize: 12 }}>Ver ejemplo</summary>
          <pre style={{ background: 'var(--surface2)', padding: 10, borderRadius: 6, fontSize: 11, overflowX: 'auto', marginTop: 6 }}>{EJEMPLO}</pre>
        </details>
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Pegá acá el CSV..."
          rows={10}
          style={{ ...inp, fontFamily: 'monospace', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={parsear} disabled={!texto.trim()}
            style={{ padding: '8px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            🔍 Validar
          </button>
          {preview.length > 0 && (
            <button onClick={importar} disabled={cargando}
              style={{ padding: '8px 16px', background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
              {cargando ? '⏳ Importando...' : `✅ Importar ${preview.filter(p => p.ok).length} válidas`}
            </button>
          )}
        </div>
        {resultado && (
          <div style={{ marginTop: 10, padding: 10, background: resultado.ok ? '#1a2a1a' : '#3a1a1a', color: resultado.ok ? '#7dff7d' : '#ff8b8b', borderRadius: 6 }}>
            {resultado.msg}
          </div>
        )}
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">Vista previa ({preview.filter(p => p.ok).length} válidas / {preview.length} total)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textTransform: 'uppercase' }}>
                  <th style={{ width: 30 }}></th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Cuenta</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Fecha</th>
                  <th style={{ textAlign: 'right', padding: 4 }}>Total</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Contraparte</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)', background: p.ok ? 'transparent' : '#3a1a1a44' }}>
                    <td style={{ textAlign: 'center', padding: 4 }}>{p.ok ? '✅' : '❌'}</td>
                    <td style={{ padding: 4 }}>{p.raw.cuenta} {!p.cuentaResuelta && <span style={{ color: '#ff8b8b' }}>(no encontrada)</span>}</td>
                    <td style={{ padding: 4 }}>{p.raw.tipo}</td>
                    <td style={{ padding: 4 }}>{p.raw.fecha}</td>
                    <td style={{ textAlign: 'right', padding: 4 }}>{fmt$(p.raw.monto_total)}</td>
                    <td style={{ padding: 4 }}>{p.raw.contraparte_nombre || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, sub, color }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Bebas Neue',cursive", color: color || 'var(--gold)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}
