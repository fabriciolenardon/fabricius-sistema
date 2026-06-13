-- ============================================================
-- MIGRACIÓN 17: Carga completa de precios desde PDFs reales
-- ============================================================
-- Fuentes:
--   PDF 'PLANILLA PRECIOS.pdf' → minorista y mayorista (todos los productos)
--   PDF 'LISTA PARA CARNICERIAS.pdf' → precio_carniceria (cuando hay match)
--
-- Reglas:
-- - Piezas bovinas (PLU 35-44): minorista = mayorista (no tienen descuento)
-- - Cuando un campo está NULL en el VALUES, NO se sobrescribe (COALESCE)
-- - Algunos productos no tienen precio_carniceria si no aparecen en PDF1
-- - Rebozados convertidos de precio por caja a precio por kg
-- - PLU 46 CHINCHULIN-RINON: promedio chinchulin $8000 + riñón $6800 = $7400
-- - PLU 51 CORAZON-TRIPA GORDA: promedio corazón $5650 + tripa $5750 = $5700
-- ============================================================

with nuevos_precios (plu, p_minorista, p_mayorista, p_carniceria) as (
  values
    (1, 20800::numeric, 18720::numeric, 17955::numeric),  -- CUADRIL-NALGA-PECETO
    (2, 18600::numeric, 16740::numeric, 16150::numeric),  -- JAMON CUADRADO-BOLA DE LOMO-PULPA PALETA
    (3, 19800::numeric, 17820::numeric, 16625::numeric),  -- COSTILLA
    (4, 19500::numeric, 17500::numeric, 16150::numeric),  -- VACIO
    (5, 18970::numeric, 17070::numeric, null::numeric),  -- PICANA/TAPA DE CUADRIL
    (6, 18180::numeric, 16360::numeric, null::numeric),  -- CORTE AMERICANO-ENTRECOT
    (7, 19620::numeric, 17670::numeric, 17100::numeric),  -- COLITA CUADRIL
    (8, 16900::numeric, 15210::numeric, 14630::numeric),  -- TAPA DE NALGA
    (9, 18900::numeric, 17010::numeric, 16150::numeric),  -- TAPA DE ASADO
    (10, 17200::numeric, 15480::numeric, 15000::numeric),  -- COSTELETA/CARRE
    (11, 15700::numeric, 14130::numeric, 13245::numeric),  -- AGUJA ESPECIAL
    (12, 13300::numeric, 11970::numeric, null::numeric),  -- AGUJA ECONOMICA
    (13, 12090::numeric, 10880::numeric, 12350::numeric),  -- BOCADO FINO
    (14, 15700::numeric, 14130::numeric, 12350::numeric),  -- BOCADO ANCHO
    (15, 23000::numeric, 20700::numeric, null::numeric),  -- LOMITO
    (16, 14000::numeric, 11000::numeric, 12350::numeric),  -- MOLIDA SEMIESPECIAL
    (17, 16000::numeric, 14400::numeric, 12350::numeric),  -- MOLIDA ESPECIAL
    (18, 16900::numeric, 15210::numeric, 12635::numeric),  -- FALDA ESPECIAL
    (19, 13700::numeric, 12960::numeric, 12635::numeric),  -- FALDA ECONOMICA
    (20, 16700::numeric, 15030::numeric, 12635::numeric),  -- FALDA DESHUESADA
    (21, 19000::numeric, 17100::numeric, null::numeric),  -- MILANESA COMUN
    (22, 21200::numeric, 19080::numeric, null::numeric),  -- MILANESA DE PECETO
    (23, 21200::numeric, 19080::numeric, null::numeric),  -- MILANESA DE NALGA
    (24, 10900::numeric, 9810::numeric, 8550::numeric),  -- OSOBUCO
    (25, 6500::numeric, 5850::numeric, null::numeric),  -- PUCHERO ECONOMICO
    (26, 15400::numeric, 13860::numeric, null::numeric),  -- TORTUGA-CARNAZA
    (27, 17500::numeric, 15750::numeric, null::numeric),  -- ALBONDIGA
    (28, 17500::numeric, 15750::numeric, 14535::numeric),  -- HAMBURGUESA
    (29, 18700::numeric, 16830::numeric, 15485::numeric),  -- HAMBURGUESA RELLENA C/MUZZARELLA
    (30, 21000::numeric, 18900::numeric, 17100::numeric),  -- MATAMBRE
    (31, 20550::numeric, 18500::numeric, null::numeric),  -- BIFE DE CHORIZO Y OJO DE BIFE
    (32, 10500::numeric, 9450::numeric, null::numeric),  -- CHIQUIZUELA
    (33, 16000::numeric, 14400::numeric, null::numeric),  -- ROAST BEEF
    (34, 16000::numeric, 14400::numeric, 12350::numeric),  -- BOCADO DESHUESADO
    (35, 13400::numeric, 13400::numeric, 12400::numeric),  -- PIERNA
    (36, 17400::numeric, 17400::numeric, 16400::numeric),  -- COSTILLAR COMPLETO
    (37, 17400::numeric, 17400::numeric, 16400::numeric),  -- COSTILLAR CON VACIO
    (38, 17400::numeric, 17400::numeric, 16400::numeric),  -- COSTILLAR
    (39, 16400::numeric, 16400::numeric, 15900::numeric),  -- PARRILLERO
    (40, 9700::numeric, 9700::numeric, 9400::numeric),  -- CORTITO
    (41, 11300::numeric, 11300::numeric, null::numeric),  -- MEDIA RES C/DESPOSTE EMBOLSADO
    (42, 10900::numeric, 10900::numeric, null::numeric),  -- MEDIA RES DESPOSTADA EN PIEZAS
    (43, 13400::numeric, 13400::numeric, 12400::numeric),  -- CUARTO PISTOLA
    (44, 11500::numeric, 11500::numeric, 11000::numeric),  -- PALETA
    (45, 18300::numeric, 16470::numeric, null::numeric),  -- ENTRANA DE COSTILLAR
    (46, 9900::numeric, 9000::numeric, 7400::numeric),  -- CHINCHULIN-RINON
    (47, 30000::numeric, 28500::numeric, 27500::numeric),  -- MOLLEJA SURTIDA
    (48, 10500::numeric, 9500::numeric, 8500::numeric),  -- MONDONGO
    (49, 2000::numeric, 2000::numeric, null::numeric),  -- SESOS (LA UNIDAD)
    (50, 11500::numeric, 11000::numeric, 10000::numeric),  -- LENGUA
    (51, 8000::numeric, 7250::numeric, 5700::numeric),  -- CORAZON-TRIPA GORDA
    (52, 6000::numeric, 5500::numeric, 4800::numeric),  -- HIGADO
    (53, 7500::numeric, 6800::numeric, 6800::numeric),  -- RABO
    (54, 9400::numeric, 8460::numeric, 7500::numeric),  -- BONDIOLA
    (55, 12500::numeric, 11250::numeric, 10500::numeric),  -- MATAMBRE CERDO
    (56, 9700::numeric, 8700::numeric, null::numeric),  -- PULPA CERDO
    (57, 8600::numeric, 7700::numeric, null::numeric),  -- COSTELETA CERDO
    (58, 9000::numeric, 8100::numeric, null::numeric),  -- CORTE AMERICANO/ENTRECOT CERDO
    (59, 9500::numeric, 8500::numeric, null::numeric),  -- COSTILLA CERDO
    (60, 8900::numeric, 8000::numeric, null::numeric),  -- VACIO CERDO
    (61, 9700::numeric, 8700::numeric, null::numeric),  -- LOMO CERDO
    (62, 8300::numeric, 7450::numeric, 6500::numeric),  -- HAMBURGUESAS CERDO
    (63, 8800::numeric, 7500::numeric, 7300::numeric),  -- CHORIZO
    (64, 9700::numeric, 8250::numeric, 8100::numeric),  -- CHORIZO SABORIZADO
    (65, 8800::numeric, 7950::numeric, 7800::numeric),  -- CHORIZO COLORADO
    (66, 6500::numeric, 5850::numeric, 5100::numeric),  -- CHORIZO CUNE
    (67, 7000::numeric, 6000::numeric, 5500::numeric),  -- MORCILLA
    (68, 2700::numeric, 2700::numeric, 1700::numeric),  -- CUERITO
    (69, 2700::numeric, 2700::numeric, 1700::numeric),  -- HUESITOS/PATITAS
    (70, 7600::numeric, 6500::numeric, null::numeric),  -- BOCADO CERDO
    (71, 5600::numeric, 5000::numeric, null::numeric),  -- OSOBUCO CERDO
    (72, 9400::numeric, 8500::numeric, 8000::numeric),  -- SALCHICHA PARRILLERA
    (73, 10400::numeric, 8500::numeric, null::numeric),  -- MILANESA CERDO
    (74, 8470::numeric, 7700::numeric, 7200::numeric),  -- PECHITO
    (75, 7480::numeric, 6800::numeric, 6300::numeric),  -- PIERNA CERDO
    (76, 6800::numeric, 6120::numeric, 5300::numeric),  -- PALETA DE CERDO
    (77, 7370::numeric, 6700::numeric, 6200::numeric),  -- CARRE
    (78, 30000::numeric, 28000::numeric, 27000::numeric),  -- SALAME CASERO ENV.
    (79, 27200::numeric, 24000::numeric, null::numeric),  -- SALAME CASERO SIN ENVASAR
    (80, 16000::numeric, 16000::numeric, null::numeric),  -- PROVOLETA
    (81, 29000::numeric, 26100::numeric, 25000::numeric),  -- BONDIOLA EMBUTIDO
    (82, 29000::numeric, 29000::numeric, 25000::numeric),  -- LOMO EMBUTIDO
    (83, 29000::numeric, 29000::numeric, 25000::numeric),  -- PANCETA
    (84, 9500::numeric, 9500::numeric, null::numeric),  -- QUESO CERDO ENV.
    (85, 20000::numeric, 20000::numeric, null::numeric),  -- ARROLLADO DE CERDO
    (86, 40000::numeric, 40000::numeric, 35000::numeric),  -- JAMON CRUDO
    (87, 9500::numeric, 8900::numeric, 4500::numeric),  -- PECHUGA
    (88, 5850::numeric, 5850::numeric, 3650::numeric),  -- POLLO FRESCO
    (89, 5850::numeric, 5850::numeric, 3550::numeric),  -- PATA MUSLO
    (90, 5050::numeric, 5050::numeric, 3250::numeric),  -- ALITA
    (91, 12000::numeric, 12000::numeric, null::numeric),  -- ARROLLADO DE POLLO
    (92, 9300::numeric, 8900::numeric, null::numeric),  -- MILANESA DE PECHUGA
    (93, 7500::numeric, 7000::numeric, 6500::numeric),  -- HAMBURGUESA POLLO
    (94, 9000::numeric, 8000::numeric, 7500::numeric),  -- HAMBURGUESA RELLENA C/MUZZARELLA POLLO
    (95, 14500::numeric, 11980::numeric, 13340::numeric),  -- BOCADITOS/CANONCITOS MUZZARELLA GRANGYS
    (96, 9500::numeric, 9500::numeric, 8500::numeric),  -- NUGGETS INDACOR
    (97, 10100::numeric, 10100::numeric, 9100::numeric),  -- MEDALLON DE POLLO JYQ GRANGYS
    (98, 7600::numeric, 6160::numeric, 5160::numeric),  -- MEDALLON DE MERLUZA GRANGYS
    (99, 12500::numeric, 10771::numeric, 10057::numeric),  -- FILET DE MERLUZA
    (100, 6700::numeric, 6700::numeric, null::numeric),  -- PAPAS BASTON CONGELADAS
    (101, 10000::numeric, 10000::numeric, null::numeric),  -- PAPAS NOISETTE CONGELADAS
    (102, 11500::numeric, 11500::numeric, null::numeric),  -- PAPAS CARITAS CONGELADAS
    (103, 22500::numeric, 20250::numeric, null::numeric),  -- TOMAHAWK
    (104, 26300::numeric, 23670::numeric, null::numeric),  -- RIB EYE/OJO DE BIFE
    (105, 26300::numeric, 23670::numeric, null::numeric),  -- ASADO VENTANA
    (106, 22500::numeric, 20250::numeric, null::numeric)  -- T-BONE
)
update precios p
set precio_minorista  = coalesce(np.p_minorista,  p.precio_minorista),
    precio_mayorista  = coalesce(np.p_mayorista,  p.precio_mayorista),
    precio_carniceria = coalesce(np.p_carniceria, p.precio_carniceria),
    updated_at = now()
from nuevos_precios np
where p.codigo_balanza = np.plu;

-- Reporte de control
select
  count(*) filter (where precio_minorista  > 0) as con_minorista,
  count(*) filter (where precio_mayorista  > 0) as con_mayorista,
  count(*) filter (where precio_carniceria > 0) as con_carniceria,
  count(*) filter (where precio_minorista is null or precio_minorista = 0) as sin_minorista
from precios
where codigo_balanza between 1 and 106;