-- =====================================================================
-- 138 — MERMA: tipos de media res propios de cada boca
-- =====================================================================
-- Los tipos que define la CENTRAL (config_sistema.merma_conversion) son uno
-- solo para todo el sistema: la franquicia los ve y los usa con el % que puso
-- Fabricio, y no los puede modificar (las policies de config_sistema ya exigen
-- es_central() para escribir).
--
-- Lo que faltaba: que una boca pueda AGREGAR un tipo suyo — una media res que
-- compra ella y la central no maneja — con su propio %. Como config_sistema
-- tiene PRIMARY KEY (clave), no puede haber una fila por sucursal; los tipos
-- propios viven acá y el front los suma a los de la central.
--
-- El PRECIO no entra en esta tabla: el costo por kilo sale del precio de
-- compra de cada entrada, que ya es propio de cada boca. La central paga más
-- barato y la sucursal, que le recompra, calcula sobre lo que ella pagó.
-- =====================================================================

CREATE TABLE IF NOT EXISTS merma_tipos_sucursal (
  id          bigserial PRIMARY KEY,
  sucursal_id integer NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  -- Mismo formato de id que los de la central (slug del label), para que el
  -- desposte y las planillas de rinde los traten igual.
  tipo_id     text NOT NULL,
  label       text NOT NULL,
  merma       numeric NOT NULL DEFAULT 0 CHECK (merma >= 0 AND merma <= 90),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (sucursal_id, tipo_id)
);

DROP TRIGGER IF EXISTS trg_set_sucursal_id ON merma_tipos_sucursal;
CREATE TRIGGER trg_set_sucursal_id
  BEFORE INSERT ON merma_tipos_sucursal
  FOR EACH ROW EXECUTE FUNCTION set_sucursal_id();

ALTER TABLE merma_tipos_sucursal ENABLE ROW LEVEL SECURITY;

-- Cada boca maneja los suyos y SOLO los suyos. El filtro va en la permisiva,
-- no en una restrictiva: `sucursal_aislamiento` devuelve TRUE en todas las
-- filas para los roles franquicia/cliente_mayorista y no aislaría nada.
DROP POLICY IF EXISTS merma_tipos_propios ON merma_tipos_sucursal;
CREATE POLICY merma_tipos_propios ON merma_tipos_sucursal
  FOR ALL
  USING      (sucursal_id = mi_sucursal())
  WITH CHECK (sucursal_id = mi_sucursal());

-- La central los ve todos (para saber qué agregó cada boca), pero no los edita:
-- son de ellas.
DROP POLICY IF EXISTS merma_tipos_central_lee ON merma_tipos_sucursal;
CREATE POLICY merma_tipos_central_lee ON merma_tipos_sucursal
  FOR SELECT USING (es_central());

COMMENT ON TABLE merma_tipos_sucursal IS
  'Tipos de media res propios de una boca, con su % de merma. Los tipos de la central viven en config_sistema.merma_conversion y son de sólo lectura para la sucursal.';
