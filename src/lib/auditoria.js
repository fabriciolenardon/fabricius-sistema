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
    descripcion: `Anuló venta #${venta.id} del ${venta.fecha} · Total: $${Math.round(venta.total).toLocaleString('es-AR')}`,
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
    descripcion: `Guardó arqueo del ${arqueo.fecha} · Contado: $${Math.round(arqueo.total_contado).toLocaleString('es-AR')}`,
    valoresDespues: arqueo,
  }),
  crearFactura: (factura) => logAuditoria({
    accion: 'insert',
    modulo: 'facturacion',
    entidad: 'factura',
    entidad_id: factura.id,
    descripcion: `Registró factura ${factura.tipo} ${factura.tipo_comprobante || ''} ${factura.numero || ''} · $${Math.round(factura.monto_total).toLocaleString('es-AR')}`,
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
}
