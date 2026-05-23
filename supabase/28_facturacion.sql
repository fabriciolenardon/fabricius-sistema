-- =====================================================
-- MIGRACION 28: MÓDULO DE FACTURACIÓN
-- =====================================================
-- Pensado para una estructura mixta de varias cuentas
-- (4 monotributistas + 1 SAS) que comparten la operatoria
-- de Carnicerías Fabricius. Permite:
--   1) Registrar cada cuenta fiscal con su CUIT y datos clave.
--   2) Cargar facturas emitidas y recibidas por cuenta.
--   3) Cargar impuestos / tasas pagadas (monotributo, IIBB,
--      tasa municipal, etc.).
--   4) Calcular facturación acumulada últimos 12 meses por
--      cuenta para alertar al borde del tope de monotributo.
-- =====================================================

-- ---------- 1) CUENTAS FISCALES ----------
CREATE TABLE IF NOT EXISTS cuentas_fiscales (
  id                      SERIAL PRIMARY KEY,
  nombre                  TEXT NOT NULL,                     -- nombre interno, ej: "Mono Fabri", "SAS Carnicerías Fabricius"
  razon_social            TEXT,                              -- razón social legal
  cuit                    TEXT UNIQUE NOT NULL,
  tipo                    TEXT NOT NULL CHECK (tipo IN ('monotributo', 'responsable_inscripto', 'sas', 'exento')),
  -- Solo para monotributo:
  categoria_monotributo   TEXT CHECK (categoria_monotributo IN ('A','B','C','D','E','F','G','H','I','J','K')),
  actividad               TEXT CHECK (actividad IN ('servicios', 'comercio')) DEFAULT 'comercio',
  -- Provincial / municipal:
  inscripto_iibb          BOOLEAN DEFAULT FALSE,
  iibb_numero             TEXT,
  iibb_regimen            TEXT CHECK (iibb_regimen IN ('local', 'convenio_multilateral', 'simplificado', null)),
  alicuota_iibb_pct       NUMERIC(5,2),
  inscripto_municipal     BOOLEAN DEFAULT FALSE,
  alicuota_municipal_pct  NUMERIC(5,2),
  -- IVA:
  condicion_iva           TEXT CHECK (condicion_iva IN ('monotributo','responsable_inscripto','exento','consumidor_final')) DEFAULT 'monotributo',
  -- Metadata:
  fecha_inicio_actividad  DATE,
  domicilio_fiscal        TEXT,
  email                   TEXT,
  telefono                TEXT,
  notas                   TEXT,
  activa                  BOOLEAN DEFAULT TRUE,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_fiscales_activa ON cuentas_fiscales(activa);
CREATE INDEX IF NOT EXISTS idx_cuentas_fiscales_tipo   ON cuentas_fiscales(tipo);

COMMENT ON TABLE cuentas_fiscales IS 'Cuentas con las que se factura (monotributistas y SAS).';
COMMENT ON COLUMN cuentas_fiscales.actividad IS 'Para monotributo: servicios o venta de cosas muebles (comercio).';

-- ---------- 2) FACTURAS ----------
CREATE TABLE IF NOT EXISTS facturas (
  id                  SERIAL PRIMARY KEY,
  cuenta_id           INT NOT NULL REFERENCES cuentas_fiscales(id) ON DELETE RESTRICT,
  tipo                TEXT NOT NULL CHECK (tipo IN ('emitida','recibida')),
  fecha               DATE NOT NULL,
  punto_venta         TEXT,                                   -- ej "0001"
  numero              TEXT,                                   -- ej "00012345"
  tipo_comprobante    TEXT CHECK (tipo_comprobante IN ('A','B','C','E','M','Ticket','NCA','NCB','NCC','NDA','NDB','NDC','Otro')),
  monto_neto          NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_iva           NUMERIC(14,2) NOT NULL DEFAULT 0,
  monto_otros         NUMERIC(14,2) NOT NULL DEFAULT 0,       -- percepciones, impuestos internos, etc.
  monto_total         NUMERIC(14,2) NOT NULL,
  -- Contraparte:
  contraparte_nombre  TEXT,
  contraparte_cuit    TEXT,
  contraparte_iva     TEXT CHECK (contraparte_iva IN ('responsable_inscripto','monotributo','exento','consumidor_final','no_aplica',null)),
  concepto            TEXT,                                   -- descripción libre
  condicion_pago      TEXT CHECK (condicion_pago IN ('contado','cuenta_corriente','cheque','transferencia','tarjeta','otro',null)),
  pagada              BOOLEAN DEFAULT TRUE,                   -- para recibidas, útil para tracking
  fecha_vto           DATE,
  archivo_url         TEXT,                                   -- link al PDF si lo subimos
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_cuenta_fecha ON facturas(cuenta_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_tipo_fecha   ON facturas(tipo, fecha DESC);

COMMENT ON TABLE facturas IS 'Facturas emitidas y recibidas por cada cuenta fiscal.';

-- ---------- 3) IMPUESTOS Y TASAS PAGADAS ----------
CREATE TABLE IF NOT EXISTS impuestos_pagados (
  id              SERIAL PRIMARY KEY,
  cuenta_id       INT NOT NULL REFERENCES cuentas_fiscales(id) ON DELETE RESTRICT,
  concepto        TEXT NOT NULL CHECK (concepto IN (
    'monotributo','iva','ganancias','iibb','iibb_convenio',
    'tasa_municipal','seguridad_higiene','ingresos_brutos_retencion',
    'sicore','sircreb','otro'
  )),
  periodo_anio    INT NOT NULL CHECK (periodo_anio BETWEEN 2020 AND 2099),
  periodo_mes     INT CHECK (periodo_mes BETWEEN 1 AND 12),   -- null si es anual
  monto           NUMERIC(14,2) NOT NULL,
  fecha_pago      DATE NOT NULL,
  comprobante     TEXT,                                       -- VEP, ticket, comprobante DGR, etc.
  archivo_url     TEXT,
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_impuestos_cuenta_fecha ON impuestos_pagados(cuenta_id, fecha_pago DESC);
CREATE INDEX IF NOT EXISTS idx_impuestos_concepto     ON impuestos_pagados(concepto, periodo_anio, periodo_mes);

COMMENT ON TABLE impuestos_pagados IS 'Pagos de impuestos y tasas por cuenta y período.';

-- ---------- 4) RLS — solo admin lee/escribe ----------
ALTER TABLE cuentas_fiscales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE impuestos_pagados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cuentas_fiscales_admin  ON cuentas_fiscales;
DROP POLICY IF EXISTS facturas_admin          ON facturas;
DROP POLICY IF EXISTS impuestos_pagados_admin ON impuestos_pagados;

CREATE POLICY cuentas_fiscales_admin  ON cuentas_fiscales  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY facturas_admin          ON facturas          FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY impuestos_pagados_admin ON impuestos_pagados FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================
-- LISTO: corré este SQL, después la app habilita la
-- pestaña Facturación y podés empezar a cargar cuentas.
-- =====================================================
