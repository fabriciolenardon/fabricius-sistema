// ============================================================
// MONOTRIBUTO 2026 — Valores oficiales ARCA
// ============================================================
// Vigencia: FEBRERO – JULIO 2026.
// ARCA actualiza semestralmente (en enero y julio).
// Cuando salgan los nuevos valores: actualizar este archivo
// y subir el bump de fecha en VIGENCIA_HASTA.
//
// Fuente:
//   - Resolución ARCA / Boletín Oficial diciembre 2025
//   - https://www.afip.gob.ar/monotributo/categorias.asp
//   - iProfesional 06/05/2026
//
// El tope de FACTURACIÓN ANUAL es lo que dispara la
// recategorización obligatoria (parámetro: últimos 12 meses
// corridos previos a enero y julio).
// ============================================================

export const VIGENCIA_DESDE = '2026-02-01'
export const VIGENCIA_HASTA = '2026-07-31'

// Precio unitario máximo de venta de cosas muebles
// (si vendés algún producto por encima de este precio, no podés ser monotributista)
export const PRECIO_UNITARIO_MAX = 536767.47

// Tope absoluto del régimen — superar esto te excluye del monotributo
export const TOPE_MAX_ABSOLUTO = 108357084.05

// ============================================================
// Categorías
// tope_anual: facturación bruta anual máxima permitida
// cuota_servicios: cuota mensual para prestadores de servicios
// cuota_comercio: cuota mensual para venta de cosas muebles
// ============================================================
export const CATEGORIAS = [
  { cat: 'A', tope_anual: 10277988.13, cuota_servicios: 42386.74,  cuota_comercio: 42386.74  },
  { cat: 'B', tope_anual: 15058447.71, cuota_servicios: 48250.78,  cuota_comercio: 48250.78  },
  { cat: 'C', tope_anual: 21113696.52, cuota_servicios: 56501.85,  cuota_comercio: 55227.06  },
  { cat: 'D', tope_anual: 26212853.42, cuota_servicios: 72414.10,  cuota_comercio: 70661.26  },
  { cat: 'E', tope_anual: 30833964.37, cuota_servicios: 102537.97, cuota_comercio: 92658.35  },
  { cat: 'F', tope_anual: 38642048.36, cuota_servicios: 129045.32, cuota_comercio: 111198.27 },
  { cat: 'G', tope_anual: 46211109.37, cuota_servicios: 197108.23, cuota_comercio: 135918.34 },
  { cat: 'H', tope_anual: 70113407.33, cuota_servicios: 447346.93, cuota_comercio: 272063.40 },
  { cat: 'I', tope_anual: 78479211.62, cuota_servicios: 824802.26, cuota_comercio: 406512.05 },
  { cat: 'J', tope_anual: 89872640.30, cuota_servicios: 999007.65, cuota_comercio: 497059.41 },
  { cat: 'K', tope_anual: 108357084.05, cuota_servicios: 1381687.90, cuota_comercio: 600879.51 },
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
