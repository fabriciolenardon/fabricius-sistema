-- 61_pedidos_whatsapp.sql
-- Bandeja de solicitudes entrantes por WhatsApp que toma Iris (Fase 2).
-- Separada de la tabla `pedidos` (que exige cliente_id y maneja el flujo
-- formal de remitos/confirmación). Acá Iris registra la INTENCIÓN de pedido
-- de un cliente (registrado o no) para que el equipo la revise. Modo
-- "auto con barreras": Iris NO cierra la venta, solo escala la solicitud.
-- El webhook (api/whatsapp.js) inserta con la service_role key (bypassa RLS);
-- el panel admin lee/gestiona con is_admin().

create table if not exists public.pedidos_whatsapp (
  id              uuid primary key default gen_random_uuid(),
  telefono        text not null,              -- wa_id del cliente (formato Meta)
  nombre_contacto text,                       -- nombre si el cliente lo dio / perfil WA
  mensaje_cliente text not null,              -- el mensaje que disparó el pedido
  resumen_pedido  text,                       -- lo que Iris entendió (ej "5 kg asado p/ mañana")
  estado          text not null default 'nuevo',  -- nuevo | visto | atendido | descartado
  atendido_por    text,
  atendido_en     timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.pedidos_whatsapp enable row level security;

create policy pwa_admin_all on public.pedidos_whatsapp
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists idx_pedidos_whatsapp_estado
  on public.pedidos_whatsapp (estado, created_at desc);
