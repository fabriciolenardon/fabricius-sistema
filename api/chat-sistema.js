export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) {
      return res.status(401).json({ error: 'Sesión requerida. Iniciá sesión nuevamente.' })
    }

    const { messages } = req.body
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL
    const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY
    const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_KEY

    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return res.status(500).json({ error: 'Supabase no configurado en el servidor' })
    }
    if (!openRouterKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY no configurada' })
    }

    const headers = {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    const [preciosRes, clientesRes, salidasRes, entradasRes, gastosRes, remitosRes, stockRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/precios?select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/clientes?select=*&order=nombre`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/salidas_deposito?select=*&order=fecha.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/entradas_deposito?select=*&order=fecha.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/gastos?select=*&order=fecha.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/remitos?select=*&order=created_at.desc&limit=30`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/stock_actual?select=*`, { headers }),
    ])

    const [precios, clientes, salidas, entradas, gastos, remitos, stockRows] = await Promise.all([
      preciosRes.json(), clientesRes.json(), salidasRes.json(),
      entradasRes.json(), gastosRes.json(), remitosRes.json(), stockRes.json(),
    ])

    const stockMap = {}
    if (Array.isArray(stockRows)) {
      stockRows.forEach(r => { stockMap[r.tipo] = r.kg_disponible })
    }

    const stockBovino = stockMap.bovino_mr ?? 0
    const stockPollo = stockMap.pollo ?? 0
    const stockCerdo = stockMap.cerdo ?? 0

    const contexto = `
Sos el asistente inteligente de Carnicerías Fabricius. Tenés acceso a los datos del sistema según el permiso del usuario. Respondé en español argentino, de forma directa y sin asteriscos ni markdown.

=== STOCK ACTUAL DEL DEPÓSITO ===
- Bovino (Media Res): ${Math.max(0, stockBovino).toFixed(1)} kg
- Pollo: ${Math.max(0, stockPollo).toFixed(1)} kg
- Cerdo: ${Math.max(0, stockCerdo).toFixed(1)} kg

=== CLIENTES Y SALDOS ===
${Array.isArray(clientes) ? clientes.map(c => `- ${c.nombre}: ${c.saldo > 0 ? `debe $${Math.round(c.saldo).toLocaleString('es-AR')}` : c.saldo < 0 ? `tiene saldo a favor de $${Math.round(Math.abs(c.saldo)).toLocaleString('es-AR')}` : 'está al día, saldo cero'}`).join('\n') : 'Sin datos'}

=== PRECIOS ACTUALES ===
${Array.isArray(precios) ? precios.map(p => `- ${p.nombre} (${p.categoria}): Carn $${p.precio_carniceria || '—'} / May $${p.precio_mayorista || '—'} / Min $${p.precio_minorista || '—'}`).join('\n') : 'Sin datos'}

=== ÚLTIMOS GASTOS ===
${Array.isArray(gastos) ? gastos.slice(0, 10).map(g => `- ${g.fecha} | ${g.tipo} | ${g.descripcion}: $${Math.round(g.monto || 0).toLocaleString('es-AR')}`).join('\n') : 'Sin datos'}

=== ÚLTIMOS REMITOS ===
${Array.isArray(remitos) ? remitos.slice(0, 10).map(r => `- Remito N°${String(r.numero || '').padStart(5, '0')} | ${r.fecha} | ${r.cliente_nombre}: $${Math.round(r.total || 0).toLocaleString('es-AR')}`).join('\n') : 'Sin datos'}

=== ÚLTIMOS DESPACHOS ===
${Array.isArray(salidas) ? salidas.slice(0, 10).map(s => `- ${s.fecha} | ${s.cliente_nombre} | ${s.descripcion}: ${s.kg}kg a $${Math.round(s.precio_kg || 0).toLocaleString('es-AR')}/kg`).join('\n') : 'Sin datos'}
`

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterKey}`,
        'HTTP-Referer': 'https://fabricius-sistema.vercel.app',
        'X-Title': 'Fabricius Sistema',
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          { role: 'system', content: contexto },
          ...messages,
        ],
      }),
    })

    const data = await response.json()
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
