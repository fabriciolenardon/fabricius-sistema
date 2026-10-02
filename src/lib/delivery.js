// ============================================================
// delivery.js — lo compartido entre la app pública (/pedir) y el panel
// ============================================================
// El público no tiene usuario: lee y escribe SOLO por las funciones de
// la mig 156 (delivery_catalogo, delivery_crear_pedido, delivery_ver_pedido,
// delivery_avisar_transferencia). El precio lo recalcula el servidor; lo
// que se muestra acá es nada más para que el cliente vea el aproximado.
// ============================================================
import { fmtPrecio } from './formatos'

export const TZ = 'America/Argentina/Buenos_Aires'

// Orden y nombres que ve el cliente (las claves son las categorías reales).
export const CATEGORIAS_DELIVERY = [
  { key: 'bovino_corte', label: 'Vaca' },
  { key: 'bovino_brosa', label: 'Achuras' },
  { key: 'cerdo_corte', label: 'Cerdo' },
  { key: 'pollo', label: 'Pollo' },
  { key: 'embutido', label: 'Embutidos' },
  { key: 'rebozado', label: 'Rebozados y congelados' },
]

export const ESTADOS = {
  nuevo:     { label: 'Nuevo',            color: '#b45309' },
  pesado:    { label: 'Pesado',           color: '#2563eb' },
  pagado:    { label: 'Pagado',           color: '#0f766e' },
  en_camino: { label: 'En camino',        color: '#7c3aed' },
  entregado: { label: 'Entregado',        color: '#15803d' },
  cancelado: { label: 'Cancelado',        color: '#6b7280' },
}

// Pesos redondos, sin centavos: así se habla en el mostrador.
export const pesos = n => fmtPrecio(Math.round(Number(n) || 0), { decimales: 0 })

// Los nombres vienen en mayúsculas y con espacios de más: "VACIO DE TERNERA "
// → "Vacio de ternera" (los acentos no están en la base).
export function nombreLindo(n) {
  const s = String(n || '').trim().toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function fmtCantidad(cantidad, pesable) {
  const n = Number(cantidad) || 0
  if (!pesable) return `${n} u.`
  return `${n.toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg`
}

// "1½ kg" para los botones rápidos
export const OPCIONES_KG = [0.5, 1, 1.5, 2]
export function labelKg(kg) {
  if (kg === 0.5) return '½ kg'
  if (kg === 1.5) return '1½ kg'
  return `${kg} kg`
}

// ── Horarios ──────────────────────────────────────────────────
// La hora SIEMPRE de Argentina (el celular del cliente puede tener otra).
function ahoraARG(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map(x => [x.type, x.value]))
  const dias = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const h = Number(p.hour) % 24
  return { dow: dias[p.weekday], min: h * 60 + Number(p.minute) }
}
const aMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }

// Hasta qué hora se toman pedidos ahora mismo (o null si está cerrado).
export function cierraA(config, date = new Date()) {
  if (!config?.activo) return null
  const { dow, min } = ahoraARG(date)
  const h = (config.horarios || []).find(h => (h.dias || []).includes(dow) && min >= aMin(h.desde) && min < aMin(h.hasta))
  return h ? h.hasta : null
}

const NOMBRE_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

// "hoy a las 17:30" / "mañana a las 9:00" / "el lunes a las 9:00"
export function proximaApertura(config, date = new Date()) {
  if (!config?.activo) return null
  const { dow, min } = ahoraARG(date)
  for (let d = 0; d < 8; d++) {
    const dia = ((dow - 1 + d) % 7) + 1
    const turnos = (config.horarios || [])
      .filter(h => (h.dias || []).includes(dia))
      .map(h => aMin(h.desde))
      .filter(m => d > 0 || m > min)
      .sort((a, b) => a - b)
    if (turnos.length) {
      const m = turnos[0]
      const hora = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
      const cuando = d === 0 ? 'hoy' : d === 1 ? 'mañana' : `el ${NOMBRE_DIA[dia]}`
      return `${cuando} a las ${hora}`
    }
  }
  return null
}

// "Lunes a sábado" + los turnos, para mostrar.
export function textoHorarios(config) {
  const hs = config?.horarios || []
  if (!hs.length) return []
  const dias = hs[0].dias || []
  const iguales = hs.every(h => JSON.stringify(h.dias) === JSON.stringify(dias))
  const rango = d => {
    const ord = [...d].sort((a, b) => a - b)
    const corrido = ord.every((x, i) => i === 0 || x === ord[i - 1] + 1)
    if (corrido && ord.length > 2) return `${NOMBRE_DIA[ord[0]]} a ${NOMBRE_DIA[ord[ord.length - 1]]}`
    return ord.map(x => NOMBRE_DIA[x]).join(', ')
  }
  const turno = h => `${h.desde.replace(/^0/, '')} a ${h.hasta.replace(/^0/, '')}`
  if (iguales) {
    const d = rango(dias)
    return [{ dias: d.charAt(0).toUpperCase() + d.slice(1), turnos: hs.map(turno).join(' y ') }]
  }
  return hs.map(h => { const d = rango(h.dias || []); return { dias: d.charAt(0).toUpperCase() + d.slice(1), turnos: turno(h) } })
}

// Los códigos que tira delivery_crear_pedido → lo que se le dice al cliente.
export function mensajeError(error, config) {
  const m = String(error?.message || error || '')
  if (m.includes('SESION')) return 'Tu sesión se cerró. Ingresá de nuevo con tu teléfono y tu clave.'
  if (m.includes('YA_EXISTE')) return 'Ese teléfono ya tiene una cuenta. Ingresá con tu clave.'
  if (m.includes('PIN')) return 'La clave tiene que ser de 4 números.'
  if (m.includes('CERRADO')) return 'Justo cerramos la toma de pedidos. Probá de nuevo en el próximo horario.'
  if (m.includes('MINIMO')) return `La compra mínima es de ${pesos(config?.minimo)}.`
  if (m.includes('NOMBRE')) return 'Escribí tu nombre.'
  if (m.includes('TELEFONO')) return 'Revisá el número de WhatsApp: tiene que tener la característica (ej. 3574 …).'
  if (m.includes('DIRECCION')) return 'Escribí la dirección de entrega.'
  if (m.includes('SIN_STOCK')) return 'Uno de los productos se quedó sin stock recién. Sacalo del pedido y elegí otro.'
  if (m.includes('PRODUCTO')) return 'Uno de los productos ya no está disponible. Sacalo del pedido y probá de nuevo.'
  if (m.includes('CANTIDAD')) return 'Hay una cantidad que no podemos tomar (máximo 20 kg por producto).'
  if (m.includes('DEMASIADOS')) return 'Ya tenés pedidos en curso con este número. Esperá a que lleguen o llamanos.'
  if (m.includes('SATURADO')) return 'Estamos con muchos pedidos. Probá en unos minutos.'
  return 'No pudimos mandar el pedido. Revisá tu conexión y probá de nuevo.'
}

// Lo que vuelve delivery_ingresar en { error }.
export function mensajeIngreso(codigo) {
  if (codigo === 'NO_EXISTE') return 'No hay una cuenta con ese teléfono. Creá una, es un minuto.'
  if (codigo === 'CLAVE') return 'La clave no es correcta. Ojo: a los 5 intentos la cuenta se bloquea 15 minutos.'
  if (codigo === 'BLOQUEADO') return 'Por seguridad la cuenta quedó bloqueada 15 minutos. Si te olvidaste la clave, escribinos y te la reseteamos.'
  return 'No pudimos ingresar. Revisá tu conexión y probá de nuevo.'
}

// "Te faltan 2 pedidos para tu 10%" / "Tenés 10% de descuento en este pedido"
export function textoCupon(cupon) {
  if (!cupon || !(cupon.cada > 0) || !(cupon.pct > 0)) return null
  if (cupon.disponible) return `🎁 Tenés ${cupon.pct}% de descuento en la carne de tu próximo pedido`
  const f = cupon.faltan
  return `Te ${f === 1 ? 'falta 1 pedido' : `faltan ${f} pedidos`} para tu ${cupon.pct}% de descuento`
}

// ── Mensajes de WhatsApp que manda el local (wa.me, desde su celular) ──
// Cómo se nombra un renglón: si se cambió por otro producto, se aclara.
export function nombreRenglon(i) {
  const n = nombreLindo(i.nombre)
  return i.reemplaza ? `${n} (en lugar de ${nombreLindo(i.reemplaza)})` : n
}

export function mensajeTotalFinal(p, config) {
  const lineas = (p.items || []).map(i => {
    if (i.sin_stock) return `• ${nombreLindo(i.nombre)}: no había, no se cobra`
    const cant = i.pesable ? fmtCantidad(i.kg_real ?? i.cantidad, true) : fmtCantidad(i.cantidad, false)
    return `• ${nombreRenglon(i)} ${cant}: ${pesos(i.importe_real ?? i.importe)}`
  })
  const pago = p.forma_pago === 'transferencia'
    ? `Transferí ${pesos(p.total_final)} al alias *${config?.alias || ''}* y mandanos el comprobante por acá. Apenas lo vemos, sale el pedido.`
    : `Pagás ${pesos(p.total_final)} en efectivo cuando te llega.`
  return [
    `Hola ${p.cliente_nombre}! Ya pesamos tu pedido N° ${p.id} de Fabricius 🥩`,
    '',
    ...lineas,
    ...(Number(p.descuento_monto) > 0 ? [`• Descuento cupón ${Number(p.descuento_pct)}%: -${pesos(p.descuento_monto)}`] : []),
    `• Envío: ${pesos(p.envio)}`,
    `*Total: ${pesos(p.total_final)}*`,
    '',
    pago,
    '',
    `Seguilo acá: ${linkSeguimiento(p.token)}`,
  ].join('\n')
}

// Preguntarle al cliente qué hacer con un producto que no hay.
export function mensajeSinStock(p, item) {
  return [
    `Hola ${p.cliente_nombre}! Te escribimos de Fabricius por tu pedido N° ${p.id}.`,
    `Hoy no tenemos *${nombreLindo(item.reemplaza || item.nombre)}* 😕`,
    '¿Te lo cambiamos por otro producto o lo sacamos del pedido?',
  ].join('\n')
}

export function mensajeEnCamino(p) {
  return `Hola ${p.cliente_nombre}! Tu pedido N° ${p.id} de Fabricius ya salió para ${p.direccion} 🛵`
}

// La dirección PÚBLICA de la app (dominio propio, sin "vercel" en el link).
// Los links que se le mandan al cliente salen siempre de acá, aunque quien
// los arme esté en el panel del sistema (otro dominio).
export const URL_DELIVERY = 'https://delivery.fabriciuscarnes.com.ar'

export function linkSeguimiento(token) {
  return `${URL_DELIVERY}/pedir/seguimiento/${token}`
}
