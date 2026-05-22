// ============================================================
// MAYORISTA — antes "Ventas"
// ============================================================
// Esta pantalla unifica el flujo de DESPACHO de mercadería a clientes
// mayoristas y la consulta de REMITOS generados. Reutiliza los mismos
// componentes SalidaForm y RemitosTab que antes vivían dentro de Depósito.
//
// La pantalla "Caja" maneja las ventas minoristas con balanza.
// Esta pantalla "Mayorista" maneja los despachos con remitos.
// ============================================================
import { useState } from 'react'
import { SalidaForm, RemitosTab } from './Deposito'

export default function Ventas() {
  const [tab, setTab] = useState('despacho')
  const [alert, setAlert] = useState(null)
  const [remitoActual, setRemitoActual] = useState(null)

  function showAlert(msg, type = 'success') {
    setAlert({ msg, type })
    setTimeout(() => setAlert(null), 4000)
  }

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)}
      style={{
        padding: '9px 20px', borderRadius: 8, border: 'none',
        background: tab === id ? 'var(--gold)' : 'var(--surface)',
        color: tab === id ? '#000' : 'var(--muted)',
        cursor: 'pointer', fontFamily: "'DM Sans',sans-serif",
        fontWeight: 700, fontSize: 13,
      }}>
      {label}
    </button>
  )

  return (
    <div>
      <div className="page-title">MAYORISTA</div>
      <div className="page-sub">Despachos a clientes mayoristas y remitos emitidos</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabBtn('despacho', '📤 Nuevo despacho')}
        {tabBtn('remitos', '🚚 Remitos')}
      </div>

      {alert && (
        <div style={{
          background: alert.type === 'error' ? '#3a1a1a' : '#1a2a1a',
          border: `1px solid ${alert.type === 'error' ? '#5a2a2a' : '#2d5a2d'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          color: alert.type === 'error' ? '#ff6b6b' : '#7dff7d', fontWeight: 600,
        }}>{alert.msg}</div>
      )}

      {tab === 'despacho' && (
        <SalidaForm
          onSaved={() => {}}
          showAlert={showAlert}
          onRemito={setRemitoActual}
          setTab={setTab}
        />
      )}

      {tab === 'remitos' && <RemitosTab remitoActual={remitoActual} />}
    </div>
  )
}
