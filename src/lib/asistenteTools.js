// ═══════════════════════════════════════════════════════════
// HERRAMIENTAS DEL ASISTENTE (TOOLS) — v2
// ═══════════════════════════════════════════════════════════
// Cambios v2:
//   + Función cargar_entrada_deposito (compra de carne / pollo / embutidos)
//   + Función cargar_pago_cliente (registro de pagos en cta cte)
//   + Función buscar_cliente (para resolver cliente_id antes de pagar)
//   + Función consultar_entradas_recientes
// ═══════════════════════════════════════════════════════════

import { supabase } from './supabase.js'

// ═══════════════════════════════════════════════════════════
// CONSTANTES — Valores válidos en la base de datos
// ═══════════════════════════════════════════════════════════
const TIPOS_DEPOSITO = ['bovino_mr', 'cerdo', 'pollo', 'cajon_bovino', 'embutido']
const TIPOS_ANIMAL_BOVINO = ['novillito', 'vaquillona', 'overo_grande', 'overo_chico', 'bubalino']
const TIPOS_ANIMAL_CERDO = ['capon']
const TIPOS_MOVIMIENTO = ['remito', 'pago', 'nota_debito', 'nota_credito']

// ═══════════════════════════════════════════════════════════
// 1. DEFINICIONES — Le decimos a Gemini qué funciones tiene disponibles
// ═══════════════════════════════════════════════════════════
export const DEFINICIONES_TOOLS = [
  // ─── CONSULTAS ─────────────────────────────────────────────
  {
    name: 'consultar_stock',
    description: 'Consulta el stock actual disponible en el depósito (kg de cada tipo de carne). Usar cuando el usuario pregunte por stock, qué hay en depósito, cuánta carne hay, etc.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_deuda_cliente',
    description: 'Busca un cliente por nombre (búsqueda parcial) y devuelve su saldo / cuánto debe.',
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
    name: 'consultar_deuda_proveedores',
    description: `Consulta cuánto LE DEBEMOS NOSOTROS a los proveedores (cuenta corriente de proveedores: PRETTO, CEIBA, etc.). Usar cuando pregunten "cuánto le debemos a X", "cuánto debo a los proveedores", "saldo de Pretto", etc.
NOTA: el usuario puede estar hablando por micrófono y los nombres llegan mal transcriptos (ej: "apretó" o "preto" = PRETTO). Si el nombre no matchea, la función devuelve TODOS los proveedores con su saldo — deducí cuál quiso decir y confirmáselo.`,
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Opcional. Nombre o parte del nombre del proveedor. Sin nombre, lista todos.' }
      }
    }
  },

  // ─── MEMORIA DE FABRI ──────────────────────────────────────
  {
    name: 'recordar',
    description: `Guarda un recuerdo PERMANENTE en tu memoria (lo vas a ver en todas las charlas futuras). USALO PROACTIVAMENTE cuando:
- el usuario exprese una preferencia de trato ("decime jefe", "respuestas más cortas", "no me tires tantos números")
- aprendas un dato del negocio que NO está en el sistema (apodos de clientes/proveedores, rutinas: "los jueves llega media res", acuerdos de palabra)
- el usuario te corrija algo que dijiste mal
Reglas: UNA idea por recuerdo, frase corta y clara. NO guardes datos que ya viven en el sistema (precios, saldos, stock — eso se consulta fresco). Avisale al usuario con naturalidad que lo vas a recordar.`,
    parameters: {
      type: 'object',
      properties: {
        contenido: { type: 'string', description: 'El recuerdo, en una frase corta. Ej: "A Fabricio le gusta que lo saluden como jefe y respuestas breves".' },
        tipo: { type: 'string', description: '"preferencia" (de trato/estilo) o "dato" (del negocio). Default: dato.' },
        usuario: { type: 'string', description: 'Opcional: nombre de la persona a la que aplica el recuerdo. Vacío = general del negocio.' }
      },
      required: ['contenido']
    }
  },
  {
    name: 'olvidar',
    description: 'Desactiva un recuerdo de tu memoria por su id (los ves como [id] en la sección TU MEMORIA). Usalo si el usuario te pide olvidar algo o si un recuerdo quedó viejo/equivocado.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number', description: 'El id del recuerdo a olvidar.' } },
      required: ['id']
    }
  },
  {
    name: 'consultar_entradas_recientes',
    description: 'Lista las últimas entradas cargadas en el depósito. Opcionalmente filtra por tipo.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Opcional. Filtrar por: bovino_mr, cerdo, pollo, cajon_bovino, embutido' },
        limite: { type: 'number', description: 'Cantidad de resultados (default 10)' }
      }
    }
  },

  // ─── GASTOS ────────────────────────────────────────────────
  {
    name: 'cargar_gasto',
    description: `Carga un nuevo gasto en el sistema de Carnicerías Fabricius.

REGLAS DE NEGOCIO:
- Campo "tipo" OBLIGATORIO. Valores: "fijo" (luz, gas, alquiler, sueldos), "variable" (combustible, mantenimiento), "socio" (gasto personal de Ariel o Fabricio).
- Campo "socio" SOLO si tipo="socio". Valores: "Ariel" o "Fabricio".
- ANTES de cargar, mostrá un resumen al usuario y pedí confirmación.`,
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Tipo de gasto: "fijo", "variable" o "socio".' },
        descripcion: { type: 'string', description: 'Descripción clara del gasto.' },
        monto: { type: 'number', description: 'Monto en pesos. Solo el número.' },
        categoria: { type: 'string', description: 'Categoría libre. Ej: combustible, luz, gas, farmacia, etc.' },
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD. Si no se especifica, usar hoy.' },
        socio: { type: 'string', description: 'SOLO si tipo="socio". Valores: "Ariel" o "Fabricio".' },
        forma: { type: 'string', description: 'Forma de pago opcional.' },
        notas: { type: 'string', description: 'Notas adicionales opcionales.' }
      },
      required: ['tipo', 'descripcion', 'monto']
    }
  },

  // ─── ENTRADAS DE DEPÓSITO ──────────────────────────────────
  {
    name: 'cargar_entrada_deposito',
    description: `Carga una entrada nueva al depósito (compra de mercadería).

REGLAS DE NEGOCIO:
- Campo "tipo" OBLIGATORIO. Valores exactos permitidos:
  * "bovino_mr" → media res bovina (al peso, en kg)
  * "cerdo" → capones de cerdo (al peso, en kg)
  * "pollo" → pollo POR CAJÓN (peso fijo del cajón)
  * "cajon_bovino" → cajas de cortes bovinos
  * "embutido" → embutidos al peso (en kg)
- Para "bovino_mr" el campo "tipo_animal" es importante. Valores: "novillito", "vaquillona", "overo_grande", "overo_chico", "bubalino".
- Para "cerdo" el tipo_animal es "capon".
- Si el usuario menciona "media res" o "novillito/vaquillona" → tipo="bovino_mr".
- Si menciona "capones" o "cerdos enteros" → tipo="cerdo".
- Si menciona "pollos" o "cajón de pollo" → tipo="pollo".
- Si menciona "embutidos" (chorizos, salames, morcillas) → tipo="embutido".
- ANTES de cargar, SIEMPRE mostrá un resumen y pedí confirmación.
- Si extraés datos de una foto de remito, mostrá todo lo que viste y dejá que el usuario confirme.`,
    parameters: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          description: 'Tipo de mercadería. OBLIGATORIO. Valores: "bovino_mr", "cerdo", "pollo", "cajon_bovino" o "embutido".'
        },
        tipo_animal: {
          type: 'string',
          description: 'Subtipo / calidad. Para bovino_mr: novillito, vaquillona, overo_grande, overo_chico, bubalino. Para cerdo: capon.'
        },
        proveedor_nombre: {
          type: 'string',
          description: 'Nombre del proveedor (frigorífico, granja, etc.)'
        },
        descripcion: {
          type: 'string',
          description: 'Descripción libre. Ej: "Media res novillito Frigorífico Cordobés"'
        },
        kg: {
          type: 'number',
          description: 'Kg que figuran en el remito del proveedor.'
        },
        kg_real: {
          type: 'number',
          description: 'Kg reales después de pesar (si difiere del remito). Opcional.'
        },
        merma_pct: {
          type: 'number',
          description: 'Porcentaje de merma (ej: 2 para 2%). Opcional.'
        },
        precio_kg: {
          type: 'number',
          description: 'Precio por kg en pesos. Ej: 9800'
        },
        importe: {
          type: 'number',
          description: 'Importe total (si el usuario lo da directo en lugar de kg + precio_kg).'
        },
        cantidad: {
          type: 'number',
          description: 'Cantidad de unidades (ej: 2 medias res, 3 cajones). Opcional.'
        },
        fecha: {
          type: 'string',
          description: 'Fecha YYYY-MM-DD. Si no se especifica, hoy.'
        }
      },
      required: ['tipo']
    }
  },

  // ─── PAGOS DE CLIENTES ─────────────────────────────────────
  {
    name: 'buscar_cliente',
    description: 'Busca clientes por nombre (búsqueda parcial). Útil para resolver a qué cliente se refiere el usuario antes de cargar un pago. Devuelve nombre, id y saldo.',
    parameters: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente.' }
      },
      required: ['nombre']
    }
  },
  {
    name: 'cargar_pago_cliente',
    description: `Registra un pago de un cliente en su cuenta corriente.

PROCESO IMPORTANTE:
1. PRIMERO buscar al cliente con buscar_cliente para obtener su cliente_id exacto.
2. Si la búsqueda devuelve MÁS DE UN cliente, preguntar al usuario cuál es.
3. Mostrar resumen del pago (cliente, monto, forma de pago) y pedir confirmación.
4. Recién después llamar a esta función con el cliente_id correcto.

El saldo del cliente se actualiza AUTOMÁTICAMENTE por un trigger en la base de datos.`,
    parameters: {
      type: 'object',
      properties: {
        cliente_id: {
          type: 'string',
          description: 'UUID del cliente (obtenido previamente con buscar_cliente). OBLIGATORIO.'
        },
        monto: {
          type: 'number',
          description: 'Monto del pago en pesos. OBLIGATORIO.'
        },
        fecha: {
          type: 'string',
          description: 'Fecha YYYY-MM-DD. Si no se especifica, hoy.'
        },
        descripcion: {
          type: 'string',
          description: 'Descripción del pago. Ej: "Pago por transferencia", "Pago en efectivo"'
        }
      },
      required: ['cliente_id', 'monto']
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

      // ─── CONSULTAS ─────────────────────────────────────────
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

      // ─── MEMORIA DE FABRI ──────────────────────────────────
      case 'recordar': {
        const contenido = String(args.contenido || '').trim()
        if (!contenido) return { resultado: 'No me pasaste nada para recordar.' }
        const { error } = await supabase.from('fabri_memoria').insert({
          contenido,
          tipo: args.tipo === 'preferencia' ? 'preferencia' : 'dato',
          usuario: args.usuario?.trim() || null,
        })
        if (error) throw error
        return { resultado: `🧠 Guardado en memoria: "${contenido}"` }
      }

      case 'olvidar': {
        const { error } = await supabase.from('fabri_memoria')
          .update({ activa: false }).eq('id', args.id)
        if (error) throw error
        return { resultado: `Listo, olvidé el recuerdo [${args.id}].` }
      }

      case 'consultar_deuda_proveedores': {
        // Saldo real por proveedor = Σ debe − Σ haber de movimientos NO anulados
        // (misma fórmula que la pantalla de Proveedores)
        const { data, error } = await supabase
          .from('movimientos_proveedores')
          .select('proveedor_nombre, debe, haber, anulado')
        if (error) throw error
        const tot = {}
        ;(data || []).forEach(m => {
          if (m.anulado) return
          const k = (m.proveedor_nombre || '—').trim().toUpperCase()
          tot[k] = (tot[k] || 0) + (Number(m.debe) || 0) - (Number(m.haber) || 0)
        })
        const sinAcentos = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        let lista = Object.entries(tot).map(([nombre, saldo]) => ({ nombre, saldo }))
          .sort((a, b) => b.saldo - a.saldo)
        let nota = ''
        if (args?.nombre) {
          const buscado = sinAcentos(args.nombre)
          const filtrada = lista.filter(p => sinAcentos(p.nombre).includes(buscado))
          if (filtrada.length > 0) {
            lista = filtrada
          } else {
            nota = `\n(No encontré "${args.nombre}" — te muestro todos los proveedores por si la voz transcribió mal el nombre.)`
          }
        }
        if (lista.length === 0) return { resultado: 'No hay cuentas corrientes de proveedores cargadas.' }
        const texto = lista.map(p =>
          `${p.nombre}: ${p.saldo > 0 ? 'le debemos ' + formatearPesos(p.saldo) : p.saldo < 0 ? 'saldo a favor nuestro de ' + formatearPesos(-p.saldo) : 'al día'}`
        ).join('\n')
        const total = lista.reduce((s, p) => s + Math.max(0, p.saldo), 0)
        return { resultado: `Cuenta corriente de proveedores:\n${texto}\n\nTotal que les debemos: ${formatearPesos(total)}${nota}` }
      }

      case 'consultar_entradas_recientes': {
        let query = supabase
          .from('entradas_deposito')
          .select('*')
          .order('fecha', { ascending: false })
          .limit(args.limite || 10)
        if (args.tipo) query = query.eq('tipo', args.tipo)
        const { data, error } = await query
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay entradas cargadas.' }
        const lista = data.map(e => {
          const partes = [
            formatearFecha(e.fecha),
            e.tipo + (e.tipo_animal ? ` (${e.tipo_animal})` : ''),
            e.kg ? `${e.kg} kg` : null,
            e.precio_kg ? `${formatearPesos(e.precio_kg)}/kg` : null,
            e.importe ? `Total: ${formatearPesos(e.importe)}` : null,
            e.proveedor_nombre || null
          ].filter(Boolean).join(' · ')
          return `• ${partes}`
        }).join('\n')
        return { resultado: `Últimas entradas al depósito:\n${lista}` }
      }

      // ─── GASTOS ────────────────────────────────────────────
      case 'cargar_gasto': {
        const tiposValidos = ['fijo', 'variable', 'socio']
        const tipo = (args.tipo || '').toLowerCase().trim()
        if (!tiposValidos.includes(tipo)) {
          return { resultado: `❌ El tipo "${args.tipo}" no es válido. Tiene que ser: "fijo", "variable" o "socio".` }
        }
        let socio = null
        if (tipo === 'socio') {
          const sociosValidos = ['Ariel', 'Fabricio']
          const encontrado = sociosValidos.find(s =>
            s.toLowerCase() === (args.socio || '').toLowerCase() ||
            (args.socio || '').toLowerCase().includes(s.toLowerCase())
          )
          if (!encontrado) return { resultado: `❌ Para tipo="socio" necesito saber si es de Ariel o Fabricio.` }
          socio = encontrado
        }
        const gasto = {
          tipo, descripcion: args.descripcion, monto: Number(args.monto),
          categoria: args.categoria || null,
          fecha: args.fecha || new Date().toISOString().slice(0, 10),
          socio, forma: args.forma || null, notas: args.notas || null,
          creado_por: 'asistente_ia'
        }
        const { data, error } = await supabase.from('gastos').insert([gasto]).select()
        if (error) throw error
        let r = `✅ Gasto cargado correctamente:\n• Tipo: ${tipo}\n`
        if (socio) r += `• Socio: ${socio}\n`
        r += `• Descripción: ${gasto.descripcion}\n• Monto: ${formatearPesos(gasto.monto)}\n`
        if (gasto.categoria) r += `• Categoría: ${gasto.categoria}\n`
        r += `• Fecha: ${formatearFecha(gasto.fecha)}`
        if (gasto.forma) r += `\n• Forma: ${gasto.forma}`
        return { resultado: r, id: data[0]?.id }
      }

      // ─── ENTRADAS DE DEPÓSITO ──────────────────────────────
      case 'cargar_entrada_deposito': {
        // Validar tipo
        const tipo = (args.tipo || '').toLowerCase().trim()
        if (!TIPOS_DEPOSITO.includes(tipo)) {
          return {
            resultado: `❌ El tipo "${args.tipo}" no es válido. Tiene que ser uno de: ${TIPOS_DEPOSITO.join(', ')}.`
          }
        }

        // Validar tipo_animal si aplica
        let tipo_animal = args.tipo_animal ? args.tipo_animal.toLowerCase().trim() : null
        if (tipo === 'bovino_mr' && tipo_animal && !TIPOS_ANIMAL_BOVINO.includes(tipo_animal)) {
          return {
            resultado: `❌ El subtipo "${tipo_animal}" no es válido para bovino. Tiene que ser: ${TIPOS_ANIMAL_BOVINO.join(', ')}.`
          }
        }
        if (tipo === 'cerdo' && !tipo_animal) tipo_animal = 'capon'

        // Calcular importe si no vino pero hay kg y precio_kg
        let importe = args.importe ? Number(args.importe) : null
        if (!importe && args.kg && args.precio_kg) {
          importe = Number(args.kg) * Number(args.precio_kg)
        }

        // Armar el registro
        const entrada = {
          tipo,
          tipo_animal,
          proveedor_nombre: args.proveedor_nombre || null,
          descripcion: args.descripcion || null,
          kg: args.kg ? Number(args.kg) : null,
          kg_real: args.kg_real ? Number(args.kg_real) : null,
          merma_pct: args.merma_pct ? Number(args.merma_pct) : null,
          precio_kg: args.precio_kg ? Number(args.precio_kg) : null,
          importe,
          cantidad: args.cantidad ? Number(args.cantidad) : null,
          fecha: args.fecha || new Date().toISOString().slice(0, 10),
          despostada: false,
          reservada: false
        }

        const { data, error } = await supabase.from('entradas_deposito').insert([entrada]).select()
        if (error) throw error

        // Armar resumen
        let r = `✅ Entrada cargada al depósito:\n`
        r += `• Tipo: ${tipo}${tipo_animal ? ` (${tipo_animal})` : ''}\n`
        if (entrada.proveedor_nombre) r += `• Proveedor: ${entrada.proveedor_nombre}\n`
        if (entrada.cantidad) r += `• Cantidad: ${entrada.cantidad} unidades\n`
        if (entrada.kg) r += `• Kg: ${entrada.kg}\n`
        if (entrada.precio_kg) r += `• Precio: ${formatearPesos(entrada.precio_kg)}/kg\n`
        if (entrada.importe) r += `• Importe total: ${formatearPesos(entrada.importe)}\n`
        r += `• Fecha: ${formatearFecha(entrada.fecha)}`
        return { resultado: r, id: data[0]?.id }
      }

      // ─── BUSCAR CLIENTE ────────────────────────────────────
      case 'buscar_cliente': {
        const { data, error } = await supabase
          .from('clientes')
          .select('id, nombre, nombre_fantasia, tipo, saldo, localidad')
          .or(`nombre.ilike.%${args.nombre}%,nombre_fantasia.ilike.%${args.nombre}%`)
          .limit(10)
        if (error) throw error
        if (!data || data.length === 0) {
          return { resultado: `No encontré ningún cliente con "${args.nombre}".` }
        }
        const lista = data.map(c =>
          `• ${c.nombre}${c.nombre_fantasia ? ` (${c.nombre_fantasia})` : ''}` +
          `${c.localidad ? ` - ${c.localidad}` : ''}` +
          ` - Saldo: ${formatearPesos(c.saldo)} - ID: ${c.id}`
        ).join('\n')
        return {
          resultado: `Encontré ${data.length} cliente(s):\n${lista}`,
          clientes: data
        }
      }

      // ─── PAGO DE CLIENTE ───────────────────────────────────
      case 'cargar_pago_cliente': {
        if (!args.cliente_id) {
          return { resultado: '❌ Falta el cliente_id. Buscá primero al cliente con buscar_cliente.' }
        }
        // Verificar que el cliente existe
        const { data: cliente, error: errCliente } = await supabase
          .from('clientes')
          .select('id, nombre, saldo')
          .eq('id', args.cliente_id)
          .single()
        if (errCliente || !cliente) {
          return { resultado: `❌ No encontré el cliente con id ${args.cliente_id}.` }
        }

        const monto = Number(args.monto)
        if (!monto || monto <= 0) {
          return { resultado: '❌ El monto del pago tiene que ser mayor a 0.' }
        }

        const movimiento = {
          cliente_id: args.cliente_id,
          fecha: args.fecha || new Date().toISOString().slice(0, 10),
          tipo: 'pago',
          descripcion: args.descripcion || 'Pago registrado desde asistente IA',
          debe: 0,
          haber: monto
        }

        const { data, error } = await supabase
          .from('movimientos_ctacte')
          .insert([movimiento])
          .select()
        if (error) throw error

        // Releer el saldo actualizado (el trigger ya lo recalculó)
        const { data: clienteAct } = await supabase
          .from('clientes')
          .select('saldo')
          .eq('id', args.cliente_id)
          .single()

        let r = `✅ Pago registrado:\n`
        r += `• Cliente: ${cliente.nombre}\n`
        r += `• Monto: ${formatearPesos(monto)}\n`
        r += `• Fecha: ${formatearFecha(movimiento.fecha)}\n`
        r += `• Saldo anterior: ${formatearPesos(cliente.saldo)}\n`
        r += `• Saldo actualizado: ${formatearPesos(clienteAct?.saldo || 0)}`
        return { resultado: r, id: data[0]?.id }
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
