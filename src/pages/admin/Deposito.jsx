import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

async function actualizarStock(tipo, kg) {
  const { data } = await supabase.from('stock_actual').select('*').eq('tipo', tipo).maybeSingle()
  if (data) {
    await supabase.from('stock_actual').update({ kg_disponible: (data.kg_disponible || 0) + kg }).eq('tipo', tipo)
  } else {
    await supabase.from('stock_actual').insert({ tipo, kg_disponible: kg })
  }
}

const MODELOS_DESPOSTE = {
  A: { piezas: [
    { nombre: 'Cuarto delantero', pct: 0.45, tipo_stock: 'bovino_pieza', busqueda_precio: 'delantero' },
    { nombre: 'Cuarto trasero', pct: 0.45, tipo_stock: 'bovino_pieza', busqueda_precio: 'trasero' },
    { nombre: 'Costillar', pct: 0.10, tipo_stock: 'bovino_pieza', busqueda_precio: 'costilla' },
  ]},
  B: { piezas: [
    { nombre: 'Pierna', pct: 0.35, tipo_stock: 'bovino_pieza', busqueda_precio: 'pierna' },
    { nombre: 'Paleta', pct: 0.30, tipo_stock: 'bovino_pieza', busqueda_precio: 'paleta' },
    { nombre: 'Lomo', pct: 0.20, tipo_stock: 'bovino_pieza', busqueda_precio: 'lomo' },
    { nombre: 'Costillar', pct: 0.15, tipo_stock: 'bovino_pieza', busqueda_precio: 'costilla' },
  ]},
}

const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString('es-AR')

export function Deposito() {
  const [tab, setTab] = useState('entradas')
  const [alert, setAlert] = useState(null)
  const [remitoActual, setRemitoActual] = useState(null)
  const [proveedores, setProveedores] = useState([])

  useEffect(() => {
    supabase.from('proveedores').select('nombre').eq('activo', true).order('nombre')
      .then(({ data }) => setProveedores((data || []).map(p => p.nombre)))
  }, [])

  function showAlert(msg) { setAlert(msg); setTimeout(() => setAlert(null), 4000) }

  return (
    <div>
      <div className="page-title">DEPÓSITO</div>
      <div className="page-sub">Stock, entradas, despachos, desposte y proveedores</div>
      {alert && <div className={`alert alert-${alert?.type || 'success'}`}>{alert?.msg || alert}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'entradas', label: '📥 Entradas' },
          { id: 'salidas', label: '📤 Despachos' },
          { id: 'desposte', label: '🔪 Desposte' },
          { id: 'remitos', label: '🧾 Remitos' },
          { id: 'proveedores', label: '🏭 Proveedores' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${tab === t.id ? 'var(--amber)' : 'var(--border)'}`, background: tab === t.id ? 'var(--amber)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'entradas' && <EntradaForm onSaved={() => {}} showAlert={showAlert} proveedores={proveedores} />}
      {tab === 'salidas' && <SalidaForm onSaved={() => {}} showAlert={showAlert} onRemito={setRemitoActual} setTab={setTab} />}
        {tab === 'desposte' && <DesposteTab key={tab} onSaved={() => {}} />}    
{tab === 'remitos' && <RemitosTab remitoActual={remitoActual} />}
      {tab === 'proveedores' && <ProveedoresTab />}
    </div>
  )
}

export default Deposito
// =============================================
// MÓDULO DE DESPOSTE BOVINO
// =============================================
function DesposteTab({ onSaved }) {
  const [subtab, setSubtab] = useState('piezas')
  const [mediasRes, setMediasRes] = useState([])
  const [piezasStock, setPiezasStock] = useState({})
  const [despostes, setDespostes] = useState([])
  const [precios, setPrecios] = useState([])
  const [seleccionada, setSeleccionada] = useState(null)
  const [modelo, setModelo] = useState('A')
  const [tipoAnimal, setTipoAnimal] = useState('novillo')
  const [piezas, setPiezas] = useState([])
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [notas, setNotas] = useState('')
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(false)
  const [kgPiezaConvertir, setKgPiezaConvertir] = useState('')
  const [tipoPiezaSeleccionada, setTipoPiezaSeleccionada] = useState('')
  const [nombrePieza, setNombrePieza] = useState('')
  const [tipoAnimalPieza, setTipoAnimalPieza] = useState('novillo')
  const [precioCostoPieza, setPrecioCostoPieza] = useState('')
  const [mermaPieza, setMermaPieza] = useState(25)
  const [caponesDisponibles, setCaponesDisponibles] = useState([])
const [caponSeleccionado, setCaponSeleccionado] = useState(null)
const [piezasCerdo, setPiezasCerdo] = useState({
  pierna: '', carre: '', pechito: '', matambre: '',
  paleta: '', parrillero: '', bondiola: '', huesos: '', tocino: '', cuero: '', cabeza: ''
})
  const MERMAS_KILO = {
    novillo:  { label: 'Novillo / Novillito', merma: 0.24, color: 'var(--gold)' },
    ternera:  { label: 'Ternera',             merma: 0.30, color: 'var(--amber)' },
    bubalino: { label: 'Bubalino',            merma: 0.25, color: 'var(--blue)' },
  }

  useEffect(() => { cargarDatos() }, [])

  async function cargarDatos() {
    const [{ data: entradas }, { data: despostesData }, { data: preciosData }, { data: stockData }, { data: caponesData }] = await Promise.all([
      supabase.from('entradas_deposito').select('*').eq('tipo', 'bovino_mr').eq('despostada', false).eq('reservada', false).order('fecha', { ascending: false }),
      supabase.from('despostes').select('*').order('fecha', { ascending: false }).limit(20),
      supabase.from('precios').select('*').eq('categoria', 'bovino_pieza'),
      supabase.from('stock_actual').select('*'),
      supabase.from('entradas_deposito').select('*').eq('tipo', 'cerdo').eq('despostada', false).order('fecha', { ascending: false })
    ])
    setMediasRes(entradas || [])
    setDespostes(despostesData || [])
    setPrecios(preciosData || [])
    const stockMap = {}
    ;(stockData || []).forEach(r => stockMap[r.tipo] = r.kg_disponible)
    setPiezasStock(stockMap)
    setCaponesDisponibles(caponesData || [])
console.log('CAPONES:', caponesData)
    console.log('STOCK CARGADO:', stockMap)
  }
  function showAlert(msg, type = 'success') { setAlert({ msg, type }); setTimeout(() => setAlert(null), 5000) }

  function buscarPrecio(busqueda) {
    const termino = busqueda.toLowerCase()
    const encontrado = precios.find(p =>
      p.nombre.toLowerCase().includes(termino) ||
      termino.split(' ').some(t => t.length > 3 && p.nombre.toLowerCase().includes(t))
    )
    return encontrado?.precio_carniceria || encontrado?.precio_mayorista || 0
  }

  function calcularPiezas(entrada, modeloId) {
    if (!entrada) return []
    const kgBase = entrada.kg_real || entrada.kg || 0
    const kgNeto = kgBase * 0.975
    return MODELOS_DESPOSTE[modeloId].piezas.map(pieza => ({
      nombre: pieza.nombre,
      kg: parseFloat((kgNeto * pieza.pct).toFixed(2)),
      kg_editado: parseFloat((kgNeto * pieza.pct).toFixed(2)),
      tipo_stock: pieza.tipo_stock,
      precio_venta: buscarPrecio(pieza.busqueda_precio),
      precio_costo_kg: entrada.precio_kg || 0,
    }))
  }

  function seleccionarMedia(entrada) {
    setSeleccionada(entrada)
    setPiezas(calcularPiezas(entrada, modelo))
  }

  function cambiarModelo(m) {
    setModelo(m)
    if (seleccionada) setPiezas(calcularPiezas(seleccionada, m))
  }

  function editarKg(idx, valor) {
    setPiezas(prev => prev.map((p, i) => i === idx ? { ...p, kg_editado: parseFloat(valor) || 0 } : p))
  }

  function editarPrecio(idx, valor) {
    setPiezas(prev => prev.map((p, i) => i === idx ? { ...p, precio_venta: parseFloat(valor) || 0 } : p))
  }

  async function confirmarDespostePiezas() {
    if (!seleccionada || piezas.length === 0) { showAlert('Selecciona una media res', 'error'); return }
    setLoading(true)
    try {
      const kgBase = seleccionada.kg_real || seleccionada.kg || 0
      const kgNeto = kgBase * 0.975
      const { data: desposteData, error } = await supabase.from('despostes').insert({
        fecha, entrada_id: seleccionada.id, modelo,
        tipo_desposte: 'piezas', tipo_animal: tipoAnimal,
        kg_media_res: kgBase, merma_pct: 2.5, kg_neto: kgNeto,
        piezas: piezas.map(p => ({ nombre: p.nombre, kg: p.kg_editado, precio_venta: p.precio_venta, tipo_stock: p.tipo_stock })),
        notas
      }).select().single()
      if (error) throw error
      await supabase.from('entradas_deposito').update({ despostada: true, desposte_id: desposteData.id }).eq('id', seleccionada.id)
      await actualizarStock('bovino_mr', -kgBase)
      for (const pieza of piezas) { await actualizarStock('bovino_pieza', pieza.kg_editado) }
      showAlert('✅ Desposte en piezas completado — ' + piezas.length + ' piezas al stock')
      setSeleccionada(null); setPiezas([]); setNotas('')
      await cargarDatos(); onSaved()
    } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
    setLoading(false)
  }

  async function confirmarDesposteKilo() {
    if (!seleccionada) { showAlert('Selecciona una media res', 'error'); return }
    setLoading(true)
    try {
      const kgBase = seleccionada.kg_real || seleccionada.kg || 0
      const merma = MERMAS_KILO[tipoAnimal].merma
      const kgNeto = parseFloat((kgBase * (1 - merma)).toFixed(2))
      const precioCostoKg = seleccionada.precio_kg > 0 ? parseFloat((seleccionada.precio_kg / (1 - merma)).toFixed(0)) : 0
      const { data: desposteData, error } = await supabase.from('despostes').insert({
        fecha, entrada_id: seleccionada.id, modelo: 'KILO',
        tipo_desposte: 'kilo', tipo_animal: tipoAnimal,
        kg_media_res: kgBase, merma_pct: merma * 100, kg_neto: kgNeto,
        piezas: [{ nombre: 'Bovino cortes por kilo', kg: kgNeto, precio_costo_kg: precioCostoKg }],
        notas
      }).select().single()
      if (error) throw error
      await supabase.from('entradas_deposito').update({ despostada: true, desposte_id: desposteData.id }).eq('id', seleccionada.id)
      await actualizarStock('bovino_mr', -kgBase)
      await actualizarStock('bovino_corte', kgNeto)
      showAlert('✅ Media res enviada a cortes — ' + kgNeto.toFixed(1) + ' kg al stock')
      setSeleccionada(null); setNotas('')
      await cargarDatos(); onSaved()
    } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
    setLoading(false)
  }
async function confirmarDesposteCerdo() {
  if (!caponSeleccionado) { showAlert('Seleccioná un capón', 'error'); return }
  setLoading(true)
  try {
    const kgCapon = caponSeleccionado.kg_real || caponSeleccionado.kg || 0
    const piezasRegistradas = [
      { nombre: 'Piernas (x2)', kg: parseFloat(piezasCerdo.pierna) || 0, stock: 'cerdo_pierna' },
      { nombre: 'Carrés (x2)', kg: parseFloat(piezasCerdo.carre) || 0, stock: 'cerdo_carre' },
      { nombre: 'Pechitos (x2)', kg: parseFloat(piezasCerdo.pechito) || 0, stock: 'cerdo_pechito' },
      { nombre: 'Matambres (x2)', kg: parseFloat(piezasCerdo.matambre) || 0, stock: 'cerdo_matambre' },
      { nombre: 'Paletas (x2)', kg: parseFloat(piezasCerdo.paleta) || 0, stock: 'cerdo_paleta' },
      { nombre: 'Carnaza', kg: parseFloat(piezasCerdo.parrillero) || 0, stock: 'cerdo_parrillero' },
{ nombre: 'Huesos', kg: parseFloat(piezasCerdo.huesos) || 0, stock: 'cerdo_huesos' },
      { nombre: 'Bondiola s/hueso', kg: parseFloat(piezasCerdo.bondiola) || 0, stock: 'cerdo_bondiola' },
      { nombre: 'Tocino', kg: parseFloat(piezasCerdo.tocino) || 0, stock: 'cerdo_tocino' },
      { nombre: 'Cuero', kg: parseFloat(piezasCerdo.cuero) || 0, stock: 'cerdo_cuero' },
      { nombre: 'Cabeza', kg: parseFloat(piezasCerdo.cabeza) || 0, stock: 'cerdo_cabeza' },
    ].filter(p => p.kg > 0)
    await supabase.from('despostes').insert({
      fecha, entrada_id: caponSeleccionado.id, modelo: 'CERDO',
      tipo_desposte: 'cerdo', tipo_animal: 'cerdo',
      kg_media_res: kgCapon, merma_pct: 0, kg_neto: kgCapon,
      piezas: piezasRegistradas.map(p => ({ nombre: p.nombre, kg: p.kg, tipo_stock: p.stock })),
      notas
    })
    await supabase.from('entradas_deposito').update({ despostada: true }).eq('id', caponSeleccionado.id)
    await actualizarStock('cerdo', -kgCapon)
    for (const pieza of piezasRegistradas) {
      await actualizarStock(pieza.stock, pieza.kg)
    }
    showAlert('✅ Capón despostado — piezas al stock')
    setCaponSeleccionado(null)
    setPiezasCerdo({ pierna: '', carre: '', pechito: '', matambre: '', paleta: '', parrillero: '', bondiola: '', tocino: '', cuero: '', cabeza: '' })
    setNotas('')
    await cargarDatos(); onSaved()
  } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
  setLoading(false)
}
  async function confirmarConversionPieza() {
  if (!kgPiezaConvertir || !nombrePieza) { showAlert('Completa todos los campos', 'error'); return }
  const kg = parseFloat(kgPiezaConvertir)
  const merma = mermaPieza / 100
  const kgNeto = parseFloat((kg * (1 - merma)).toFixed(2))
  
  const PIEZA_A_STOCK = {
    '🦵 Pierna con hueso': 'pieza_pierna',
    '🥩 Cuarto pistola': 'pieza_cuarto_pistola',
    '🍖 Costillar completo': 'pieza_costillar',
    '🥩 Cortito': 'pieza_cortito',
    '🥩 Carré sin lomo': 'pieza_carre',
    '🥩 Paleta entera': 'pieza_paleta',
    '🥩 Parrillero': 'pieza_parrillero',
    '📦 Caja CB': 'caja_cb',
    '📦 Caja PT': 'caja_pt',
  }
  const tipoStock = PIEZA_A_STOCK[nombrePieza] || 'bovino_pieza'

  setLoading(true)
  try {
    await supabase.from('despostes').insert({
      fecha, entrada_id: null, modelo: 'PIEZA_KILO',
      tipo_desposte: 'pieza_kilo', tipo_animal: tipoAnimalPieza,
      kg_media_res: kg, merma_pct: merma * 100, kg_neto: kgNeto,
      piezas: [{ nombre: nombrePieza, kg: kgNeto, precio_costo_kg: parseFloat(precioCostoPieza) || 0 }],
      notas
    })
    await actualizarStock(tipoStock, -kg)
    await actualizarStock('bovino_corte', kgNeto)
    showAlert('✅ ' + nombrePieza + ' convertida — ' + kgNeto.toFixed(1) + ' kg al stock')
    setKgPiezaConvertir(''); setNombrePieza(''); setPrecioCostoPieza(''); setNotas('')
    await cargarDatos(); onSaved()
  } catch (err) { showAlert('❌ Error: ' + err.message, 'error') }
  setLoading(false)
}
  const kgBase = seleccionada ? (seleccionada.kg_real || seleccionada.kg || 0) : 0
  const kgNetoPiezas = kgBase * 0.975
  const kgTotalPiezas = piezas.reduce((s, p) => s + (p.kg_editado || 0), 0)
  const diferencia = kgNetoPiezas - kgTotalPiezas
  const mermaKilo = MERMAS_KILO[tipoAnimal]
  const kgNetoKilo = kgBase * (1 - mermaKilo.merma)
  const precioCostoKilo = seleccionada?.precio_kg > 0 ? (seleccionada.precio_kg / (1 - mermaKilo.merma)).toFixed(0) : 0
 const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '7px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, boxSizing: 'border-box' }

  return (
    <div>
      {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[{ id: 'piezas', label: '🍖 Desposte en Piezas' }, { id: 'kilo', label: '⚖️ Desposte para venta por Kilo' }, { id: 'pieza_kilo', label: '🔄 Convertir Pieza a Cortes' }, { id: 'cerdo', label: '🐷 Desposte Cerdo' },
{ id: 'historial', label: '📋 Historial' }].map(t => (
          <button key={t.id} onClick={() => { setSubtab(t.id); setSeleccionada(null); setPiezas([]); cargarDatos() }}
            style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${subtab === t.id ? 'var(--gold)' : 'var(--border)'}`, background: subtab === t.id ? 'var(--gold)' : 'transparent', color: subtab === t.id ? '#000' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      {subtab === 'piezas' && (
        <div style={{ display: 'grid', gridTemplateColumns: seleccionada ? '1fr 1.5fr' : '1fr', gap: 16 }}>
          <div>
            <div className="card">
              <div className="card-title">🐄 Medias Reses disponibles</div>
              {mediasRes.length === 0 ? <div className="empty">Sin medias reses para despostar</div> : mediasRes.map(e => (
                <div key={e.id} onClick={() => seleccionarMedia(e)}
                  style={{ padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: `2px solid ${seleccionada?.id === e.id ? 'var(--gold)' : 'var(--border)'}`, background: seleccionada?.id === e.id ? 'rgba(201,168,76,0.08)' : 'var(--surface2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>🐄 {e.descripcion || 'Media Res'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
                      {e.precio_kg > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>${Math.round(e.precio_kg).toLocaleString('es-AR')}/kg</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{(e.kg_real || e.kg || 0).toFixed(1)} kg</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Neto: {((e.kg_real || e.kg || 0) * 0.975).toFixed(1)} kg</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {seleccionada && (
            <div className="card" style={{ borderColor: 'var(--gold)' }}>
              <div className="card-title">🔪 Despostar en piezas: {seleccionada.descripcion || 'Media Res'}</div>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg entrada</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{kgBase.toFixed(1)} kg</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>Merma 2.5%</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--red-light)' }}>-{(kgBase * 0.025).toFixed(1)} kg</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg neto</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--green)' }}>{kgNetoPiezas.toFixed(1)} kg</div></div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
                <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Modelo</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {Object.entries(MODELOS_DESPOSTE).map(([id, m]) => (
                    <button key={id} onClick={() => cambiarModelo(id)}
                      style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: `2px solid ${modelo === id ? 'var(--gold)' : 'var(--border)'}`, background: modelo === id ? 'rgba(201,168,76,0.1)' : 'var(--surface2)', color: modelo === id ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12, textAlign: 'left' }}>
                      <div style={{ fontSize: 15, marginBottom: 3 }}>{id === 'A' ? '🅰️' : '🅱️'} Modelo {id}</div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>{m.piezas.map(p => p.nombre).join(' + ')}</div>
                    </button>
                  ))}
                </div>
              </div>
              <table style={{ marginBottom: 14 }}>
                <thead><tr><th>Pieza</th><th>%</th><th>Kg sugerido</th><th>Kg real</th><th style={{ color: 'var(--gold)' }}>Precio/kg</th><th style={{ color: 'var(--green)' }}>Valor</th></tr></thead>
                <tbody>
                  {piezas.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{(MODELOS_DESPOSTE[modelo].piezas[i]?.pct * 100).toFixed(1)}%</td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{p.kg.toFixed(1)} kg</td>
                      <td><input type="number" step="0.1" value={p.kg_editado} onChange={e => editarKg(i, e.target.value)} style={{ ...inp, width: 75, borderColor: Math.abs(p.kg_editado - p.kg) > 2 ? 'var(--amber)' : 'var(--border)' }} /></td>
                      <td><input type="number" value={p.precio_venta} onChange={e => editarPrecio(i, e.target.value)} style={{ ...inp, width: 100, borderColor: 'var(--gold)' }} /></td>
                      <td style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>${Math.round((p.kg_editado || 0) * (p.precio_venta || 0)).toLocaleString('es-AR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
                <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg en piezas</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--gold)' }}>{kgTotalPiezas.toFixed(1)} kg</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Diferencia</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: Math.abs(diferencia) > 5 ? 'var(--red-light)' : 'var(--green)' }}>{diferencia >= 0 ? '+' : ''}{diferencia.toFixed(1)} kg</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Valor total</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--green)' }}>${Math.round(piezas.reduce((s, p) => s + (p.kg_editado || 0) * (p.precio_venta || 0), 0)).toLocaleString('es-AR')}</div></div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => { setSeleccionada(null); setPiezas([]) }}>Cancelar</button>
                <button className="btn btn-gold" onClick={confirmarDespostePiezas} disabled={loading}>{loading ? '⏳ Procesando...' : '🔪 Confirmar desposte en piezas'}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {subtab === 'kilo' && (
        <div style={{ display: 'grid', gridTemplateColumns: seleccionada ? '1fr 1.2fr' : '1fr', gap: 16 }}>
          <div>
            <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#7db5ff', marginBottom: 6 }}>⚖️ Desposte para venta por kilo</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>La media res se desarma completa. Los kg netos van al stock de <strong style={{ color: 'var(--gold)' }}>Bovino Cortes</strong>.</div>
            </div>
            <div className="card">
              <div className="card-title">🐄 Seleccioná una media res</div>
              {mediasRes.length === 0 ? <div className="empty">Sin medias reses disponibles</div> : mediasRes.map(e => (
                <div key={e.id} onClick={() => setSeleccionada(e)}
                  style={{ padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: `2px solid ${seleccionada?.id === e.id ? 'var(--blue)' : 'var(--border)'}`, background: seleccionada?.id === e.id ? 'rgba(41,128,185,0.08)' : 'var(--surface2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>🐄 {e.descripcion || 'Media Res'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
                      {e.precio_kg > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>Costo: ${Math.round(e.precio_kg).toLocaleString('es-AR')}/kg</div>}
                    </div>
                    <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--blue)' }}>{(e.kg_real || e.kg || 0).toFixed(1)} kg</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {seleccionada && (
            <div className="card" style={{ borderColor: 'var(--blue)' }}>
              <div className="card-title">⚖️ Configurar desposte por kilo</div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Tipo de animal</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {Object.entries(MERMAS_KILO).map(([id, m]) => (
                    <button key={id} onClick={() => setTipoAnimal(id)}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${tipoAnimal === id ? m.color : 'var(--border)'}`, background: tipoAnimal === id ? m.color + '22' : 'var(--surface2)', color: tipoAnimal === id ? m.color : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>
                      <div>{m.label}</div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>Merma: {(m.merma * 100).toFixed(0)}%</div>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Kg entrada</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24 }}>{kgBase.toFixed(1)} kg</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Merma {(mermaKilo.merma * 100).toFixed(0)}%</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--red-light)' }}>-{(kgBase * mermaKilo.merma).toFixed(1)} kg</div></div>
                  <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Kg vendibles</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 24, color: 'var(--green)' }}>{kgNetoKilo.toFixed(1)} kg</div></div>
                </div>
                {seleccionada.precio_kg > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Costo compra: <strong style={{ color: 'var(--text)' }}>${Math.round(seleccionada.precio_kg).toLocaleString('es-AR')}/kg</strong></div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Costo real: <span style={{ color: 'var(--amber)', fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>${parseInt(precioCostoKilo).toLocaleString('es-AR')}/kg</span></div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>ℹ️ El costo real sube porque el mismo precio pagado rinde menos kg útiles.</div>
              </div>
              <div className="form-row" style={{ marginBottom: 14 }}>
                <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
                <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setSeleccionada(null)}>Cancelar</button>
                <button className="btn btn-gold" onClick={confirmarDesposteKilo} disabled={loading}>{loading ? '⏳ Procesando...' : `⚖️ Confirmar — ${kgNetoKilo.toFixed(1)} kg a Bovino Cortes`}</button>
              </div>
            </div>
          )}
        </div>
      )}

     {subtab === 'pieza_kilo' && (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
    <div>
      <div style={{ background: '#1a1a2a', border: '1px solid #2a2a5a', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#7db5ff', marginBottom: 6 }}>🔄 Convertir Pieza a Cortes</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Seleccioná una pieza del stock, ingresá los kg a convertir y los kg netos van a <strong style={{ color: 'var(--gold)' }}>Bovino Cortes</strong>.</div>
      </div>
      <div className="card">
        <div className="card-title">📦 Stock actual de piezas</div>
        {[
          { tipo: 'pieza_pierna', label: '🦵 Pierna con hueso' },
          { tipo: 'pieza_cuarto_pistola', label: '🥩 Cuarto pistola' },
          { tipo: 'pieza_costillar', label: '🍖 Costillar completo' },
          { tipo: 'pieza_cortito', label: '🥩 Cortito' },
          { tipo: 'pieza_carre', label: '🥩 Carré sin lomo' },
          { tipo: 'pieza_paleta', label: '🥩 Paleta entera' },
          { tipo: 'pieza_parrillero', label: '🥩 Parrillero' },
          { tipo: 'caja_cb', label: '📦 Caja CB' },
          { tipo: 'caja_pt', label: '📦 Caja PT' },
        ].map(p => (
          <div key={p.tipo} onClick={() => { setNombrePieza(p.label); setTipoPiezaSeleccionada(p.tipo); setKgPiezaConvertir((piezasStock[p.tipo] || 0).toString()); }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', borderBottom: '1px solid var(--border)', cursor: 'pointer', borderRadius: 6, background: nombrePieza === p.label ? 'rgba(201,168,76,0.08)' : 'transparent', border: nombrePieza === p.label ? '1px solid var(--gold)' : '1px solid transparent' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: (piezasStock[p.tipo] || 0) > 0 ? 'var(--gold)' : 'var(--muted)' }}>
              {(piezasStock[p.tipo] || 0).toFixed(1)} kg
            </span>
          </div>
        ))}
      </div>
    </div>
    <div className="card">
      <div className="card-title">🔄 Convertir pieza a cortes</div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Pieza seleccionada</label>
        <input value={nombrePieza} onChange={e => setNombrePieza(e.target.value)} placeholder="Clickeá una pieza del stock o escribí..." style={{ ...inp, borderColor: nombrePieza ? 'var(--gold)' : 'var(--border)' }} />
      </div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Kg a convertir</label>
        <input type="number" step="0.1" value={kgPiezaConvertir} onChange={e => setKgPiezaConvertir(e.target.value)} placeholder="0" style={{ ...inp, borderColor: 'var(--gold)' }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>% de merma de la pieza</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="number" step="0.5" min="0" max="50" value={mermaPieza} onChange={e => setMermaPieza(parseFloat(e.target.value) || 0)}
            style={{ ...inp, width: 80, borderColor: 'var(--gold)', textAlign: 'center', fontSize: 18, fontWeight: 700 }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>% — editable según la pieza</span>
        </div>
      </div>
      {kgPiezaConvertir > 0 && (
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
            <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg pieza</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20 }}>{parseFloat(kgPiezaConvertir).toFixed(1)} kg</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Merma {mermaPieza}%</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--red-light)' }}>-{(parseFloat(kgPiezaConvertir) * mermaPieza / 100).toFixed(1)} kg</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--muted)' }}>Kg a cortes</div><div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--green)' }}>{(parseFloat(kgPiezaConvertir) * (1 - mermaPieza / 100)).toFixed(1)} kg</div></div>
          </div>
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Precio costo/kg (opcional)</label>
        <input type="number" value={precioCostoPieza} onChange={e => setPrecioCostoPieza(e.target.value)} placeholder="Para referencia" style={inp} />
      </div>
      <div className="form-group" style={{ marginBottom: 14 }}>
        <label>Fecha</label>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} />
      </div>
      <button className="btn btn-gold" onClick={confirmarConversionPieza} disabled={loading || !kgPiezaConvertir || !nombrePieza} style={{ width: '100%' }}>
        {loading ? '⏳ Procesando...' : '🔄 Confirmar conversión a cortes'}
      </button>
    </div>
  </div>
)}
{subtab === 'cerdo' && (
  <div style={{ display: 'grid', gridTemplateColumns: caponSeleccionado ? '1fr 1.5fr' : '1fr', gap: 16 }}>
  <div>
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--amber)' }}>
      <div className="card-title">🐷 Stock piezas de cerdo</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { tipo: 'cerdo_pierna', label: '🦵 Piernas' },
          { tipo: 'cerdo_carre', label: '🥩 Carrés' },
          { tipo: 'cerdo_pechito', label: '🍖 Pechitos' },
          { tipo: 'cerdo_matambre', label: '🥩 Matambres' },
          { tipo: 'cerdo_paleta', label: '🥩 Paletas' },
          { tipo: 'cerdo_parrillero', label: '🥩 Parrillero' },
          { tipo: 'cerdo_bondiola', label: '🥩 Bondiola' },
          { tipo: 'cerdo_tocino', label: '🧀 Tocino' },
          { tipo: 'cerdo_cuero', label: '🟫 Cuero' },
          { tipo: 'cerdo_cabeza', label: '💀 Cabeza' },
        ].map(p => (
          <div key={p.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: (piezasStock[p.tipo] || 0) > 0 ? 'var(--amber)' : 'var(--muted)' }}>
              {(piezasStock[p.tipo] || 0).toFixed(1)} kg
            </span>
          </div>
        ))}
      </div>
    </div>
    <div className="card">
      <div className="card-title">🐷 Capones disponibles</div>
      {caponesDisponibles.length === 0 ? <div className="empty">Sin capones para despostar</div> : caponesDisponibles.map(e => (
        <div key={e.id} onClick={() => setCaponSeleccionado(e)}
          style={{ padding: 12, borderRadius: 8, marginBottom: 8, cursor: 'pointer', border: `2px solid ${caponSeleccionado?.id === e.id ? 'var(--amber)' : 'var(--border)'}`, background: caponSeleccionado?.id === e.id ? 'rgba(201,130,60,0.08)' : 'var(--surface2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>🐷 {e.descripcion || 'Capón'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
              {e.precio_kg > 0 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>${Math.round(e.precio_kg).toLocaleString('es-AR')}/kg</div>}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--amber)' }}>{(e.kg_real || e.kg || 0).toFixed(1)} kg</div>
          </div>
        </div>
      ))}
    </div>
  </div>
    {caponSeleccionado && (
      <div className="card" style={{ borderColor: 'var(--amber)' }}>
        <div className="card-title">🔪 Despostar capón: {caponSeleccionado.descripcion || 'Capón'} — {(caponSeleccionado.kg_real || caponSeleccionado.kg || 0).toFixed(1)} kg</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Ingresá los kg de cada pieza. Los valores son editables.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { id: 'pierna', label: '🦵 Piernas (x2)', stock: 'cerdo_pierna' },
            { id: 'carre', label: '🥩 Carrés (x2)', stock: 'cerdo_carre' },
            { id: 'pechito', label: '🍖 Pechitos (x2)', stock: 'cerdo_pechito' },
            { id: 'matambre', label: '🥩 Matambres (x2)', stock: 'cerdo_matambre' },
            { id: 'paleta', label: '🥩 Paletas (x2)', stock: 'cerdo_paleta' },
            { id: 'parrillero', label: '🥩 Carnaza', stock: 'cerdo_parrillero' },
{ id: 'huesos', label: '🦴 Huesos', stock: 'cerdo_huesos' },
            { id: 'bondiola', label: '🥩 Bondiola s/hueso', stock: 'cerdo_bondiola' },
            { id: 'tocino', label: '🧀 Tocino', stock: 'cerdo_tocino' },
            { id: 'cuero', label: '🟫 Cuero', stock: 'cerdo_cuero' },
            { id: 'cabeza', label: '💀 Cabeza', stock: 'cerdo_cabeza' },
          ].map(p => (
            <div key={p.id}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{p.label}</label>
              <input type="number" step="0.1" placeholder="0" value={piezasCerdo[p.id]} onChange={e => setPiezasCerdo(prev => ({ ...prev, [p.id]: e.target.value }))}
                style={{ ...inp, borderColor: piezasCerdo[p.id] ? 'var(--amber)' : 'var(--border)' }} />
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Kg capón:</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18 }}>{(caponSeleccionado.kg_real || caponSeleccionado.kg || 0).toFixed(1)} kg</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Kg registrados:</span>
            <span style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 18, color: 'var(--amber)' }}>
              {Object.values(piezasCerdo).reduce((s, v) => s + (parseFloat(v) || 0), 0).toFixed(1)} kg
            </span>
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 14 }}>
          <div className="form-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
          <div className="form-group"><label>Notas</label><input placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} style={inp} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={() => setCaponSeleccionado(null)}>Cancelar</button>
          <button className="btn btn-gold" onClick={confirmarDesposteCerdo} disabled={loading} style={{ background: 'var(--amber)' }}>
            {loading ? '⏳ Procesando...' : '🔪 Confirmar desposte de cerdo'}
          </button>
        </div>
      </div>
    )}
  </div>
)}
      {subtab === 'historial' && (
        <div className="card">
          <div className="card-title">📋 Historial de despostes</div>
          {despostes.length === 0 ? <div className="empty">Sin despostes registrados</div> : despostes.map(d => (
            <div key={d.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {d.tipo_desposte === 'piezas' ? '🍖 Piezas' : d.tipo_desposte === 'kilo' ? '⚖️ Por Kilo' : '🔄 Pieza a Kilo'}
                    {d.tipo_animal ? ` · ${MERMAS_KILO[d.tipo_animal]?.label || d.tipo_animal}` : ''}
                    {d.modelo && d.modelo !== 'KILO' && d.modelo !== 'PIEZA_KILO' ? ` · Modelo ${d.modelo}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{d.fecha} · {d.kg_media_res?.toFixed(1)} kg — {d.kg_neto?.toFixed(1)} kg neto</div>
                  {d.notas && <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{d.notas}</div>}
                </div>
                <span style={{ background: d.tipo_desposte === 'piezas' ? '#2a2010' : '#1a1a2a', color: d.tipo_desposte === 'piezas' ? 'var(--gold)' : '#7db5ff', borderRadius: 6, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                  {d.tipo_desposte === 'piezas' ? 'PIEZAS' : d.tipo_desposte === 'kilo' ? 'X KILO' : 'PIEZA→KILO'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(d.piezas || []).map((p, i) => (
                  <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text2)' }}>
                    {p.nombre}: {p.kg?.toFixed(1)} kg{p.precio_venta > 0 ? ` · $${Math.round(p.precio_venta).toLocaleString('es-AR')}/kg` : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function EntradaForm({ onSaved, showAlert, proveedores }) {
  const [form, setForm] = useState({ tipo: '', proveedor: '', descripcion: '', fecha: new Date().toISOString().split('T')[0], kg: '', precioKg: '9800', merma: '', destino: 'DEPOSITO', importe: '' })
  const [historial, setHistorial] = useState([])
  const [editando, setEditando] = useState(null)
  const [formEdit, setFormEdit] = useState({})

  useEffect(() => { cargarHistorial() }, [])

  async function cargarHistorial() {
    const { data } = await supabase.from('entradas_deposito').select('*').order('fecha', { ascending: false }).limit(100)
    setHistorial(data || [])
  }

  async function guardar() {
    if (!form.tipo || !form.proveedor || !form.kg) { showAlert({ type: 'error', msg: 'Completá los campos requeridos' }); return }
    const kgReal = parseFloat(form.kg) * (1 - (parseFloat(form.merma) || 0) / 100)
    const importe = form.tipo === 'bovino_mr'
      ? parseFloat(form.kg) * parseFloat(form.precioKg)
      : parseFloat(form.importe) || 0
    const { error } = await supabase.from('entradas_deposito').insert({
      fecha: form.fecha, tipo: form.tipo, proveedor_nombre: form.proveedor,
      descripcion: form.descripcion || form.tipo, kg: parseFloat(form.kg), kg_real: kgReal,
      merma_pct: parseFloat(form.merma) || 0, precio_kg: parseFloat(form.precioKg) || 0,
      importe, destino: form.destino, cantidad: 1
    })
    if (error) { showAlert({ type: 'error', msg: error.message }); return }
    const kgSumar = form.tipo === 'bovino_mr' ? kgReal : parseFloat(form.kg)
    await actualizarStock(form.tipo, kgSumar)
    await supabase.from('compras_proveedores').insert({
      fecha: form.fecha, proveedor_nombre: form.proveedor,
      producto: form.descripcion || form.tipo,
      kg: parseFloat(form.kg), importe
    })
    showAlert({ type: 'success', msg: '✅ Entrada registrada — Stock actualizado' })
    setForm(f => ({ ...f, descripcion: '', kg: '', importe: '', precioKg: '9800' }))
    onSaved()
    cargarHistorial()
    setTimeout(() => showAlert(null), 3000)
  }

async function eliminar(entrada) {
  if (!confirm(`¿Eliminar esta entrada de ${entrada.kg} kg de ${entrada.proveedor_nombre}?`)) return
  
  if (entrada.despostada && entrada.desposte_id) {
    const { data: desposte } = await supabase.from('despostes').select('*').eq('id', entrada.desposte_id).single()
    if (desposte) {
      if (desposte.tipo_desposte === 'piezas') {
        const kgPiezas = (desposte.piezas || []).reduce((s, p) => s + (p.kg || 0), 0)
        await actualizarStock('bovino_pieza', -kgPiezas)
      } else if (desposte.tipo_desposte === 'kilo') {
        await actualizarStock('bovino_corte', -(desposte.kg_neto || 0))
      } else if (desposte.tipo_desposte === 'pieza_kilo') {
        await actualizarStock('bovino_corte', -(desposte.kg_neto || 0))
      }
      await supabase.from('despostes').delete().eq('id', entrada.desposte_id)
    }
  }
  await supabase.from('compras_proveedores').delete()
  .eq('fecha', entrada.fecha)
  .eq('proveedor_nombre', entrada.proveedor_nombre)
  .eq('kg', entrada.kg)
  await supabase.from('entradas_deposito').delete().eq('id', entrada.id)
  await actualizarStock(entrada.tipo, -(entrada.kg_real || entrada.kg))
  showAlert({ type: 'success', msg: '🗑️ Entrada y desposte eliminados — Stock revertido' })
  cargarHistorial()
  onSaved()
}

  function abrirEdicion(entrada) {
    setEditando(entrada.id)
    setFormEdit({
      fecha: entrada.fecha,
      descripcion: entrada.descripcion || '',
      kg: entrada.kg || '',
      precioKg: entrada.precio_kg || '',
      proveedor: entrada.proveedor_nombre || '',
      destino: entrada.destino || 'DEPOSITO',
    })
  }

  async function guardarEdicion(entrada) {
    const kgAnterior = entrada.kg_real || entrada.kg || 0
    const kgNuevo = parseFloat(formEdit.kg) || 0
    const kgReal = kgNuevo * (1 - (entrada.merma_pct || 0) / 100)
    const diferencia = kgReal - kgAnterior
    await supabase.from('entradas_deposito').update({
      fecha: formEdit.fecha,
      descripcion: formEdit.descripcion,
      kg: kgNuevo,
      kg_real: kgReal,
      precio_kg: parseFloat(formEdit.precioKg) || 0,
      proveedor_nombre: formEdit.proveedor,
      destino: formEdit.destino,
      importe: kgNuevo * (parseFloat(formEdit.precioKg) || 0)
    }).eq('id', entrada.id)
    if (diferencia !== 0) await actualizarStock(entrada.tipo, diferencia)
    setEditando(null)
    showAlert({ type: 'success', msg: '✅ Entrada actualizada' })
    cargarHistorial()
    onSaved()
  }

  const TIPOS = {
    bovino_mr: '🐄 Media Res', bovino_corte: '🥩 Bovino Corte',
    bovino_brosa: '🫀 Brosa', cerdo: '🐷 Cerdo',
    pollo: '🍗 Pollo', embutido: '🌭 Embutido'
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Registrar entrada al depósito</div>
        <div className="form-row">
          <div className="form-group"><label>Tipo de producto</label>
            <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
              <option value="">— Seleccioná —</option>
<option value="bovino_mr">🐄 Media Res</option>
<option value="pieza_pierna">🦵 Pierna bovina con hueso</option>
<option value="pieza_cuarto_pistola">🥩 Cuarto pistola</option>
<option value="pieza_costillar">🍖 Costillar completo</option>
<option value="pieza_cortito">🥩 Cortito</option>
<option value="pieza_carre">🥩 Carré sin lomo</option>
<option value="pieza_paleta">🥩 Paleta entera</option>
<option value="pieza_parrillero">🥩 Parrillero</option>
<option value="caja_cb">📦 Caja bovina CB</option>
<option value="caja_pt">📦 Caja bovina PT</option>
<option value="bovino_brosa">🫀 Bovino — Brosa</option>
<option value="cerdo">🐷 Cerdo — Capón</option>
<option value="pollo">🍗 Pollo — Cajón</option>
<option value="embutido">🌭 Embutido/Rebozado</option>
            </select>
          </div>
          <div className="form-group"><label>Fecha</label>
            <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Proveedor</label>
            <select value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}>
              <option value="">— Seleccioná —</option>
              {proveedores.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Descripción</label>
            <input placeholder="Ej: Novillito Premium..." value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Kg</label>
            <input type="number" step="0.1" placeholder="0" value={form.kg} onChange={e => setForm(f => ({ ...f, kg: e.target.value }))} />
          </div>
          <div className="form-group"><label>Precio/kg ($)</label>
            <input type="number" value={form.precioKg} onChange={e => setForm(f => ({ ...f, precioKg: e.target.value }))} placeholder="Precio por kg" />
          </div>
        </div>
        <div className="form-row">
          {form.tipo === 'bovino_mr' && (
            <div className="form-group"><label>Merma % (opcional)</label>
              <input type="number" step="0.5" placeholder="2.5" value={form.merma} onChange={e => setForm(f => ({ ...f, merma: e.target.value }))} />
            </div>
          )}
          {form.tipo !== 'bovino_mr' && (
            <div className="form-group"><label>Importe total ($)</label>
              <input type="number" placeholder="0" value={form.importe} onChange={e => setForm(f => ({ ...f, importe: e.target.value }))} />
            </div>
          )}
          <div className="form-group"><label>Destino</label>
            <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value }))}>
              <option value="MITRE">Local Mitre</option>
              <option value="CENTRO">Centro</option>
              <option value="MONTE CRISTO">Monte Cristo</option>
              <option value="CLIENTE">Cliente externo</option>
              <option value="DEPOSITO">Queda en depósito</option>
            </select>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>
          ✅ La entrada actualizará el stock y se registrará en Cuenta Proveedores
        </div>
        <button className="btn btn-gold" onClick={guardar}>✅ Registrar entrada</button>
      </div>

      <div className="card">
        <div className="card-title">📋 Historial de entradas ({historial.length})</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Proveedor</th>
              <th>Descripción</th>
              <th>Kg</th>
              <th>Precio/kg</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {historial.map(e => (
              editando === e.id ? (
                <tr key={e.id} style={{ background: 'rgba(201,168,76,0.08)' }}>
                  <td><input type="date" value={formEdit.fecha} onChange={x => setFormEdit(f => ({ ...f, fecha: x.target.value }))} style={{ ...inp, width: 130 }} /></td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{TIPOS[e.tipo] || e.tipo}</td>
                  <td><input value={formEdit.proveedor} onChange={x => setFormEdit(f => ({ ...f, proveedor: x.target.value }))} style={{ ...inp, width: 110 }} /></td>
                  <td><input value={formEdit.descripcion} onChange={x => setFormEdit(f => ({ ...f, descripcion: x.target.value }))} style={{ ...inp, width: 130 }} /></td>
                  <td><input type="number" step="0.1" value={formEdit.kg} onChange={x => setFormEdit(f => ({ ...f, kg: x.target.value }))} style={{ ...inp, width: 70, borderColor: 'var(--gold)' }} /></td>
                  <td><input type="number" value={formEdit.precioKg} onChange={x => setFormEdit(f => ({ ...f, precioKg: x.target.value }))} style={{ ...inp, width: 90 }} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => guardarEdicion(e)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>💾</button>
                      <button onClick={() => setEditando(null)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td>{e.fecha}</td>
                  <td style={{ fontSize: 12 }}>{TIPOS[e.tipo] || e.tipo}</td>
                  <td>{e.proveedor_nombre}</td>
                  <td>{e.descripcion}</td>
                  <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{(e.kg_real || e.kg || 0).toFixed(1)} kg</td>
                  <td style={{ color: 'var(--muted)' }}>{e.precio_kg > 0 ? '$' + Math.round(e.precio_kg).toLocaleString('es-AR') : '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => abrirEdicion(e)} style={{ background: 'var(--amber)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff' }}>✏️</button>
                      <button onClick={() => eliminar(e)} style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: '#ff6b6b' }}>🗑️</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {historial.length === 0 && <tr><td colSpan={7} className="empty">Sin entradas registradas</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SalidaForm({ onSaved, showAlert, onRemito, setTab }) {
  const [form, setForm] = useState({ destino: 'MITRE', clienteId: '', clienteNombre: '', domicilio: '', fecha: new Date().toISOString().split('T')[0], categoria: '', productoId: '', kg: '', precio: '', cobro: 'cta_cte', notas: '' })
  const [items, setItems] = useState([])
  const [todosPrecios, setTodosPrecios] = useState([])
  const [clientes, setClientes] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [mostrarClientes, setMostrarClientes] = useState(false)
  const [mediasDisponibles, setMediasDisponibles] = useState([])
  const [mediaSeleccionada, setMediaSeleccionada] = useState(null)
  useEffect(() => {
    supabase.from('precios').select('*').order('nombre').then(({ data }) => setTodosPrecios(data || []))
    supabase.from('clientes').select('*').order('nombre').then(({ data }) => setClientes(data || []))
  supabase.from('entradas_deposito').select('*').eq('tipo', 'bovino_mr').eq('despostada', false).eq('reservada', false).order('fecha', { ascending: false }).then(({ data }) => setMediasDisponibles(data || []))
  }, [])

const CATEGORIAS = {
    bovino_mr: '🐄 Media Reses',
    bovino_corte: '🥩 Bovinos — Cortes',
    bovino_brosa: '🫀 Brosas',
    bovino_pieza: '🍖 Piezas',
    bovino_caja_cb: '📦 Cajas Bovinas CB',
    bovino_caja_pt: '📦 Cajas Bovinas PT',
    cerdo_corte: '🐷 Cerdo — Cortes',
    cerdo_pieza: '🐷 Cerdo — Piezas',
    embutido: '🌭 Embutidos',
    pollo: '🍗 Pollo Cajones',
    rebozado: '🧊 Rebozados',
  }
const CATEGORIA_A_STOCK = {
    bovino_mr: 'bovino_mr',
    bovino_corte: 'bovino_corte',
    bovino_brosa: 'bovino_brosa',
    bovino_pieza: 'bovino_pieza',
    bovino_caja_cb: 'caja_cb',
    bovino_caja_pt: 'caja_pt',
    pieza_pierna: 'pieza_pierna',
    pieza_cuarto_pistola: 'pieza_cuarto_pistola',
    pieza_costillar: 'pieza_costillar',
    pieza_cortito: 'pieza_cortito',
    pieza_carre: 'pieza_carre',
    pieza_paleta: 'pieza_paleta',
    pieza_parrillero: 'pieza_parrillero',
    caja_cb: 'caja_cb',
    caja_pt: 'caja_pt',
    cerdo_corte: 'cerdo',
    cerdo_pieza: 'cerdo_pieza',
    cerdo: 'cerdo',
    embutido: 'embutido',
    pollo: 'pollo',
    rebozado: 'rebozado',
  }
  
  const DESTINOS_FRANQUICIA = { 'CENTRO': 'ALVEAR', 'MONTE CRISTO': 'MONTE CRISTO' }
  const categorias = [...new Set(todosPrecios.map(p => p.categoria))]
  const productosFiltrados = todosPrecios.filter(p => p.categoria === form.categoria)
  const clientesFiltrados = clientes.filter(c => c.nombre.toLowerCase().includes(busqueda.toLowerCase()))
  const esClienteExterno = ['carniceria', 'mayorista'].includes(form.destino)
  const esFranquicia = ['CENTRO', 'MONTE CRISTO'].includes(form.destino)

  function getLista(dest) { return dest === 'mayorista' ? 'precio_mayorista' : 'precio_carniceria' }

  function seleccionarCliente(c) {
    setForm(f => ({ ...f, clienteId: c.id, clienteNombre: c.nombre, domicilio: c.domicilio || '' }))
    setBusqueda(c.nombre)
    setMostrarClientes(false)
  }

  function onProductoChange(id) {
    if (!id) return
    const prod = todosPrecios.find(p => p.id === id)
    if (!prod) return
    const precio = prod[getLista(form.destino)] || prod.precio_mayorista || 0
    setForm(f => ({ ...f, productoId: id, precio }))
  }
async function agregarItem() {
    if (!form.kg || !form.precio) { showAlert({ type: 'error', msg: 'Completá kg y precio' }); return }
    if (form.categoria !== 'bovino_mr' && !form.productoId) { showAlert({ type: 'error', msg: 'Seleccioná un producto' }); return }
    const prod = todosPrecios.find(p => p.id === form.productoId)
    const descripcion = form.categoria === 'bovino_mr' 
      ? (mediaSeleccionada ? `Media Res — ${mediaSeleccionada.descripcion || mediaSeleccionada.proveedor_nombre}` : 'Media Res')
      : (prod?.nombre || '')
    const prodItem = form.categoria !== 'bovino_mr' ? todosPrecios.find(p => p.id === form.productoId) : null
const item = {
  descripcion,
  kg: parseFloat(form.kg),
  precio: parseFloat(form.precio),
  importe: parseFloat(form.kg) * parseFloat(form.precio),
  tipo: form.categoria,
  stock_origen: prodItem?.stock_origen || null
}
    setItems(prev => [...prev, item])
    setForm(f => ({ ...f, kg: '', productoId: '', precio: '', categoria: '' }))
    if (mediaSeleccionada) {
      await supabase.from('entradas_deposito').update({ 
        reservada: true, 
        reservada_para: 'remito en proceso',
        reservada_en: new Date().toISOString()
      }).eq('id', mediaSeleccionada.id)
      setMediasDisponibles(prev => prev.filter(m => m.id !== mediaSeleccionada.id))
      setMediaSeleccionada(null)
    }
  }
 
  function quitarItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }
  const total = items.reduce((s, i) => s + i.importe, 0)

  async function guardar() {
    if (items.length === 0) { showAlert({ type: 'error', msg: 'Agregá al menos un producto' }); return }
    let clienteId = form.clienteId
    let clienteNombre = form.clienteNombre || form.destino
    let domicilio = form.domicilio

    if (esFranquicia) {
      const nombreBuscar = DESTINOS_FRANQUICIA[form.destino]
      const { data: clienteFranquicia } = await supabase.from('clientes').select('*').ilike('nombre', `%${nombreBuscar}%`).single()
      if (clienteFranquicia) {
        clienteId = clienteFranquicia.id
        clienteNombre = clienteFranquicia.nombre
        domicilio = clienteFranquicia.domicilio || form.destino
      }
    }

    for (const item of items) {
      await supabase.from('salidas_deposito').insert({
        fecha: form.fecha, cliente_nombre: clienteNombre,
        tipo: item.tipo, descripcion: item.descripcion,
        kg: item.kg, precio_kg: item.precio,
        total: item.importe, lista: getLista(form.destino),
        cobro: form.cobro, notas: form.notas
      })
    }

    const kgPorTipo = {}
for (const item of items) {
  const tipoStock = item.stock_origen || CATEGORIA_A_STOCK[item.tipo] || item.tipo
  kgPorTipo[tipoStock] = (kgPorTipo[tipoStock] || 0) + item.kg
}
   for (const [tipo, kg] of Object.entries(kgPorTipo)) {
      await actualizarStock(tipo, -kg)
    }
      if (mediaSeleccionada) {
      await supabase.from('entradas_deposito').update({ despostada: true }).eq('id', mediaSeleccionada.id)
      setMediaSeleccionada(null)
      const { data: medias } = await supabase.from('entradas_deposito').select('*').eq('tipo', 'bovino_mr').eq('despostada', false).eq('reservada', false).order('fecha', { ascending: false })
      setMediasDisponibles(medias || [])
    }
    const { data: remitoData } = await supabase.from('remitos').insert({     fecha: form.fecha, cliente_nombre: clienteNombre,
      cliente_id: clienteId || null, domicilio,
      items, total, cobro: form.cobro, notas: form.notas
    }).select().single()

    if (clienteId) {
      const { data: clienteActual } = await supabase.from('clientes').select('saldo').eq('id', clienteId).single()
      const nuevoSaldo = (clienteActual?.saldo || 0) + total
      await supabase.from('movimientos_ctacte').insert({
        cliente_id: clienteId, fecha: form.fecha, tipo: 'compra',
        descripcion: `Remito N° ${String(remitoData?.numero || '').padStart(5, '0')} — ${items.map(i => i.descripcion).join(', ')}`,
        debe: total, haber: 0, saldo: nuevoSaldo, remito_id: remitoData?.id || null
      })
      await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', clienteId)
    }

    showAlert({ type: 'success', msg: '✅ Despacho registrado — Stock descontado — Remito generado' })
    onRemito(remitoData)
    setItems([])
    setBusqueda('')
    setForm({ destino: 'MITRE', clienteId: '', clienteNombre: '', domicilio: '', fecha: new Date().toISOString().split('T')[0], categoria: '', productoId: '', kg: '', precio: '', cobro: 'cta_cte', notas: '' })
    onSaved()
    setTimeout(() => { showAlert(null); setTab('remitos') }, 1500)
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Registrar despacho</div>
        <div className="form-row">
          <div className="form-group"><label>Destino</label>
            <select value={form.destino} onChange={e => setForm(f => ({ ...f, destino: e.target.value, clienteId: '', clienteNombre: '' }))}>
              <option value="MITRE">Local Mitre</option>
              <option value="CENTRO">🏪 Centro — Alvear (Roxana)</option>
              <option value="MONTE CRISTO">🏪 Monte Cristo (Agustín)</option>
              <option value="carniceria">Carnicería cliente</option>
              <option value="mayorista">Gastronómico / Mayorista</option>
            </select>
          </div>
          <div className="form-group"><label>Fecha</label>
            <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          </div>
        </div>
{form.categoria === 'bovino_mr' && (
  <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 700, color: '#7dff7d', marginBottom: 10 }}>🐄 Seleccioná la media res a despachar</div>
    {mediasDisponibles.length === 0 ? (
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin medias reses disponibles</div>
    ) : mediasDisponibles.map(e => (
      <div key={e.id} onClick={() => { setMediaSeleccionada(e); setForm(f => ({ ...f, kg: (e.kg_real || e.kg || 0).toString() })) }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer', border: `2px solid ${mediaSeleccionada?.id === e.id ? 'var(--gold)' : 'var(--border)'}`, background: mediaSeleccionada?.id === e.id ? 'rgba(201,168,76,0.1)' : 'var(--surface2)' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>🐄 {e.descripcion || 'Media Res'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{e.fecha} · {e.proveedor_nombre}</div>
        </div>
        <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 22, color: 'var(--gold)' }}>{(e.kg_real || e.kg || 0).toFixed(1)} kg</div>
      </div>
    ))}
  </div>
)}
        {esFranquicia && (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 600 }}>🏪 Franquicia — el remito se cargará automáticamente en su legajo</span>
          </div>
        )}

        {esClienteExterno && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Buscar cliente</label>
            <input value={busqueda}
              onChange={e => { setBusqueda(e.target.value); setMostrarClientes(true); setForm(f => ({ ...f, clienteId: '', clienteNombre: e.target.value })) }}
              onFocus={() => setMostrarClientes(true)}
              placeholder="Escribí el nombre del cliente..."
              style={{ background: 'var(--surface)', border: '1px solid var(--gold)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 14, width: '100%', boxSizing: 'border-box' }} />
            {mostrarClientes && clientesFiltrados.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 100, maxHeight: 200, overflowY: 'auto' }}>
                {clientesFiltrados.map(c => (
                  <div key={c.id} onClick={() => seleccionarCliente(c)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <span style={{ fontWeight: 600 }}>{c.nombre}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.tipo}</span>
                  </div>
                ))}
              </div>
            )}
            {form.clienteId && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>✅ Cliente vinculado</div>}
          </div>
        )}

        {!esFranquicia && (
          <div className="form-row">
            <div className="form-group"><label>Señor/a</label>
              <input placeholder="Nombre" value={form.clienteNombre} onChange={e => setForm(f => ({ ...f, clienteNombre: e.target.value }))} disabled={!!form.clienteId} style={{ opacity: form.clienteId ? 0.6 : 1 }} />
            </div>
            <div className="form-group"><label>Domicilio</label>
              <input placeholder="Dirección" value={form.domicilio} onChange={e => setForm(f => ({ ...f, domicilio: e.target.value }))} />
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group"><label>Categoría</label>
            <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value, productoId: '', precio: '' }))}>
              <option value="">— Seleccioná —</option>
              {categorias.map(c => <option key={c} value={c}>{CATEGORIAS[c] || c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Producto</label>
            <select value={form.productoId} onChange={e => onProductoChange(e.target.value)} disabled={!form.categoria}>
              <option value="">— Seleccioná producto —</option>
              {productosFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group"><label>Kg</label>
            <input type="number" step="0.1" placeholder="0" value={form.kg} onChange={e => setForm(f => ({ ...f, kg: e.target.value }))} />
          </div>
          <div className="form-group"><label>Precio/kg</label>
            <input type="number" value={form.precio} onChange={e => setForm(f => ({ ...f, precio: e.target.value }))} style={{ borderColor: 'var(--gold)' }} />
          </div>
        </div>

        <button className="btn btn-ghost" onClick={agregarItem} style={{ marginBottom: 16 }}>➕ Agregar producto al remito</button>

        {items.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <table>
              <thead><tr><th>Descripción</th><th>Kg</th><th>Precio/kg</th><th>Importe</th><th></th></tr></thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.descripcion}</td>
                    <td>{item.kg} kg</td>
                    <td>${Math.round(item.precio).toLocaleString('es-AR')}</td>
                    <td style={{ color: 'var(--gold)' }}>${Math.round(item.importe).toLocaleString('es-AR')}</td>
                    <td><button onClick={() => quitarItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer' }}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', fontFamily: "'Bebas Neue', cursive", fontSize: 28, color: 'var(--gold)', marginTop: 8 }}>
              TOTAL: ${Math.round(total).toLocaleString('es-AR')}
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group"><label>Forma de cobro</label>
            <select value={form.cobro} onChange={e => setForm(f => ({ ...f, cobro: e.target.value }))}>
              <option value="cta_cte">Cuenta corriente</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="echeq">E-cheq</option>
            </select>
          </div>
          <div className="form-group"><label>Notas</label>
            <input placeholder="Observaciones" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>
        </div>
        <button className="btn btn-gold" onClick={guardar}>📤 Registrar despacho y generar remito</button>
      </div>
    </div>
  )
}

function RemitosTab({ remitoActual }) {
  const [remitos, setRemitos] = useState([])
  const [seleccionado, setSeleccionado] = useState(remitoActual)
  const [anulando, setAnulando] = useState(false)
  const [editando, setEditando] = useState(null)
  const [itemsEdit, setItemsEdit] = useState([])
  const [alert, setAlert] = useState(null)
  const [todosPrecios, setTodosPrecios] = useState([])
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  const [nuevoProductoId, setNuevoProductoId] = useState('')
  const [nuevoKg, setNuevoKg] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')
 const CATEGORIAS = {
    bovino_mr: '🐄 Media Reses', bovino_corte: '🥩 Bovinos — Cortes',
    bovino_brosa: '🫀 Brosas', bovino_pieza: '🍖 Piezas',
    bovino_caja_cb: '📦 Cajas CB', bovino_caja_pt: '📦 Cajas PT',
    cerdo_corte: '🐷 Cerdo — Cortes',
    cerdo_pieza: '🐷 Cerdo — Piezas',
    embutido: '🌭 Embutidos',
    pollo: '🍗 Pollo', rebozado: '🧊 Rebozados',
  }
  useEffect(() => {
    cargarRemitos()
    supabase.from('precios').select('*').order('nombre').then(({ data }) => setTodosPrecios(data || []))
  }, [])

  useEffect(() => { if (remitoActual) setSeleccionado(remitoActual) }, [remitoActual])

  async function cargarRemitos() {
    const { data } = await supabase.from('remitos').select('*').order('created_at', { ascending: false }).limit(30)
    setRemitos(data || [])
  }
  async function eliminarRemito(remito) {
  if (anulando) return
  if (!confirm(`¿Eliminar Remito N° ${String(remito.numero).padStart(5,'0')} de ${remito.cliente_nombre} por $${Math.round(remito.total).toLocaleString('es-AR')}?`)) return
  
  setAnulando(true)
  const { data: remitoActual } = await supabase.from('remitos').select('eliminado').eq('id', remito.id).single()
  if (remitoActual?.eliminado) {
    showAlert('Este remito ya fue anulado', 'error')
    setAnulando(false)
    return
  }
  const { data: { user } } = await supabase.auth.getUser()
  const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).single()
  const eliminadoPor = perfil?.nombre || user.email
  await supabase.from('remitos').update({
    eliminado: true,
    eliminado_por: eliminadoPor,
    eliminado_en: new Date().toISOString()
  }).eq('id', remito.id)
  if (remito.cliente_id) {
    const { data: clienteActual } = await supabase.from('clientes').select('saldo').eq('id', remito.cliente_id).single()
    const nuevoSaldo = (clienteActual?.saldo || 0) - remito.total
    await supabase.from('clientes').update({ saldo: nuevoSaldo }).eq('id', remito.cliente_id)
    await supabase.from('movimientos_ctacte').delete().eq('remito_id', remito.id)
  }
  showAlert('🗑️ Remito anulado', 'success')
  setAnulando(false)
  cargarRemitos()
}
function showAlert(msg, type = 'success') { setAlert({ msg, type }); setTimeout(() => setAlert(null), 4000) }

  function abrirEdicion(remito) {
    setEditando(remito)
    setItemsEdit(JSON.parse(JSON.stringify(remito.items || [])))
    setSeleccionado(null)
  }

  function editarItem(idx, campo, valor) {
    setItemsEdit(prev => {
      const items = [...prev]
      items[idx] = { ...items[idx], [campo]: parseFloat(valor) || valor }
      if (campo === 'kg' || campo === 'precio') {
        items[idx].importe = (parseFloat(items[idx].kg) || 0) * (parseFloat(items[idx].precio) || 0)
      }
      return items
    })
  }

  function quitarItemEdit(idx) { setItemsEdit(prev => prev.filter((_, i) => i !== idx)) }

  function agregarItemEdit() {
    if (!nuevoKg || !nuevoPrecio || !nuevoProductoId) return
    const prod = todosPrecios.find(p => p.id === nuevoProductoId)
    const item = {
      descripcion: prod?.nombre || '',
      kg: parseFloat(nuevoKg),
      precio: parseFloat(nuevoPrecio),
      importe: parseFloat(nuevoKg) * parseFloat(nuevoPrecio),
      tipo: nuevaCategoria
    }
    setItemsEdit(prev => [...prev, item])
    setNuevoKg(''); setNuevoPrecio(''); setNuevoProductoId(''); setNuevaCategoria('')
  }

  async function guardarEdicion() {
    if (itemsEdit.length === 0) { showAlert('Debe tener al menos un producto', 'error'); return }
    const nuevoTotal = itemsEdit.reduce((s, i) => s + (parseFloat(i.importe) || 0), 0)
    const diferencia = nuevoTotal - (editando.total || 0)

    await supabase.from('remitos').update({ items: itemsEdit, total: nuevoTotal }).eq('id', editando.id)

    if (editando.cliente_id && diferencia !== 0) {
      const { data: movs } = await supabase.from('movimientos_ctacte').select('*').eq('remito_id', editando.id).maybeSingle()
      if (movs) {
        await supabase.from('movimientos_ctacte').update({
          debe: (movs.debe || 0) + diferencia,
          saldo: (movs.saldo || 0) + diferencia,
          descripcion: `Remito N° ${String(editando.numero || '').padStart(5, '0')} — ${itemsEdit.map(i => i.descripcion).join(', ')} ✏️ Editado`
        }).eq('id', movs.id)
      }
      const { data: clienteActual } = await supabase.from('clientes').select('saldo').eq('id', editando.cliente_id).single()
      await supabase.from('clientes').update({ saldo: (clienteActual?.saldo || 0) + diferencia }).eq('id', editando.cliente_id)
    }

    showAlert(`✅ Remito N° ${String(editando.numero).padStart(5, '0')} actualizado`)
    setEditando(null); setItemsEdit([])
    cargarRemitos()
  }

  function imprimir(remito) {
    const items = remito.items || []
    const win = window.open('', '_blank')
    win.document.write(`<html><head><title>Remito N° ${remito.numero}</title>
      <style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; max-width: 400px; margin: 0 auto; } .header { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; } table { width: 100%; border-collapse: collapse; margin: 12px 0; } th { border: 1px solid #000; padding: 4px; text-align: center; font-size: 10px; font-weight: 700; background: #f0f0f0; } td { border: 1px solid #000; padding: 4px; text-align: center; font-size: 11px; } td.desc { text-align: left; } .total-box { border: 1px solid #000; padding: 6px 12px; font-size: 13px; font-weight: 700; } .firma { margin-top: 40px; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 10px; } @media print { body { padding: 10px; } }</style></head>
      <body>
        <div class="header"><div><div style="font-size:22px;font-weight:900;letter-spacing:2px">FABRICIUS</div><div style="font-size:9px;color:#555">CARNICERÍAS · PREMIUM QUALITY</div><div style="font-size:10px;color:#444;margin-top:4px">📍 Casa Central: Av. Mitre 670 - Río Primero, Córdoba</div><div style="font-size:11px;font-weight:700;background:#000;color:#fff;padding:3px 8px;display:inline-block;border-radius:4px;margin-top:4px">📱 3574 400346</div></div><div style="text-align:right"><div style="font-size:10px;font-weight:700;border:1px solid #000;padding:2px 6px;margin-bottom:4px;text-align:center">X — DOCUMENTO NO VÁLIDO COMO FACTURA</div><div style="font-size:24px;font-weight:900;font-style:italic">REMITO</div><div style="font-size:13px;font-weight:700">N° ${String(remito.numero).padStart(5, '0')}</div></div></div>
        <div style="font-size:11px;margin-bottom:8px">Fecha: <strong>${remito.fecha}</strong></div>
        <div style="border-bottom:1px solid #000;margin-bottom:8px;padding-bottom:2px"><span style="font-size:10px;font-weight:700;margin-right:6px">Señor/a:</span>${remito.cliente_nombre || ''}</div>
        <table><thead><tr><th style="width:40%">DESCRIPCIÓN</th><th style="width:15%">KG</th><th style="width:22%">PRECIO UNITARIO</th><th style="width:23%">IMPORTE</th></tr></thead>
        <tbody>${items.map(item => `<tr><td class="desc">${item.descripcion}</td><td>${item.kg}</td><td>$${Math.round(item.precio).toLocaleString('es-AR')}</td><td>$${Math.round(item.importe).toLocaleString('es-AR')}</td></tr>`).join('')}${Array(Math.max(0, 10 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('')}</tbody></table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px"><div class="total-box">TOTAL: $${Math.round(remito.total).toLocaleString('es-AR')}</div></div>
        <div class="firma">Firma y aclaración: ________________________________</div>
        <script>window.onload = () => { window.print(); }</script>
      </body></html>`)
    win.document.close()
  }

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, boxSizing: 'border-box' }
  const categorias = [...new Set(todosPrecios.map(p => p.categoria))]
  const productosFiltrados = todosPrecios.filter(p => p.categoria === nuevaCategoria)

  if (editando) {
    const nuevoTotal = itemsEdit.reduce((s, i) => s + (parseFloat(i.importe) || 0), 0)
    return (
      <div>
        {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
        <button onClick={() => setEditando(null)} className="btn btn-ghost" style={{ marginBottom: 16 }}>← Volver a remitos</button>
        <div style={{ background: '#2a1a0a', border: '1px solid var(--amber)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: 14 }}>✏️ Editando Remito N° {String(editando.numero).padStart(5, '0')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{editando.cliente_nombre} · {editando.fecha}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total original</div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 20, color: 'var(--muted)', textDecoration: 'line-through' }}>${Math.round(editando.total).toLocaleString('es-AR')}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Items del remito</div>
          <table>
            <thead><tr><th style={{ width: '35%' }}>Descripción</th><th>Kg</th><th>Precio/kg</th><th>Importe</th><th></th></tr></thead>
            <tbody>
              {itemsEdit.map((item, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{item.descripcion}</td>
                  <td><input type="number" step="0.1" value={item.kg} onChange={e => editarItem(i, 'kg', e.target.value)} style={{ ...inp, width: 70 }} /></td>
                  <td><input type="number" value={item.precio} onChange={e => editarItem(i, 'precio', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                  <td style={{ color: 'var(--gold)', fontWeight: 600 }}>${Math.round(item.importe || 0).toLocaleString('es-AR')}</td>
                  <td><button onClick={() => quitarItemEdit(i)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer', fontSize: 16 }}>🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 16, padding: 14, background: 'var(--surface2)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, fontWeight: 600 }}>➕ Agregar producto</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px 100px auto', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Categoría</label>
                <select value={nuevaCategoria} onChange={e => { setNuevaCategoria(e.target.value); setNuevoProductoId('') }} style={{ ...inp, width: '100%' }}>
                  <option value="">— Seleccioná —</option>
                  {categorias.map(c => <option key={c} value={c}>{CATEGORIAS[c] || c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Producto</label>
                <select value={nuevoProductoId} onChange={e => { setNuevoProductoId(e.target.value); const prod = todosPrecios.find(p => p.id === e.target.value); if (prod) setNuevoPrecio((prod.precio_carniceria || prod.precio_mayorista || '').toString()) }} disabled={!nuevaCategoria} style={{ ...inp, width: '100%' }}>
                  <option value="">— Producto —</option>
                  {productosFiltrados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Kg</label><input type="number" step="0.1" placeholder="0" value={nuevoKg} onChange={e => setNuevoKg(e.target.value)} style={{ ...inp, width: '100%' }} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Precio/kg</label><input type="number" placeholder="0" value={nuevoPrecio} onChange={e => setNuevoPrecio(e.target.value)} style={{ ...inp, width: '100%', borderColor: 'var(--gold)' }} /></div>
              <button onClick={agregarItemEdit} className="btn btn-ghost" style={{ whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>➕</button>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 0', borderTop: '2px solid var(--border)' }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Diferencia: </span>
              <span style={{ fontWeight: 700, color: nuevoTotal - editando.total >= 0 ? 'var(--green)' : 'var(--red-light)' }}>{nuevoTotal - editando.total >= 0 ? '+' : ''}{fmt(nuevoTotal - editando.total)}</span>
              {editando.cliente_id && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(se ajusta en cta. cte.)</span>}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',cursive", fontSize: 32, color: 'var(--gold)' }}>TOTAL: ${Math.round(nuevoTotal).toLocaleString('es-AR')}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-gold" onClick={guardarEdicion}>💾 Guardar cambios</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {alert && <div style={{ background: '#1a2a1a', border: '1px solid #2d5a2d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
      {seleccionado && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--gold)' }}>
          <div className="card-title">🧾 Remito N° {String(seleccionado.numero).padStart(5, '0')} — {seleccionado.cliente_nombre}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-gold" onClick={() => imprimir(seleccionado)}>🖨️ Imprimir remito</button>
            <button className="btn btn-ghost" onClick={() => abrirEdicion(seleccionado)}>✏️ Editar remito</button>
            <button className="btn btn-ghost" onClick={() => setSeleccionado(null)}>✕ Cerrar</button>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-title">Historial de remitos</div>
        <table>
          <thead><tr><th>N° Remito</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Acciones</th></tr></thead>
          <tbody>
            {remitos.map(r => (
              <tr key={r.id} style={{ background: r.eliminado ? 'rgba(255,50,50,0.08)' : 'transparent', opacity: r.eliminado ? 0.7 : 1 }}>
                <td>
  <strong>N° {String(r.numero).padStart(5, '0')}</strong>
  {r.eliminado && <span style={{ marginLeft: 8, background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO por {r.eliminado_por}</span>}
</td>
                <td>{r.fecha}</td>
                <td>{r.cliente_nombre}</td>
                <td style={{ color: 'var(--gold)' }}>${Math.round(r.total).toLocaleString('es-AR')}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => imprimir(r)} style={{ background: 'var(--gold)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>🖨️</button>
                     <button onClick={() => abrirEdicion(r)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: 'var(--amber)' }}>✏️</button>
{!r.eliminado && <button onClick={() => eliminarRemito(r)} disabled={anulando} style={{ background: anulando ? '#2a2a2a' : '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, padding: '4px 10px', cursor: anulando ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12, color: '#ff6b6b', opacity: anulando ? 0.5 : 1 }}>🗑️</button>}
{r.eliminado && <span style={{ background: '#3a1a1a', color: '#ff6b6b', borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>❌ ANULADO</span>}
                  </div>
                </td>
              </tr>
            ))}          
{remitos.length === 0 && <tr><td colSpan={5} className="empty">Sin remitos</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProveedoresTab() {
  const [subtab, setSubtab] = useState('resumen')
  const [compras, setCompras] = useState([])
  const [pagos, setPagos] = useState([])
  const [proveedoresDB, setProveedoresDB] = useState([])
  const [alert, setAlert] = useState(null)
  const [nuevoProveedor, setNuevoProveedor] = useState('')
  const [legajoAbierto, setLegajoAbierto] = useState(null)
  const [editandoLegajo, setEditandoLegajo] = useState(false)
  const [formLegajo, setFormLegajo] = useState({ contacto: '', telefono: '', cuit: '', direccion: '', producto_principal: '', notas: '' })
  const [formCompra, setFormCompra] = useState({ fecha: new Date().toISOString().split('T')[0], semana_inicio: '', semana_fin: '', proveedor_nombre: '', producto: '', kg: '', importe: '' })
  const [formPago, setFormPago] = useState({ fecha: new Date().toISOString().split('T')[0], semana_inicio: '', semana_fin: '', proveedor_nombre: '', importe_compra: '', percepcion: '', saldo_anterior: '', entrega: '', notas: '' })

  const inp = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', fontFamily: "'DM Sans',sans-serif", fontSize: 13, width: '100%', boxSizing: 'border-box' }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: c }, { data: p }, { data: prov }] = await Promise.all([
      supabase.from('compras_proveedores').select('*').order('fecha', { ascending: false }).limit(100),
      supabase.from('pagos_proveedores_semanal').select('*').order('fecha', { ascending: false }).limit(100),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre')
    ])
    setCompras(c || [])
    setPagos(p || [])
    setProveedoresDB(prov || [])
  }

  function showMsg(msg, type = 'success') { setAlert({ msg, type }); setTimeout(() => setAlert(null), 3000) }

  async function agregarProveedor() {
    if (!nuevoProveedor.trim()) return
    const nombre = nuevoProveedor.trim().toUpperCase()
    const { error } = await supabase.from('proveedores').insert({ nombre, activo: true })
    if (error) { showMsg('❌ Ya existe ese proveedor', 'error'); return }
    showMsg('✅ Proveedor agregado'); setNuevoProveedor(''); fetchAll()
  }

  async function eliminarProveedor(id, nombre) {
    if (!confirm(`¿Eliminar el proveedor ${nombre}?`)) return
    await supabase.from('proveedores').delete().eq('id', id)
    showMsg('🗑️ Proveedor eliminado')
    if (legajoAbierto?.id === id) setLegajoAbierto(null)
    fetchAll()
  }

  function abrirLegajo(prov) {
    setLegajoAbierto(prov)
    setFormLegajo({ contacto: prov.contacto || '', telefono: prov.telefono || '', cuit: prov.cuit || '', direccion: prov.direccion || '', producto_principal: prov.producto_principal || '', notas: prov.notas || '' })
    setEditandoLegajo(false)
  }

  async function guardarLegajo() {
    await supabase.from('proveedores').update(formLegajo).eq('id', legajoAbierto.id)
    showMsg('✅ Legajo actualizado'); setEditandoLegajo(false)
    setLegajoAbierto({ ...legajoAbierto, ...formLegajo }); fetchAll()
  }

  async function guardarCompra() {
    if (!formCompra.proveedor_nombre || !formCompra.importe) { showMsg('Completá proveedor e importe', 'error'); return }
    await supabase.from('compras_proveedores').insert({ fecha: formCompra.fecha, semana_inicio: formCompra.semana_inicio || null, semana_fin: formCompra.semana_fin || null, proveedor_nombre: formCompra.proveedor_nombre, producto: formCompra.producto, kg: parseFloat(formCompra.kg) || 0, importe: parseFloat(formCompra.importe) || 0 })
    showMsg('✅ Compra registrada')
    setFormCompra(f => ({ ...f, producto: '', kg: '', importe: '', proveedor_nombre: '' })); fetchAll()
  }

  async function guardarPago() {
    if (!formPago.proveedor_nombre) { showMsg('Seleccioná un proveedor', 'error'); return }
    const saldoAdeudado = (parseFloat(formPago.importe_compra) || 0) + (parseFloat(formPago.percepcion) || 0) + (parseFloat(formPago.saldo_anterior) || 0) - (parseFloat(formPago.entrega) || 0)
    await supabase.from('pagos_proveedores_semanal').insert({ fecha: formPago.fecha, semana_inicio: formPago.semana_inicio || null, semana_fin: formPago.semana_fin || null, proveedor_nombre: formPago.proveedor_nombre, importe_compra: parseFloat(formPago.importe_compra) || 0, percepcion: parseFloat(formPago.percepcion) || 0, saldo_anterior: parseFloat(formPago.saldo_anterior) || 0, entrega: parseFloat(formPago.entrega) || 0, saldo_adeudado: saldoAdeudado, notas: formPago.notas })
    showMsg('✅ Pago registrado')
    setFormPago(f => ({ ...f, importe_compra: '', percepcion: '', saldo_anterior: '', entrega: '', notas: '', proveedor_nombre: '' })); fetchAll()
  }

  const proveedoresNombres = proveedoresDB.map(p => p.nombre)
  const getResumenProv = (nombre) => {
    const comprasProv = compras.filter(c => c.proveedor_nombre?.toUpperCase().includes(nombre))
    const pagosProv = pagos.filter(p => p.proveedor_nombre?.toUpperCase().includes(nombre))
    const totalCompras = comprasProv.reduce((s, c) => s + (c.importe || 0), 0)
    const totalEntregado = pagosProv.reduce((s, p) => s + (p.entrega || 0), 0)
    const ultimoPago = pagosProv[0]
    const saldoAdeudado = ultimoPago?.saldo_adeudado ?? (totalCompras - totalEntregado)
    return { totalCompras, totalEntregado, saldoAdeudado, comprasProv, pagosProv }
  }
  const totalDeuda = proveedoresDB.reduce((s, p) => s + Math.max(0, getResumenProv(p.nombre).saldoAdeudado), 0)

  if (legajoAbierto) {
    const { totalCompras, totalEntregado, saldoAdeudado, comprasProv, pagosProv } = getResumenProv(legajoAbierto.nombre)
    return (
      <div>
        <button onClick={() => setLegajoAbierto(null)} className="btn btn-ghost" style={{ marginBottom: 16 }}>← Volver a proveedores</button>
        {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
        <div style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface2) 100%)', border: '1px solid var(--amber)', borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 32, color: 'var(--amber)', letterSpacing: 2 }}>🏭 {legajoAbierto.nombre}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Legajo de proveedor</div>
              {legajoAbierto.producto_principal && <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 4 }}>🥩 {legajoAbierto.producto_principal}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Saldo adeudado</div>
              <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 36, color: saldoAdeudado > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt(saldoAdeudado)}</div>
              <div style={{ fontSize: 11, color: saldoAdeudado > 0 ? 'var(--red-light)' : 'var(--green)' }}>{saldoAdeudado > 0 ? '⚠️ Con deuda' : '✅ Al día'}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Total compras</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--amber)' }}>{fmt(totalCompras)}</div></div>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Total pagado</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--green)' }}>{fmt(totalEntregado)}</div></div>
            <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Compras registradas</div><div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 22, color: 'var(--gold)' }}>{comprasProv.length}</div></div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title" style={{ margin: 0 }}>📋 Datos del proveedor</div>
              <button onClick={() => setEditandoLegajo(!editandoLegajo)} className="btn btn-ghost btn-sm">{editandoLegajo ? '✕ Cancelar' : '✏️ Editar'}</button>
            </div>
            {editandoLegajo ? (
              <div>
                {[['contacto', '👤 Contacto', 'Nombre del contacto'], ['telefono', '📱 Teléfono', 'Ej: 3574 000000'], ['cuit', '🆔 CUIT', 'XX-XXXXXXXX-X'], ['direccion', '📍 Dirección', 'Dirección del proveedor'], ['producto_principal', '🥩 Producto principal', 'Ej: Bovino Media Res'], ['notas', '📝 Notas', 'Observaciones, condiciones, etc.']].map(([campo, label, placeholder]) => (
                  <div key={campo} style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
                    <input value={formLegajo[campo]} onChange={e => setFormLegajo(f => ({ ...f, [campo]: e.target.value }))} placeholder={placeholder} style={inp} />
                  </div>
                ))}
                <button className="btn btn-gold" onClick={guardarLegajo} style={{ width: '100%', marginTop: 8 }}>💾 Guardar legajo</button>
              </div>
            ) : (
              <div>
                {[['👤 Contacto', legajoAbierto.contacto], ['📱 Teléfono', legajoAbierto.telefono], ['🆔 CUIT', legajoAbierto.cuit], ['📍 Dirección', legajoAbierto.direccion], ['🥩 Producto principal', legajoAbierto.producto_principal], ['📝 Notas', legajoAbierto.notas]].map(([label, valor]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: valor ? 'var(--text)' : 'var(--muted)', fontStyle: valor ? 'normal' : 'italic' }}>{valor || 'Sin datos'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">💰 Últimos pagos</div>
            {pagosProv.length === 0 ? <div className="empty">Sin pagos registrados</div> : pagosProv.slice(0, 6).map(p => (
              <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.fecha}</span>
                  <span style={{ fontSize: 12, color: p.saldo_adeudado > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 600 }}>Saldo: {fmt(p.saldo_adeudado)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                  <span>Compra: {fmt(p.importe_compra)}</span>
                  <span style={{ color: 'var(--green)' }}>Entrega: {fmt(p.entrega)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">📥 Historial de compras</div>
          <table>
            <thead><tr><th>Fecha</th><th>Producto</th><th>Kg</th><th>Importe</th></tr></thead>
            <tbody>
              {comprasProv.slice(0, 15).map(c => (<tr key={c.id}><td>{c.fecha}</td><td>{c.producto || '—'}</td><td>{c.kg > 0 ? c.kg + ' kg' : '—'}</td><td style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(c.importe)}</td></tr>))}
              {comprasProv.length === 0 && <tr><td colSpan={4} className="empty">Sin compras registradas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      {alert && <div style={{ background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a', border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`, borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600 }}>{alert.msg}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[{ id: 'resumen', label: '📊 Resumen' }, { id: 'compras', label: '📥 Compras' }, { id: 'pagos', label: '💰 Pagos semanales' }, { id: 'gestionar', label: '⚙️ Gestionar proveedores' }].map(t => (
          <button key={t.id} onClick={() => setSubtab(t.id)} style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${subtab === t.id ? 'var(--amber)' : 'var(--border)'}`, background: subtab === t.id ? 'var(--amber)' : 'transparent', color: subtab === t.id ? '#fff' : 'var(--muted)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 12 }}>{t.label}</button>
        ))}
      </div>

      {subtab === 'resumen' && (
        <div>
          <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
            <div className="stat"><div className="stat-label">Total adeudado proveedores</div><div className="stat-value" style={{ color: 'var(--red-light)' }}>{fmt(totalDeuda)}</div></div>
            <div className="stat"><div className="stat-label">Proveedores activos</div><div className="stat-value" style={{ color: 'var(--gold)' }}>{proveedoresDB.length}</div></div>
          </div>
          <div className="card">
            <div className="card-title">Estado de cuenta por proveedor</div>
            <table>
              <thead><tr><th>Proveedor</th><th style={{ color: 'var(--amber)' }}>Total compras</th><th style={{ color: 'var(--green)' }}>Total entregado</th><th style={{ color: 'var(--red-light)' }}>Saldo adeudado</th><th>Estado</th><th>Legajo</th></tr></thead>
              <tbody>
                {proveedoresDB.map(p => { const r = getResumenProv(p.nombre); return (<tr key={p.id}><td><strong>{p.nombre}</strong></td><td style={{ color: 'var(--amber)' }}>{fmt(r.totalCompras)}</td><td style={{ color: 'var(--green)' }}>{fmt(r.totalEntregado)}</td><td style={{ color: r.saldoAdeudado > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700 }}>{fmt(r.saldoAdeudado)}</td><td><span style={{ background: r.saldoAdeudado > 0 ? '#3a1a1a' : '#1a3a1a', color: r.saldoAdeudado > 0 ? 'var(--red-light)' : 'var(--green)', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{r.saldoAdeudado > 0 ? 'DEBE' : '✅ AL DÍA'}</span></td><td><button onClick={() => abrirLegajo(p)} style={{ background: 'var(--amber)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff' }}>📋 Ver legajo</button></td></tr>) })}
                {proveedoresDB.length === 0 && <tr><td colSpan={6} className="empty">Sin proveedores registrados</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subtab === 'compras' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">➕ Registrar compra manual</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Las entradas al depósito se registran automáticamente.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Proveedor</label><select value={formCompra.proveedor_nombre} onChange={e => setFormCompra(f => ({ ...f, proveedor_nombre: e.target.value }))} style={inp}><option value="">— Seleccioná —</option>{proveedoresNombres.map(p => <option key={p}>{p}</option>)}</select></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Producto</label><input value={formCompra.producto} onChange={e => setFormCompra(f => ({ ...f, producto: e.target.value }))} placeholder="Ej: Bovino Media Res" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={formCompra.fecha} onChange={e => setFormCompra(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Kg</label><input type="number" value={formCompra.kg} onChange={e => setFormCompra(f => ({ ...f, kg: e.target.value }))} placeholder="0" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Importe ($)</label><input type="number" value={formCompra.importe} onChange={e => setFormCompra(f => ({ ...f, importe: e.target.value }))} placeholder="0" style={{ ...inp, borderColor: 'var(--gold)' }} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Semana</label><div style={{ display: 'flex', gap: 4 }}><input type="date" value={formCompra.semana_inicio} onChange={e => setFormCompra(f => ({ ...f, semana_inicio: e.target.value }))} style={{ ...inp, fontSize: 11 }} /><input type="date" value={formCompra.semana_fin} onChange={e => setFormCompra(f => ({ ...f, semana_fin: e.target.value }))} style={{ ...inp, fontSize: 11 }} /></div></div>
            </div>
            <button className="btn btn-gold" onClick={guardarCompra}>✅ Registrar compra</button>
          </div>
          <div className="card">
            <div className="card-title">Historial de compras</div>
            <table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Producto</th><th>Kg</th><th>Importe</th></tr></thead>
            <tbody>{compras.slice(0, 20).map(c => (<tr key={c.id}><td>{c.fecha}</td><td><strong>{c.proveedor_nombre}</strong></td><td>{c.producto || '—'}</td><td>{c.kg > 0 ? c.kg + ' kg' : '—'}</td><td style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(c.importe)}</td></tr>))}{compras.length === 0 && <tr><td colSpan={5} className="empty">Sin compras registradas</td></tr>}</tbody></table>
          </div>
        </div>
      )}

      {subtab === 'pagos' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">💰 Registrar pago semanal</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Proveedor</label><select value={formPago.proveedor_nombre} onChange={e => setFormPago(f => ({ ...f, proveedor_nombre: e.target.value }))} style={inp}><option value="">— Seleccioná —</option>{proveedoresNombres.map(p => <option key={p}>{p}</option>)}</select></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fecha</label><input type="date" value={formPago.fecha} onChange={e => setFormPago(f => ({ ...f, fecha: e.target.value }))} style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Importe compra ($)</label><input type="number" value={formPago.importe_compra} onChange={e => setFormPago(f => ({ ...f, importe_compra: e.target.value }))} placeholder="0" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Percepción ($)</label><input type="number" value={formPago.percepcion} onChange={e => setFormPago(f => ({ ...f, percepcion: e.target.value }))} placeholder="0" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Saldo semana anterior ($)</label><input type="number" value={formPago.saldo_anterior} onChange={e => setFormPago(f => ({ ...f, saldo_anterior: e.target.value }))} placeholder="0" style={inp} /></div>
              <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Lo que se entrega ($)</label><input type="number" value={formPago.entrega} onChange={e => setFormPago(f => ({ ...f, entrega: e.target.value }))} placeholder="0" style={{ ...inp, borderColor: 'var(--green)' }} /></div>
            </div>
            {(formPago.importe_compra || formPago.entrega) && (
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>Compra: </span><strong style={{ color: 'var(--amber)' }}>{fmt(parseFloat(formPago.importe_compra) || 0)}</strong></div>
                <div style={{ fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>+ Percepción: </span><strong>{fmt(parseFloat(formPago.percepcion) || 0)}</strong></div>
                <div style={{ fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>+ Saldo ant.: </span><strong>{fmt(parseFloat(formPago.saldo_anterior) || 0)}</strong></div>
                <div style={{ fontSize: 12 }}><span style={{ color: 'var(--muted)' }}>− Entrega: </span><strong style={{ color: 'var(--green)' }}>{fmt(parseFloat(formPago.entrega) || 0)}</strong></div>
                <div style={{ fontSize: 14, fontWeight: 700 }}><span style={{ color: 'var(--muted)' }}>= Saldo adeudado: </span><strong style={{ color: ((parseFloat(formPago.importe_compra) || 0) + (parseFloat(formPago.percepcion) || 0) + (parseFloat(formPago.saldo_anterior) || 0) - (parseFloat(formPago.entrega) || 0)) > 0 ? 'var(--red-light)' : 'var(--green)' }}>{fmt((parseFloat(formPago.importe_compra) || 0) + (parseFloat(formPago.percepcion) || 0) + (parseFloat(formPago.saldo_anterior) || 0) - (parseFloat(formPago.entrega) || 0))}</strong></div>
              </div>
            )}
            <div><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Notas</label><input value={formPago.notas} onChange={e => setFormPago(f => ({ ...f, notas: e.target.value }))} placeholder="Cheque nro., banco, etc." style={{ ...inp, marginBottom: 12 }} /></div>
            <button className="btn btn-gold" onClick={guardarPago}>✅ Registrar pago semanal</button>
          </div>
          <div className="card">
            <div className="card-title">Historial de pagos semanales</div>
            <table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Compra</th><th>Percep.</th><th>Saldo ant.</th><th>Entrega</th><th>Saldo adeudado</th></tr></thead>
            <tbody>{pagos.slice(0, 20).map(p => (<tr key={p.id}><td>{p.fecha}</td><td><strong>{p.proveedor_nombre}</strong></td><td style={{ color: 'var(--amber)' }}>{fmt(p.importe_compra)}</td><td>{p.percepcion > 0 ? fmt(p.percepcion) : '—'}</td><td>{p.saldo_anterior > 0 ? fmt(p.saldo_anterior) : '—'}</td><td style={{ color: 'var(--green)' }}>{fmt(p.entrega)}</td><td style={{ color: p.saldo_adeudado > 0 ? 'var(--red-light)' : 'var(--green)', fontWeight: 700 }}>{fmt(p.saldo_adeudado)}</td></tr>))}{pagos.length === 0 && <tr><td colSpan={7} className="empty">Sin pagos registrados</td></tr>}</tbody></table>
          </div>
        </div>
      )}

      {subtab === 'gestionar' && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">➕ Agregar nuevo proveedor</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Nombre del proveedor</label><input value={nuevoProveedor} onChange={e => setNuevoProveedor(e.target.value)} onKeyDown={e => e.key === 'Enter' && agregarProveedor()} placeholder="Ej: GARCIA, SAN MARTIN..." style={{ ...inp, borderColor: 'var(--gold)', textTransform: 'uppercase' }} /></div>
              <button onClick={agregarProveedor} className="btn btn-gold" style={{ whiteSpace: 'nowrap' }}>➕ Agregar</button>
            </div>
          </div>
          <div className="card">
            <div className="card-title">📋 Proveedores activos ({proveedoresDB.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {proveedoresDB.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
                  <div><div style={{ fontWeight: 600, fontSize: 13 }}>{p.nombre}</div>{p.producto_principal && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.producto_principal}</div>}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => abrirLegajo(p)} style={{ background: 'var(--amber)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#fff' }}>📋</button>
                    <button onClick={() => eliminarProveedor(p.id, p.nombre)} style={{ background: 'none', border: 'none', color: 'var(--red-light)', cursor: 'pointer', fontSize: 16 }}>🗑️</button>
                  </div>
                </div>
              ))}
              {proveedoresDB.length === 0 && <div className="empty" style={{ gridColumn: '1/-1' }}>Sin proveedores registrados</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
