// ============================================================
// AUDITORÍA — helper centralizado para registrar cambios
// ============================================================
// Uso:
//   import { logAuditoria } from '../../lib/auditoria'
//   await logAuditoria({
//     accion: 'delete',
//     modulo: 'caja',
//     entidad: 'venta_minorista',
//     entidad_id: venta.id,
//     descripcion: `Anuló venta #${venta.id} por $${venta.total}`,
//     valoresAntes: venta,
//   })
//
// No bloquea la operación: si falla el log, igual continúa.
// ============================================================
import { supabase } from './supabase'
import { fmtPrecio } from './formatos'

export async function logAuditoria({
  accion,            // 'insert' | 'update' | 'delete' | 'login' | 'logout' | 'custom'
  modulo,            // 'caja' | 'precios' | 'ofertas' | 'facturacion' | 'deposito' | 'arqueo' | 'desposte' | ...
  entidad,           // 'venta_minorista' | 'precio' | 'factura' | 'cuenta_fiscal' | ...
  entidad_id = null,
  descripcion = null,
  valoresAntes = null,
  valoresDespues = null,
}) {
  try {
    // Capturar info del usuario actual
    const { data: { user } } = await supabase.auth.getUser()
    let usuario_nombre = null
    let usuario_rol = null
    if (user) {
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('nombre, rol')
          .eq('id', user.id)
          .maybeSingle()
        usuario_nombre = prof?.nombre || user.email || null
        usuario_rol = prof?.rol || null
      } catch (e) { /* silencioso */ }
    }

    await supabase.from('auditoria_log').insert({
      usuario_id: user?.id || null,
      usuario_nombre,
      usuario_rol,
      accion,
      modulo,
      entidad,
      entidad_id: entidad_id != null ? String(entidad_id) : null,
      descripcion,
      valores_antes: valoresAntes,
      valores_despues: valoresDespues,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
  } catch (e) {
    // Silencioso: no queremos romper la app si la auditoría falla
    console.warn('[auditoria] no se pudo loguear:', e?.message)
  }
}

// Helpers acotados para uso común
export const auditoria = {
  anularVenta: (venta) => logAuditoria({
    accion: 'delete',
    modulo: 'caja',
    entidad: 'venta_minorista',
    entidad_id: venta.id,
    descripcion: `Anuló venta #${venta.id} del ${venta.fecha} · Total: ${fmtPrecio(venta.total)}`,
    valoresAntes: venta,
  }),
  cambiarPrecio: (precio, antes, despues) => logAuditoria({
    accion: 'update',
    modulo: 'precios',
    entidad: 'precio',
    entidad_id: precio.id,
    descripcion: `Cambió precio de "${precio.nombre || precio.descripcion}"`,
    valoresAntes: antes,
    valoresDespues: despues,
  }),
  crearOferta: (oferta) => logAuditoria({
    accion: 'insert',
    modulo: 'precios',
    entidad: 'oferta',
    entidad_id: oferta.id,
    descripcion: `Creó oferta "${oferta.producto_nombre}" hasta ${oferta.fecha_fin}`,
    valoresDespues: oferta,
  }),
  desactivarOferta: (oferta) => logAuditoria({
    accion: 'update',
    modulo: 'precios',
    entidad: 'oferta',
    entidad_id: oferta.id,
    descripcion: `Desactivó oferta "${oferta.producto_nombre}"`,
    valoresAntes: oferta,
  }),
  aprobarFlujoDeposito: (flujo) => logAuditoria({
    accion: 'update',
    modulo: 'deposito',
    entidad: 'flujo_deposito',
    entidad_id: flujo.id,
    descripcion: `Aprobó flujo desposte #${flujo.id} (${flujo.tipo})`,
    valoresAntes: flujo,
  }),
  rechazarFlujoDeposito: (flujo, motivo) => logAuditoria({
    accion: 'update',
    modulo: 'deposito',
    entidad: 'flujo_deposito',
    entidad_id: flujo.id,
    descripcion: `Rechazó flujo desposte #${flujo.id} · Motivo: ${motivo || '—'}`,
    valoresAntes: flujo,
  }),
  guardarArqueo: (arqueo) => logAuditoria({
    accion: 'insert',
    modulo: 'arqueo',
    entidad: 'arqueo_caja',
    entidad_id: arqueo.id,
    descripcion: `Guardó arqueo del ${arqueo.fecha} · Contado: ${fmtPrecio(arqueo.total_contado)}`,
    valoresDespues: arqueo,
  }),
  crearFactura: (factura) => logAuditoria({
    accion: 'insert',
    modulo: 'facturacion',
    entidad: 'factura',
    entidad_id: factura.id,
    descripcion: `Registró factura ${factura.tipo} ${factura.tipo_comprobante || ''} ${factura.numero || ''} · ${fmtPrecio(factura.monto_total)}`,
    valoresDespues: factura,
  }),
  borrarFactura: (factura) => logAuditoria({
    accion: 'delete',
    modulo: 'facturacion',
    entidad: 'factura',
    entidad_id: factura.id,
    descripcion: `Borró factura ${factura.tipo} #${factura.numero || factura.id}`,
    valoresAntes: factura,
  }),
  // Borrado de un movimiento de cuenta corriente de un cliente. La fila se
  // borra de verdad (no puede quedar en el ledger sumando), así que el ÚNICO
  // registro de que existió es este log: por eso guarda el movimiento entero
  // en valores_antes. Sin esto el pago desaparecía sin dejar rastro.
  eliminarMovimientoCtacte: (mov, clienteNombre, motivo) => logAuditoria({
    accion: 'delete',
    modulo: 'clientes',
    entidad: 'movimiento_ctacte',
    entidad_id: mov.id,
    descripcion: `Eliminó ${mov.tipo} de ${fmtPrecio(mov.debe > 0 ? mov.debe : mov.haber)} del ${mov.fecha} · ${clienteNombre || 'cliente'}${motivo ? ` · Motivo: ${motivo}` : ''}`,
    valoresAntes: { ...mov, cliente_nombre: clienteNombre, motivo_eliminacion: motivo || null },
  }),
  ajustarStock: (tipo, antes, despues, motivo) => logAuditoria({
    accion: 'update',
    modulo: 'deposito',
    entidad: 'stock_actual',
    entidad_id: tipo,
    descripcion: `Ajustó stock "${tipo}": ${antes} → ${despues}. Motivo: ${motivo || '—'}`,
    valoresAntes: { tipo, kg_disponible: antes },
    valoresDespues: { tipo, kg_disponible: despues, motivo },
  }),
}


// ============================================================
// LECTURA — movimientos de cta cte eliminados de un cliente
// ============================================================
// Reconstruye el "historial de eliminados" desde el log. Devuelve el
// movimiento tal como estaba + quién y cuándo lo borró.
export async function movimientosCtacteEliminados(clienteId) {
  if (!clienteId) return []
  const base = () => supabase
    .from('auditoria_log')
    .select('id, fecha, usuario_nombre, descripcion, valores_antes')
    .eq('entidad', 'movimiento_ctacte')
    .eq('accion', 'delete')
    .order('fecha', { ascending: false })

  // El filtro por cliente va en la consulta (el tope de filas se consumiría
  // con los borrados de TODOS los clientes). Si el filtro sobre el jsonb
  // fallara, se cae a traer las últimas y filtrar acá: una lista vacía se ve
  // igual que "no se registró nada" y es justo lo que no queremos mostrar mal.
  let { data, error } = await base().eq('valores_antes->>cliente_id', clienteId).limit(500)
  if (error) {
    console.warn('[auditoria] filtro por cliente no soportado, se filtra en el cliente:', error.message)
    const r = await base().limit(1000)
    if (r.error) { console.warn('[auditoria] no se pudieron leer los eliminados:', r.error.message); return [] }
    data = (r.data || []).filter(l => String(l.valores_antes?.cliente_id) === String(clienteId))
  }
  return (data || [])
    .map(l => ({
      log_id: l.id,
      eliminado_en: l.fecha,
      eliminado_por: l.usuario_nombre || '—',
      motivo: l.valores_antes?.motivo_eliminacion || null,
      mov: l.valores_antes || {},
    }))
}
