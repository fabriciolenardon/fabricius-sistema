-- =====================================================
-- MIGRACION 31: AUDITORÍA DE CAMBIOS
-- =====================================================
-- Registra quién hizo qué y cuándo en operaciones críticas:
-- anulaciones, modificaciones de precios, ofertas, despostes,
-- aprobaciones de flujo, cambios en cuentas fiscales, etc.
-- =====================================================

CREATE TABLE IF NOT EXISTS auditoria_log (
  id              BIGSERIAL PRIMARY KEY,
  fecha           TIMESTAMPTZ DEFAULT NOW(),
  usuario_id      UUID,                                       -- auth.users.id
  usuario_nombre  TEXT,                                       -- snapshot del nombre
  usuario_rol     TEXT,                                       -- snapshot del rol
  accion          TEXT NOT NULL,                              -- 'insert' | 'update' | 'delete' | 'login' | 'logout' | 'custom'
  modulo          TEXT,                                       -- 'caja' | 'precios' | 'ofertas' | 'facturacion' | 'deposito' | etc
  entidad         TEXT,                                       -- nombre de tabla o concepto: 'venta_minorista' | 'precio' | 'factura' | etc
  entidad_id      TEXT,                                       -- id del registro afectado (texto para soportar INT y UUID)
  descripcion     TEXT,                                       -- texto humano legible
  valores_antes   JSONB,                                      -- snapshot anterior (si aplica)
  valores_despues JSONB,                                      -- snapshot después (si aplica)
  ip              TEXT,                                       -- IP del cliente (opcional)
  user_agent      TEXT                                        -- navegador (opcional)
);

CREATE INDEX IF NOT EXISTS idx_auditoria_fecha    ON auditoria_log(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario  ON auditoria_log(usuario_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_modulo   ON auditoria_log(modulo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidad  ON auditoria_log(entidad, entidad_id);

COMMENT ON TABLE auditoria_log IS 'Log de acciones críticas (quién hizo qué y cuándo).';

-- RLS — solo admin lee. Cualquier rol autenticado puede INSERTAR.
ALTER TABLE auditoria_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auditoria_admin_read ON auditoria_log;
DROP POLICY IF EXISTS auditoria_insert     ON auditoria_log;

CREATE POLICY auditoria_admin_read ON auditoria_log FOR SELECT
  USING (public.is_admin());

-- Cualquier usuario autenticado puede insertar (necesario para que cajero/desposte
-- puedan loguear sus propias acciones).
CREATE POLICY auditoria_insert ON auditoria_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================
-- LISTO. La app inserta filas vía supabase.from('auditoria_log').insert(...)
-- desde un helper centralizado (src/lib/auditoria.js).
-- =====================================================
