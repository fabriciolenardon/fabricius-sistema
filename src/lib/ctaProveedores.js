// ============================================================
// CUENTA CORRIENTE DE PROVEEDORES — helpers DEBE/HABER/SALDO
// ============================================================
// Espejo de la cuenta corriente de clientes (movimientos_ctacte) pero
// para proveedores. Encapsula las operaciones contra
// `movimientos_proveedores`:
//   - listar movimientos de un proveedor
//   - registrar compra (debe), pago/entrega (haber), ajuste, saldo inicial
//   - recalcular el saldo corriente y replicarlo en proveedores.saldo_adeudado
//
// Convención de signos (NUESTRA deuda con el proveedor):
//   debe  → compra (aumenta lo que le debemos)
//   haber → pago/entrega (reduce lo que le debemos)
//   saldo = Σdebe − Σhaber
//     > 0  le debemos · < 0  saldo a favor · = 0  al día
// ============================================================
import { supabase, fetchAllRows } from './supabase'

// Trae TODOS los movimientos de un proveedor, MÁS antiguos primero (para poder
// recalcular el saldo corriente acumulando en orden). Paginado de a 1000: si se
// cortara en 1000, el saldo recalculado quedaría mal (subdeclarado).
export async function cargarMovimientos(proveedorId) {
  if (!proveedorId) return []
  const { data } = await fetchAllRows(() => supabase
    .from('movimientos_proveedores')
    .select('*')
    .eq('proveedor_id', proveedorId)
    .order('fecha', { ascending: true })
    .order('id', { ascending: true }))
  return data || []
}

// Recalcula el saldo corriente de TODOS los movimientos de un proveedor
// en orden cronológico y lo persiste en cada fila (columna saldo). Se llama
// después de insertar, editar o borrar un movimiento para mantener la cadena
// consistente. El saldo total = Σdebe − Σhaber se deriva on-the-fly (no se
// guarda en la tabla proveedores, que no tiene esa columna en producción).
export async function recalcularSaldo(proveedorId) {
  const movs = await cargarMovimientos(proveedorId)
  let saldo = 0
  for (const m of movs) {
    // Los movimientos ANULADOS quedan visibles en el extracto pero NO afectan
    // el saldo (es como si la compra/pago no hubiera existido).
    if (!m.anulado) saldo += (Number(m.debe) || 0) - (Number(m.haber) || 0)
    // Solo actualizamos si cambió, para minimizar writes
    if (Number(m.saldo) !== saldo) {
      await supabase.from('movimientos_proveedores').update({ saldo }).eq('id', m.id)
    }
  }
  // NOTA: el saldo NO se persiste en proveedores (esa columna no existe en
  // producción). El saldo se calcula siempre como Σdebe − Σhaber de los
  // movimientos, que es la fuente de verdad. El saldo por-movimiento queda
  // guardado arriba para el extracto de la cuenta corriente.
  return saldo
}

// Nombre del usuario logueado para `registrado_por` (mig 58). Best effort:
// si falla la consulta, el movimiento se guarda igual sin autor — la plata
// nunca se traba por la trazabilidad.
// Motivo: el 11/06 aparecieron 3 pagos a PRETTO y nadie pudo decir quién
// los cargó. Desde ahora cada movimiento queda firmado.
// El nombre del que registra NO cambia durante la sesion, pero se pedia de
// nuevo en CADA movimiento: dos viajes al servidor (auth.getUser + profiles)
// que sumaban ~900 ms a cada carga de mercaderia. Se resuelve una sola vez y
// queda en memoria; al recargar la pagina se vuelve a pedir.
let _nombreUsuario                       // undefined = todavia no se pidio
let _nombreUsuarioPromesa                // la consulta en curso, si hay una

async function nombreUsuarioActual() {
  if (_nombreUsuario !== undefined) return _nombreUsuario
  // Si dos movimientos salen juntos, comparten la misma consulta en vez de
  // disparar dos.
  if (!_nombreUsuarioPromesa) {
    _nombreUsuarioPromesa = (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return null
        const { data: perfil } = await supabase.from('profiles').select('nombre').eq('id', user.id).maybeSingle()
        return perfil?.nombre || user.email || null
      } catch { return null }
    })()
  }
  _nombreUsuario = await _nombreUsuarioPromesa
  _nombreUsuarioPromesa = null
  return _nombreUsuario
}

// Para el logout: la proxima carga tiene que volver a preguntar quien es.
export function olvidarUsuarioCache() {
  _nombreUsuario = undefined
  _nombreUsuarioPromesa = null
}

// Inserta un movimiento genérico y recalcula el saldo del proveedor.
// mov: { fecha, proveedorId, proveedorNombre, tipo, descripcion, debe, haber, entradaId, forma, notas }
export async function agregarMovimiento(mov) {
  const fila = {
    fecha: mov.fecha,
    proveedor_id: mov.proveedorId,
    proveedor_nombre: mov.proveedorNombre || null,
    tipo: mov.tipo || 'compra',
    descripcion: mov.descripcion || null,
    debe: Number(mov.debe) || 0,
    haber: Number(mov.haber) || 0,
    saldo: 0, // se recalcula abajo
    entrada_id: mov.entradaId || null,
    forma: mov.forma || null,
    notas: mov.notas || null,
    registrado_por: await nombreUsuarioActual(),
  }
  const { data, error } = await supabase.from('movimientos_proveedores').insert(fila).select().single()
  if (error) return { error: error.message }
  await recalcularSaldo(mov.proveedorId)
  return { data, error: null }
}

// Atajos semánticos
export function registrarCompraProv({ proveedorId, proveedorNombre, fecha, importe, descripcion, entradaId }) {
  return agregarMovimiento({
    proveedorId, proveedorNombre, fecha, tipo: 'compra',
    descripcion: descripcion || 'Compra', debe: importe, haber: 0, entradaId,
  })
}

export function registrarPagoProv({ proveedorId, proveedorNombre, fecha, importe, forma, notas }) {
  return agregarMovimiento({
    proveedorId, proveedorNombre, fecha, tipo: 'pago',
    descripcion: `Pago${forma ? ' — ' + forma : ''}${notas ? ' — ' + notas : ''}`,
    debe: 0, haber: importe, forma, notas,
  })
}

export function registrarAjusteProv({ proveedorId, proveedorNombre, fecha, debe, haber, descripcion }) {
  return agregarMovimiento({
    proveedorId, proveedorNombre, fecha, tipo: 'ajuste',
    descripcion: descripcion || 'Ajuste', debe: debe || 0, haber: haber || 0,
  })
}

// Saldo inicial al migrar: si saldoInicial > 0 lo cargamos como DEBE
// (le debíamos), si < 0 como HABER (teníamos a favor).
export function registrarSaldoInicialProv({ proveedorId, proveedorNombre, fecha, saldoInicial }) {
  const s = Number(saldoInicial) || 0
  return agregarMovimiento({
    proveedorId, proveedorNombre, fecha, tipo: 'saldo_inicial',
    descripcion: 'Saldo inicial (migración de cuentas)',
    debe: s > 0 ? s : 0,
    haber: s < 0 ? Math.abs(s) : 0,
  })
}

// Corrige la forma de pago (y las notas) de un PAGO ya registrado, sin tocar
// importes ni saldo — caso típico: se cargó "efectivo" y era transferencia.
// Regenera la descripción (que lleva la forma incrustada) para que el
// extracto muestre lo corregido. El filtro tipo='pago' evita pisar compras.
export async function actualizarFormaPagoProv({ movId, forma, notas }) {
  const descripcion = `Pago${forma ? ' — ' + forma : ''}${notas ? ' — ' + notas : ''}`
  const { error } = await supabase.from('movimientos_proveedores')
    .update({ forma: forma || null, notas: notas || null, descripcion })
    .eq('id', movId).eq('tipo', 'pago')
  return { error: error?.message || null }
}

// Elimina un movimiento y recalcula el saldo del proveedor.
export async function eliminarMovimiento(movId, proveedorId) {
  const { error } = await supabase.from('movimientos_proveedores').delete().eq('id', movId)
  if (error) return { error: error.message }
  await recalcularSaldo(proveedorId)
  return { error: null }
}

// Revierte el/los movimiento(s) de compra asociados a una entrada al
// depósito (por entrada_id) cuando esa entrada se elimina. Recalcula el
// saldo de cada proveedor afectado.
export async function revertirCompraDeEntrada(entradaId, anuladoPor = null) {
  if (!entradaId) return
  const { data: movs } = await supabase
    .from('movimientos_proveedores').select('id, proveedor_id, anulado').eq('entrada_id', entradaId)
  if (!movs || movs.length === 0) return
  const provIds = new Set()
  for (const m of movs) {
    // Antes se borraba el movimiento. Ahora se ANULA (queda visible en el
    // extracto del proveedor, marcado, pero deja de sumar a la deuda).
    if (!m.anulado) {
      await supabase.from('movimientos_proveedores')
        .update({ anulado: true, anulado_por: anuladoPor, anulado_en: new Date().toISOString() })
        .eq('id', m.id)
    }
    if (m.proveedor_id) provIds.add(m.proveedor_id)
  }
  for (const pid of provIds) await recalcularSaldo(pid)
}

// ¿El proveedor ya tiene su cuenta corriente inicializada?
// (al menos un movimiento). Sirve para mostrar el botón de migración.
export async function tieneMovimientos(proveedorId) {
  const { count } = await supabase
    .from('movimientos_proveedores')
    .select('id', { count: 'exact', head: true })
    .eq('proveedor_id', proveedorId)
  return (count || 0) > 0
}

// Crea un movimiento de COMPRA (debe) en la cuenta corriente del proveedor
// a partir de una entrada al depósito. SOLO si:
//   - el proveedor existe en la tabla proveedores, y
//   - ya tiene cuenta corriente inicializada (al menos un movimiento)
// Si el proveedor no está inicializado, no hace nada (la compra igual
// queda registrada en compras_proveedores para el fallback semanal, y
// cuando el admin inicialice la cta cte podrá cargar el saldo correcto).
// Devuelve { creado: boolean }.
export async function registrarCompraDesdeEntrada({ proveedorNombre, fecha, importe, descripcion, entradaId }) {
  if (!proveedorNombre || !(Number(importe) > 0)) return { creado: false }
  const { data: prov } = await supabase
    .from('proveedores').select('id, nombre').ilike('nombre', proveedorNombre).maybeSingle()
  if (!prov) return { creado: false }
  const yaInit = await tieneMovimientos(prov.id)
  if (!yaInit) return { creado: false }
  await registrarCompraProv({
    proveedorId: prov.id, proveedorNombre: prov.nombre,
    fecha, importe, descripcion, entradaId,
  })
  return { creado: true }
}

// Sincroniza el movimiento de COMPRA (debe) de una entrada al depósito cuando
// esa entrada se EDITA (cambió el importe, la fecha, el proveedor o la
// descripción).
//
// Sin esto la corrección quedaba SOLO en entradas_deposito y la cuenta
// corriente seguía con el número viejo. Bug real del 07/09/2026: una media res
// (MR-486) se cargó a $101/kg, se corrigió a $10.100 desde Ingresos, y en la
// cuenta de EMANUEL SARAVIA quedó por $10.847 en lugar de $1.084.740 — casi
// $1.074.000 de deuda subdeclarada en una sola línea.
//
// Casos que contempla:
//   - la entrada NO tenía movimiento (proveedor sin cta cte al cargarla, o
//     importe 0): se crea ahora si corresponde
//   - cambió el PROVEEDOR de la entrada: se anula el movimiento en la cuenta
//     vieja y se crea en la nueva
//   - duplicados (más de un movimiento vigente para la misma entrada): se
//     corrige el primero y se anulan los sobrantes, que nunca debieron existir
export async function actualizarCompraDesdeEntrada({ entradaId, proveedorNombre, fecha, importe, descripcion }) {
  if (!entradaId) return { actualizado: false }
  const { data: movs } = await supabase
    .from('movimientos_proveedores')
    .select('id, proveedor_id, anulado')
    .eq('entrada_id', entradaId)
    .order('id', { ascending: true })
  const vigentes = (movs || []).filter(m => !m.anulado)

  // ¿A qué proveedor corresponde AHORA la entrada?
  const { data: prov } = proveedorNombre
    ? await supabase.from('proveedores').select('id, nombre').ilike('nombre', proveedorNombre).maybeSingle()
    : { data: null }

  // Se le cambió el proveedor a la entrada: la compra tiene que salir de la
  // cuenta vieja y entrar en la nueva (no alcanza con pisar el nombre).
  if (vigentes.length > 0 && prov && vigentes.some(m => m.proveedor_id !== prov.id)) {
    await revertirCompraDeEntrada(entradaId)
    return await registrarCompraDesdeEntrada({ proveedorNombre, fecha, importe, descripcion, entradaId })
  }

  if (vigentes.length === 0) {
    return await registrarCompraDesdeEntrada({ proveedorNombre, fecha, importe, descripcion, entradaId })
  }

  const [principal, ...sobrantes] = vigentes
  await supabase.from('movimientos_proveedores').update({
    fecha,
    debe: Number(importe) || 0,
    descripcion: descripcion || 'Compra',
    proveedor_nombre: prov?.nombre || proveedorNombre || null,
  }).eq('id', principal.id)
  for (const m of sobrantes) {
    await supabase.from('movimientos_proveedores')
      .update({ anulado: true, anulado_por: 'sistema (duplicado de la misma entrada)', anulado_en: new Date().toISOString() })
      .eq('id', m.id)
  }
  const provIds = new Set(vigentes.map(m => m.proveedor_id).filter(Boolean))
  for (const pid of provIds) await recalcularSaldo(pid)
  return { actualizado: true }
}
