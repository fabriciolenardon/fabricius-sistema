// ═══════════════════════════════════════════════════════════
// HERRAMIENTAS DEL ASISTENTE (TOOLS)
// ═══════════════════════════════════════════════════════════
// Acá se definen las funciones que la IA puede llamar.
// Cada función tiene:
//   1. Su DEFINICIÓN (qué hace, qué parámetros recibe) → se la pasamos a Gemini
//   2. Su EJECUCIÓN real (qué hace en Supabase) → se corre cuando la IA la llama
//
// PARA EXPANDIR: agregar nuevas funciones acá siguiendo el mismo patrón.
// ═══════════════════════════════════════════════════════════

import { supabase } from './supabase.js'

// ═══════════════════════════════════════════════════════════
// 1. DEFINICIONES — Le decimos a Gemini qué funciones tiene disponibles
// ═══════════════════════════════════════════════════════════
export const DEFINICIONES_TOOLS = [
  {
    name: 'consultar_stock',
    description: 'Consulta el stock actual disponible en el depósito (kg de cada tipo de carne). Usar cuando el usuario pregunte por stock, qué hay en depósito, cuánta carne hay, etc.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_deuda_cliente',
    description: 'Busca un cliente por nombre (búsqueda parcial) y devuelve su saldo / cuánto debe. Usar cuando el usuario pregunte cuánto debe alguien.',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente a buscar' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'consultar_precios',
    description: 'Devuelve la lista de precios actual. Opcionalmente filtra por categoría.',
    parameters: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Categoría opcional. Ej: bovino_pieza, cerdo, etc.' }
      }
    }
  },
  {
    name: 'consultar_clientes_con_deuda',
    description: 'Lista los clientes que tienen saldo pendiente (deuda).',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'cargar_gasto',
    description: 'Carga un nuevo gasto en el sistema. SIEMPRE pedir confirmación al usuario antes de llamarla mostrando los datos a cargar.',
    parameters: {
      type: 'object',
      properties: {
        descripcion: { type: 'string', description: 'Descripción del gasto. Ej: "Combustible camioneta"' },
        monto: { type: 'number', description: 'Monto en pesos argentinos. Ej: 15000' },
        categoria: { type: 'string', description: 'Categoría del gasto. Ej: combustible, luz, gas, mantenimiento, sueldos, otros' },
        fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD. Si no se especifica, usar la fecha de hoy.' },
        sucursal: { type: 'string', description: 'Sucursal a la que se imputa el gasto (opcional)' }
      },
      required: ['descripcion', 'monto', 'categoria']
    }
  },
  {
    name: 'analizar_imagen_remito',
    description: 'NO se llama directamente. La IA debe extraer los datos del remito/ticket/factura que ve en la imagen y ofrecerle al usuario los datos extraídos para que confirme cuál acción tomar (cargar gasto, cargar entrada de depósito, etc.).',
    parameters: { type: 'object', properties: {} }
  }
]

// ═══════════════════════════════════════════════════════════
// 2. EJECUCIÓN — Cuando la IA llama una función, acá se ejecuta de verdad
// ═══════════════════════════════════════════════════════════
export async function ejecutarFuncion(nombre, args) {
  console.log(`🤖 Ejecutando función: ${nombre}`, args)

  try {
    switch (nombre) {

      case 'consultar_stock': {
        const { data, error } = await supabase
          .from('stock_actual')
          .select('*')
          .order('tipo')
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay stock cargado.' }
        const lista = data.map(r => `${r.tipo}: ${r.kg_disponible} kg`).join('\n')
        return { resultado: `Stock actual:\n${lista}` }
      }

      case 'consultar_deuda_cliente': {
        const { data, error } = await supabase
          .from('clientes')
          .select('nombre, tipo, saldo')
          .ilike('nombre', `%${args.nombre}%`)
        if (error) throw error
        if (!data || data.length === 0) {
          return { resultado: `No encontré ningún cliente con el nombre "${args.nombre}".` }
        }
        const lista = data.map(c =>
          `${c.nombre} (${c.tipo || 'sin tipo'}): ${formatearPesos(c.saldo)}`
        ).join('\n')
        return { resultado: `Clientes encontrados:\n${lista}` }
      }

      case 'consultar_precios': {
        let query = supabase.from('precios').select('*')
        if (args.categoria) query = query.eq('categoria', args.categoria)
        const { data, error } = await query
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay precios cargados.' }
        const lista = data.map(p =>
          `${p.nombre || p.tipo}: ${formatearPesos(p.precio)} ${p.unidad || ''}`
        ).join('\n')
        return { resultado: `Lista de precios:\n${lista}` }
      }

      case 'consultar_clientes_con_deuda': {
        const { data, error } = await supabase
          .from('clientes')
          .select('nombre, tipo, saldo')
          .gt('saldo', 0)
          .order('saldo', { ascending: false })
        if (error) throw error
        if (!data || data.length === 0) return { resultado: '✅ Ningún cliente tiene deuda actualmente.' }
        const lista = data.map(c => `${c.nombre}: ${formatearPesos(c.saldo)}`).join('\n')
        const total = data.reduce((s, c) => s + Number(c.saldo || 0), 0)
        return { resultado: `Clientes con deuda:\n${lista}\n\nTotal adeudado: ${formatearPesos(total)}` }
      }

      case 'cargar_gasto': {
        const gasto = {
          descripcion: args.descripcion,
          monto: Number(args.monto),
          categoria: args.categoria,
          fecha: args.fecha || new Date().toISOString().slice(0, 10),
          sucursal: args.sucursal || null,
          creado_por: 'asistente_ia'
        }
        const { data, error } = await supabase
          .from('gastos')
          .insert([gasto])
          .select()
        if (error) throw error
        return {
          resultado: `✅ Gasto cargado correctamente:\n` +
                     `- Descripción: ${gasto.descripcion}\n` +
                     `- Monto: ${formatearPesos(gasto.monto)}\n` +
                     `- Categoría: ${gasto.categoria}\n` +
                     `- Fecha: ${gasto.fecha}`,
          id: data[0]?.id
        }
      }

      default:
        return { resultado: `Función "${nombre}" no implementada todavía.` }
    }
  } catch (err) {
    console.error('Error ejecutando función:', err)
    return { resultado: `❌ Error: ${err.message}` }
  }
}

function formatearPesos(valor) {
  if (valor == null || isNaN(valor)) return '$0'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(valor))
}
