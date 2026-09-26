-- ============================================================
-- 154 — El salame que se elabora es el ENVASADO
-- ============================================================
-- Fabricio, 26/09/2026: "el salame común que venimos elaborando son los
-- envasados". De una misma tanda se envasa una parte y otra queda con reipa
-- para vender suelta, y cada una tiene su propio stock (mig 153).
--
-- Hasta ahora TODA la elaboración acreditaba a `emb_salame_comun` (el sin
-- envasar), así que los kilos que hay ahí son en realidad salame envasado.
-- Los datos lo confirman: desde junio se vendieron 67,3 kg de SALAME ENVASADO
-- contra 9,6 kg del sin envasar.
--
-- Esta migración mueve el saldo al bucket que corresponde. De acá en más lo
-- reparte la pantalla: al pesar seco se cargan los dos pesos por separado
-- (ver BUCKET_EMBUTIDO y finalizarMaduracionSalame en Deposito.jsx).
--
-- NO es idempotente por diseño: mueve un saldo. Si se corre dos veces deja el
-- sin envasar en negativo, por eso sólo mueve lo que había al momento de
-- escribirla y verifica antes de tocar.
-- ============================================================

-- Pasa al envasado todo lo que hoy figura en el sin envasar (por boca).
with saldo as (
  select sucursal_id, kg_disponible as kg
    from public.stock_actual
   where tipo = 'emb_salame_comun' and kg_disponible > 0
)
update public.stock_actual s
   set kg_disponible = s.kg_disponible + saldo.kg,
       ultima_actualizacion = now()
  from saldo
 where s.tipo = 'emb_salame_envasado' and s.sucursal_id = saldo.sucursal_id;

update public.stock_actual
   set kg_disponible = 0, ultima_actualizacion = now()
 where tipo = 'emb_salame_comun' and kg_disponible > 0;

-- Verificación: el envasado tiene que quedar con los kilos y el otro en 0.
SELECT tipo, sucursal_id, kg_disponible
  FROM public.stock_actual
 WHERE tipo IN ('emb_salame_comun','emb_salame_envasado')
 ORDER BY tipo, sucursal_id;
