-- =====================================================
-- MIGRACION 44: CACHE DEL TICKET DE ACCESO (TA) DE WSAA
-- =====================================================
-- Para hablar directo con ARCA (sin AfipSDK) primero hay que
-- autenticarse en WSAA: se firma un "Login Ticket Request" con
-- el certificado y ARCA devuelve un Token + Sign válido ~12 hs.
--
-- ARCA NO permite pedir un TA nuevo mientras uno siga vigente
-- ("El CEE ya posee un TA válido"). Por eso hay que cachearlo.
--
-- `arca_ta` guarda el TA por (cert_cuit, ambiente, service).
-- SECRETA: RLS sin policies → solo service_role (edge function).
-- =====================================================

CREATE TABLE IF NOT EXISTS arca_ta (
  cert_cuit   TEXT NOT NULL,                 -- CUIT titular del certificado
  ambiente    TEXT NOT NULL,                 -- 'homologacion' | 'produccion'
  service     TEXT NOT NULL DEFAULT 'wsfe',
  token       TEXT NOT NULL,
  sign        TEXT NOT NULL,
  expiration  TIMESTAMPTZ NOT NULL,          -- vencimiento del TA (de ARCA)
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cert_cuit, ambiente, service)
);

COMMENT ON TABLE arca_ta IS 'Cache del Ticket de Acceso (token+sign) de WSAA. SECRETA: RLS sin policies, solo service_role.';

ALTER TABLE arca_ta ENABLE ROW LEVEL SECURITY;
