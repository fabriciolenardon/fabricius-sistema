-- =====================================================
-- MIGRACION 29: EXTRAS DE FACTURACIÓN
-- =====================================================
-- 1) Tabla `contrapartes`: padrón de clientes y proveedores
--    reusable en facturas (autocomplete).
-- 2) Storage bucket `facturas` para subir PDFs.
-- 3) Permite link entre facturas y contrapartes (opcional).
-- =====================================================

-- ---------- 1) PADRÓN DE CONTRAPARTES ----------
CREATE TABLE IF NOT EXISTS contrapartes (
  id                SERIAL PRIMARY KEY,
  nombre            TEXT NOT NULL,
  cuit              TEXT,
  condicion_iva     TEXT CHECK (condicion_iva IN ('responsable_inscripto','monotributo','exento','consumidor_final','no_aplica')),
  tipo              TEXT CHECK (tipo IN ('cliente','proveedor','ambos')) DEFAULT 'ambos',
  email             TEXT,
  telefono          TEXT,
  domicilio         TEXT,
  notas             TEXT,
  activa            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cuit)
);

CREATE INDEX IF NOT EXISTS idx_contrapartes_nombre ON contrapartes(nombre);
CREATE INDEX IF NOT EXISTS idx_contrapartes_tipo   ON contrapartes(tipo, activa);

COMMENT ON TABLE contrapartes IS 'Padrón de clientes y proveedores para reusar en facturas.';

ALTER TABLE contrapartes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contrapartes_admin ON contrapartes;
CREATE POLICY contrapartes_admin ON contrapartes FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- 2) Vincular factura con contraparte (opcional) ----------
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS contraparte_id INT REFERENCES contrapartes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_contraparte ON facturas(contraparte_id);

-- =====================================================
-- 3) STORAGE BUCKET — hay que crearlo desde la consola
--    de Supabase porque desde SQL solo se puede con
--    superuser. Pasos:
--    1. Supabase → Storage → New bucket → 'facturas'
--    2. Visibilidad: Private
--    3. RLS: solo admin lee/escribe
--
--    O ejecutar manualmente con el service_role key:
--    INSERT INTO storage.buckets (id, name, public)
--      VALUES ('facturas', 'facturas', false)
--      ON CONFLICT DO NOTHING;
-- =====================================================
