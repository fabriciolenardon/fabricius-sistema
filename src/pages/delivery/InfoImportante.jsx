// ============================================================
// Información importante para el cliente del delivery
// ============================================================
// Texto de Fabricio (02/10/2026): cómo conservar la carne al recibirla y
// cómo es el cambio de un producto. Va en el inicio de la app y en el
// seguimiento, cuando el pedido ya salió o se entregó.
// ============================================================
import { C, F } from './estilo'

const TEL_RECLAMOS = '3574638429'

export default function InfoImportante() {
  return (
    <section aria-labelledby="info-importante" style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.55, color: '#3D3632' }}>
      <h2 id="info-importante" style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 17, color: C.ink }}>Información importante</h2>
      <p style={{ margin: 0 }}>
        <b>Conservación:</b> al recibir su pedido, retire las carnes de su envoltorio y guárdelas en la heladera si las va a cocinar dentro de las próximas <b>8 horas</b>. De lo contrario, congélelas para mantener correctamente la cadena de frío.
      </p>
      <p style={{ margin: 0 }}>
        <b>Cambios:</b> si algún producto no es de su agrado, vuelva a colocarlo en su envoltorio, consérvelo en la heladera y comuníquese al{' '}
        <a href={`https://wa.me/549${TEL_RECLAMOS}`} target="_blank" rel="noreferrer" style={{ color: C.goldText, fontWeight: 700, whiteSpace: 'nowrap' }}>3574 638429</a>{' '}
        para gestionar el cambio.
      </p>
      <p style={{ margin: 0, fontWeight: 700, color: C.ink }}>
        No se aceptan devoluciones de productos que hayan sido manipulados o cocinados.
      </p>
    </section>
  )
}
