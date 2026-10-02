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
        <b>Al recibir su pedido</b>, saque las carnes en su envoltorio y guárdelas en la heladera si las va a cocinar dentro de las <b>8 horas</b>. Si no, <b>frízelas</b> para mantener correctamente la cadena de frío.
      </p>
      <p style={{ margin: 0 }}>
        <b>Si algún producto no le gustó</b>, vuelva a ponerlo en su envoltorio, guárdelo en la heladera y haga su reclamo para cambiarlo, comunicándose al{' '}
        <a href={`https://wa.me/549${TEL_RECLAMOS}`} target="_blank" rel="noreferrer" style={{ color: C.goldText, fontWeight: 700, whiteSpace: 'nowrap' }}>3574 638429</a>.
      </p>
      <p style={{ margin: 0, fontWeight: 700, color: C.ink }}>
        No aceptamos devoluciones una vez que el alimento fue manipulado o cocinado.
      </p>
    </section>
  )
}
