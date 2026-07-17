// ============================================================
// DESPOSTE ELABORAR — El operario carga elaboraciones con efecto real
// ============================================================
// Módulo completo de elaboración en el portal del sector:
//   🌭 Embutidos frescos (chorizos, salchicha, morcilla): descuenta piezas
//      de cerdo (+ retazos) y suma cada producto terminado a su bucket.
//   🍔 Hamburguesas (carne/pollo/cerdo): descuenta la materia prima según
//      el tipo y suma el peso final al bucket hamb_*.
//   🥓 Salames: etapa 1 registra la tanda y descuenta materia prima (entra
//      al secado, SIN sumar stock); etapa 2 ("En secado") carga los kg
//      secos reales y recién ahí suma al stock.
// Toda la lógica de negocio vive en src/lib/elaborar.js (espejo del admin).
// Confirmación inline (nada de window.confirm — iOS/PWA los suprime).
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { parseNumero, fmtKg } from '../../lib/formatos'
import {
  NOMBRE_EMBUTIDO, ORIGEN_HAMBURGUESA, PIEZAS_MATERIA_PRIMA,
  registrarElaboracionEmbutido, registrarElaboracionHamburguesa,
  registrarElaboracionSalame, finalizarMaduracionSalame,
} from '../../lib/elaborar'

const inp = {
  background: 'var(--surface2)', border: '2px solid var(--border)', color: 'var(--text)',
  borderRadius: 10, padding: '14px 16px', fontFamily: "'DM Sans', sans-serif",
  fontSize: 20, fontWeight: 700, width: '100%', boxSizing: 'border-box',
  textAlign: 'right',
}

const PRODUCTOS_EMBUTIDO = ['chorizo_parrillero', 'chorizo_saborizado', 'chorizo_colorado', 'salchicha_parrillera', 'morcilla']
const VARIEDADES_SALAME = ['salame_comun', 'salame_holanda', 'salame_rockeford']

const sumaObj = obj => Object.values(obj || {}).reduce((s, v) => s + parseNumero(v), 0)
const objNum = obj => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, parseNumero(v)]))

function KPI({ label, valor, color }) {
  return (
    <div style={{ padding: 14, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 30, color }}>{valor}</div>
    </div>
  )
}

function CampoKg({ label, valor, onChange }) {
  return (
    <div style={{ padding: 14, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
      <label style={{ fontSize: 14, color: 'var(--muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="number" inputMode="decimal" step="0.01" min="0" value={valor || ''} onChange={e => onChange(e.target.value)} placeholder="0" style={inp} />
        <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 700 }}>kg</span>
      </div>
    </div>
  )
}

// Botón de confirmación en dos pasos (inline, sin window.confirm):
// 1er toque muestra el resumen + "¿Confirmar?"; el 2do ejecuta.
function BotonConfirmar({ resumen, advertencia, deshabilitado, guardando, onConfirmar, texto }) {
  const [armado, setArmado] = useState(false)
  useEffect(() => { setArmado(false) }, [deshabilitado])
  if (!armado) {
    return (
      <button onClick={() => setArmado(true)} disabled={deshabilitado || guardando}
        style={{
          width: '100%', padding: 20, background: deshabilitado ? 'var(--surface2)' : 'var(--green)',
          color: deshabilitado ? 'var(--muted)' : '#000', border: 'none', borderRadius: 12,
          cursor: deshabilitado ? 'not-allowed' : 'pointer',
          fontFamily: "'Bebas Neue', cursive", fontSize: 24, letterSpacing: 3,
        }}>
        {texto}
      </button>
    )
  }
  return (
    <div style={{ background: 'var(--surface)', border: '2px solid var(--gold)', borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{resumen}</div>
      {advertencia && <div style={{ fontSize: 14, color: '#ffd17a', marginBottom: 8 }}>{advertencia}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button onClick={() => { setArmado(false); onConfirmar() }} disabled={guardando}
          style={{ flex: 1, padding: 16, background: 'var(--green)', color: '#000', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: "'Bebas Neue', cursive", fontSize: 20, letterSpacing: 2 }}>
          {guardando ? '⏳ GUARDANDO...' : '✅ SÍ, CONFIRMAR'}
        </button>
        <button onClick={() => setArmado(false)} disabled={guardando}
          style={{ padding: '16px 24px', background: 'var(--surface2)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700 }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

export default function DesposteElaborar() {
  const [modo, setModo] = useState('embutido')
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)

  // Embutidos frescos
  const [piezasEmb, setPiezasEmb] = useState({})
  const [retazos, setRetazos] = useState('')
  const [pesoReal, setPesoReal] = useState({})
  // Hamburguesas
  const [tipoHamb, setTipoHamb] = useState('hamburguesa_carne')
  const [piezasHamb, setPiezasHamb] = useState({})
  const [kgOrigenHamb, setKgOrigenHamb] = useState('')
  const [kgFinalHamb, setKgFinalHamb] = useState('')
  // Salames
  const [piezasSal, setPiezasSal] = useState({})
  const [kgBovinoSal, setKgBovinoSal] = useState('')
  const [kgQuesoSal, setKgQuesoSal] = useState('')
  const [variedadesSal, setVariedadesSal] = useState({})
  const [enSecado, setEnSecado] = useState([])
  const [finales, setFinales] = useState({}) // { [elabId]: { [tipo]: kg } }
  const [finalizando, setFinalizando] = useState(null) // elab.id armado para confirmar

  const [notas, setNotas] = useState('')

  function aviso(texto, tipo = 'success') {
    setMsg({ texto, tipo })
    setTimeout(() => setMsg(null), 5000)
  }

  useEffect(() => { if (modo === 'salame') cargarSecado() }, [modo])

  async function cargarSecado() {
    const { data } = await supabase.from('elaboraciones_embutidos')
      .select('*').eq('tipo', 'salame').eq('maduracion_completa', false)
      .order('fecha', { ascending: false })
    setEnSecado(data || [])
  }

  function limpiar() {
    setPiezasEmb({}); setRetazos(''); setPesoReal({})
    setPiezasHamb({}); setKgOrigenHamb(''); setKgFinalHamb('')
    setPiezasSal({}); setKgBovinoSal(''); setKgQuesoSal(''); setVariedadesSal({})
    setNotas('')
  }

  // ── Totales en vivo ──
  const kgMateriaEmb = sumaObj(piezasEmb) + parseNumero(retazos)
  const kgFinalEmb = sumaObj(pesoReal)
  const pctEmb = kgMateriaEmb > 0 ? (kgFinalEmb / kgMateriaEmb - 1) * 100 : 0

  const esCerdoHamb = tipoHamb === 'hamburguesa_cerdo'
  const kgOrigHamb = esCerdoHamb ? sumaObj(piezasHamb) : parseNumero(kgOrigenHamb)
  const kgFinHamb = parseNumero(kgFinalHamb)
  const pctHamb = kgOrigHamb > 0 ? (kgFinHamb / kgOrigHamb - 1) * 100 : 0

  const kgMateriaSal = sumaObj(piezasSal) + parseNumero(kgBovinoSal) + parseNumero(kgQuesoSal)
  const kgNetoSal = sumaObj(variedadesSal)

  // ── Confirmaciones ──
  async function confirmarEmbutido() {
    setGuardando(true)
    try {
      const r = await registrarElaboracionEmbutido({
        piezas: objNum(piezasEmb), kgRetazos: parseNumero(retazos), pesoReal: objNum(pesoReal), notas,
      })
      aviso(`✅ ${r.kgFinal.toFixed(1)} kg elaborados — ${r.detalle} (cada uno a su stock)`)
      limpiar()
    } catch (err) { aviso('❌ ' + err.message, 'error') }
    setGuardando(false)
  }

  async function confirmarHamburguesa() {
    setGuardando(true)
    try {
      const r = await registrarElaboracionHamburguesa({
        tipo: tipoHamb, piezasCerdo: objNum(piezasHamb), kgOrigen: parseNumero(kgOrigenHamb), kgFinal: kgFinHamb, notas,
      })
      aviso(`✅ ${r.kgFinal.toFixed(1)} kg de ${NOMBRE_EMBUTIDO[tipoHamb]} al stock (${r.pctFinal >= 0 ? '+' : ''}${r.pctFinal.toFixed(1)}% vs ${r.kgOrigen.toFixed(1)} kg usados)`)
      limpiar()
    } catch (err) { aviso('❌ ' + err.message, 'error') }
    setGuardando(false)
  }

  async function confirmarSalame() {
    setGuardando(true)
    try {
      const r = await registrarElaboracionSalame({
        piezasCerdo: objNum(piezasSal), kgBovino: parseNumero(kgBovinoSal), kgQueso: parseNumero(kgQuesoSal),
        variedades: objNum(variedadesSal), notas,
      })
      aviso(`✅ Salame registrado en secado — ${r.detalle} (${r.kgTotal.toFixed(1)} kg netos). Cargá el peso final cuando esté seco.`)
      limpiar(); cargarSecado()
    } catch (err) { aviso('❌ ' + err.message, 'error') }
    setGuardando(false)
  }

  async function confirmarFinalizarSalame(elab) {
    setGuardando(true)
    try {
      const r = await finalizarMaduracionSalame(elab, finales[elab.id] || {})
      aviso(`✅ Salame seco finalizado — ${r.detalle} (cada uno a su stock)`)
      setFinales(f => ({ ...f, [elab.id]: {} }))
      setFinalizando(null)
      cargarSecado()
    } catch (err) { aviso('❌ ' + err.message, 'error') }
    setGuardando(false)
  }

  const MODOS = [
    { id: 'embutido', label: '🌭 Embutidos' },
    { id: 'hamburguesa', label: '🍔 Hamburguesas' },
    { id: 'salame', label: '🥓 Salames' },
  ]

  return (
    <div>
      {msg && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 1000,
          padding: '18px 24px', borderRadius: 10, fontSize: 16, fontWeight: 700,
          background: msg.tipo === 'error' ? '#3a1a1a' : '#1a2a1a',
          color: msg.tipo === 'error' ? '#ff8b8b' : '#7dff7d',
          border: `1px solid ${msg.tipo === 'error' ? '#ff6b6b' : '#7dff7d'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxWidth: 460,
        }}>{msg.texto}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {MODOS.map(m => (
          <button key={m.id} onClick={() => setModo(m.id)}
            style={{
              flex: 1, minWidth: 140, padding: '14px 10px', borderRadius: 12,
              border: `2px solid ${modo === m.id ? 'var(--gold)' : 'var(--border)'}`,
              background: modo === m.id ? 'var(--gold)' : 'var(--surface)',
              color: modo === m.id ? '#000' : 'var(--muted)',
              cursor: 'pointer', fontSize: 17, fontWeight: 800,
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* ══════════ EMBUTIDOS FRESCOS ══════════ */}
      {modo === 'embutido' && (
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>🐷 Materia prima usada</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Kg de cada pieza de cerdo que se molió. Se descuentan del stock de piezas.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
            {PIEZAS_MATERIA_PRIMA.map(p => (
              <CampoKg key={p.key} label={p.nombre} valor={piezasEmb[p.key]} onChange={v => setPiezasEmb(x => ({ ...x, [p.key]: v }))} />
            ))}
            <CampoKg label="Retazos de cerdo (descuenta de Cabezas)" valor={retazos} onChange={setRetazos} />
          </div>

          <h2 style={{ fontSize: 20, marginBottom: 4 }}>⚖️ Producto terminado (peso real)</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Pesá lo que salió de cada producto. Cada uno suma a su propio stock.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 16 }}>
            {PRODUCTOS_EMBUTIDO.map(t => (
              <CampoKg key={t} label={NOMBRE_EMBUTIDO[t]} valor={pesoReal[t]} onChange={v => setPesoReal(x => ({ ...x, [t]: v }))} />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <KPI label="🐷 MATERIA PRIMA" valor={fmtKg(kgMateriaEmb)} color="var(--gold)" />
            <KPI label="🌭 ELABORADO" valor={fmtKg(kgFinalEmb)} color={kgFinalEmb > 0 ? '#7dff7d' : 'var(--muted)'} />
            <KPI label={pctEmb >= 0 ? '📈 AUMENTO' : '📉 MERMA'} valor={`${Math.abs(pctEmb).toFixed(1)}%`} color={pctEmb >= 0 ? '#7dff7d' : '#ffd17a'} />
          </div>

          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Notas (opcional)"
            style={{ ...inp, fontSize: 15, textAlign: 'left', fontWeight: 400, marginBottom: 16 }} />

          <BotonConfirmar
            texto="✅ CONFIRMAR ELABORACIÓN"
            deshabilitado={kgFinalEmb === 0 || sumaObj(piezasEmb) === 0}
            guardando={guardando}
            resumen={`Se descuentan ${fmtKg(kgMateriaEmb)} de materia prima y se suman ${fmtKg(kgFinalEmb)} de producto terminado al stock.`}
            advertencia={kgMateriaEmb > 0 && kgFinalEmb > kgMateriaEmb * 1.6 ? '⚠️ El peso final supera por mucho a la materia prima — revisá los kg.' : null}
            onConfirmar={confirmarEmbutido}
          />
        </div>
      )}

      {/* ══════════ HAMBURGUESAS ══════════ */}
      {modo === 'hamburguesa' && (
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 10 }}>🍔 Tipo de hamburguesa</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {['hamburguesa_carne', 'hamburguesa_pollo', 'hamburguesa_cerdo'].map(t => (
              <button key={t} onClick={() => setTipoHamb(t)}
                style={{
                  flex: 1, minWidth: 130, padding: '14px 10px', borderRadius: 12,
                  border: `2px solid ${tipoHamb === t ? 'var(--gold)' : 'var(--border)'}`,
                  background: tipoHamb === t ? 'var(--surface2)' : 'var(--surface)',
                  color: tipoHamb === t ? 'var(--gold)' : 'var(--muted)',
                  cursor: 'pointer', fontSize: 16, fontWeight: 800,
                }}>
                {t === 'hamburguesa_carne' ? '🐄 Carne' : t === 'hamburguesa_pollo' ? '🐔 Pollo' : '🐷 Cerdo'}
              </button>
            ))}
          </div>

          {esCerdoHamb ? (
            <>
              <h2 style={{ fontSize: 20, marginBottom: 4 }}>🐷 Piezas de cerdo usadas</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 16 }}>
                {PIEZAS_MATERIA_PRIMA.map(p => (
                  <CampoKg key={p.key} label={p.nombre} valor={piezasHamb[p.key]} onChange={v => setPiezasHamb(x => ({ ...x, [p.key]: v }))} />
                ))}
              </div>
            </>
          ) : (
            <div style={{ maxWidth: 420, marginBottom: 16 }}>
              <CampoKg label={ORIGEN_HAMBURGUESA[tipoHamb].label} valor={kgOrigenHamb} onChange={setKgOrigenHamb} />
            </div>
          )}

          <div style={{ maxWidth: 420, marginBottom: 16 }}>
            <CampoKg label="⚖️ Kg de hamburguesas elaboradas (peso final)" valor={kgFinalHamb} onChange={setKgFinalHamb} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <KPI label="🥩 MATERIA PRIMA" valor={fmtKg(kgOrigHamb)} color="var(--gold)" />
            <KPI label="🍔 ELABORADO" valor={fmtKg(kgFinHamb)} color={kgFinHamb > 0 ? '#7dff7d' : 'var(--muted)'} />
            <KPI label={pctHamb >= 0 ? '📈 AUMENTO' : '📉 MERMA'} valor={`${Math.abs(pctHamb).toFixed(1)}%`} color={pctHamb >= 0 ? '#7dff7d' : '#ffd17a'} />
          </div>

          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Notas (opcional)"
            style={{ ...inp, fontSize: 15, textAlign: 'left', fontWeight: 400, marginBottom: 16 }} />

          <BotonConfirmar
            texto="✅ CONFIRMAR HAMBURGUESAS"
            deshabilitado={kgOrigHamb === 0 || kgFinHamb === 0}
            guardando={guardando}
            resumen={`Se descuentan ${fmtKg(kgOrigHamb)} de materia prima y se suman ${fmtKg(kgFinHamb)} de ${NOMBRE_EMBUTIDO[tipoHamb]} al stock.`}
            advertencia={kgOrigHamb > 0 && kgFinHamb > kgOrigHamb * 1.6 ? '⚠️ El peso final supera por mucho a la materia prima — revisá los kg.' : null}
            onConfirmar={confirmarHamburguesa}
          />
        </div>
      )}

      {/* ══════════ SALAMES ══════════ */}
      {modo === 'salame' && (
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>🐷 Materia prima de la tanda</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>Se descuenta ahora; el stock de salames se suma recién cuando estén secos y pesados.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
            {PIEZAS_MATERIA_PRIMA.map(p => (
              <CampoKg key={p.key} label={p.nombre} valor={piezasSal[p.key]} onChange={v => setPiezasSal(x => ({ ...x, [p.key]: v }))} />
            ))}
            <CampoKg label="Carne bovina (descuenta de Bovino Cortes)" valor={kgBovinoSal} onChange={setKgBovinoSal} />
            <CampoKg label="Queso (no descuenta stock)" valor={kgQuesoSal} onChange={setKgQuesoSal} />
          </div>

          <h2 style={{ fontSize: 20, marginBottom: 4 }}>🥓 Kg netos por variedad (entran al secado)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 16 }}>
            {VARIEDADES_SALAME.map(t => (
              <CampoKg key={t} label={NOMBRE_EMBUTIDO[t]} valor={variedadesSal[t]} onChange={v => setVariedadesSal(x => ({ ...x, [t]: v }))} />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <KPI label="🐷 MATERIA PRIMA" valor={fmtKg(kgMateriaSal)} color="var(--gold)" />
            <KPI label="🥓 NETO AL SECADO" valor={fmtKg(kgNetoSal)} color={kgNetoSal > 0 ? '#7dff7d' : 'var(--muted)'} />
          </div>

          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Notas (opcional)"
            style={{ ...inp, fontSize: 15, textAlign: 'left', fontWeight: 400, marginBottom: 16 }} />

          <div style={{ marginBottom: 28 }}>
            <BotonConfirmar
              texto="✅ REGISTRAR TANDA EN SECADO"
              deshabilitado={sumaObj(piezasSal) === 0 || kgNetoSal === 0}
              guardando={guardando}
              resumen={`Se descuentan ${fmtKg(kgMateriaSal)} de materia prima. ${fmtKg(kgNetoSal)} netos entran al secado (todavía NO suman stock).`}
              onConfirmar={confirmarSalame}
            />
          </div>

          {/* En secado: cargar peso final */}
          <h2 style={{ fontSize: 20, marginBottom: 10 }}>⏳ Tandas en secado ({enSecado.length})</h2>
          {enSecado.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', background: 'var(--surface)', borderRadius: 12 }}>
              No hay salames en secado.
            </div>
          )}
          {enSecado.map(elab => {
            const vars = Array.isArray(elab.productos_finales) && elab.productos_finales.length
              ? elab.productos_finales
              : [{ tipo: elab.tipo_embutido || 'salame_comun', kg_neto: Number(elab.kg_elaborado) || 0 }]
            const f = finales[elab.id] || {}
            const totalFinal = vars.reduce((s, v) => s + parseNumero(f[v.tipo]), 0)
            return (
              <div key={elab.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Tanda del {elab.fecha}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{Number(elab.kg_elaborado || 0).toFixed(1)} kg netos al secado</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
                  {vars.map(v => (
                    <CampoKg key={v.tipo}
                      label={`${NOMBRE_EMBUTIDO[v.tipo] || v.tipo} (neto ${Number(v.kg_neto || 0).toFixed(1)} kg) — peso SECO`}
                      valor={f[v.tipo]}
                      onChange={val => setFinales(x => ({ ...x, [elab.id]: { ...(x[elab.id] || {}), [v.tipo]: val } }))} />
                  ))}
                </div>
                {finalizando === elab.id ? (
                  <div style={{ background: 'var(--surface2)', border: '2px solid var(--gold)', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                      Se suman {fmtKg(totalFinal)} de salame seco al stock. ¿Confirmar?
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => confirmarFinalizarSalame(elab)} disabled={guardando}
                        style={{ flex: 1, padding: 12, background: 'var(--green)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 15 }}>
                        {guardando ? '⏳ Guardando...' : '✅ Sí, finalizar'}
                      </button>
                      <button onClick={() => setFinalizando(null)} disabled={guardando}
                        style={{ padding: '12px 18px', background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setFinalizando(elab.id)} disabled={totalFinal === 0 || guardando}
                    style={{
                      width: '100%', padding: 14, borderRadius: 10, border: 'none',
                      background: totalFinal === 0 ? 'var(--surface2)' : 'var(--gold)',
                      color: totalFinal === 0 ? 'var(--muted)' : '#000',
                      cursor: totalFinal === 0 ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 16,
                    }}>
                    ⚖️ FINALIZAR SECADO Y SUMAR AL STOCK
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
