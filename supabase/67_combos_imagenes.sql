-- ════════════════════════════════════════════════════════════
-- 67 · Imágenes de combos (Iris las manda por WhatsApp)
-- ────────────────────────────────────────────────────────────
-- Fabricio sube las fotos de los combos desde el panel; quedan en el
-- bucket público 'combos' y registradas acá. Cuando un cliente pregunta
-- por combos/bolsones, Iris (webhook) envía estas imágenes por su URL
-- pública. El bucket es público para que WhatsApp pueda descargarlas.
-- ════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('combos', 'combos', true)
on conflict (id) do nothing;

create table if not exists combos_imagenes (
  id         uuid primary key default gen_random_uuid(),
  url        text not null,   -- URL pública (la usa WhatsApp)
  path       text not null,   -- ruta en el bucket (para poder borrar)
  titulo     text,
  orden      int  not null default 0,
  activo     boolean not null default true,
  creado_at  timestamptz not null default now()
);

alter table combos_imagenes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'combos_imagenes' and policyname = 'combos_imagenes_admin_all') then
    create policy combos_imagenes_admin_all on combos_imagenes for all using (is_admin()) with check (is_admin());
  end if;
  -- Storage: lectura pública del bucket; escritura/borrado solo admin.
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'combos_obj_lectura') then
    create policy combos_obj_lectura on storage.objects for select using (bucket_id = 'combos');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'combos_obj_admin_insert') then
    create policy combos_obj_admin_insert on storage.objects for insert with check (bucket_id = 'combos' and is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'combos_obj_admin_delete') then
    create policy combos_obj_admin_delete on storage.objects for delete using (bucket_id = 'combos' and is_admin());
  end if;
end $$;
