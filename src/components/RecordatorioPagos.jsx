// ============================================================
// RecordatorioPagos — aviso flotante "Hola jefe, cargá los pagos"
// ============================================================
// Aparece JUE/VIE/SÁB/DOM (reloj ARG) para recordarle al CEO cargar los
// pagos a proveedores de la semana pasada. Dos acciones:
//   - Posponer  → vuelve a aparecer a las 3 horas.
//   - Ya cargué → no molesta más por el resto de esa semana.
// El estado se guarda en localStorage (por navegador). Se re-evalúa solo
// cada 5 min y al volver a la pestaña, así el snooze de 3h reaparece sin
// recargar. Pedido de Fabricio (29/06/2026).
// ============================================================
import { useState, useEffect } from 'react'
import { fechaHoyARG } from '../lib/fechas'

// 0=Dom, 4=Jue, 5=Vie, 6=Sáb. Los días en que se carga lo de la semana pasada.
const DIAS_AVISO = [4, 5, 6, 0]
const LS_POSPUESTO = 'recordatorioPagos.pospuestoHasta'    // timestamp ms
const LS_PAGADO_SEMANA = 'recordatorioPagos.pagadoSemana'  // lunes 'YYYY-MM-DD'

// Día de la semana (0=Dom) de la fecha ARG de hoy. T12:00 evita cruces de día.
function diaSemanaARG() {
  return new Date(fechaHoyARG() + 'T12:00:00').getDay()
}
// Lunes de la semana actual (ARG), para marcar "ya cargué" por semana.
function lunesSemanaARG() {
  const d = new Date(fechaHoyARG() + 'T12:00:00')
  const dia = d.getDay()
  d.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1))
  return fechaHoyARG(d)
}

export default function RecordatorioPagos() {
  const [visible, setVisible] = useState(false)

  function evaluar() {
    if (!DIAS_AVISO.includes(diaSemanaARG())) return setVisible(false)
    if (localStorage.getItem(LS_PAGADO_SEMANA) === lunesSemanaARG()) return setVisible(false)
    const hasta = Number(localStorage.getItem(LS_POSPUESTO) || 0)
    if (hasta && Date.now() < hasta) return setVisible(false)
    setVisible(true)
  }

  useEffect(() => {
    evaluar()
    const iv = setInterval(evaluar, 5 * 60 * 1000)   // re-chequea cada 5 min
    const onFocus = () => evaluar()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [])

  function posponer() {
    localStorage.setItem(LS_POSPUESTO, String(Date.now() + 3 * 60 * 60 * 1000))
    setVisible(false)
  }
  function marcarPagados() {
    localStorage.setItem(LS_PAGADO_SEMANA, lunesSemanaARG())
    localStorage.removeItem(LS_POSPUESTO)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fade-in" style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 600,
      width: 'min(340px, calc(100vw - 32px))', background: 'var(--surface)',
      border: '1px solid var(--gold)', borderRadius: 14,
      boxShadow: '0 12px 32px rgba(0,0,0,0.55)', padding: 18,
    }}>
      <div style={{ fontSize: 30, marginBottom: 4 }}>👋</div>
      <div style={{ fontFamily: "'Bebas Neue', cursive", fontSize: 24, color: 'var(--gold)', letterSpacing: 1.5 }}>HOLA JEFE</div>
      <div style={{ fontSize: 14, color: 'var(--text2)', margin: '8px 0 16px', lineHeight: 1.4 }}>
        No te olvides de cargar los <strong>pagos a proveedores</strong> de la semana pasada.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={posponer} style={{
          flex: 1, padding: '11px 10px', background: 'var(--surface2)', color: 'var(--text2)',
          border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer',
          fontWeight: 600, fontSize: 13, fontFamily: "'DM Sans', sans-serif",
        }}>⏰ Posponer 3 hs</button>
        <button onClick={marcarPagados} style={{
          flex: 1, padding: '11px 10px', background: 'var(--green)', color: '#000',
          border: 'none', borderRadius: 10, cursor: 'pointer',
          fontWeight: 700, fontSize: 13, fontFamily: "'DM Sans', sans-serif",
        }}>✅ Ya los cargué</button>
      </div>
    </div>
  )
}
