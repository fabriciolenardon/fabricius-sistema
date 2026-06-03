-- =====================================================
-- MIGRACION 42: ARCA — CERTIFICADO DE APODERADO
-- =====================================================
-- Caso real: Fabricius SAS no tiene login propio a ARCA; se
-- factura a través de su apoderado (Ariel Garrone), que entra
-- a ARCA con SU CUIT/clave. Es decir: el TITULAR del certificado
-- (Garrone) es distinto del EMISOR del comprobante (la SAS).
--
-- `arca_config.cert_cuit` guarda el CUIT del titular del
-- certificado cuando difiere del CUIT de la cuenta (emisor).
-- Si es NULL, titular = emisor (caso normal, monotributistas).
-- =====================================================

ALTER TABLE arca_config
  ADD COLUMN IF NOT EXISTS cert_cuit TEXT;

COMMENT ON COLUMN arca_config.cert_cuit IS
  'CUIT del titular del certificado (apoderado) cuando difiere del emisor (cuentas_fiscales.cuit). NULL = mismo CUIT.';
