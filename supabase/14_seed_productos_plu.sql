-- ============================================================
-- MIGRACIÓN 14: Seed de los 106 productos con PLU oficial
-- ============================================================
-- Fuente: PDF "CARNICERIAS FABRICIUS - CODIGOS PLU - BALANZA"
--
-- Comportamiento idempotente:
--   1) Para cada producto del PDF, si existe por nombre en `precios`
--      y NO tiene codigo_balanza asignado → se le asigna el PLU del PDF.
--   2) Si el producto NO existe → se inserta nuevo con su PLU.
--   3) Si ya tiene codigo_balanza (cualquiera) → no se toca, para no
--      sobrescribir asignaciones manuales hechas por Fabri.
--
-- Precios: NO se cargan. Quedan en NULL hasta que se editen desde la UI.
-- Categorías: derivadas de la sección del PDF (CORTES, PIEZAS, ACHURAS, etc.)
-- ============================================================

-- Pre-requisito: la migración 12 debe haberse corrido (necesitamos la
-- columna codigo_balanza y el índice único asociado).

with productos_pdf (plu, categoria, nombre, pesable) as (
  values
    -- BOVINO - CORTES (1-34)
    (1,  'bovino_corte', 'CUADRIL-NALGA-PECETO', true),
    (2,  'bovino_corte', 'JAMON CUADRADO-BOLA DE LOMO-PULPA PALETA', true),
    (3,  'bovino_corte', 'COSTILLA', true),
    (4,  'bovino_corte', 'VACIO', true),
    (5,  'bovino_corte', 'PICANA/TAPA DE CUADRIL', true),
    (6,  'bovino_corte', 'CORTE AMERICANO-ENTRECOT', true),
    (7,  'bovino_corte', 'COLITA CUADRIL', true),
    (8,  'bovino_corte', 'TAPA DE NALGA', true),
    (9,  'bovino_corte', 'TAPA DE ASADO', true),
    (10, 'bovino_corte', 'COSTELETA/CARRE', true),
    (11, 'bovino_corte', 'AGUJA ESPECIAL', true),
    (12, 'bovino_corte', 'AGUJA ECONOMICA', true),
    (13, 'bovino_corte', 'BOCADO FINO', true),
    (14, 'bovino_corte', 'BOCADO ANCHO', true),
    (15, 'bovino_corte', 'LOMITO', true),
    (16, 'bovino_corte', 'MOLIDA SEMIESPECIAL', true),
    (17, 'bovino_corte', 'MOLIDA ESPECIAL', true),
    (18, 'bovino_corte', 'FALDA ESPECIAL', true),
    (19, 'bovino_corte', 'FALDA ECONOMICA', true),
    (20, 'bovino_corte', 'FALDA DESHUESADA', true),
    (21, 'bovino_corte', 'MILANESA COMUN', true),
    (22, 'bovino_corte', 'MILANESA DE PECETO', true),
    (23, 'bovino_corte', 'MILANESA DE NALGA', true),
    (24, 'bovino_corte', 'OSOBUCO', true),
    (25, 'bovino_corte', 'PUCHERO ECONOMICO', true),
    (26, 'bovino_corte', 'TORTUGA-CARNAZA', true),
    (27, 'bovino_corte', 'ALBONDIGA', true),
    (28, 'bovino_corte', 'HAMBURGUESA', true),
    (29, 'bovino_corte', 'HAMBURGUESA RELLENA C/MUZZARELLA', true),
    (30, 'bovino_corte', 'MATAMBRE', true),
    (31, 'bovino_corte', 'BIFE DE CHORIZO Y OJO DE BIFE', true),
    (32, 'bovino_corte', 'CHIQUIZUELA', true),
    (33, 'bovino_corte', 'ROAST BEEF', true),
    (34, 'bovino_corte', 'BOCADO DESHUESADO', true),

    -- BOVINO - PIEZAS (35-44)
    (35, 'bovino_pieza', 'PIERNA', true),
    (36, 'bovino_pieza', 'COSTILLAR COMPLETO', true),
    (37, 'bovino_pieza', 'COSTILLAR CON VACIO', true),
    (38, 'bovino_pieza', 'COSTILLAR', true),
    (39, 'bovino_pieza', 'PARRILLERO', true),
    (40, 'bovino_pieza', 'CORTITO', true),
    (41, 'bovino_pieza', 'MEDIA RES C/DESPOSTE EMBOLSADO', true),
    (42, 'bovino_pieza', 'MEDIA RES DESPOSTADA EN PIEZAS', true),
    (43, 'bovino_pieza', 'CUARTO PISTOLA', true),
    (44, 'bovino_pieza', 'PALETA', true),

    -- ACHURAS / BROSAS (45-53)
    (45, 'bovino_brosa', 'ENTRANA DE COSTILLAR', true),
    (46, 'bovino_brosa', 'CHINCHULIN-RINON', true),
    (47, 'bovino_brosa', 'MOLLEJA SURTIDA', true),
    (48, 'bovino_brosa', 'MONDONGO', true),
    (49, 'bovino_brosa', 'SESOS (LA UNIDAD)', false), -- vende por unidad, no pesable
    (50, 'bovino_brosa', 'LENGUA', true),
    (51, 'bovino_brosa', 'CORAZON-TRIPA GORDA', true),
    (52, 'bovino_brosa', 'HIGADO', true),
    (53, 'bovino_brosa', 'RABO', true),

    -- CERDO - CORTES (54-73)
    (54, 'cerdo_corte', 'BONDIOLA', true),
    (55, 'cerdo_corte', 'MATAMBRE CERDO', true),
    (56, 'cerdo_corte', 'PULPA CERDO', true),
    (57, 'cerdo_corte', 'COSTELETA CERDO', true),
    (58, 'cerdo_corte', 'CORTE AMERICANO/ENTRECOT CERDO', true),
    (59, 'cerdo_corte', 'COSTILLA CERDO', true),
    (60, 'cerdo_corte', 'VACIO CERDO', true),
    (61, 'cerdo_corte', 'LOMO CERDO', true),
    (62, 'cerdo_corte', 'HAMBURGUESAS CERDO', true),
    (63, 'cerdo_corte', 'CHORIZO', true),
    (64, 'cerdo_corte', 'CHORIZO SABORIZADO', true),
    (65, 'cerdo_corte', 'CHORIZO COLORADO', true),
    (66, 'cerdo_corte', 'CHORIZO CUNE', true),
    (67, 'cerdo_corte', 'MORCILLA', true),
    (68, 'cerdo_corte', 'CUERITO', true),
    (69, 'cerdo_corte', 'HUESITOS/PATITAS', true),
    (70, 'cerdo_corte', 'BOCADO CERDO', true),
    (71, 'cerdo_corte', 'OSOBUCO CERDO', true),
    (72, 'cerdo_corte', 'SALCHICHA PARRILLERA', true),
    (73, 'cerdo_corte', 'MILANESA CERDO', true),

    -- CERDO - PIEZAS (74-77)
    (74, 'cerdo_pieza', 'PECHITO', true),
    (75, 'cerdo_pieza', 'PIERNA CERDO', true),
    (76, 'cerdo_pieza', 'PALETA DE CERDO', true),
    (77, 'cerdo_pieza', 'CARRE', true),

    -- EMBUTIDOS (78-86)
    (78, 'embutido', 'SALAME CASERO ENV.', true),
    (79, 'embutido', 'SALAME CASERO SIN ENVASAR', true),
    (80, 'embutido', 'PROVOLETA', true),
    (81, 'embutido', 'BONDIOLA EMBUTIDO', true),
    (82, 'embutido', 'LOMO EMBUTIDO', true),
    (83, 'embutido', 'PANCETA', true),
    (84, 'embutido', 'QUESO CERDO ENV.', true),
    (85, 'embutido', 'ARROLLADO DE CERDO', true),
    (86, 'embutido', 'JAMON CRUDO', true),

    -- POLLO (87-94)
    (87, 'pollo', 'PECHUGA', true),
    (88, 'pollo', 'POLLO FRESCO', true),
    (89, 'pollo', 'PATA MUSLO', true),
    (90, 'pollo', 'ALITA', true),
    (91, 'pollo', 'ARROLLADO DE POLLO', true),
    (92, 'pollo', 'MILANESA DE PECHUGA', true),
    (93, 'pollo', 'HAMBURGUESA POLLO', true),
    (94, 'pollo', 'HAMBURGUESA RELLENA C/MUZZARELLA POLLO', true),

    -- REBOZADOS (95-102)
    (95,  'rebozado', 'BOCADITOS/CANONCITOS MUZZARELLA GRANGYS', true),
    (96,  'rebozado', 'NUGGETS INDACOR', true),
    (97,  'rebozado', 'MEDALLON DE POLLO JYQ GRANGYS', true),
    (98,  'rebozado', 'MEDALLON DE MERLUZA GRANGYS', true),
    (99,  'rebozado', 'FILET DE MERLUZA', true),
    (100, 'rebozado', 'PAPAS BASTON CONGELADAS', true),
    (101, 'rebozado', 'PAPAS NOISETTE CONGELADAS', true),
    (102, 'rebozado', 'PAPAS CARITAS CONGELADAS', true),

    -- LINEA DORADA (103-106) — cortes premium, los agrupo en bovino_corte
    (103, 'bovino_corte', 'TOMAHAWK', true),
    (104, 'bovino_corte', 'RIB EYE/OJO DE BIFE', true),
    (105, 'bovino_corte', 'ASADO VENTANA', true),
    (106, 'bovino_corte', 'T-BONE', true)
),

-- PASO 1: actualizar productos existentes que NO tengan PLU asignado.
-- (Si ya tienen otro PLU, no se toca para preservar asignaciones manuales.)
actualizados as (
  update precios p
  set codigo_balanza = pdf.plu,
      pesable = pdf.pesable,
      updated_at = now()
  from productos_pdf pdf
  where upper(trim(p.nombre)) = upper(trim(pdf.nombre))
    and p.codigo_balanza is null
  returning p.id, p.nombre, pdf.plu
),

-- PASO 2: insertar productos del PDF que no existen en la tabla.
-- NOTA: no usamos `activo` porque esa columna no existe en producción.
insertados as (
  insert into precios (categoria, nombre, codigo_balanza, pesable, dias_vencimiento)
  select pdf.categoria, pdf.nombre, pdf.plu, pdf.pesable, 3
  from productos_pdf pdf
  where not exists (
    select 1 from precios p
    where upper(trim(p.nombre)) = upper(trim(pdf.nombre))
  )
  returning id, nombre, codigo_balanza
)

-- Reporte final
select
  (select count(*) from actualizados) as productos_actualizados,
  (select count(*) from insertados)   as productos_insertados,
  (select count(*) from precios where codigo_balanza between 1 and 106) as plus_asignados_total;
