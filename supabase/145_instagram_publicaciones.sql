-- ───────────────────────────────────────────────────────────
-- 145 — Instagram: bucket público de placas + registro de publicaciones
-- ───────────────────────────────────────────────────────────
-- Para publicar en Instagram, Meta va a BUSCAR la imagen a una URL pública
-- (no se le suben bytes). Por eso el bucket `placas` es público, al revés
-- que `facturas`. Solo van ahí las placas de ofertas, que de todos modos
-- terminan publicadas en la cuenta.
--
-- `ig_publicaciones` es solo el rastro de lo que salió, para poder mirar
-- después qué se publicó y cuándo sin depender de la app de Instagram.
-- ───────────────────────────────────────────────────────────

-- ── Bucket público de placas ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'placas',
  'placas',
  true,
  10485760, -- 10 MB
  array['image/png','image/jpeg','image/webp','video/mp4']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cualquiera lee (tiene que poder leerlo Meta, que entra sin sesión)
drop policy if exists "placas lectura publica" on storage.objects;
create policy "placas lectura publica"
  on storage.objects for select
  using (bucket_id = 'placas');

-- Solo admin sube y borra
drop policy if exists "placas escribe admin" on storage.objects;
create policy "placas escribe admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'placas'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

drop policy if exists "placas borra admin" on storage.objects;
create policy "placas borra admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'placas'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin')
  );

-- ── Registro de lo publicado ──
create table if not exists ig_publicaciones (
  id            bigserial primary key,
  media_id      text not null,
  permalink     text,
  tipo          text not null default 'foto',   -- foto | carrusel | reel
  caption       text,
  publicado_por uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create unique index if not exists ig_publicaciones_media_id_idx
  on ig_publicaciones (media_id);

create index if not exists ig_publicaciones_created_idx
  on ig_publicaciones (created_at desc);

alter table ig_publicaciones enable row level security;

-- Lee cualquier admin; escribe solo el endpoint (service role, que saltea RLS)
drop policy if exists "ig_publicaciones lee admin" on ig_publicaciones;
create policy "ig_publicaciones lee admin"
  on ig_publicaciones for select
  to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.rol = 'admin'));
