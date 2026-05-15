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
    description: `Carga un nuevo gasto en el sistema de Carnicerías Fabricius.

REGLAS DE NEGOCIO IMPORTANTES:
- El campo "tipo" es OBLIGATORIO y debe ser uno de estos 3 valores exactos: "fijo", "variable" o "socio".
  * "fijo" → gastos recurrentes del negocio (luz, gas, alquiler, sueldos, internet, impuestos)
  * "variable" → gastos puntuales del negocio (combustible, mantenimiento, repuestos, insumos, viáticos)
  * "socio" → gastos personales de Ariel o Fabricio (farmacia, comida personal, ropa, etc.)
- El campo "socio" SOLO se llena cuando tipo="socio". Valores permitidos: "Ariel" o "Fabricio".
- La empresa tiene dos socios: Ariel Garrone y Fabricio Lenardon.
- SIEMPRE inferí el tipo correcto según el contexto. Si el usuario no aclara y el gasto suena personal, preguntar.
- ANTES de cargar, mostrá un resumen al usuario y pedí confirmación.`,
    parameters: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          description: 'Tipo de gasto. OBLIGATORIO. Valores permitidos: "fijo", "variable" o "socio".'
        },
        descripcion: {
          type: 'string',
          description: 'Descripción clara del gasto. Ej: "Combustible camioneta", "Factura de luz EPEC"'
        },
        monto: {
          type: 'number',
          description: 'Monto en pesos argentinos. Solo el número, sin signo $ ni puntos. Ej: 15000'
        },
        categoria: {
          type: 'string',
          description: 'Categoría libre del gasto. Ej: combustible, luz, gas, mantenimiento, sueldos, farmacia, etc.'
        },
        fecha: {
          type: 'string',
          description: 'Fecha en formato YYYY-MM-DD. Si el usuario no especifica fecha, usar la fecha de hoy.'
        },
        socio: {
          type: 'string',
          description: 'SOLO se llena si tipo="socio". Valores permitidos: "Ariel" o "Fabricio".'
        },
        forma: {
          type: 'string',
          description: 'Forma de pago opcional. Ej: efectivo, transferencia, cheque, tarjeta. Solo si el usuario lo menciona.'
        },
        notas: {
          type: 'string',
          description: 'Notas adicionales opcionales que el usuario haya mencionado.'
        }
      },
      required: ['tipo', 'descripcion', 'monto']
    }
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
        // Validar tipo
        const tiposValidos = ['fijo', 'variable', 'socio']
        const tipo = (args.tipo || '').toLowerCase().trim()
        if (!tiposValidos.includes(tipo)) {
          return {
            resultado: `❌ El tipo "${args.tipo}" no es válido. Tiene que ser: "fijo", "variable" o "socio".`
          }
        }

        // Validar socio si corresponde
        let socio = null
        if (tipo === 'socio') {
          const sociosValidos = ['Ariel', 'Fabricio']
          const socioNormalizado = (args.socio || '').trim()
          const encontrado = sociosValidos.find(s =>
            s.toLowerCase() === socioNormalizado.toLowerCase() ||
            socioNormalizado.toLowerCase().includes(s.toLowerCase())
          )
          if (!encontrado) {
            return {
              resultado: `❌ Para un gasto de tipo "socio" necesito saber si es de Ariel o Fabricio.`
            }
          }
          socio = encontrado
        }

        // Construir el registro respetando el esquema real de la tabla
        const gasto = {
          tipo,
          descripcion: args.descripcion,
          monto: Number(args.monto),
          categoria: args.categoria || null,
          fecha: args.fecha || new Date().toISOString().slice(0, 10),
          socio,
          forma: args.forma || null,
          notas: args.notas || null,
          creado_por: 'asistente_ia'
        }

        const { data, error } = await supabase
          .from('gastos')
          .insert([gasto])
          .select()
        if (error) throw error

        // Armar el resumen amigable
        let resumen = `✅ Gasto cargado correctamente:\n`
        resumen += `• Tipo: ${tipo}\n`
        if (socio) resumen += `• Socio: ${socio}\n`
        resumen += `• Descripción: ${gasto.descripcion}\n`
        resumen += `• Monto: ${formatearPesos(gasto.monto)}\n`
        if (gasto.categoria) resumen += `• Categoría: ${gasto.categoria}\n`
        resumen += `• Fecha: ${formatearFecha(gasto.fecha)}\n`
        if (gasto.forma) resumen += `• Forma de pago: ${gasto.forma}\n`
        if (gasto.notas) resumen += `• Notas: ${gasto.notas}`

        return { resultado: resumen, id: data[0]?.id }
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

function formatearFecha(fechaISO) {
  if (!fechaISO) return ''
  const [a, m, d] = fechaISO.split('-')
  return `${d}/${m}/${a}`
}