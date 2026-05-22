-- ============================================================
-- MIGRACIÓN 16: Carga de precios MINORISTA y MAYORISTA para los 106 PLU
-- ============================================================
-- La balanza solo maneja minorista (público) y mayorista. La lista de
-- 'carnicería' (ventas a otras carnicerías) se emite desde Despacho y
-- esta migración NO la toca para no pisar lo que Fabri ya cargó allí.
--
-- Fuente: CSV productos_fabricius.csv (export del 24/10/2022).
-- ⚠️  Estos precios están viejos. Sirven para que la Caja pueda calcular
--    kg a partir del importe de la etiqueta. Actualizar desde la UI de
--    Precios con los valores reales vigentes lo antes posible.
--
-- Mapeo del CSV:
--   Precio 1 (mayor)   → precio_minorista  (público)
--   Precio 2 (-10%)    → precio_mayorista
--   precio_carniceria → NO se toca
--
-- Update por codigo_balanza (único). Solo impacta productos con PLU 1-106.
-- ============================================================

with precios_csv (plu, p_minorista, p_mayorista) as (
  values
    (1, 20800, 18720),  -- CUADRIL-NALGA-PECETO
    (2, 18600, 16740),  -- JAMON CUADRADO-BOLA DE LOMO-PULPA PALETA
    (3, 19800, 17820),  -- COSTILLA
    (4, 19500, 17500),  -- VACIO
    (5, 18970, 17070),  -- PICANA/TAPA DE CUADRIL
    (6, 18180, 16360),  -- CORTE AMERICANO-ENTRECOT
    (7, 19620, 17670),  -- COLITA CUADRIL
    (8, 16900, 15210),  -- TAPA DE NALGA
    (9, 18900, 17010),  -- TAPA DE ASADO
    (10, 17200, 15480),  -- COSTELETA/CARRE
    (11, 15700, 14130),  -- AGUJA ESPECIAL
    (12, 13300, 11970),  -- AGUJA ECONOMICA
    (13, 12090, 10880),  -- BOCADO FINO
    (14, 15700, 14130),  -- BOCADO ANCHO
    (15, 23000, 20700),  -- LOMITO
    (16, 14000, 11000),  -- MOLIDA SEMIESPECIAL
    (17, 16000, 14400),  -- MOLIDA ESPECIAL
    (18, 16900, 15210),  -- FALDA ESPECIAL
    (19, 13700, 12960),  -- FALDA ECONOMICA
    (20, 16700, 15030),  -- FALDA DESHUESADA
    (21, 19000, 17100),  -- MILANESA COMUN
    (22, 21200, 19080),  -- MILANESA DE PECETO
    (23, 21200, 19080),  -- MILANESA DE NALGA
    (24, 10900, 9810),  -- OSOBUCO
    (25, 6500, 5850),  -- PUCHERO ECONOMICO
    (26, 15400, 13860),  -- TORTUGA-CARNAZA
    (27, 17500, 15750),  -- ALBONDIGA
    (28, 17500, 15750),  -- HAMBURGUESA
    (29, 18700, 16830),  -- HAMBURGUESA RELLENA C/MUZZARELLA
    (30, 21000, 18900),  -- MATAMBRE
    (31, 20550, 18500),  -- BIFE DE CHORIZO Y OJO DE BIFE
    (32, 10500, 9450),  -- CHIQUIZUELA
    (33, 16000, 14400),  -- ROAST BEEF
    (34, 16000, 14400),  -- BOCADO DESHUESADO
    (35, 13400, 13400),  -- PIERNA
    (36, 17400, 17400),  -- COSTILLAR COMPLETO
    (37, 17400, 17400),  -- COSTILLAR CON VACIO
    (38, 17400, 17400),  -- COSTILLAR
    (39, 16400, 16400),  -- PARRILLERO
    (40, 9700, 9700),  -- CORTITO
    (41, 11300, 11300),  -- MEDIA RES C/DESPOSTE EMBOLSADO
    (42, 10900, 10900),  -- MEDIA RES DESPOSTADA EN PIEZAS
    (43, 13400, 13400),  -- CUARTO PISTOLA
    (44, 11500, 11500),  -- PALETA
    (45, 18300, 16470),  -- ENTRANA DE COSTILLAR
    (46, 9900, 9000),  -- CHINCHULIN-RINON
    (47, 30000, 28500),  -- MOLLEJA SURTIDA
    (48, 10500, 9500),  -- MONDONGO
    (49, 2000, 2000),  -- SESOS (LA UNIDAD)
    (50, 11500, 11000),  -- LENGUA
    (51, 8000, 7250),  -- CORAZON-TRIPA GORDA
    (52, 6000, 5500),  -- HIGADO
    (53, 7500, 6800),  -- RABO
    (54, 9400, 8460),  -- BONDIOLA
    (55, 12500, 11250),  -- MATAMBRE CERDO
    (56, 9700, 8700),  -- PULPA CERDO
    (57, 8600, 7700),  -- COSTELETA CERDO
    (58, 9000, 8100),  -- CORTE AMERICANO/ENTRECOT CERDO
    (59, 9500, 8500),  -- COSTILLA CERDO
    (60, 8900, 8000),  -- VACIO CERDO
    (61, 9700, 8700),  -- LOMO CERDO
    (62, 8300, 7450),  -- HAMBURGUESAS CERDO
    (63, 8800, 7500),  -- CHORIZO
    (64, 9700, 8250),  -- CHORIZO SABORIZADO
    (65, 8800, 7950),  -- CHORIZO COLORADO
    (66, 6500, 5850),  -- CHORIZO CUNE
    (67, 7000, 6000),  -- MORCILLA
    (68, 2700, 2700),  -- CUERITO
    (69, 2700, 2700),  -- HUESITOS/PATITAS
    (70, 7600, 6500),  -- BOCADO CERDO
    (71, 5600, 5000),  -- OSOBUCO CERDO
    (72, 9400, 8500),  -- SALCHICHA PARRILLERA
    (73, 10400, 8500),  -- MILANESA CERDO
    (74, 8470, 7700),  -- PECHITO
    (75, 7480, 6800),  -- PIERNA CERDO
    (76, 6800, 6120),  -- PALETA DE CERDO
    (77, 7370, 6700),  -- CARRE
    (78, 30000, 28000),  -- SALAME CASERO ENV.
    (79, 27200, 24000),  -- SALAME CASERO SIN ENVASAR
    (80, 16000, 16000),  -- PROVOLETA
    (81, 29000, 26100),  -- BONDIOLA EMBUTIDO
    (82, 29000, 29000),  -- LOMO EMBUTIDO
    (83, 29000, 29000),  -- PANCETA
    (84, 9500, 9500),  -- QUESO CERDO ENV.
    (85, 20000, 20000),  -- ARROLLADO DE CERDO
    (86, 40000, 40000),  -- JAMON CRUDO
    (87, 9500, 9500),  -- PECHUGA
    (88, 5850, 5850),  -- POLLO FRESCO
    (89, 5850, 5850),  -- PATA MUSLO
    (90, 5050, 5050),  -- ALITA
    (91, 12000, 12000),  -- ARROLLADO DE POLLO
    (92, 9300, 9300),  -- MILANESA DE PECHUGA
    (93, 7500, 7500),  -- HAMBURGUESA POLLO
    (94, 9000, 9000),  -- HAMBURGUESA RELLENA C/MUZZARELLA POLLO
    (95, 14500, 14500),  -- BOCADITOS/CANONCITOS MUZZARELLA GRANGYS
    (96, 9500, 9500),  -- NUGGETS INDACOR
    (97, 10100, 10100),  -- MEDALLON DE POLLO JYQ GRANGYS
    (98, 7600, 7600),  -- MEDALLON DE MERLUZA GRANGYS
    (99, 12500, 12500),  -- FILET DE MERLUZA
    (100, 6700, 6700),  -- PAPAS BASTON CONGELADAS
    (101, 10000, 10000),  -- PAPAS NOISETTE CONGELADAS
    (102, 11500, 11500),  -- PAPAS CARITAS CONGELADAS
    (103, 22500, 20250),  -- TOMAHAWK
    (104, 26300, 23670),  -- RIB EYE/OJO DE BIFE
    (105, 26300, 23670),  -- ASADO VENTANA
    (106, 22500, 20250)  -- T-BONE
)
update precios p
set precio_minorista = pc.p_minorista,
    precio_mayorista = pc.p_mayorista,
    updated_at = now()
from precios_csv pc
where p.codigo_balanza = pc.plu;

-- Verificación:
select count(*) as productos_listos_para_caja
from precios
where codigo_balanza between 1 and 106
  and precio_minorista > 0;