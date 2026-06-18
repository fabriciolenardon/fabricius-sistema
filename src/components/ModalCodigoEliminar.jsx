// ============================================================
// MODAL CÓDIGO PARA ELIMINAR VENTA
// ============================================================
// Overlay centrado que pide un código de seguridad antes de anular
// una venta. Reemplaza el viejo "tipear ANULAR". Si el código es
// correcto llama onConfirm(); si no, muestra error y no elimina.
//
// El código vive acá como constante (es un freno operativo, no un
// secreto real: gatea borrados accidentales, sobre todo del cajero).
// ============================================================
import { useState, useEffect, useRef } from 'react'
import { fmtPrecio } from '../lib/formatos'

export const CODIGO_ELIMINAR = '240697'

const fmt$ = n => fmtPrecio(Math.abs(Number(n) || 0))

export default function ModalCodigoEliminar({ venta, onConfirm, onCancel }) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    setCodigo(''); setError('')
    const t = setTimeout(() => ref.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [venta])

  if (!venta) return null

  const intentar = () => {
    if (codigo.trim() === CODIGO_ELIMINAR) onConfirm()
    else { setError('Código incorrecto'); setCodigo('') }
  }

  const nItems = Array.isArray(venta.items) ? venta.items.length : 0

  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, width: 360, maxWidth: '90vw', boxShadow: '0 12px 48px rgba(0,0,0,.55)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>🗑️ Eliminar venta</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
          {venta.hora ? String(venta.hora).slice(0, 5) + ' · ' : ''}{nItems} item{nItems !== 1 ? 's' : ''} · <b style={{ color: 'var(--gold)' }}>{fmt$(venta.total)}</b>
          <br />Ingresá el código de seguridad para eliminarla. Se devuelve el stock.
        </div>
        <input
          ref={ref} type="password" inputMode="numeric" value={codigo}
          onChange={e => { setCodigo(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') intentar(); if (e.key === 'Escape') onCancel() }}
          placeholder="• • • • • •"
          style={{
            width: '100%', boxSizing: 'border-box', textAlign: 'center', letterSpacing: 8,
            fontSize: 24, padding: '12px', background: 'var(--bg)',
            border: `1px solid ${error ? '#c84040' : 'var(--border)'}`, color: 'var(--text)', borderRadius: 10,
          }}
        />
        {error && <div style={{ color: '#ff8b8b', fontSize: 12, marginTop: 8, textAlign: 'center', fontWeight: 600 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
            Cancelar
          </button>
          <button onClick={intentar}
            style={{ flex: 1, padding: '10px', background: '#c84040', border: 'none', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 800 }}>
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}
