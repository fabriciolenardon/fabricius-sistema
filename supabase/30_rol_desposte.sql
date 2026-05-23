-- =====================================================
-- MIGRACION 30: ROL "DESPOSTE" + TABLA FLUJO_DEPOSITO
-- =====================================================
-- Crea el rol "desposte" para empleados del sector que
-- usan tablet para cargar despostes de capones (modifica
-- stock real) y despostes de medias reses (van a una
-- tabla de aprobación para que admin las procese).
-- =====================================================

-- 1) Agregar 'desposte' al check de profiles.rol
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_rol_check
  CHECK (rol IN ('admin', 'franquicia', 'cliente_mayorista', 'cajero', 'desposte'));

-- 2) Función helper para chequear rol desposte
CREATE OR REPLACE FUNCTION public.is_desposte()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND rol = 'desposte'
  );
$$;

-- 3) Tabla flujo_deposito: cargas de empleados pendientes de aprobación
CREATE TABLE IF NOT EXISTS flujo_deposito (
  id              SERIAL PRIMARY KEY,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  hora            TIME DEFAULT CURRENT_TIME,
  empleado_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  empleado_nombre TEXT,                                       -- snapshot del nombre
  tipo            TEXT NOT NULL CHECK (tipo IN (
    'media_res_piezas',       -- elige modelo A/B/C
    'media_res_kilo',         -- venta por kilo (manual)
    'media_res_mayorista',    -- entera mayorista
    'media_res_minorista'     -- entera minorista
  )),
  entrada_id      INT REFERENCES entradas_deposito(id) ON DELETE SET NULL,
  kg_media_res    NUMERIC(12,2),                              -- kg de la media res
  modelo          TEXT,                                       -- 'A' | 'B' | 'C' | null
  payload         JSONB DEFAULT '{}'::jsonb,                  -- detalle adicional
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  desposte_id     INT REFERENCES despostes(id) ON DELETE SET NULL,  -- al aprobar
  aprobado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  aprobado_at     TIMESTAMPTZ,
  notas           TEXT,
  notas_admin     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flujo_deposito_estado ON flujo_deposito(estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_flujo_deposito_tipo   ON flujo_deposito(tipo, fecha DESC);

COMMENT ON TABLE flujo_deposito IS 'Cargas de despostes de medias reses hechas por empleados, pendientes de procesar por admin.';

-- 4) RLS
ALTER TABLE flujo_deposito ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flujo_deposito_admin     ON flujo_deposito;
DROP POLICY IF EXISTS flujo_deposito_desposte  ON flujo_deposito;

-- admin: todo
CREATE POLICY flujo_deposito_admin ON flujo_deposito FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- desposte: leer todo (para ver sus cargas) e insertar
CREATE POLICY flujo_deposito_desposte ON flujo_deposito FOR ALL
  USING (public.is_desposte()) WITH CHECK (public.is_desposte());

-- 5) Permitir al rol desposte leer/escribir lo necesario para hacer despostes de capones
-- (capones están en entradas_deposito, despostes va a la tabla despostes,
--  y modifica stock_actual + piezas_stock).
-- Reutilizamos políticas que ya permitan SELECT a usuarios autenticados,
-- pero agregamos políticas específicas en las tablas críticas.

DO $$ BEGIN
  -- entradas_deposito: el rol desposte puede ver TODAS las entradas para elegir capones
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'entradas_deposito_desposte_read') THEN
    CREATE POLICY entradas_deposito_desposte_read ON entradas_deposito FOR SELECT
      USING (public.is_desposte() OR public.is_admin());
  END IF;

  -- entradas_deposito: el rol desposte puede UPDATEAR para marcar 'despostada=true' al usar un capón
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'entradas_deposito_desposte_update') THEN
    CREATE POLICY entradas_deposito_desposte_update ON entradas_deposito FOR UPDATE
      USING (public.is_desposte() OR public.is_admin())
      WITH CHECK (public.is_desposte() OR public.is_admin());
  END IF;

  -- despostes: el rol desposte puede insertar
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'despostes_desposte_insert') THEN
    CREATE POLICY despostes_desposte_insert ON despostes FOR INSERT
      WITH CHECK (public.is_desposte() OR public.is_admin());
  END IF;

  -- despostes: leer
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'despostes_desposte_read') THEN
    CREATE POLICY despostes_desposte_read ON despostes FOR SELECT
      USING (public.is_desposte() OR public.is_admin());
  END IF;

  -- stock_actual: el rol desposte puede ver y actualizar (para sumar piezas de capones)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stock_actual_desposte') THEN
    CREATE POLICY stock_actual_desposte ON stock_actual FOR ALL
      USING (public.is_desposte() OR public.is_admin())
      WITH CHECK (public.is_desposte() OR public.is_admin());
  END IF;

  -- precios: leer (para ver nombres de cortes)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'precios_desposte_read') THEN
    CREATE POLICY precios_desposte_read ON precios FOR SELECT
      USING (public.is_desposte() OR public.is_admin() OR public.is_franquicia());
  END IF;
END $$;

-- =====================================================
-- LISTO.
-- Después de correr esta migración:
-- 1) En Supabase → Authentication → Users → Add User
--    Crear el usuario 'desposte@fabricius.local' (o el email
--    que prefieras), con clave fuerte.
-- 2) En SQL Editor:
--    INSERT INTO profiles (id, nombre, rol)
--    VALUES (
--      '<UUID del usuario creado>',
--      'Sector Desposte',
--      'desposte'
--    );
-- =====================================================
