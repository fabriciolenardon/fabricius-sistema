// ============================================================
// RINDES — portal Desposte
// ============================================================
// La MISMA pantalla de planillas de rinde que usa la central (Depósito →
// Mermas → Planillas de rinde), montada en el portal del sector: el rinde se
// hace EN el desposte — ellos pesan cada pieza — así que la carga va donde
// está la balanza, no en la oficina.
//
// Los permisos los pone la base (mig 130): el usuario desposte puede CREAR
// planillas y actualizar SOLO la clave merma_conversion (la regla "la última
// planilla manda el %"). Borrar del historial sigue siendo del CEO — el botón
// ni le aparece (isCEO en PlanillasRinde).
//
// Acá la config se carga directo de config_sistema: en Depósito la trae el
// padre (DesposteTab), pero este portal no tiene ese estado.
// ============================================================
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import PlanillasRinde from '../../components/PlanillasRinde'

export default function DesposteRindes() {
  const [config, setConfig] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    supabase.from('config_sistema').select('valor').eq('clave', 'merma_conversion').maybeSingle()
      .then(({ data }) => {
        if (!vivo) return
        setConfig(data?.valor || { piezas: {}, media_res: [], merma_frio: 2.5 })
        setCargando(false)
      })
    return () => { vivo = false }
  }, [])

  if (cargando) return <div className="empty">Cargando planillas…</div>

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.6 }}>
        Pesá cada corte que sale y cargalo acá: el sistema saca la merma solo.
      </div>
      <PlanillasRinde config={config} onConfigChange={setConfig} />
    </div>
  )
}
