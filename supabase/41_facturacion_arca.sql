-- =====================================================
-- MIGRACION 41: FACTURACIÓN ELECTRÓNICA — ENLACE CON ARCA
-- =====================================================
-- Suma la capacidad de EMITIR comprobantes electrónicos
-- (obtener CAE) desde la app, por cada cuenta fiscal, vía
-- AfipSDK (que resuelve WSAA + WSFEv1 contra ARCA).
--
-- Diseño de seguridad:
--   - El certificado y la clave privada de cada CUIT son
--     SECRETOS: viven en `arca_config`, una tabla con RLS
--     habilitado y SIN policies → ni anon ni authenticated
--     pueden leerla. Solo la `service_role` (edge function)
--     la accede. Nunca viajan al frontend.
--   - Los datos NO secretos (si está habilitado, ambiente,
--     punto de venta) se reflejan en `cuentas_fiscales` para
--     que el panel admin los muestre sin tocar la clave.
--   - Cada comprobante emitido se guarda en `facturas` (la
--     tabla de siempre) con su CAE → sigue alimentando topes
--     de monotributo y Libro IVA.
-- =====================================================

-- ---------- 1) CONFIG ARCA POR CUENTA (SECRETA) ----------
CREATE TABLE IF NOT EXISTS arca_config (
  cuenta_id             INT PRIMARY KEY REFERENCES cuentas_fiscales(id) ON DELETE CASCADE,
  ambiente              TEXT NOT NULL DEFAULT 'homologacion'
                          CHECK (ambiente IN ('homologacion','produccion')),
  punto_venta           INT NOT NULL DEFAULT 1,
  cert                  TEXT,                 -- PEM del certificado X.509
  key                   TEXT,                 -- PEM de la clave privada
  afipsdk_access_token  TEXT,                 -- opcional: sube límites de AfipSDK
  ultimo_test_ok        BOOLEAN,
  ultimo_test_at        TIMESTAMPTZ,
  ultimo_test_msg       TEXT,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE arca_config IS 'Credenciales ARCA por cuenta fiscal. SECRETA: RLS sin policies, solo service_role.';
COMMENT ON COLUMN arca_config.cert IS 'Certificado X.509 en PEM. No exponer al frontend.';
COMMENT ON COLUMN arca_config.key  IS 'Clave privada en PEM. No exponer al frontend.';

-- RLS habilitado y SIN ninguna policy: bloquea anon y authenticated por completo.
-- La service_role saltea RLS, así que solo la edge function puede leer/escribir.
ALTER TABLE arca_config ENABLE ROW LEVEL SECURITY;

-- ---------- 2) FLAGS NO SECRETOS EN cuentas_fiscales ----------
-- Reflejo legible (vía RLS admin existente) del estado de ARCA,
-- sin exponer cert/key.
ALTER TABLE cuentas_fiscales
  ADD COLUMN IF NOT EXISTS arca_habilitado  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS arca_ambiente    TEXT,
  ADD COLUMN IF NOT EXISTS arca_punto_venta INT;

COMMENT ON COLUMN cuentas_fiscales.arca_habilitado IS 'TRUE si la cuenta ya tiene credenciales ARCA cargadas y probadas.';

-- ---------- 3) COLUMNAS ARCA EN facturas ----------
-- Para los comprobantes emitidos electrónicamente guardamos el
-- CAE y su vencimiento, el resultado crudo de ARCA y los códigos
-- AFIP del comprobante / receptor.
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS cae                TEXT,
  ADD COLUMN IF NOT EXISTS cae_vto            DATE,
  ADD COLUMN IF NOT EXISTS arca_estado        TEXT
      CHECK (arca_estado IN ('borrador','autorizada','rechazada','error') OR arca_estado IS NULL),
  ADD COLUMN IF NOT EXISTS arca_resultado     JSONB,   -- Observaciones/Errors de ARCA
  ADD COLUMN IF NOT EXISTS comprobante_codigo INT,     -- código AFIP: 1=Fac A, 6=Fac B, 11=Fac C, ...
  ADD COLUMN IF NOT EXISTS doc_tipo           INT,     -- 80=CUIT, 86=CUIL, 96=DNI, 99=consumidor final
  ADD COLUMN IF NOT EXISTS doc_nro            TEXT,
  ADD COLUMN IF NOT EXISTS cond_iva_receptor  INT,     -- RG 5616: 1=RI, 4=Exento, 5=CF, 6=Mono
  ADD COLUMN IF NOT EXISTS emitida_por_arca   BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN facturas.cae IS 'Código de Autorización Electrónico devuelto por ARCA.';
COMMENT ON COLUMN facturas.emitida_por_arca IS 'TRUE si el comprobante se emitió electrónicamente (no carga manual).';

-- Índice para listar/filtrar comprobantes electrónicos por cuenta y fecha.
CREATE INDEX IF NOT EXISTS idx_facturas_arca
  ON facturas(cuenta_id, fecha DESC)
  WHERE emitida_por_arca;

-- =====================================================
-- LISTO: correr este SQL en el SQL Editor de Supabase.
-- Después desplegar las edge functions `arca-config` y
-- `arca-emitir`, y configurar las credenciales por cuenta
-- desde la pestaña Facturación → Cuentas → ⚙️ Configurar ARCA.
-- =====================================================
