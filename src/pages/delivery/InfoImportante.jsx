// ============================================================
// Información importante para el cliente del delivery
// ============================================================
// Texto de Fabricio (02/10/2026): cómo conservar la carne al recibirla y
// cómo es el cambio de un producto. Va en el inicio de la app y en el
// seguimiento, cuando el pedido ya salió o se entregó.
//
// Abajo: el botón para dejar una reseña en Google de la CASA CENTRAL
// (Av. Mitre 670 — en Google figura como "Carnicerías Fabricius"). El
// link cae directo en las estrellitas.
// ============================================================
import { C, F, btnPrimario } from './estilo'

const TEL_RECLAMOS = '3574638429'
const MSG_RECLAMO = 'Hola! Quiero hacer un reclamo por un producto de mi pedido de delivery.'
const RESENA_CENTRAL = 'https://search.google.com/local/writereview?placeid=ChIJpS3cMInfMpQRdwbkpN9HdnQ'

const iconoWa = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" />
  </svg>
)

export default function InfoImportante() {
  return (
    <section aria-labelledby="info-importante" style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.55, color: '#3D3632' }}>
      <h2 id="info-importante" style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 17, color: C.ink }}>Información importante</h2>
      <p style={{ margin: 0 }}>
        <b>Conservación:</b> al recibir su pedido, retire las carnes de su envoltorio y guárdelas en la heladera si las va a cocinar dentro de las próximas <b>8 horas</b>. De lo contrario, congélelas para mantener correctamente la cadena de frío.
      </p>
      <p style={{ margin: 0 }}>
        <b>Cambios:</b> si algún producto no es de su agrado, vuelva a colocarlo en su envoltorio, consérvelo en la heladera y comuníquese al{' '}
        <b style={{ whiteSpace: 'nowrap' }}>3574 638429</b> para gestionar el cambio.
      </p>
      <a href={`https://wa.me/549${TEL_RECLAMOS}?text=${encodeURIComponent(MSG_RECLAMO)}`} target="_blank" rel="noreferrer"
        style={{ ...btnPrimario, minHeight: 50, fontSize: 16, background: '#1F7A45' }}>
        {iconoWa} Hacer un reclamo por WhatsApp
      </a>
      <p style={{ margin: 0, fontWeight: 700, color: C.ink }}>
        No se aceptan devoluciones de productos que hayan sido manipulados o cocinados.
      </p>
    </section>
  )
}

// ⭐ Reseña en Google de la casa central (Av. Mitre 670).
export function ResenaGoogle() {
  return (
    <section aria-labelledby="resena-google" style={{ borderRadius: 14, padding: 16, background: C.soft, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
      <div aria-hidden="true" style={{ fontSize: 26, letterSpacing: 4, color: '#E2A400' }}>★★★★★</div>
      <h2 id="resena-google" style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 18, color: C.ink }}>¿Te gustó tu compra?</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.muted }}>Contanos en Google cómo te fue. Son 10 segundos y nos ayuda muchísimo.</p>
      <a href={RESENA_CENTRAL} target="_blank" rel="noreferrer" style={{ ...btnPrimario, minHeight: 50, fontSize: 16 }}>
        Calificanos en Google
      </a>
    </section>
  )
}
