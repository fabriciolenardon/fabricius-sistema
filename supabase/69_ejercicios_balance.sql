-- =====================================================
-- MIGRACION 69: CIERRE DE EJERCICIO Y BALANCE CONTABLE
-- =====================================================
-- Pensado para FABRICIUS SAS (Responsable Inscripto), que cierra
-- su ejercicio económico el 30/06 de cada año y presenta balance.
-- También sirve para cualquier otra cuenta fiscal que lleve ejercicio.
--
-- Modelo:
--   - `ejercicios`        → un registro por año fiscal de cada cuenta.
--                           Guarda fechas, estado (abierto/cerrado), los
--                           valores que enganchan ER↔Patrimonial (existencia
--                           inicial/final, impuesto a las ganancias) y, al
--                           cerrar, un SNAPSHOT inmutable con todo el balance.
--   - `ejercicio_lineas`  → renglones cargados a mano (gastos del Estado de
--                           Resultados + rubros del Estado de Situación
--                           Patrimonial), agrupados por sección.
--
-- El Estado de Resultados saca Ventas/Compras NETAS directo de `facturas`
-- (RPC `ejercicio_resultados_auto`); el resto se carga a mano.
-- El cierre (`cerrar_ejercicio`) congela el snapshot, bloquea el ejercicio
-- y abre automáticamente el siguiente. NO toca ninguna factura.
-- =====================================================

-- ---------- 1) EJERCICIOS ----------
CREATE TABLE IF NOT EXISTS ejercicios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id           INT NOT NULL REFERENCES cuentas_fiscales(id) ON DELETE RESTRICT,
  numero              INT NOT NULL,                       -- N° de ejercicio (1, 2, 3...)
  denominacion        TEXT,                               -- "Ejercicio Económico N° 1"
  fecha_inicio        DATE NOT NULL,
  fecha_cierre        DATE NOT NULL,
  estado              TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  -- Valores que enganchan el Estado de Resultados con el Patrimonial:
  existencia_inicial  NUMERIC(16,2) NOT NULL DEFAULT 0,   -- bienes de cambio al inicio (= existencia final del ejercicio anterior)
  existencia_final    NUMERIC(16,2) NOT NULL DEFAULT 0,   -- bienes de cambio al cierre (también va al Activo Corriente)
  impuesto_ganancias  NUMERIC(16,2) NOT NULL DEFAULT 0,   -- impuesto a las ganancias del ejercicio
  -- Snapshot inmutable al cerrar:
  resultado_ejercicio NUMERIC(16,2),
  total_activo        NUMERIC(16,2),
  total_pasivo        NUMERIC(16,2),
  total_pn            NUMERIC(16,2),
  snapshot            JSONB,                              -- balance completo congelado (ER + ESP + auto + líneas)
  notas               TEXT,
  cerrado_at          TIMESTAMPTZ,
  cerrado_por         UUID,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cuenta_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_ejercicios_cuenta ON ejercicios(cuenta_id, fecha_inicio DESC);

COMMENT ON TABLE ejercicios IS 'Ejercicios económicos (años fiscales) por cuenta. Al cerrar guardan snapshot inmutable del balance.';

-- ---------- 2) LÍNEAS MANUALES DEL BALANCE ----------
CREATE TABLE IF NOT EXISTS ejercicio_lineas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejercicio_id  UUID NOT NULL REFERENCES ejercicios(id) ON DELETE CASCADE,
  estado        TEXT NOT NULL CHECK (estado IN ('resultados','patrimonial')),
  seccion       TEXT NOT NULL,        -- ER: gastos | otros_ingresos | otros_egresos
                                      -- ESP: activo_corriente | activo_no_corriente | pasivo_corriente | pasivo_no_corriente | patrimonio_neto
  rubro         TEXT NOT NULL,        -- etiqueta libre ("Sueldos y cargas sociales")
  monto         NUMERIC(16,2) NOT NULL DEFAULT 0,
  orden         INT NOT NULL DEFAULT 0,
  notas         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ejercicio_lineas_ej ON ejercicio_lineas(ejercicio_id);

COMMENT ON TABLE ejercicio_lineas IS 'Renglones manuales del balance (gastos del ER y rubros del patrimonial) por ejercicio.';

-- ---------- 3) RLS — solo admin ----------
ALTER TABLE ejercicios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejercicio_lineas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ejercicios_admin       ON ejercicios;
DROP POLICY IF EXISTS ejercicio_lineas_admin ON ejercicio_lineas;

CREATE POLICY ejercicios_admin       ON ejercicios       FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY ejercicio_lineas_admin ON ejercicio_lineas FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- 4) RPC: totales automáticos del Estado de Resultados ----------
-- Saca de `facturas` las ventas/compras/gastos NETAS (sin IVA) del rango,
-- restando las notas de crédito (códigos 3,8,13). Mismo criterio de signo
-- que facturas_historial. SECURITY INVOKER → respeta RLS del que llama.
CREATE OR REPLACE FUNCTION public.ejercicio_resultados_auto(p_cuenta int, p_desde date, p_hasta date)
RETURNS json
LANGUAGE sql STABLE SET search_path = public
AS $function$
  WITH base AS (
    SELECT
      f.monto_neto, f.monto_iva,
      COALESCE(f.clasificacion, CASE WHEN f.tipo = 'emitida' THEN 'venta' ELSE 'compra' END) AS clasif,
      CASE WHEN f.comprobante_codigo IN (3,8,13) OR upper(COALESCE(f.tipo_comprobante,'')) LIKE 'NC%' THEN -1 ELSE 1 END AS sg
    FROM facturas f
    WHERE f.cuenta_id = p_cuenta AND f.fecha >= p_desde AND f.fecha <= p_hasta
  )
  SELECT json_build_object(
    'ventas_netas',  COALESCE(sum(sg * monto_neto) FILTER (WHERE clasif = 'venta'), 0),
    'ventas_iva',    COALESCE(sum(sg * monto_iva)  FILTER (WHERE clasif = 'venta'), 0),
    'ventas_cant',   count(*) FILTER (WHERE clasif = 'venta'),
    'compras_netas', COALESCE(sum(sg * monto_neto) FILTER (WHERE clasif = 'compra'), 0),
    'compras_iva',   COALESCE(sum(sg * monto_iva)  FILTER (WHERE clasif = 'compra'), 0),
    'compras_cant',  count(*) FILTER (WHERE clasif = 'compra'),
    'gastos_netas',  COALESCE(sum(sg * monto_neto) FILTER (WHERE clasif = 'gasto'), 0),
    'gastos_iva',    COALESCE(sum(sg * monto_iva)  FILTER (WHERE clasif = 'gasto'), 0),
    'gastos_cant',   count(*) FILTER (WHERE clasif = 'gasto')
  )
  FROM base;
$function$;

-- ---------- 5) RPC: cerrar ejercicio (atómico) ----------
-- Congela el ejercicio con su snapshot y abre el siguiente automáticamente.
-- SECURITY DEFINER para hacer las dos cosas en una sola transacción; igual
-- chequea is_admin() adentro. El frontend después siembra las líneas del
-- ejercicio nuevo (catálogo estándar + arrastre de resultados no asignados).
CREATE OR REPLACE FUNCTION public.cerrar_ejercicio(
  p_ejercicio_id uuid,
  p_snapshot     jsonb,
  p_resultado    numeric,
  p_activo       numeric,
  p_pasivo       numeric,
  p_pn           numeric
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_ej      ejercicios%ROWTYPE;
  v_new_id  uuid;
  v_new_num int;
  v_inicio  date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_ej FROM ejercicios WHERE id = p_ejercicio_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ejercicio no encontrado';
  END IF;
  IF v_ej.estado = 'cerrado' THEN
    RAISE EXCEPTION 'El ejercicio ya está cerrado';
  END IF;

  -- 1) Congelar el ejercicio actual
  UPDATE ejercicios SET
    estado              = 'cerrado',
    snapshot            = p_snapshot,
    resultado_ejercicio = p_resultado,
    total_activo        = p_activo,
    total_pasivo        = p_pasivo,
    total_pn            = p_pn,
    cerrado_at          = now(),
    cerrado_por         = auth.uid(),
    updated_at          = now()
  WHERE id = p_ejercicio_id;

  -- 2) Abrir el ejercicio siguiente (mismas fechas + 1 año)
  v_new_num := v_ej.numero + 1;
  v_inicio  := v_ej.fecha_cierre + 1;
  INSERT INTO ejercicios (cuenta_id, numero, denominacion, fecha_inicio, fecha_cierre, estado, existencia_inicial)
  VALUES (
    v_ej.cuenta_id, v_new_num,
    'Ejercicio Económico N° ' || v_new_num,
    v_inicio,
    ((v_inicio + interval '1 year') - interval '1 day')::date,
    'abierto',
    v_ej.existencia_final                  -- la existencia final pasa a ser inicial del nuevo
  )
  ON CONFLICT (cuenta_id, numero) DO NOTHING
  RETURNING id INTO v_new_id;

  -- Si por algún motivo ya existía, recuperamos su id
  IF v_new_id IS NULL THEN
    SELECT id INTO v_new_id FROM ejercicios WHERE cuenta_id = v_ej.cuenta_id AND numero = v_new_num;
  END IF;

  RETURN json_build_object(
    'nuevo_ejercicio_id', v_new_id,
    'nuevo_numero',       v_new_num,
    'existencia_inicial', v_ej.existencia_final
  );
END;
$function$;

-- cerrar_ejercicio MUTA datos y es SECURITY DEFINER: que solo la pueda llamar
-- un usuario logueado (igual chequea is_admin() adentro). Nunca el rol anónimo.
REVOKE EXECUTE ON FUNCTION public.cerrar_ejercicio(uuid, jsonb, numeric, numeric, numeric, numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.cerrar_ejercicio(uuid, jsonb, numeric, numeric, numeric, numeric) TO authenticated;

-- =====================================================
-- LISTO. La app habilita la pestaña "📊 Balance" en Facturación.
-- =====================================================
