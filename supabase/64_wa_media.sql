-- Fotos/comprobantes/archivos de WhatsApp visibles en el chat.
-- 1) columna con el PATH del archivo en storage
alter table public.wa_mensajes add column if not exists media_url text;

-- 2) bucket privado para los archivos entrantes de WhatsApp
insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do nothing;

-- 3) solo admins leen/escriben (igual que el bucket facturas)
do $$
begin
  create policy "wa_media_admin_all" on storage.objects for all
    using (bucket_id = 'wa-media' and exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin'))
    with check (bucket_id = 'wa-media' and exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin'));
exception when duplicate_object then null;
end $$;
