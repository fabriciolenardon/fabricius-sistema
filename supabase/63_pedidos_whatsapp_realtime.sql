-- pedidos_whatsapp faltaba en la publicación de realtime → los pedidos que toma
-- Iris no se notificaban en vivo (ni el badge ni el Centro de Actividad). Lo
-- agregamos. Idempotente vía DO (ADD TABLE falla si ya está).
do $$
begin
  alter publication supabase_realtime add table public.pedidos_whatsapp;
exception when duplicate_object then null;
end $$;
