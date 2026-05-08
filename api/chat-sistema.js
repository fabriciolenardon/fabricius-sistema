export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const { messages } = req.body
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL
    const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY

    const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

    const [preciosRes, clientesRes, salidasRes, entradasRes, gastosRes, remitosRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/precios?select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/clientes?select=*&order=nombre`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/salidas_deposito?select=*&order=fecha.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/entradas_deposito?select=*&order=fecha.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/gastos?select=*&order=fecha.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/remitos?select=*&order=created_at.desc&limit=30`, { headers }),
    ])

    const [precios, clientes, salidas, entradas, gastos, remitos] = await Promise.all([
      preciosRes.json(), clientesRes.json(), salidasRes.json(),
      entradasRes.json(), gastosRes.json(), remitosRes.json()
    ])

    const stockBovino = entradas.filter(e => e.tipo === 'bovino_mr').reduce((s, e) => s + (e.kg_real || 0), 0)
      - salidas.filter(s => s.tipo === 'bovino_mr').reduce((s, e) => s + (e.kg || 0), 0)
    const stockPollo = entradas.filter(e => e.tipo === 'pollo').reduce((s, e) => s + (e.kg || 0), 0)
      - salidas.filter(s => s.tipo === 'pollo').reduce((s, e) => s + (e.kg || 0), 0)
    const stockCerdo = entradas.filter(e => e.tipo === 'cerdo').reduce((s, e) => s + (e.kg || 0), 0)
      - salidas.filter(s => s.tipo === 'cerdo').reduce((s, e) => s + (e.kg || 0), 0)

    const contexto = `
Sos el asistente inteligente de Carnicerías Fabricius. Tenés acceso a todos los datos del sistema en tiempo real. Respondé en español argentino, de forma directa y sin asteriscos ni markdown.

=== STOCK ACTUAL DEL DEPÓSITO ===
- Bovino (Media Res): ${Math.max(0, stockBovino).toFixed(1)} kg
- Pollo: ${Math.max(0, stockPollo).toFixed(1)} kg  
- Cerdo: ${Math.max(0, stockCerdo).toFixed(1)} kg

=== CLIENTES Y SALDOS ===
${clientes.map(c => `- ${c.nombre}: ${c.saldo > 0 ? `debe $${Math.round(c.saldo).toLocaleString('es-AR')}` : c.saldo < 0 ? `tiene saldo a favor de $${Math.round(Math.abs(c.saldo)).toLocaleString('es-AR')}` : 'está al día, saldo cero'}`).join('\n')}

=== PRECIOS ACTUALES ===
${precios.map(p => `- ${p.nombre} (${p.categoria}): Carn $${p.precio_carniceria || '—'} / May $${p.precio_mayorista || '—'} / Min $${p.precio_minorista || '—'}`).join('\n')}

=== ÚLTIMOS GASTOS ===
${gastos.slice(0, 10).map(g => `- ${g.fecha} | ${g.tipo} | ${g.descripcion}: $${Math.round(g.monto || 0).toLocaleString('es-AR')}`).join('\n')}

=== ÚLTIMOS REMITOS ===
${remitos.slice(0, 10).map(r => `- Remito N°${String(r.numero || '').padStart(5, '0')} | ${r.fecha} | ${r.cliente_nombre}: $${Math.round(r.total || 0).toLocaleString('es-AR')}`).join('\n')}

=== ÚLTIMOS DESPACHOS ===
${salidas.slice(0, 10).map(s => `- ${s.fecha} | ${s.cliente_nombre} | ${s.descripcion}: ${s.kg}kg a $${Math.round(s.precio_kg || 0).toLocaleString('es-AR')}/kg`).join('\n')}
`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VITE_OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://fabricius-sistema.vercel.app',
        'X-Title': 'Fabricius Sistema'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          { role: 'system', content: contexto },
          ...messages
        ]
      })
    })

    const data = await response.json()
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
