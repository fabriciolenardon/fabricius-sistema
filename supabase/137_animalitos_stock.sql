-- =====================================================================
-- 137 — ANIMALITOS: lechón, cabrito y cordero con stock individual
-- =====================================================================
-- Estos tres se compran y se venden ENTEROS, y cada animal pesa distinto.
-- Un bucket agregado en kilos no alcanza: cuando el cliente pregunta "¿tenés
-- uno de 10 kg?" hay que poder mirar la cámara desde el sistema. Por eso van
-- con tracking individual, mismo modelo que `medias_stock` y `cajas_stock`:
-- una fila por animal, con su código visible (LE-001 / CA-001 / CO-001), su
-- peso y su costo.
--
-- El stock agregado sigue viviendo en stock_actual, en tres buckets propios
-- (animal_lechon / animal_cabrito / animal_cordero) — así el Dashboard, el
-- Ajuste de Stock y un futuro `precios.stock_origen` los ven como a cualquier
-- otro producto. La fuente de verdad de cuántos hay es esta tabla; el bucket
-- es el espejo en kilos.
-- =====================================================================

CREATE TABLE IF NOT EXISTS animalitos_stock (
  id               bigserial PRIMARY KEY,
  tipo             text NOT NULL CHECK (tipo IN ('lechon', 'cabrito', 'cordero')),
  -- Código visible del animal, igual que el MR-XXX de las medias res.
  codigo           text GENERATED ALWAYS AS (
                     CASE tipo
                       WHEN 'lechon'  THEN 'LE-'
                       WHEN 'cabrito' THEN 'CA-'
                       ELSE                'CO-'
                     END || lpad(id::text, 3, '0')
                   ) STORED,
  kg               numeric NOT NULL CHECK (kg > 0),
  proveedor_origen text,
  fecha_ingreso    date NOT NULL DEFAULT CURRENT_DATE,
  precio_costo_kg  numeric,
  -- Vínculo con la compra que lo trajo (misma idea que el entrada_id de
  -- medias_stock): permite anular el ingreso y revertir todo junto.
  entrada_id       uuid REFERENCES entradas_deposito(id) ON DELETE SET NULL,
  estado           text NOT NULL DEFAULT 'disponible'
                     CHECK (estado IN ('disponible', 'vendido', 'anulado')),
  -- Salida: se vende entero, pesado y cobrado por kilo.
  cliente_nombre   text,
  precio_venta_kg  numeric,
  total_venta      numeric,
  fecha_salida     date,
  notas_salida     text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  sucursal_id      integer NOT NULL
);

-- sucursal_id lo completa solo el trigger compartido (mig 92): si el insert
-- no lo manda, toma la sucursal del usuario (o la central).
DROP TRIGGER IF EXISTS trg_set_sucursal_id ON animalitos_stock;
CREATE TRIGGER trg_set_sucursal_id
  BEFORE INSERT ON animalitos_stock
  FOR EACH ROW EXECUTE FUNCTION set_sucursal_id();

CREATE INDEX IF NOT EXISTS animalitos_stock_estado_idx  ON animalitos_stock (estado, tipo);
CREATE INDEX IF NOT EXISTS animalitos_stock_entrada_idx ON animalitos_stock (entrada_id);

-- RLS: mismo patrón que medias_stock / cajas_stock.
ALTER TABLE animalitos_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS animalitos_stock_admin  ON animalitos_stock;
CREATE POLICY animalitos_stock_admin ON animalitos_stock
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS animalitos_stock_cajero ON animalitos_stock;
CREATE POLICY animalitos_stock_cajero ON animalitos_stock
  FOR ALL USING (is_cajero()) WITH CHECK (is_cajero());

DROP POLICY IF EXISTS sucursal_aislamiento ON animalitos_stock;
CREATE POLICY sucursal_aislamiento ON animalitos_stock
  AS RESTRICTIVE FOR ALL
  USING      (is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal())
  WITH CHECK (is_cliente_mayorista() OR is_franquicia() OR sucursal_id = mi_sucursal());

-- Buckets del stock agregado, uno por animalito y por boca. Se crean en cero
-- para que el Dashboard y el Ajuste de Stock los muestren desde el día uno
-- (sin esto aparecen recién con el primer ingreso).
INSERT INTO stock_actual (tipo, kg_disponible, sucursal_id)
SELECT t.tipo, 0, s.id
  FROM (VALUES ('animal_lechon'), ('animal_cabrito'), ('animal_cordero')) AS t(tipo)
 CROSS JOIN sucursales s
 WHERE NOT EXISTS (
   SELECT 1 FROM stock_actual sa WHERE sa.tipo = t.tipo AND sa.sucursal_id = s.id
 );

COMMENT ON TABLE animalitos_stock IS
  'Lechones, cabritos y corderos: una fila por animal con su peso propio. Se compran y se venden enteros. El espejo en kilos vive en stock_actual.animal_*.';
