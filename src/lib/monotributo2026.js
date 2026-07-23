// ============================================================
// MONOTRIBUTO 2026 — Valores oficiales ARCA
// ============================================================
// Vigencia: AGOSTO 2026 – ENERO 2027 (desde el 1/08/2026).
// ARCA actualiza semestralmente (en enero y julio).
// Cuando salgan los nuevos valores: actualizar este archivo
// y subir el bump de fecha en VIGENCIA_HASTA.
//
// Actualización JULIO 2026: índice IPC 1er semestre = +16,8459%
// (todas las categorías y cuotas escalan por el mismo factor).
// Recategorización: hasta el 05/08/2026.
//
// Fuente:
//   - https://www.afip.gob.ar/monotributo/categorias.asp (21/07/2026)
//   - Cargado el 22/07/2026 — verificado contra el tope K oficial
//     $126.610.838,75 que pasó Fabricio.
//
// El tope de FACTURACIÓN ANUAL es lo que dispara la
// recategorización obligatoria (parámetro: últimos 12 meses
// corridos previos a enero y julio).
// ============================================================

export const VIGENCIA_DESDE = '2026-08-01'
export const VIGENCIA_HASTA = '2027-01-31'

// Precio unitario máximo de venta de cosas muebles
// (si vendés algún producto por encima de este precio, no podés ser monotributista)
export const PRECIO_UNITARIO_MAX = 716840.77

// Tope absoluto del régimen — superar esto te excluye del monotributo
export const TOPE_MAX_ABSOLUTO = 126610838.75

// ============================================================
// Categorías
// tope_anual: facturación bruta anual máxima permitida
// cuota_servicios: cuota mensual para prestadores de servicios
// cuota_comercio: cuota mensual para venta de cosas muebles
// ============================================================
export const CATEGORIAS = [
  { cat: 'A', tope_anual: 12009410.45, cuota_servicios: 49527.18,  cuota_comercio: 49527.18  },
  { cat: 'B', tope_anual: 17595182.74, cuota_servicios: 56379.08,  cuota_comercio: 56379.08  },
  { cat: 'C', tope_anual: 24670494.31, cuota_servicios: 66020.12,  cuota_comercio: 64530.58  },
  { cat: 'D', tope_anual: 30628651.43, cuota_servicios: 84612.93,  cuota_comercio: 82564.81  },
  { cat: 'E', tope_anual: 36028231.33, cuota_servicios: 119811.45, cuota_comercio: 108267.51 },
  { cat: 'F', tope_anual: 45151659.41, cuota_servicios: 150784.21, cuota_comercio: 129930.65 },
  { cat: 'G', tope_anual: 53995798.87, cuota_servicios: 230312.94, cuota_comercio: 158815.05 },
  { cat: 'H', tope_anual: 81924660.37, cuota_servicios: 522706.68, cuota_comercio: 317895.01 },
  { cat: 'I', tope_anual: 91699761.90, cuota_servicios: 963747.86, cuota_comercio: 474992.78 },
  { cat: 'J', tope_anual: 105012519.20, cuota_servicios: 1167299.76, cuota_comercio: 580793.69 },
  { cat: 'K', tope_anual: 126610838.75, cuota_servicios: 1614446.04, cuota_comercio: 702103.24 },
]

// Devuelve la categoría que correspondería según la facturación anual.
// Si supera el tope K → devuelve null (queda excluido del monotributo).
export function categoriaSugerida(facturacionAnual) {
  if (facturacionAnual <= 0) return CATEGORIAS[0]
  for (const c of CATEGORIAS) {
    if (facturacionAnual <= c.tope_anual) return c
  }
  return null // excedido
}

// Devuelve la cuota mensual que debería pagar según categoría + actividad.
export function cuotaMensual(categoriaLetra, actividad = 'comercio') {
  const c = CATEGORIAS.find(x => x.cat === categoriaLetra)
  if (!c) return 0
  return actividad === 'servicios' ? c.cuota_servicios : c.cuota_comercio
}

// Devuelve el tope anual de una categoría dada.
export function topeAnual(categoriaLetra) {
  const c = CATEGORIAS.find(x => x.cat === categoriaLetra)
  return c ? c.tope_anual : 0
}

// Estado del semáforo según % consumido del tope.
// verde: < 70%, amarillo: 70–85%, naranja: 85–95%, rojo: ≥ 95%
export function estadoSemaforo(pct) {
  if (pct >= 95) return { nivel: 'rojo', color: '#ff4f4f', label: '🔴 CRÍTICO — cerca del tope' }
  if (pct >= 85) return { nivel: 'naranja', color: '#ff9b3a', label: '🟠 ATENCIÓN — pasando del 85%' }
  if (pct >= 70) return { nivel: 'amarillo', color: '#ffd17a', label: '🟡 PRECAUCIÓN — pasando del 70%' }
  return { nivel: 'verde', color: '#7dff7d', label: '🟢 OK' }
}

// Próxima recategorización (enero o julio del año en curso/próximo).
export function proximaRecategorizacion(hoy = new Date()) {
  const y = hoy.getFullYear()
  const enero = new Date(y, 0, 20)      // ARCA suele abrir recategorización 20-ene
  const julio = new Date(y, 6, 20)      // y 20-jul
  if (hoy < enero) return enero
  if (hoy < julio) return julio
  return new Date(y + 1, 0, 20)
}
