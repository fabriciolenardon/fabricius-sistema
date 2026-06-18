// Whatsapp.jsx — Contenedor único de WhatsApp con dos sub-pestañas:
// "Conversaciones" (inbox en vivo) y "Pedidos" (bandeja de solicitudes).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import ConversacionesWhatsapp from './ConversacionesWhatsapp'
import PedidosWhatsapp from './PedidosWhatsapp'
import CampanasWhatsapp from './CampanasWhatsapp'
import CombosWhatsapp from './CombosWhatsapp'

const TAB_VALIDA = (t) => (t === 'pedidos' || t === 'campanas' || t === 'combos') ? t : 'conversaciones'

export default function Whatsapp() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(TAB_VALIDA(params.get('tab')))
  const [noLeidos, setNoLeidos] = useState(0)
  const [pedidosNuevos, setPedidosNuevos] = useState(0)

  // Contadores en vivo para los badges de cada sub-pestaña.
  useEffect(() => {
    async function cargar() {
      const [{ count: nl }, { count: pn }] = await Promise.all([
        supabase.from('wa_contactos').select('telefono', { count: 'exact', head: true }).gt('no_leidos', 0),
        supabase.from('pedidos_whatsapp').select('id', { count: 'exact', head: true }).eq('estado', 'nuevo'),
      ])
      setNoLeidos(nl || 0); setPedidosNuevos(pn || 0)
    }
    cargar()
    const canal = supabase.channel('wa-tabs-badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_contactos' }, () => cargar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_whatsapp' }, () => cargar())
      .subscribe()
    return () => supabase.removeChannel(canal)
  }, [])

  function cambiar(t) {
    setTab(t)
    setParams(t === 'conversaciones' ? {} : { tab: t }, { replace: true })
  }

  return (
    <div>
      {/* Sub-pestañas */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        <TabBtn activo={tab === 'conversaciones'} onClick={() => cambiar('conversaciones')} icon="🗨️" label="Conversaciones" badge={noLeidos} color="var(--blue)" />
        <TabBtn activo={tab === 'pedidos'} onClick={() => cambiar('pedidos')} icon="📥" label="Pedidos minoristas" badge={pedidosNuevos} color="var(--green)" />
        <TabBtn activo={tab === 'campanas'} onClick={() => cambiar('campanas')} icon="📣" label="Campañas" badge={0} color="var(--gold)" />
        <TabBtn activo={tab === 'combos'} onClick={() => cambiar('combos')} icon="📦" label="Combos" badge={0} color="var(--gold)" />
      </div>

      {tab === 'conversaciones' && <ConversacionesWhatsapp />}
      {tab === 'pedidos' && <PedidosWhatsapp />}
      {tab === 'campanas' && <CampanasWhatsapp />}
      {tab === 'combos' && <CombosWhatsapp />}
    </div>
  )
}

function TabBtn({ activo, onClick, icon, label, badge, color }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', cursor: 'pointer',
        background: 'transparent', border: 'none', borderBottom: `2px solid ${activo ? 'var(--gold)' : 'transparent'}`,
        color: activo ? 'var(--text)' : 'var(--muted)', fontSize: 14, fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
        marginBottom: -1,
      }}>
      <span>{icon}</span>{label}
      {badge > 0 && (
        <span style={{ background: color, color: color === 'var(--green)' ? '#000' : '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{badge}</span>
      )}
    </button>
  )
}
