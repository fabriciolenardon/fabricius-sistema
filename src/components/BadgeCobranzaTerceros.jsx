// ============================================================
// BadgeCobranzaTerceros — chip que marca un remito emitido por
// COBRANZA POR CUENTA DE LA FRANQUICIA.
//
// Contexto (Fabricio 01/09): hay boletas de clientes de la franquicia
// (Alvear) que cobramos nosotros. Suman a la cuenta corriente de ese
// cliente, pero NO son venta nuestra: después se compensan bajándole
// la deuda a la franquicia. El remito existe y hay que poder verlo,
// pero tiene que distinguirse a simple vista del remito de una venta
// propia — si no, en el historial son idénticos.
//
// El chip se usa en TODOS los lugares donde el remito se ve por
// dentro (historial de depósito, legajo del cliente, cuenta
// corriente). En el remito impreso NO va: ese papel se le entrega al
// cliente y la aclaración es interna nuestra.
// ============================================================

const TITULO = 'Boleta de un cliente de la franquicia que cobramos nosotros: suma a la cuenta corriente del cliente pero NO cuenta como venta nuestra (se compensa contra la deuda de la franquicia).'

export default function BadgeCobranzaTerceros({ compacto = false }) {
  return (
    <span title={TITULO} style={{
      marginLeft: 8, background: '#2a1f0a', color: 'var(--amber)',
      border: '1px solid var(--amber)', borderRadius: 4,
      padding: '1px 6px', fontSize: 10, fontWeight: 700,
      whiteSpace: 'nowrap', letterSpacing: 0.3,
    }}>
      {compacto ? '🧾 X CTA DE FRANQUICIA' : '🧾 COBRANZA X CTA DE FRANQUICIA'}
    </span>
  )
}

// Fondo ámbar tenue para la fila del remito de cobranza por cuenta de
// terceros. Los anulados (rojo) mandan sobre esto.
export const FILA_COBRANZA_TERCEROS = 'rgba(255,176,0,0.07)'
