// ═══════════════════════════════════════════════════════════
// HERRAMIENTAS DEL ASISTENTE (TOOLS) — v3 "ACCESO TOTAL"
// ═══════════════════════════════════════════════════════════
// Cambios v2:
//   + Función cargar_entrada_deposito (compra de carne / pollo / embutidos)
//   + Función cargar_pago_cliente (registro de pagos en cta cte)
//   + Función buscar_cliente (para resolver cliente_id antes de pagar)
//   + Función consultar_entradas_recientes
// Cambios v3 (acceso de CONSULTA a todo el sistema):
//   + ventas del día, resumen mensual en vivo (reglas KPI de Fabricio),
//     cierres semanales, gastos, cheques, remitos, pedidos, ofertas,
//     monotributo, sueldos, compras de la semana, extractos de cta cte
//     (cliente y proveedor), medias, cajas, elaboraciones, promo, arqueos
//   + todas las fechas con reloj ARG (lib/fechas), nunca UTC
// ═══════════════════════════════════════════════════════════

import { supabase, fetchAllRows } from './supabase.js'
import { fechaHoyARG, fechaRelativaARG } from './fechas.js'
import { buscarConGoogle } from './gemini.js'
import { enviarWhatsapp } from './whatsapp.js'

// ═══════════════════════════════════════════════════════════
// CONSTANTES — Valores válidos en la base de datos
// ═══════════════════════════════════════════════════════════
const TIPOS_DEPOSITO = ['bovino_mr', 'cerdo', 'pollo', 'cajon_bovino', 'embutido']
const TIPOS_ANIMAL_BOVINO = ['novillito', 'vaquillona', 'overo_grande', 'overo_chico', 'bubalino']
const TIPOS_ANIMAL_CERDO = ['capon']
const TIPOS_MOVIMIENTO = ['remito', 'pago', 'nota_debito', 'nota_credito']
const TOPE_MONO_K = 108357084.05 // tope monotributo categoría K 2026

// Helpers de fecha — siempre reloj ARG (regla de la casa, ver lib/fechas.js)
const inicioMes = () => fechaHoyARG().slice(0, 8) + '01'
const inicioMesAnterior = () => {
  const hoy = fechaHoyARG()
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7))
  return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`
}
// Regla KPI de Fabricio: el mes en curso se compara 01→hoy contra
// 01→MISMO DÍA del mes anterior (nunca contra el mes completo).
const mismoDiaMesAnterior = () => {
  const hoy = fechaHoyARG()
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7)), d = Number(hoy.slice(8, 10))
  const yPrev = m === 1 ? y - 1 : y, mPrev = m === 1 ? 12 : m - 1
  const ultimo = new Date(yPrev, mPrev, 0).getDate()
  return `${yPrev}-${String(mPrev).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}
// Lunes de la semana en curso (las compras a proveedores van por semana)
const inicioSemanaARG = () => {
  const d = new Date(fechaHoyARG() + 'T12:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return fechaHoyARG(d)
}
const sumar = (rows, campo) => (rows || []).reduce((s, r) => s + (Number(r?.[campo]) || 0), 0)

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
    description: `Guarda un recuerdo en tu memoria. USALO PROACTIVAMENTE cuando:
- el usuario exprese una preferencia de trato ("decime jefe", "respuestas más cortas") → tipo "preferencia"
- aprendas un dato del negocio que NO está en el sistema (apodos de clientes/proveedores, rutinas: "los jueves llega media res", acuerdos de palabra) → tipo "dato"
- el usuario te corrija algo → tipo "dato"
- el usuario comparta cómo se SIENTE, una PREOCUPACIÓN, un objetivo personal, algo que está esperando o un tema que lo tiene pendiente ("estoy cansado", "me preocupa la deuda de X", "ojalá repunte el mayorista", "estamos con un quilombo familiar") → tipo "contexto". Esto te sirve para retomar la próxima charla con calidez ("¿cómo viene aquello que te preocupaba?") y sonar como alguien que de verdad escucha.
Reglas: UNA idea por recuerdo, frase corta y clara. NO guardes datos que ya viven en el sistema (precios, saldos, stock — eso se consulta fresco). Para "preferencia"/"dato" avisá con naturalidad ("anotado 🧠"). Para "contexto" NO hace falta avisar que lo anotás — solo respondé con empatía; queda guardado en silencio.`,
    parameters: {
      type: 'object',
      properties: {
        contenido: { type: 'string', description: 'El recuerdo, en una frase corta. Ej: "A Fabricio le gusta que lo saluden como jefe" / "Fabricio venía preocupado por la deuda de Pretto".' },
        tipo: { type: 'string', description: '"preferencia" (trato/estilo), "dato" (del negocio, permanente) o "contexto" (estado de ánimo / preocupación / tema pendiente, relevante por unos días). Default: dato.' },
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
  },

  // ─── ACCESO TOTAL (v3): consultas de TODO el sistema ───────
  {
    name: 'consultar_ventas_dia',
    description: 'Ventas de un día: caja minorista (total, cantidad, ticket promedio) + despachos mayoristas (remitos), y comparación con ayer si es hoy. Usar para "cuánto vendimos hoy/ayer/tal día", "cómo viene el día".',
    parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD. Default: hoy.' } } }
  },
  {
    name: 'consultar_resumen_mes',
    description: 'Resumen MENSUAL EN VIVO del negocio (01 → hoy): Ventas (caja + mayorista + pedidos), Compras de mercadería, Gastos (operativos + sueldos) y Saldo = V−C−G, más la variación de la caja contra el MISMO período del mes anterior. Usar para "cómo viene el mes", "cuánto ganamos este mes", "resumen del negocio".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_cierres_semanales',
    description: 'Últimas semanas CERRADAS con ventas, compras, gastos, sueldos y ganancia de cada una. Usar para "cómo cerró la semana pasada", "ganancia de las últimas semanas".',
    parameters: { type: 'object', properties: { limite: { type: 'number', description: 'Cantidad de semanas (default 4)' } } }
  },
  {
    name: 'consultar_gastos',
    description: 'Gastos registrados en un rango (default: el mes en curso), agrupados por tipo (fijo/variable/socio) con total. Usar para "cuánto gastamos", "gastos del mes", "gastos de combustible".',
    parameters: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD. Default: 01 del mes.' },
        hasta: { type: 'string', description: 'YYYY-MM-DD. Default: hoy.' },
        categoria: { type: 'string', description: 'Opcional: filtrar por categoría (combustible, luz, etc.)' }
      }
    }
  },
  {
    name: 'consultar_cheques',
    description: 'Cheques en cartera: recibidos de clientes (por cobrar, con días al vencimiento) y emitidos propios (por pagar). Usar para "qué cheques tenemos", "cuándo vence el cheque de X".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_remitos_recientes',
    description: 'Últimos remitos/despachos mayoristas (cliente, total, forma de cobro). Usar para "qué despachamos", "remitos de hoy", "qué le mandamos a X".',
    parameters: {
      type: 'object',
      properties: {
        cliente: { type: 'string', description: 'Opcional: filtrar por nombre de cliente' },
        limite: { type: 'number', description: 'Cantidad (default 10)' }
      }
    }
  },
  {
    name: 'buscar_remitos',
    description: 'Busca remitos/despachos en un RANGO DE FECHAS con el DESGLOSE de lo vendido en cada uno (producto, kg, importe). Si se pasa "producto", filtra solo los remitos que lo contienen y desglosa esas líneas sumando su total en kg y plata. Usar para "remitos del 1 al 7 de junio", "buscame todos los remitos donde se vendió matambre de cerdo entre tal y tal fecha y desglosámelo", "qué le vendimos a X esta semana con detalle".',
    parameters: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. OBLIGATORIO.' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD. OBLIGATORIO.' },
        cliente: { type: 'string', description: 'Opcional: filtrar por nombre de cliente.' },
        producto: { type: 'string', description: 'Opcional: nombre del producto a buscar (ej "matambre de cerdo", "media res"). Desglosa solo esas líneas y suma su total en kg e importe.' }
      },
      required: ['desde', 'hasta']
    }
  },
  {
    name: 'buscar_producto_vendido',
    description: 'Cuánto se vendió de un PRODUCTO en un rango de fechas, sumando los DOS canales: CAJA (mostrador/minorista) y MAYORISTA (remitos). Devuelve kg e importe de cada canal, el total general y el desglose de los remitos mayoristas. Si se pasa "cliente", filtra solo las ventas mayoristas a ese cliente (sirve para "qué/cuánto matambre le vendí a Carlos García del X al Y"). Usar para "cuánto matambre de cerdo vendimos del 8 al 14", "cuánto se vendió de costilla por caja y por remito", "qué le vendí de tal producto a tal cliente".',
    parameters: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre del producto (ej "matambre de cerdo", "costilla de ternera", "chorizo"). OBLIGATORIO.' },
        desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. OBLIGATORIO.' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD. OBLIGATORIO.' },
        cliente: { type: 'string', description: 'Opcional: nombre del cliente. Si se pasa, busca ese producto solo en los remitos de ese cliente (la caja minorista no distingue cliente).' }
      },
      required: ['producto', 'desde', 'hasta']
    }
  },
  {
    name: 'ranking_productos',
    description: 'Top productos MÁS VENDIDOS en un rango de fechas, sumando caja (mostrador) + mayorista (remitos). Ordena por kilos o por facturación. Usar para "qué fue lo más vendido este mes", "top 10 productos", "qué corte se vende más".',
    parameters: { type: 'object', properties: {
      desde: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      criterio: { type: 'string', description: '"kg" (kilos) o "importe" (plata). Default importe.' },
      limite: { type: 'number', description: 'Cuántos mostrar. Default 10.' }
    }, required: ['desde', 'hasta'] }
  },
  {
    name: 'ranking_clientes',
    description: 'Top clientes mayoristas por facturación en un rango de fechas (quién compró más). Usar para "quién me compró más", "mejores clientes del mes", "ranking de clientes".',
    parameters: { type: 'object', properties: {
      desde: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      limite: { type: 'number', description: 'Cuántos. Default 10.' }
    }, required: ['desde', 'hasta'] }
  },
  {
    name: 'ranking_proveedores',
    description: 'Top proveedores por monto de COMPRAS en un rango de fechas (a quién le compré más mercadería). Usar para "a qué proveedor le compré más", "ranking de proveedores".',
    parameters: { type: 'object', properties: {
      desde: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      limite: { type: 'number', description: 'Cuántos. Default 10.' }
    }, required: ['desde', 'hasta'] }
  },
  {
    name: 'ventas_por_categoria',
    description: 'Desglose de VENTAS por categoría/rubro (bovino, cerdo, pollo, embutido, almacén, etc.) en un rango de fechas, sumando caja + mayorista. Usar para "cuánto vendí de cada rubro", "ventas por categoría", "qué peso tiene el cerdo en mis ventas".',
    parameters: { type: 'object', properties: {
      desde: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' }
    }, required: ['desde', 'hasta'] }
  },
  {
    name: 'desglose_medios_pago',
    description: 'Desglose de cobros de la CAJA minorista por medio de pago (efectivo, débito, transferencia) en un rango de fechas. Usar para "cuánto cobré en efectivo vs tarjeta", "medios de pago de la semana".',
    parameters: { type: 'object', properties: {
      desde: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' }
    }, required: ['desde', 'hasta'] }
  },
  {
    name: 'clientes_inactivos',
    description: 'Clientes mayoristas que NO compran hace más de N días, con la fecha de su última compra (para recuperarlos). Usar para "qué clientes dejaron de comprar", "clientes inactivos", "a quién tengo que llamar".',
    parameters: { type: 'object', properties: {
      dias: { type: 'number', description: 'Días sin comprar. Default 30.' }
    } }
  },
  {
    name: 'historial_cliente',
    description: 'TODO lo que se le vendió a un CLIENTE en un rango de fechas: lista de remitos con su desglose (productos, kg, importe) y el total facturado. Usar para "qué le vendí a Carlos García este mes", "historial de compras de tal cliente", "mostrame todo lo de X".',
    parameters: { type: 'object', properties: {
      cliente: { type: 'string', description: 'Nombre (o parte) del cliente. OBLIGATORIO.' },
      desde: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' },
      hasta: { type: 'string', description: 'YYYY-MM-DD. OBLIGATORIO.' }
    }, required: ['cliente', 'desde', 'hasta'] }
  },
  {
    name: 'detalle_remito',
    description: 'El detalle completo de un remito puntual por su NÚMERO: cliente, fecha, todos los productos con kg e importe, total y forma de cobro. Usar para "mostrame el remito 345", "qué tenía el remito número X".',
    parameters: { type: 'object', properties: {
      numero: { type: 'number', description: 'Número del remito. OBLIGATORIO.' }
    }, required: ['numero'] }
  },
  {
    name: 'sugerir_compra',
    description: 'ASISTENTE DE COMPRAS: sugiere qué encargar al proveedor. Toma como base lo que se COMPRÓ en los últimos N días (pedido habitual) y lo compara con el STOCK actual, para sugerir reponer ajustando por lo que quedó. Usar para "qué tengo que encargar", "qué compro esta semana", "armame el pedido", "cuánto encargo de medias".',
    parameters: { type: 'object', properties: {
      dias: { type: 'number', description: 'Días hacia atrás para tomar como base de consumo/pedido habitual. Default 7 (una semana).' }
    } }
  },
  {
    name: 'consultar_compras_tipo',
    description: 'Total de COMPRAS de mercadería ingresada al depósito, por tipo y rango de fechas: cantidad de UNIDADES, total en KILOS e importe gastado. Usar para "cuántas medias reses compramos la semana pasada", "cuántos kilos de cerdo entraron este mes", "qué compramos de pollo entre tal y tal fecha". Responder el total en número (unidades) y en kilos.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', description: 'Tipo de mercadería: "media res"/"bovino", "cerdo", "pollo", "cajon", "embutido". Si se omite, suma todo.' },
        desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD. OBLIGATORIO.' },
        hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD. OBLIGATORIO.' }
      },
      required: ['desde', 'hasta']
    }
  },
  {
    name: 'consultar_pedidos',
    description: 'Pedidos de clientes en el sistema (pendientes, confirmados, día de entrega). Usar para "qué pedidos hay", "qué hay que entregar mañana".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_morosos',
    description: 'Clientes con deuda VIEJA (mora): la parte del saldo que excede sus compras de la semana en curso — la plata "en la calle". Usar para "quién está en mora", "a quién tengo que cobrarle", "cuánta plata tengo en la calle", "ranking de morosos".',
    parameters: { type: 'object', properties: { limite: { type: 'number', description: 'Cantidad de clientes a listar (default 10)' } } }
  },
  {
    name: 'consultar_ofertas',
    description: 'Ofertas activas hoy (producto, precio de oferta o % de descuento, vigencia). Usar para "qué ofertas tenemos".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_facturacion_monotributo',
    description: 'Estado de las cuentas de monotributo: facturado de los últimos 12 meses por cuenta y % consumido del tope categoría K. Usar para "cómo van los monotributos", "cuánto facturó Roxana", "riesgo de pasarse del tope".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_sueldos',
    description: 'Últimas liquidaciones de sueldos por empleado (semana, horas, neto). Usar para "cuánto pagamos de sueldos", "liquidación de X".',
    parameters: { type: 'object', properties: { limite: { type: 'number', description: 'Cantidad de liquidaciones (default 8)' } } }
  },
  {
    name: 'consultar_compras_semana',
    description: 'Compras a proveedores de la semana en curso (lunes → hoy) agrupadas por proveedor. Usar para "cuánto compramos esta semana", "qué le compramos a Pretto".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_extracto_proveedor',
    description: 'Extracto de la cuenta corriente de UN proveedor: últimos movimientos (compras, pagos) y saldo. Usar para "movimientos de Pretto", "qué pagos le hicimos a X". Tolerante a nombres mal transcriptos por voz.',
    parameters: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre o parte del nombre del proveedor' } },
      required: ['nombre']
    }
  },
  {
    name: 'consultar_extracto_cliente',
    description: 'Extracto de la cuenta corriente de UN cliente: últimos movimientos (remitos, pagos) y saldo. Usar para "movimientos de X", "qué pagó el cliente Y".',
    parameters: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente' } },
      required: ['nombre']
    }
  },
  {
    name: 'consultar_medias_disponibles',
    description: 'Medias reses físicas disponibles en cámara: cantidad, kg totales y códigos MR-XXX. Usar para "cuántas medias tenemos", "qué medias hay para despostar".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_cajas_disponibles',
    description: 'Cajas bovinas (CB/PT) disponibles: cantidad y kg por tipo. Usar para "cuántas cajas hay".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_elaboraciones_recientes',
    description: 'Últimas elaboraciones de embutidos y salames (qué se hizo, kg finales, desglose por producto). Usar para "qué embutidos hicimos", "cuándo elaboramos chorizos".',
    parameters: { type: 'object', properties: { limite: { type: 'number', description: 'Cantidad (default 5)' } } }
  },
  {
    name: 'consultar_promo_mundial',
    description: 'Estado de la Promo Mundial (descuento en efectivo/transferencia de la caja): activa o no y % de descuento.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'consultar_arqueos',
    description: 'Últimos arqueos de caja: fecha, cajero, total contado y diferencia contra lo esperado. Usar para "cómo dieron los arqueos", "faltó plata en caja".',
    parameters: { type: 'object', properties: { limite: { type: 'number', description: 'Cantidad (default 5)' } } }
  },
  {
    name: 'comparar_ventas',
    description: `Compara las VENTAS (caja minorista + mayorista) entre DOS períodos cualesquiera — días sueltos, semanas o rangos. Usar para "hoy vs el mismo día de la semana pasada", "esta semana vs la anterior", "la semana del 1/6 contra la del 25/5", "junio vs mayo", etc.
CÓMO ARMAR LOS PERÍODOS (vos calculás las fechas a partir de FECHA DE HOY):
- "hoy vs mismo día de la semana pasada" → A = hoy a hoy; B = (hoy − 7 días) a (hoy − 7 días).
- "esta semana vs la anterior" → A = lunes de esta semana a HOY; B = lunes anterior al MISMO día de la semana anterior (períodos del MISMO largo).
- "semana del DD/MM" → lunes a domingo de esa semana.
REGLA KPI DEL JEFE: nunca comparar un período incompleto contra uno completo — si A termina hoy (en curso), recortá B al mismo largo. Si el usuario pide explícitamente semanas completas, usá lunes→domingo en ambos.
Cada período puede ser un solo día (desde = hasta).`,
    parameters: {
      type: 'object',
      properties: {
        a_desde: { type: 'string', description: 'Inicio del período A (el más reciente). YYYY-MM-DD.' },
        a_hasta: { type: 'string', description: 'Fin del período A. YYYY-MM-DD. Para un día suelto, igual a a_desde.' },
        b_desde: { type: 'string', description: 'Inicio del período B (el de comparación). YYYY-MM-DD.' },
        b_hasta: { type: 'string', description: 'Fin del período B. YYYY-MM-DD.' },
        etiqueta_a: { type: 'string', description: 'Nombre corto del período A para mostrar. Ej: "hoy", "esta semana"' },
        etiqueta_b: { type: 'string', description: 'Nombre corto del período B. Ej: "jueves pasado", "semana anterior"' }
      },
      required: ['a_desde', 'a_hasta', 'b_desde', 'b_hasta']
    }
  },

  // ─── MUNDO EXTERIOR (v4): internet, clima, mail, whatsapp ──
  {
    name: 'buscar_en_internet',
    description: 'Busca información ACTUAL en Google y devuelve un resumen con fuentes. Usar cuando pregunten algo que NO está en el sistema y necesita datos frescos: precio del dólar o de la hacienda, noticias, feriados, leyes nuevas, datos de un proveedor/empresa, resultados deportivos, etc. NO usar para datos del negocio (eso está en las otras funciones).',
    parameters: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Qué buscar, redactado como pregunta completa con contexto. Ej: "precio del novillo en el mercado de Cañuelas hoy"' } },
      required: ['consulta']
    }
  },
  {
    name: 'consultar_pronostico',
    description: 'Pronóstico del tiempo REAL para Río Primero, Córdoba: ahora + próximos días (temperatura, lluvia, viento). Usar cuando pregunten por el clima, si llueve, el finde, etc. (Importante para planificar ventas de parrilla: finde lindo = más venta.)',
    parameters: {
      type: 'object',
      properties: { dias: { type: 'number', description: 'Cantidad de días de pronóstico (1 a 7, default 3)' } }
    }
  },
  {
    name: 'enviar_email',
    description: 'Abre el programa de correo del usuario con un email YA REDACTADO (destinatario, asunto y cuerpo precargados) — el usuario solo aprieta Enviar. Usar cuando pidan "mandale un mail a...", "escribile a...". Redactá vos el cuerpo de forma profesional según lo que pida el usuario, mostraselo antes y abrí el borrador.',
    parameters: {
      type: 'object',
      properties: {
        para: { type: 'string', description: 'Email del destinatario. Si el usuario no lo dio, podés dejarlo vacío (lo completa él) o preguntarle.' },
        asunto: { type: 'string', description: 'Asunto del email' },
        cuerpo: { type: 'string', description: 'Cuerpo completo del email, redactado y listo para enviar' }
      },
      required: ['asunto', 'cuerpo']
    }
  },
  {
    name: 'enviar_whatsapp',
    description: 'Abre WhatsApp con un mensaje YA ESCRITO (y el número si se dio) — el usuario solo aprieta Enviar. Usar cuando pidan "mandale un whatsapp a...", "pasale por whats...". Redactá el mensaje según lo que pida y abrí el borrador.',
    parameters: {
      type: 'object',
      properties: {
        telefono: { type: 'string', description: 'Número del destinatario (formato argentino, ej 3515551234). Vacío = el usuario elige el contacto en WhatsApp.' },
        mensaje: { type: 'string', description: 'Mensaje completo, redactado y listo' }
      },
      required: ['mensaje']
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
        const TIPOS_MEM = ['preferencia', 'dato', 'contexto']
        const tipo = TIPOS_MEM.includes(args.tipo) ? args.tipo : 'dato'
        const { error } = await supabase.from('fabri_memoria').insert({
          contenido, tipo,
          usuario: args.usuario?.trim() || null,
        })
        if (error) throw error
        // El "contexto" (emocional) se guarda en silencio — el modelo ya
        // sabe no narrarlo; igual devolvemos confirmación por las dudas.
        return { resultado: tipo === 'contexto' ? `(contexto anotado)` : `🧠 Guardado en memoria: "${contenido}"` }
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
        // Paginado: este ledger crece sin techo y acá se suma entero por proveedor.
        const { data, error } = await fetchAllRows(() => supabase
          .from('movimientos_proveedores')
          .select('proveedor_nombre, debe, haber, anulado'))
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
          fecha: args.fecha || fechaHoyARG(), // hora ARG, no UTC (después de las 21 cambia el día)
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
          fecha: args.fecha || fechaHoyARG(), // hora ARG, no UTC (después de las 21 cambia el día)
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
          fecha: args.fecha || fechaHoyARG(), // hora ARG, no UTC (después de las 21 cambia el día)
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

      // ─── ACCESO TOTAL (v3) ─────────────────────────────────
      case 'consultar_ventas_dia': {
        const fecha = args?.fecha || fechaHoyARG()
        const esHoy = fecha === fechaHoyARG()
        const [caja, remitos, cajaAyer] = await Promise.all([
          supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').eq('fecha', fecha),
          supabase.from('remitos').select('total, cliente_nombre').eq('fecha', fecha).eq('eliminado', false).neq('cobro', 'interno'),
          esHoy ? supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').eq('fecha', fechaRelativaARG(-1)) : Promise.resolve({ data: null }),
        ])
        const totCaja = sumar(caja.data, 'total'), nCaja = (caja.data || []).length
        const totMay = sumar(remitos.data, 'total'), nMay = (remitos.data || []).length
        let r = `Ventas del ${formatearFecha(fecha)}:\n`
        r += `• Caja minorista: ${formatearPesos(totCaja)} (${nCaja} ventas${nCaja > 0 ? `, ticket prom. ${formatearPesos(totCaja / nCaja)}` : ''})\n`
        r += `• Mayorista (remitos): ${formatearPesos(totMay)} (${nMay} despachos)\n`
        r += `• TOTAL DEL DÍA: ${formatearPesos(totCaja + totMay)}`
        if (esHoy && cajaAyer.data) {
          const totAyer = sumar(cajaAyer.data, 'total')
          if (totAyer > 0) r += `\n(Ayer la caja cerró en ${formatearPesos(totAyer)} — hoy ${totCaja >= totAyer ? 'va arriba' : 'viene abajo'} ${Math.abs(((totCaja - totAyer) / totAyer) * 100).toFixed(0)}%)`
        }
        return { resultado: r }
      }

      case 'consultar_resumen_mes': {
        const hoy = fechaHoyARG(), mIni = inicioMes()
        // Paginado: un mes de ventas de caja/salidas supera las 1000 filas y
        // Supabase corta en 1000 → el resumen mensual subdeclaraba en silencio.
        const [cajaMes, cajaMesAnt, salidasMes, pedidosMes, comprasMes, gastosMes, sueldosMes] = await Promise.all([
          fetchAllRows(() => supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', mIni).lte('fecha', hoy)),
          fetchAllRows(() => supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', inicioMesAnterior()).lte('fecha', mismoDiaMesAnterior())),
          fetchAllRows(() => supabase.from('salidas_deposito').select('total, cobro').gte('fecha', mIni).lte('fecha', hoy)),
          fetchAllRows(() => supabase.from('pedidos').select('total_estimado').eq('estado', 'confirmado').gte('dia_entrega', mIni).lte('dia_entrega', hoy)),
          fetchAllRows(() => supabase.from('entradas_deposito').select('importe').gte('fecha', mIni).lte('fecha', hoy).gt('importe', 0).eq('eliminado', false)),
          fetchAllRows(() => supabase.from('gastos').select('monto, tipo, solo_balance').gte('fecha', mIni).lte('fecha', hoy)),
          fetchAllRows(() => supabase.from('liquidaciones_sueldos').select('neto').gte('semana_inicio', mIni).lte('semana_fin', hoy)),
        ])
        const totCaja = sumar(cajaMes.data, 'total')
        const totCajaAnt = sumar(cajaMesAnt.data, 'total')
        const totMay = sumar((salidasMes.data || []).filter(s => s.cobro !== 'interno'), 'total')
        const totPed = sumar(pedidosMes.data, 'total_estimado')
        const ventas = totCaja + totMay + totPed
        const compras = sumar(comprasMes.data, 'importe')
        const gastosOp = sumar((gastosMes.data || []).filter(g => !g.solo_balance && g.tipo !== 'ingreso'), 'monto')
        const sueldos = sumar(sueldosMes.data, 'neto')
        const gastos = gastosOp + sueldos
        const saldo = ventas - compras - gastos
        const dia = hoy.slice(8, 10)
        let r = `Mes en vivo (01→${dia}):\n`
        r += `• VENTAS: ${formatearPesos(ventas)} (caja ${formatearPesos(totCaja)} + mayorista ${formatearPesos(totMay)}${totPed > 0 ? ` + pedidos ${formatearPesos(totPed)}` : ''})\n`
        r += `• COMPRAS: ${formatearPesos(compras)}\n`
        r += `• GASTOS (incl. sueldos): ${formatearPesos(gastos)}\n`
        r += `• SALDO DEL MES: ${formatearPesos(saldo)} ${saldo >= 0 ? '✅' : '🚨 NEGATIVO'}`
        if (totCajaAnt > 0) {
          const v = ((totCaja - totCajaAnt) / totCajaAnt) * 100
          r += `\n• La caja va ${v >= 0 ? '+' : ''}${v.toFixed(1)}% vs el mismo período del mes pasado (01→${dia})`
        }
        return { resultado: r }
      }

      case 'consultar_cierres_semanales': {
        const { data, error } = await supabase.from('cierres_semanales').select('*')
          .lt('semana_fin', fechaHoyARG()).order('semana_inicio', { ascending: false })
          .limit(args?.limite || 4)
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'Todavía no hay semanas cerradas.' }
        const lista = data.map(c =>
          `• ${formatearFecha(c.semana_inicio)}→${formatearFecha(c.semana_fin)}: ganancia ${formatearPesos(c.ganancia)} (V ${formatearPesos(c.ventas)} − C ${formatearPesos(c.compras)} − G ${formatearPesos((Number(c.gastos) || 0) + (Number(c.sueldos) || 0))})`
        ).join('\n')
        return { resultado: `Últimas semanas cerradas:\n${lista}` }
      }

      case 'consultar_gastos': {
        const desde = args?.desde || inicioMes(), hasta = args?.hasta || fechaHoyARG()
        // Paginado: el rango lo elige el usuario y puede abarcar meses/un año.
        const { data, error } = await fetchAllRows(() => {
          let q = supabase.from('gastos').select('tipo, monto, categoria, descripcion, solo_balance').gte('fecha', desde).lte('fecha', hasta)
          if (args?.categoria) q = q.ilike('categoria', `%${args.categoria}%`)
          return q
        })
        if (error) throw error
        const reales = (data || []).filter(g => !g.solo_balance && g.tipo !== 'ingreso')
        if (reales.length === 0) return { resultado: `Sin gastos registrados entre ${formatearFecha(desde)} y ${formatearFecha(hasta)}.` }
        const porTipo = {}
        reales.forEach(g => { porTipo[g.tipo || 'otros'] = (porTipo[g.tipo || 'otros'] || 0) + (Number(g.monto) || 0) })
        const lineas = Object.entries(porTipo).sort((a, b) => b[1] - a[1])
          .map(([t, m]) => `• ${t}: ${formatearPesos(m)}`).join('\n')
        return { resultado: `Gastos ${formatearFecha(desde)} → ${formatearFecha(hasta)} (${reales.length} registros):\n${lineas}\n\nTOTAL: ${formatearPesos(sumar(reales, 'monto'))}` }
      }

      case 'consultar_cheques': {
        const { data, error } = await supabase.from('cheques').select('*').neq('estado', 'imputado').order('fecha_pago')
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay cheques pendientes en cartera.' }
        const hoyD = new Date(fechaHoyARG() + 'T12:00')
        const dias = (f) => f ? Math.ceil((new Date(f + 'T12:00') - hoyD) / 86400000) : null
        const fmt = (c) => {
          const d = dias(c.fecha_pago)
          const venc = d == null ? 'sin fecha' : d < 0 ? `vencido hace ${-d}d` : d === 0 ? 'vence HOY' : `vence en ${d}d`
          return `• #${c.numero} · ${c.cliente_nombre || c.proveedor_nombre || '—'} · ${formatearPesos(c.monto)} · ${venc}`
        }
        const recibidos = data.filter(c => c.origen !== 'emitido')
        const emitidos = data.filter(c => c.origen === 'emitido')
        let r = ''
        if (recibidos.length) r += `Cheques POR COBRAR (${recibidos.length}, total ${formatearPesos(sumar(recibidos, 'monto'))}):\n${recibidos.map(fmt).join('\n')}`
        if (emitidos.length) r += `${r ? '\n\n' : ''}Cheques EMITIDOS por pagar (${emitidos.length}, total ${formatearPesos(sumar(emitidos, 'monto'))}):\n${emitidos.map(fmt).join('\n')}`
        return { resultado: r }
      }

      case 'consultar_remitos_recientes': {
        let query = supabase.from('remitos').select('numero, fecha, cliente_nombre, total, cobro')
          .eq('eliminado', false).order('fecha', { ascending: false }).order('created_at', { ascending: false })
          .limit(args?.limite || 10)
        if (args?.cliente) query = query.ilike('cliente_nombre', `%${args.cliente}%`)
        const { data, error } = await query
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No encontré remitos con ese criterio.' }
        const lista = data.map(rm =>
          `• ${formatearFecha(rm.fecha)} · #${rm.numero} · ${rm.cliente_nombre} · ${formatearPesos(rm.total)} · ${rm.cobro === 'cta_cte' ? 'CTA CTE' : 'pagado'}`
        ).join('\n')
        return { resultado: `Últimos remitos:\n${lista}` }
      }

      case 'buscar_remitos': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta, formato YYYY-MM-DD).' }
        // Paginado: un rango largo supera las 1000 filas y el TOTAL FACTURADO se
        // suma en el cliente (Supabase corta en 1000; ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => {
          let q = supabase.from('remitos').select('numero, fecha, cliente_nombre, total, cobro, items')
            .eq('eliminado', false).gte('fecha', args.desde).lte('fecha', args.hasta)
            .order('fecha', { ascending: true }).order('numero', { ascending: true })
          if (args?.cliente) q = q.ilike('cliente_nombre', `%${args.cliente}%`)
          return q
        })
        if (error) throw error
        if (!data || data.length === 0) return { resultado: `No encontré remitos entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}${args?.cliente ? ` para "${args.cliente}"` : ''}.` }

        const prod = (args?.producto || '').trim().toLowerCase()
        if (prod) {
          // Match por PALABRAS (no substring literal): ignora conectores como
          // "de/la/el" y exige TODAS las palabras significativas. Así "matambre
          // de cerdo" encuentra "MATAMBRE CERDO" pero no "MATAMBRE DE TERNERA"
          // (le falta "cerdo"). Normaliza tildes.
          const sinTilde = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'x', 'a', 'al'])
          const tokens = sinTilde(prod).split(/\s+/).filter(w => w && !STOP.has(w))
          const matchProd = desc => { const d = sinTilde(desc); return tokens.length > 0 && tokens.every(t => d.includes(t)) }
          let totalKg = 0, totalImp = 0, nRemitos = 0
          const lineas = []
          data.forEach(rm => {
            const items = Array.isArray(rm.items) ? rm.items : []
            const match = items.filter(it => matchProd(it.descripcion))
            if (!match.length) return
            nRemitos++
            match.forEach(it => {
              const kg = Number(it.kg) || 0, imp = Number(it.importe) || 0
              totalKg += kg; totalImp += imp
              const cant = kg ? `${kg.toLocaleString('es-AR')} kg` : (it.unidad === 'u' ? '1 u' : '—')
              lineas.push(`• ${formatearFecha(rm.fecha)} · #${rm.numero} · ${rm.cliente_nombre} · ${it.descripcion}: ${cant} · ${formatearPesos(imp)}`)
            })
          })
          if (!lineas.length) return { resultado: `No encontré "${args.producto}" en remitos entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
          return { resultado: `🔎 Ventas de "${args.producto}" (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n${lineas.join('\n')}\n\n📊 TOTAL: ${totalKg.toLocaleString('es-AR')} kg · ${formatearPesos(totalImp)} · en ${nRemitos} remito${nRemitos === 1 ? '' : 's'}.` }
        }

        const bloques = data.map(rm => {
          const items = Array.isArray(rm.items) ? rm.items : []
          const det = items.map(it => {
            const kg = Number(it.kg) || 0
            return `   - ${it.descripcion}${kg ? ': ' + kg.toLocaleString('es-AR') + ' kg' : ''} · ${formatearPesos(Number(it.importe) || 0)}`
          }).join('\n')
          return `• ${formatearFecha(rm.fecha)} · #${rm.numero} · ${rm.cliente_nombre} · ${formatearPesos(rm.total)} · ${rm.cobro === 'cta_cte' ? 'CTA CTE' : 'pagado'}${det ? '\n' + det : ''}`
        }).join('\n\n')
        return { resultado: `📋 Remitos ${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)} (${data.length}):\n\n${bloques}\n\n📊 TOTAL FACTURADO: ${formatearPesos(sumar(data, 'total'))}` }
      }

      case 'buscar_producto_vendido': {
        if (!args?.producto || !args?.desde || !args?.hasta) return { resultado: 'Necesito el producto y el rango de fechas (desde y hasta).' }
        const sinTilde = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'x', 'a', 'al'])
        const tokens = sinTilde(args.producto).split(/\s+/).filter(w => w && !STOP.has(w))
        if (!tokens.length) return { resultado: 'Decime un nombre de producto para buscar.' }
        const matchProd = desc => { const d = sinTilde(desc); return tokens.every(t => d.includes(t)) }

        // Paginado: rango largo → remitos y caja superan las 1000 filas y los kg/$
        // se acumulan en el cliente (Supabase corta en 1000; ver lib/fetchAllRows.js).
        const [remitosR, cajaR] = await Promise.all([
          fetchAllRows(() => {
            let q = supabase.from('remitos').select('numero, fecha, cliente_nombre, items').eq('eliminado', false).gte('fecha', args.desde).lte('fecha', args.hasta).order('fecha', { ascending: true })
            if (args?.cliente) q = q.ilike('cliente_nombre', `%${args.cliente}%`)
            return q
          }),
          // Si se filtra por cliente, la caja (mostrador anónimo) no aplica.
          args?.cliente ? Promise.resolve({ data: [], error: null }) : fetchAllRows(() => supabase.from('ventas_minoristas').select('items').eq('origen', 'caja').gte('fecha', args.desde).lte('fecha', args.hasta)),
        ])
        if (remitosR.error) throw remitosR.error
        if (cajaR.error) throw cajaR.error

        let mayKg = 0, mayImp = 0, mayN = 0
        const lineasMay = []
        ;(remitosR.data || []).forEach(rm => {
          const its = Array.isArray(rm.items) ? rm.items : []
          const m = its.filter(it => matchProd(it.descripcion))
          if (!m.length) return
          mayN++
          m.forEach(it => {
            const kg = Number(it.kg) || 0, imp = Number(it.importe) || 0
            mayKg += kg; mayImp += imp
            lineasMay.push(`  • ${formatearFecha(rm.fecha)} · #${rm.numero} · ${rm.cliente_nombre}: ${kg.toLocaleString('es-AR')} kg · ${formatearPesos(imp)}`)
          })
        })

        let cajaKg = 0, cajaImp = 0, cajaN = 0
        ;(cajaR.data || []).forEach(v => {
          const its = Array.isArray(v.items) ? v.items : []
          const m = its.filter(it => matchProd(it.descripcion))
          if (!m.length) return
          cajaN++
          m.forEach(it => { cajaKg += Number(it.kg) || 0; cajaImp += Number(it.importe) || 0 })
        })

        if (lineasMay.length === 0 && cajaN === 0) {
          return { resultado: `No encontré ventas de "${args.producto}"${args?.cliente ? ` a "${args.cliente}"` : ''} entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        }
        if (args?.cliente) {
          return { resultado: `🔎 "${args.producto}" vendido a ${args.cliente} (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n${lineasMay.join('\n')}\n\n📊 TOTAL: ${mayKg.toLocaleString('es-AR')} kg · ${formatearPesos(mayImp)} · en ${mayN} remito${mayN === 1 ? '' : 's'}.` }
        }
        const totKg = mayKg + cajaKg, totImp = mayImp + cajaImp
        let out = `🔎 Ventas de "${args.producto}" (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n\n`
        out += `🚚 MAYORISTA (remitos): ${mayKg.toLocaleString('es-AR')} kg · ${formatearPesos(mayImp)} · ${mayN} remito${mayN === 1 ? '' : 's'}\n`
        if (lineasMay.length) out += lineasMay.join('\n') + '\n'
        out += `\n🛒 CAJA (mostrador): ${cajaKg.toLocaleString('es-AR')} kg · ${formatearPesos(cajaImp)} · en ${cajaN} venta${cajaN === 1 ? '' : 's'}\n`
        out += `\n📊 TOTAL (las dos vías): ${totKg.toLocaleString('es-AR')} kg · ${formatearPesos(totImp)}`
        return { resultado: out }
      }

      case 'ranking_productos': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta).' }
        const crit = args?.criterio === 'kg' ? 'kg' : 'importe'
        // Paginado: rango largo supera las 1000 filas (ver lib/fetchAllRows.js).
        const [rem, caja] = await Promise.all([
          fetchAllRows(() => supabase.from('remitos').select('items').eq('eliminado', false).gte('fecha', args.desde).lte('fecha', args.hasta)),
          fetchAllRows(() => supabase.from('ventas_minoristas').select('items').eq('origen', 'caja').gte('fecha', args.desde).lte('fecha', args.hasta)),
        ])
        if (rem.error) throw rem.error; if (caja.error) throw caja.error
        const acc = {}
        const proc = rows => (rows || []).forEach(r => (Array.isArray(r.items) ? r.items : []).forEach(it => {
          const n = String(it.descripcion || '').trim().toUpperCase() || 'SIN NOMBRE'
          if (!acc[n]) acc[n] = { kg: 0, importe: 0 }
          acc[n].kg += Number(it.kg) || 0; acc[n].importe += Number(it.importe) || 0
        }))
        proc(rem.data); proc(caja.data)
        const lista = Object.entries(acc).map(([n, v]) => ({ n, ...v })).sort((a, b) => b[crit] - a[crit]).slice(0, args?.limite || 10)
        if (!lista.length) return { resultado: `No hay ventas entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        const txt = lista.map((p, i) => `${i + 1}. ${p.n}: ${p.kg.toLocaleString('es-AR')} kg · ${formatearPesos(p.importe)}`).join('\n')
        return { resultado: `🏆 Top productos (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}, por ${crit === 'kg' ? 'kilos' : 'facturación'}):\n${txt}` }
      }

      case 'ranking_clientes': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta).' }
        // Paginado: un rango largo de salidas supera las 1000 filas (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => supabase.from('salidas_deposito').select('cliente_nombre, total, cobro').gte('fecha', args.desde).lte('fecha', args.hasta))
        if (error) throw error
        const acc = {}
        ;(data || []).filter(s => s.cobro !== 'interno').forEach(s => {
          const n = (s.cliente_nombre || 'Sin nombre').trim()
          acc[n] = (acc[n] || 0) + (Number(s.total) || 0)
        })
        const lista = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, args?.limite || 10)
        if (!lista.length) return { resultado: `No hay ventas mayoristas entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        const txt = lista.map(([n, t], i) => `${i + 1}. ${n}: ${formatearPesos(t)}`).join('\n')
        return { resultado: `🏆 Top clientes mayoristas (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n${txt}` }
      }

      case 'ranking_proveedores': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta).' }
        // Paginado: un rango largo de entradas supera las 1000 filas (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => supabase.from('entradas_deposito').select('proveedor_nombre, importe').eq('eliminado', false).gte('fecha', args.desde).lte('fecha', args.hasta).gt('importe', 0))
        if (error) throw error
        const acc = {}
        ;(data || []).forEach(e => { const n = (e.proveedor_nombre || 'Sin proveedor').trim(); acc[n] = (acc[n] || 0) + (Number(e.importe) || 0) })
        const lista = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, args?.limite || 10)
        if (!lista.length) return { resultado: `No hay compras entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        const txt = lista.map(([n, t], i) => `${i + 1}. ${n}: ${formatearPesos(t)}`).join('\n')
        return { resultado: `🏆 Top proveedores por compras (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n${txt}` }
      }

      case 'ventas_por_categoria': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta).' }
        // Paginado: rango largo supera las 1000 filas (ver lib/fetchAllRows.js).
        const [rem, caja] = await Promise.all([
          fetchAllRows(() => supabase.from('remitos').select('items').eq('eliminado', false).gte('fecha', args.desde).lte('fecha', args.hasta)),
          fetchAllRows(() => supabase.from('ventas_minoristas').select('items').eq('origen', 'caja').gte('fecha', args.desde).lte('fecha', args.hasta)),
        ])
        if (rem.error) throw rem.error; if (caja.error) throw caja.error
        const acc = {}
        const proc = rows => (rows || []).forEach(r => (Array.isArray(r.items) ? r.items : []).forEach(it => {
          const cat = String(it.categoria || it.tipo || 'otros')
          if (!acc[cat]) acc[cat] = { kg: 0, importe: 0 }
          acc[cat].kg += Number(it.kg) || 0; acc[cat].importe += Number(it.importe) || 0
        }))
        proc(rem.data); proc(caja.data)
        const lista = Object.entries(acc).map(([c, v]) => ({ c, ...v })).sort((a, b) => b.importe - a.importe)
        if (!lista.length) return { resultado: `No hay ventas entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        const txt = lista.map(p => `• ${p.c}: ${formatearPesos(p.importe)} · ${p.kg.toLocaleString('es-AR')} kg`).join('\n')
        return { resultado: `📊 Ventas por categoría (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n${txt}` }
      }

      case 'desglose_medios_pago': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta).' }
        // Paginado: un rango largo de ventas de caja supera las 1000 filas (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => supabase.from('ventas_minoristas').select('efectivo, debito, transferencia, total').eq('origen', 'caja').gte('fecha', args.desde).lte('fecha', args.hasta))
        if (error) throw error
        const ef = sumar(data, 'efectivo'), de = sumar(data, 'debito'), tr = sumar(data, 'transferencia'), tot = sumar(data, 'total')
        return { resultado: `💳 Medios de pago en caja (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n• Efectivo: ${formatearPesos(ef)}\n• Débito: ${formatearPesos(de)}\n• Transferencia: ${formatearPesos(tr)}\n• TOTAL: ${formatearPesos(tot)}` }
      }

      case 'clientes_inactivos': {
        const dias = Number(args?.dias) || 30
        const limite = fechaRelativaARG(-dias)
        // Paginado: barre TODO el historial de salidas (sin filtro de fecha) para
        // saber la última compra de cada cliente; supera las 1000 filas y sin
        // paginar omitía clientes (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => supabase.from('salidas_deposito').select('cliente_nombre, fecha, cobro').order('fecha', { ascending: false }))
        if (error) throw error
        const ultima = {}
        ;(data || []).filter(s => s.cobro !== 'interno').forEach(s => { const n = (s.cliente_nombre || '').trim(); if (n && !ultima[n]) ultima[n] = s.fecha })
        const inactivos = Object.entries(ultima).filter(([, f]) => f < limite).sort((a, b) => a[1].localeCompare(b[1]))
        if (!inactivos.length) return { resultado: `Todos los clientes compraron en los últimos ${dias} días. 👍` }
        const txt = inactivos.slice(0, 20).map(([n, f]) => `• ${n} — última compra ${formatearFecha(f)}`).join('\n')
        return { resultado: `⚠️ Clientes sin comprar hace +${dias} días (${inactivos.length}):\n${txt}` }
      }

      case 'historial_cliente': {
        if (!args?.cliente || !args?.desde || !args?.hasta) return { resultado: 'Necesito el cliente y el rango de fechas (desde y hasta).' }
        // Paginado: un cliente grande en un rango largo puede pasar las 1000 filas
        // y el TOTAL se suma en el cliente (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => supabase.from('remitos').select('numero, fecha, cliente_nombre, total, cobro, items')
          .eq('eliminado', false).ilike('cliente_nombre', `%${args.cliente}%`).gte('fecha', args.desde).lte('fecha', args.hasta).order('fecha', { ascending: true }))
        if (error) throw error
        if (!data || !data.length) return { resultado: `No encontré ventas a "${args.cliente}" entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        const bloques = data.map(rm => {
          const its = Array.isArray(rm.items) ? rm.items : []
          const det = its.map(it => { const kg = Number(it.kg) || 0; return `   - ${it.descripcion}${kg ? ': ' + kg.toLocaleString('es-AR') + ' kg' : ''} · ${formatearPesos(Number(it.importe) || 0)}` }).join('\n')
          return `• ${formatearFecha(rm.fecha)} · #${rm.numero} · ${formatearPesos(rm.total)} · ${rm.cobro === 'cta_cte' ? 'CTA CTE' : 'pagado'}${det ? '\n' + det : ''}`
        }).join('\n\n')
        return { resultado: `📋 Ventas a ${(data[0].cliente_nombre || args.cliente).trim()} (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}, ${data.length} remito${data.length === 1 ? '' : 's'}):\n\n${bloques}\n\n📊 TOTAL: ${formatearPesos(sumar(data, 'total'))}` }
      }

      case 'detalle_remito': {
        if (!args?.numero) return { resultado: 'Decime el número del remito.' }
        const { data, error } = await supabase.from('remitos').select('numero, fecha, cliente_nombre, total, cobro, items, eliminado').eq('numero', args.numero).limit(5)
        if (error) throw error
        if (!data || !data.length) return { resultado: `No encontré el remito #${args.numero}.` }
        const txt = data.map(rm => {
          const its = Array.isArray(rm.items) ? rm.items : []
          const det = its.map(it => { const kg = Number(it.kg) || 0; return `   - ${it.descripcion}${kg ? ': ' + kg.toLocaleString('es-AR') + ' kg' : ''} · ${formatearPesos(Number(it.importe) || 0)}` }).join('\n')
          return `📄 Remito #${rm.numero}${rm.eliminado ? ' (ANULADO)' : ''}\n${formatearFecha(rm.fecha)} · ${rm.cliente_nombre} · ${rm.cobro === 'cta_cte' ? 'CTA CTE' : 'pagado'}\n${det}\nTotal: ${formatearPesos(rm.total)}` }).join('\n\n')
        return { resultado: txt }
      }

      case 'sugerir_compra': {
        const dias = Number(args?.dias) || 7
        const desde = fechaRelativaARG(-dias)
        const hasta = fechaHoyARG()
        const [comprasR, stockR] = await Promise.all([
          supabase.from('entradas_deposito').select('tipo, cantidad, kg, kg_real').eq('eliminado', false).gte('fecha', desde).lte('fecha', hasta),
          supabase.from('stock_actual').select('tipo, kg_disponible'),
        ])
        if (comprasR.error) throw comprasR.error
        if (stockR.error) throw stockR.error
        const stock = {}
        ;(stockR.data || []).forEach(s => { stock[s.tipo] = Number(s.kg_disponible) || 0 })
        const acc = {}
        ;(comprasR.data || []).forEach(e => {
          const t = e.tipo || 'otro'
          if (!acc[t]) acc[t] = { unidades: 0, kg: 0 }
          acc[t].unidades += Number(e.cantidad) || 1
          acc[t].kg += Number(e.kg_real) > 0 ? Number(e.kg_real) : (Number(e.kg) || 0)
        })
        const NOMBRE = { bovino_mr: 'Media res', cerdo: 'Cerdo (capones)', pollo: 'Pollo', cajon_bovino: 'Cajones bovino', embutido: 'Embutidos' }
        if (Object.keys(acc).length === 0) {
          return { resultado: `No registré compras en los últimos ${dias} días, así que no tengo una base para sugerir el pedido. Si me decís tu pedido habitual (ej. 10 medias, 12 cerdos), lo comparo con el stock.` }
        }
        const lineas = Object.entries(acc).map(([t, v]) => {
          const st = stock[t] || 0
          const nom = NOMBRE[t] || t
          return `• ${nom}: la última semana entraron ${v.unidades} u (${v.kg.toLocaleString('es-AR')} kg). Stock hoy: ${st.toLocaleString('es-AR')} kg.`
        }).join('\n')
        return { resultado: `🛒 BASE PARA TU PEDIDO (compras últimos ${dias} días vs stock actual):\n${lineas}\n\n💡 Criterio: reponé lo que se consumió. Si de algún tipo quedó bastante stock, encargá menos; si está en cero o bajo, encargá lo habitual o un poco más. Decime y te armo el pedido fino con las cantidades exactas.` }
      }

      case 'consultar_compras_tipo': {
        if (!args?.desde || !args?.hasta) return { resultado: 'Necesito el rango de fechas (desde y hasta, formato YYYY-MM-DD).' }
        const MAP_TIPO = { 'media res': 'bovino_mr', 'medias res': 'bovino_mr', 'media': 'bovino_mr', 'bovino': 'bovino_mr', 'res': 'bovino_mr', 'vaca': 'bovino_mr', 'novillo': 'bovino_mr', 'cerdo': 'cerdo', 'chancho': 'cerdo', 'pollo': 'pollo', 'cajon': 'cajon_bovino', 'cajón': 'cajon_bovino', 'embutido': 'embutido' }
        const termino = (args?.tipo || '').trim().toLowerCase()
        let tipoBd = null
        if (termino) tipoBd = MAP_TIPO[termino] || (Object.entries(MAP_TIPO).find(([k]) => termino.includes(k)) || [])[1] || null
        // Paginado: un rango largo sin filtro de tipo supera las 1000 filas y
        // unidades/kg/importe se suman en el cliente (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => {
          let q = supabase.from('entradas_deposito').select('tipo, kg, kg_real, importe, cantidad, fecha')
            .gte('fecha', args.desde).lte('fecha', args.hasta).eq('eliminado', false)
          if (tipoBd) q = q.eq('tipo', tipoBd)
          return q
        })
        if (error) throw error
        if (!data || data.length === 0) return { resultado: `No encontré compras${args?.tipo ? ' de ' + args.tipo : ''} entre ${formatearFecha(args.desde)} y ${formatearFecha(args.hasta)}.` }
        const unidades = data.reduce((s, e) => s + (Number(e.cantidad) || 1), 0)
        const kgTotal = data.reduce((s, e) => s + (Number(e.kg_real) > 0 ? Number(e.kg_real) : (Number(e.kg) || 0)), 0)
        const importe = sumar(data, 'importe')
        const etiqueta = args?.tipo ? args.tipo : 'mercadería (todo)'
        return { resultado: `🛒 Compras de ${etiqueta} (${formatearFecha(args.desde)} → ${formatearFecha(args.hasta)}):\n• Unidades / ingresos: ${unidades}\n• Kilos totales: ${kgTotal.toLocaleString('es-AR')} kg\n• Importe gastado: ${formatearPesos(importe)}` }
      }

      case 'consultar_pedidos': {
        const { data, error } = await supabase.from('pedidos').select('cliente_nombre, estado, dia_entrega, horario_entrega, total_estimado')
          .not('estado', 'in', '(rechazado,cancelado)')
          .gte('dia_entrega', fechaRelativaARG(-7)).order('dia_entrega')
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay pedidos activos en el sistema.' }
        const lista = data.map(p =>
          `• ${formatearFecha(p.dia_entrega)}${p.horario_entrega ? ` ${p.horario_entrega}` : ''} · ${p.cliente_nombre} · ${formatearPesos(p.total_estimado)} · ${(p.estado || '').toUpperCase()}`
        ).join('\n')
        return { resultado: `Pedidos:\n${lista}` }
      }

      case 'consultar_morosos': {
        // Mora = saldo − compras (debe) de la semana en curso. Lo de esta
        // semana es deuda corriente (se cobra la próxima), NO mora. Mismo
        // criterio que las tarjetas de Clientes & Cta Cte (PR #284).
        const [{ data: clis, error: errClis }, { data: movsSem }] = await Promise.all([
          supabase.from('clientes').select('id, nombre, saldo').gt('saldo', 0),
          fetchAllRows(() => supabase.from('movimientos_ctacte').select('cliente_id, debe').gte('fecha', inicioSemanaARG()).gt('debe', 0)),
        ])
        if (errClis) throw errClis
        const debeSem = {}
        for (const m of (movsSem || [])) debeSem[m.cliente_id] = (debeSem[m.cliente_id] || 0) + (Number(m.debe) || 0)
        const morosos = (clis || [])
          .map(c => ({ nombre: (c.nombre || '').trim(), mora: Math.max(0, (Number(c.saldo) || 0) - (debeSem[c.id] || 0)), saldo: Number(c.saldo) || 0 }))
          .filter(c => c.mora > 0.01)
          .sort((a, b) => b.mora - a.mora)
        if (morosos.length === 0) return { resultado: 'No hay clientes en mora: toda la deuda pendiente es de compras de esta semana (corriente). 👏' }
        const lim = args?.limite || 10
        const total = morosos.reduce((s, c) => s + c.mora, 0)
        const lista = morosos.slice(0, lim).map(c =>
          `• ${c.nombre}: ${formatearPesos(c.mora)} en mora${c.saldo > c.mora + 0.01 ? ` (saldo total ${formatearPesos(c.saldo)})` : ''}`
        ).join('\n')
        return { resultado: `Plata en la calle (deuda anterior a esta semana): ${formatearPesos(total)} entre ${morosos.length} clientes.\n${lista}${morosos.length > lim ? `\n(+${morosos.length - lim} clientes más)` : ''}\n\nCriterio: mora = saldo − compras de la semana en curso (lun→hoy).` }
      }

      case 'consultar_ofertas': {
        const hoy = fechaHoyARG()
        const { data, error } = await supabase.from('ofertas').select('*').eq('activa', true)
          .lte('fecha_inicio', hoy).or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`)
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay ofertas activas hoy.' }
        const lista = data.map(o =>
          `• ${o.producto_nombre}: ${o.descuento_pct ? `−${o.descuento_pct}%` : formatearPesos(o.precio_oferta)}${o.fecha_fin ? ` (hasta ${formatearFecha(o.fecha_fin)})` : ''}`
        ).join('\n')
        return { resultado: `Ofertas activas:\n${lista}` }
      }

      case 'consultar_facturacion_monotributo': {
        const [cuentas, facturas] = await Promise.all([
          supabase.from('cuentas_fiscales').select('id, nombre, tipo').eq('activa', true),
          supabase.from('facturas').select('cuenta_id, monto_total').eq('tipo', 'emitida').gte('fecha', fechaRelativaARG(-365)),
        ])
        if (cuentas.error) throw cuentas.error
        const monos = (cuentas.data || []).filter(c => c.tipo === 'monotributo')
        if (monos.length === 0) return { resultado: 'No hay cuentas de monotributo activas.' }
        const lista = monos.map(c => {
          const fact = sumar((facturas.data || []).filter(f => f.cuenta_id === c.id), 'monto_total')
          const pct = (fact / TOPE_MONO_K) * 100
          const icono = pct >= 95 ? '🚨' : pct >= 70 ? '⚠️' : '✅'
          return `${icono} ${c.nombre}: ${formatearPesos(fact)} en 12 meses → ${pct.toFixed(1)}% del tope K`
        }).join('\n')
        return { resultado: `Monotributos (tope cat. K: ${formatearPesos(TOPE_MONO_K)}):\n${lista}` }
      }

      case 'consultar_sueldos': {
        const { data, error } = await supabase.from('liquidaciones_sueldos').select('*')
          .order('semana_fin', { ascending: false }).limit(args?.limite || 8)
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay liquidaciones de sueldos cargadas.' }
        const lista = data.map(l =>
          `• ${l.empleado_nombre} · sem. ${formatearFecha(l.semana_inicio)}→${formatearFecha(l.semana_fin)} · ${l.horas ? `${l.horas} hs · ` : ''}neto ${formatearPesos(l.neto)}`
        ).join('\n')
        return { resultado: `Últimas liquidaciones:\n${lista}` }
      }

      case 'consultar_compras_semana': {
        const { data, error } = await supabase.from('compras_proveedores')
          .select('proveedor_nombre, importe, anulado').gte('fecha', inicioSemanaARG()).lte('fecha', fechaHoyARG())
        if (error) throw error
        const validas = (data || []).filter(c => !c.anulado)
        if (validas.length === 0) return { resultado: 'Sin compras registradas esta semana todavía.' }
        const acc = {}
        validas.forEach(c => { const k = (c.proveedor_nombre || '—').trim().toUpperCase(); acc[k] = (acc[k] || 0) + (Number(c.importe) || 0) })
        const lista = Object.entries(acc).sort((a, b) => b[1] - a[1])
          .map(([n, t]) => `• ${n}: ${formatearPesos(t)}`).join('\n')
        return { resultado: `Comprado esta semana (lunes → hoy):\n${lista}\n\nTOTAL: ${formatearPesos(Object.values(acc).reduce((s, v) => s + v, 0))}` }
      }

      case 'consultar_extracto_proveedor': {
        const sinAcentos2 = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        // Paginado: el saldo del proveedor suma TODO su ledger; si la tabla pasa
        // de 1000 filas, sin paginar se omitían movimientos viejos (ver lib/fetchAllRows.js).
        const { data, error } = await fetchAllRows(() => supabase.from('movimientos_proveedores').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }))
        if (error) throw error
        const buscado = sinAcentos2(args.nombre || '')
        const movs = (data || []).filter(m => sinAcentos2(m.proveedor_nombre || '').includes(buscado))
        if (movs.length === 0) return { resultado: `No encontré movimientos del proveedor "${args.nombre}". Probá con consultar_deuda_proveedores para ver todos.` }
        const saldo = movs.reduce((s, m) => m.anulado ? s : s + (Number(m.debe) || 0) - (Number(m.haber) || 0), 0)
        const lista = movs.slice(0, 10).map(m =>
          `• ${formatearFecha(m.fecha)} · ${m.tipo} · ${m.descripcion || ''}${Number(m.debe) > 0 ? ` · DEBE ${formatearPesos(m.debe)}` : ''}${Number(m.haber) > 0 ? ` · HABER ${formatearPesos(m.haber)}` : ''}${m.anulado ? ' (ANULADO)' : ''}`
        ).join('\n')
        return { resultado: `Cta cte de ${movs[0].proveedor_nombre} — saldo: ${saldo > 0 ? 'le debemos ' + formatearPesos(saldo) : saldo < 0 ? 'a favor nuestro ' + formatearPesos(-saldo) : 'al día'}\nÚltimos movimientos:\n${lista}` }
      }

      case 'consultar_extracto_cliente': {
        const { data: clis, error: errCli } = await supabase.from('clientes').select('id, nombre, saldo')
          .ilike('nombre', `%${args.nombre}%`).limit(3)
        if (errCli) throw errCli
        if (!clis || clis.length === 0) return { resultado: `No encontré ningún cliente con "${args.nombre}".` }
        const cli = clis[0]
        const { data: movs, error } = await supabase.from('movimientos_ctacte').select('*')
          .eq('cliente_id', cli.id).order('fecha', { ascending: false }).limit(10)
        if (error) throw error
        const lista = (movs || []).map(m =>
          `• ${formatearFecha(m.fecha)} · ${m.tipo} · ${m.descripcion || ''}${Number(m.debe) > 0 ? ` · DEBE ${formatearPesos(m.debe)}` : ''}${Number(m.haber) > 0 ? ` · HABER ${formatearPesos(m.haber)}` : ''}`
        ).join('\n') || 'Sin movimientos.'
        const extra = clis.length > 1 ? `\n(También matchean: ${clis.slice(1).map(c => c.nombre).join(', ')} — avisame si era otro)` : ''
        return { resultado: `Cta cte de ${cli.nombre} — saldo: ${formatearPesos(cli.saldo)}\nÚltimos movimientos:\n${lista}${extra}` }
      }

      case 'consultar_medias_disponibles': {
        const { data, error } = await supabase.from('medias_stock').select('codigo, kg, proveedor_origen, fecha_ingreso').eq('estado', 'disponible').order('fecha_ingreso')
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay medias reses disponibles en cámara.' }
        const kg = sumar(data, 'kg')
        const lista = data.slice(0, 15).map(m => `• ${m.codigo} · ${Number(m.kg).toFixed(1)} kg · ${m.proveedor_origen || ''} (${formatearFecha(m.fecha_ingreso)})`).join('\n')
        return { resultado: `Medias reses disponibles: ${data.length} (${kg.toFixed(0)} kg en total)\n${lista}${data.length > 15 ? `\n…y ${data.length - 15} más` : ''}` }
      }

      case 'consultar_cajas_disponibles': {
        const { data, error } = await supabase.from('cajas_stock').select('tipo_caja, kg').eq('estado', 'disponible')
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay cajas bovinas disponibles.' }
        const acc = {}
        data.forEach(c => { const k = c.tipo_caja || '—'; acc[k] = acc[k] || { n: 0, kg: 0 }; acc[k].n++; acc[k].kg += Number(c.kg) || 0 })
        const lista = Object.entries(acc).map(([t, v]) => `• ${t.toUpperCase()}: ${v.n} cajas · ${v.kg.toFixed(1)} kg`).join('\n')
        return { resultado: `Cajas disponibles:\n${lista}` }
      }

      case 'consultar_elaboraciones_recientes': {
        const { data, error } = await supabase.from('elaboraciones_embutidos').select('*')
          .order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(args?.limite || 5)
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay elaboraciones registradas.' }
        const lista = data.map(e => {
          const prods = Array.isArray(e.productos_finales) && e.productos_finales.length > 0
            ? e.productos_finales.filter(Boolean).map(p => `${(p.tipo || '').replace(/_/g, ' ')} ${Number(p.kg).toFixed(1)} kg`).join(' + ')
            : (e.tipo_embutido || '').replace(/_/g, ' ')
          const estado = e.tipo === 'salame' && !e.maduracion_completa ? ' · 🔒 en secado' : ''
          return `• ${formatearFecha(e.fecha)} · ${prods} · ${Number(e.kg_final || e.kg_elaborado || 0).toFixed(1)} kg${estado}`
        }).join('\n')
        return { resultado: `Últimas elaboraciones:\n${lista}` }
      }

      case 'consultar_promo_mundial': {
        const { data, error } = await supabase.from('config_sistema').select('valor').eq('clave', 'promo_mundial').maybeSingle()
        if (error) throw error
        const v = data?.valor || {}
        return { resultado: v.activa ? `⚽ Promo Mundial ACTIVA: −${v.descuento_pct || 10}% en efectivo/transferencia en la caja.` : 'La Promo Mundial está APAGADA.' }
      }

      case 'consultar_arqueos': {
        const { data, error } = await supabase.from('arqueos_caja').select('fecha, hora, cajero, total_contado, efectivo_esperado, diferencia')
          .order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(args?.limite || 5)
        if (error) throw error
        if (!data || data.length === 0) return { resultado: 'No hay arqueos de caja registrados.' }
        const lista = data.map(a => {
          const dif = Number(a.diferencia) || 0
          const icono = Math.abs(dif) < 1000 ? '✅' : '⚠️'
          return `${icono} ${formatearFecha(a.fecha)}${a.cajero ? ` · ${a.cajero}` : ''} · contado ${formatearPesos(a.total_contado)} · dif. ${dif >= 0 ? '+' : ''}${formatearPesos(dif)}`
        }).join('\n')
        return { resultado: `Últimos arqueos de caja:\n${lista}` }
      }

      case 'comparar_ventas': {
        const reFecha = /^\d{4}-\d{2}-\d{2}$/
        const A = { desde: args.a_desde, hasta: args.a_hasta, nombre: args.etiqueta_a || 'Período A' }
        const B = { desde: args.b_desde, hasta: args.b_hasta, nombre: args.etiqueta_b || 'Período B' }
        for (const p of [A, B]) {
          if (!reFecha.test(p.desde || '') || !reFecha.test(p.hasta || '')) {
            return { resultado: '❌ Necesito las fechas de ambos períodos en formato YYYY-MM-DD.' }
          }
        }
        // Resumen de ventas de un período: caja minorista + mayorista (remitos
        // sin flujos internos) — misma fórmula que consultar_ventas_dia.
        const resumen = async (p) => {
          // Paginado: cada período puede abarcar meses/un año (ver lib/fetchAllRows.js).
          const [caja, remitos] = await Promise.all([
            fetchAllRows(() => supabase.from('ventas_minoristas').select('total').eq('origen', 'caja').gte('fecha', p.desde).lte('fecha', p.hasta)),
            fetchAllRows(() => supabase.from('remitos').select('total').eq('eliminado', false).neq('cobro', 'interno').gte('fecha', p.desde).lte('fecha', p.hasta)),
          ])
          if (caja.error) throw caja.error
          if (remitos.error) throw remitos.error
          const tCaja = sumar(caja.data, 'total')
          const tMay = sumar(remitos.data, 'total')
          return { tCaja, nCaja: (caja.data || []).length, tMay, nMay: (remitos.data || []).length, total: tCaja + tMay }
        }
        const [ra, rb] = await Promise.all([resumen(A), resumen(B)])
        const rango = (p) => p.desde === p.hasta ? formatearFecha(p.desde) : `${formatearFecha(p.desde)} → ${formatearFecha(p.hasta)}`
        const variacion = (va, vb) => vb > 0 ? ` (${va >= vb ? '+' : ''}${(((va - vb) / vb) * 100).toFixed(1)}%)` : ''
        let r = `Comparación de ventas:\n`
        r += `▸ ${A.nombre} (${rango(A)}):\n`
        r += `  • Caja: ${formatearPesos(ra.tCaja)} (${ra.nCaja} ventas) · Mayorista: ${formatearPesos(ra.tMay)} (${ra.nMay} remitos)\n`
        r += `  • TOTAL: ${formatearPesos(ra.total)}\n`
        r += `▸ ${B.nombre} (${rango(B)}):\n`
        r += `  • Caja: ${formatearPesos(rb.tCaja)} (${rb.nCaja} ventas) · Mayorista: ${formatearPesos(rb.tMay)} (${rb.nMay} remitos)\n`
        r += `  • TOTAL: ${formatearPesos(rb.total)}\n`
        r += `▸ Diferencia (${A.nombre} vs ${B.nombre}):\n`
        r += `  • Caja: ${ra.tCaja >= rb.tCaja ? '+' : '−'}${formatearPesos(Math.abs(ra.tCaja - rb.tCaja))}${variacion(ra.tCaja, rb.tCaja)}\n`
        r += `  • Mayorista: ${ra.tMay >= rb.tMay ? '+' : '−'}${formatearPesos(Math.abs(ra.tMay - rb.tMay))}${variacion(ra.tMay, rb.tMay)}\n`
        r += `  • TOTAL: ${ra.total >= rb.total ? '+' : '−'}${formatearPesos(Math.abs(ra.total - rb.total))}${variacion(ra.total, rb.total)}`
        return { resultado: r }
      }

      // ─── MUNDO EXTERIOR (v4) ───────────────────────────────
      case 'buscar_en_internet': {
        const consulta = String(args.consulta || '').trim()
        if (!consulta) return { resultado: 'Decime qué querés que busque.' }
        const { texto, fuentes } = await buscarConGoogle(consulta)
        return { resultado: `🌐 Resultado de la búsqueda:\n${texto}${fuentes.length ? `\n\nFuentes: ${fuentes.join(' · ')}` : ''}` }
      }

      case 'consultar_pronostico': {
        // Open-Meteo: gratuito, sin API key, con CORS. Coordenadas de
        // Río Primero, Córdoba. Timezone ARG explícita.
        const dias = Math.min(7, Math.max(1, Number(args?.dias) || 3))
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=-31.34&longitude=-63.62'
          + '&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,weather_code'
          + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
          + `&timezone=America%2FArgentina%2FCordoba&forecast_days=${dias}`
        const resp = await fetch(url)
        if (!resp.ok) throw new Error('No pude consultar el servicio meteorológico.')
        const met = await resp.json()
        const CLIMA = (c) => {
          if (c === 0) return '☀️ despejado'
          if (c <= 2) return '🌤️ algo nublado'
          if (c === 3) return '☁️ nublado'
          if (c <= 48) return '🌫️ niebla'
          if (c <= 57) return '🌦️ llovizna'
          if (c <= 67) return '🌧️ lluvia'
          if (c <= 77) return '❄️ nieve'
          if (c <= 82) return '🌧️ chaparrones'
          return '⛈️ tormenta'
        }
        const cur = met.current || {}
        let r = `Clima en Río Primero AHORA: ${CLIMA(cur.weather_code)} · ${Math.round(cur.temperature_2m)}°C (térmica ${Math.round(cur.apparent_temperature)}°C) · viento ${Math.round(cur.wind_speed_10m)} km/h\n`
        const d = met.daily || {}
        const dows = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
        ;(d.time || []).forEach((f, i) => {
          const dow = dows[new Date(f + 'T12:00').getDay()]
          r += `• ${dow} ${f.slice(8, 10)}/${f.slice(5, 7)}: ${CLIMA(d.weather_code[i])} · ${Math.round(d.temperature_2m_min[i])}° a ${Math.round(d.temperature_2m_max[i])}° · lluvia ${d.precipitation_probability_max[i] ?? 0}%\n`
        })
        return { resultado: r.trim() }
      }

      case 'enviar_email': {
        const para = String(args.para || '').trim()
        const asunto = String(args.asunto || '').trim()
        const cuerpo = String(args.cuerpo || '').trim()
        if (!asunto && !cuerpo) return { resultado: 'Necesito al menos el asunto y el cuerpo del mail.' }
        const href = `mailto:${encodeURIComponent(para)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
        // mailto vía location.href no navega la página y no lo frenan los
        // bloqueadores de popups (window.open sí suele bloquearse acá).
        window.location.href = href
        return { resultado: `📧 Listo: te abrí el borrador del mail${para ? ` para ${para}` : ''} con asunto "${asunto}". Revisalo y dale Enviar.` }
      }

      case 'enviar_whatsapp': {
        const mensaje = String(args.mensaje || '').trim()
        if (!mensaje) return { resultado: 'Necesito el mensaje para abrir WhatsApp.' }
        enviarWhatsapp(args.telefono || '', mensaje)
        return { resultado: `💬 Te abrí WhatsApp con el mensaje listo${args.telefono ? '' : ' (elegí el contacto)'}. Si el navegador bloqueó la ventana, habilitá los popups del sistema y volvé a pedírmelo.` }
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
