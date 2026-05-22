-- ============================================================
-- MIGRACIÓN 22: Agregar productos del PDF que NO existen en el sistema
-- ============================================================
-- Recorre los 106 productos del PDF "CARNICERIAS FABRICIUS - CODIGOS PLU".
-- Para cada uno:
--   - Si EXISTE un producto en `precios` con nombre similar (matching
--     estricto bidireccional) → NO hace nada, lo deja como está.
--   - Si NO existe → lo INSERTA con la categoría correcta del PDF,
--     SIN precios y SIN PLU asignado.
--
-- Fabri va a asignar los PLU manualmente o desde "Importar PLUs CSV",
-- y los precios desde la pestaña "Administrar".
--
-- Categorías del sistema usadas:
--   bovino_corte    → PLU 1-34 y 103-106 (Línea Dorada)
--   bovino_pieza    → PLU 35-44
--   bovino_brosa    → PLU 45-53 (achuras)
--   cerdo_corte     → PLU 54-73
--   cerdo_pieza     → PLU 74-77
--   embutido        → PLU 78-86
--   pollo           → PLU 87-94 (pollo x kilo)
--   rebozado        → PLU 95-102 (rebozado x kilo)
--
-- NO toca las cajas (bovino_caja_cb, bovino_caja_pt), pollo_cajon,
-- rebozado_cajon, almacen ni bebidas — esos los gestiona Fabri por su lado.
-- ============================================================

with
productos_pdf (nombre, categoria) as (
  values
    -- BOVINO CORTES (PLU 1-34)
    ('CUADRIL-NALGA-PECETO', 'bovino_corte'),
    ('JAMON CUADRADO-BOLA DE LOMO-PULPA PALETA', 'bovino_corte'),
    ('COSTILLA', 'bovino_corte'),
    ('VACIO', 'bovino_corte'),
    ('PICANA/TAPA DE CUADRIL', 'bovino_corte'),
    ('CORTE AMERICANO-ENTRECOT', 'bovino_corte'),
    ('COLITA CUADRIL', 'bovino_corte'),
    ('TAPA DE NALGA', 'bovino_corte'),
    ('TAPA DE ASADO', 'bovino_corte'),
    ('COSTELETA/CARRE', 'bovino_corte'),
    ('AGUJA ESPECIAL', 'bovino_corte'),
    ('AGUJA ECONOMICA', 'bovino_corte'),
    ('BOCADO FINO', 'bovino_corte'),
    ('BOCADO ANCHO', 'bovino_corte'),
    ('LOMITO', 'bovino_corte'),
    ('MOLIDA SEMIESPECIAL', 'bovino_corte'),
    ('MOLIDA ESPECIAL', 'bovino_corte'),
    ('FALDA ESPECIAL', 'bovino_corte'),
    ('FALDA ECONOMICA', 'bovino_corte'),
    ('FALDA DESHUESADA', 'bovino_corte'),
    ('MILANESA COMUN', 'bovino_corte'),
    ('MILANESA DE PECETO', 'bovino_corte'),
    ('MILANESA DE NALGA', 'bovino_corte'),
    ('OSOBUCO', 'bovino_corte'),
    ('PUCHERO ECONOMICO', 'bovino_corte'),
    ('TORTUGA-CARNAZA', 'bovino_corte'),
    ('ALBONDIGA', 'bovino_corte'),
    ('HAMBURGUESA', 'bovino_corte'),
    ('HAMBURGUESA RELLENA C/MUZZARELLA', 'bovino_corte'),
    ('MATAMBRE', 'bovino_corte'),
    ('BIFE DE CHORIZO Y OJO DE BIFE', 'bovino_corte'),
    ('CHIQUIZUELA', 'bovino_corte'),
    ('ROAST BEEF', 'bovino_corte'),
    ('BOCADO DESHUESADO', 'bovino_corte'),
    -- BOVINO PIEZAS (PLU 35-44)
    ('PIERNA', 'bovino_pieza'),
    ('COSTILLAR COMPLETO', 'bovino_pieza'),
    ('COSTILLAR CON VACIO', 'bovino_pieza'),
    ('COSTILLAR', 'bovino_pieza'),
    ('PARRILLERO', 'bovino_pieza'),
    ('CORTITO', 'bovino_pieza'),
    ('MEDIA RES C/DESPOSTE EMBOLSADO', 'bovino_pieza'),
    ('MEDIA RES DESPOSTADA EN PIEZAS', 'bovino_pieza'),
    ('CUARTO PISTOLA', 'bovino_pieza'),
    ('PALETA', 'bovino_pieza'),
    -- BROSAS / ACHURAS (PLU 45-53)
    ('ENTRANA DE COSTILLAR', 'bovino_brosa'),
    ('CHINCHULIN-RINON', 'bovino_brosa'),
    ('MOLLEJA SURTIDA', 'bovino_brosa'),
    ('MONDONGO', 'bovino_brosa'),
    ('SESOS (LA UNIDAD)', 'bovino_brosa'),
    ('LENGUA', 'bovino_brosa'),
    ('CORAZON-TRIPA GORDA', 'bovino_brosa'),
    ('HIGADO', 'bovino_brosa'),
    ('RABO', 'bovino_brosa'),
    -- CERDO CORTES (PLU 54-73)
    ('BONDIOLA', 'cerdo_corte'),
    ('MATAMBRE CERDO', 'cerdo_corte'),
    ('PULPA CERDO', 'cerdo_corte'),
    ('COSTELETA CERDO', 'cerdo_corte'),
    ('CORTE AMERICANO/ENTRECOT CERDO', 'cerdo_corte'),
    ('COSTILLA CERDO', 'cerdo_corte'),
    ('VACIO CERDO', 'cerdo_corte'),
    ('LOMO CERDO', 'cerdo_corte'),
    ('HAMBURGUESAS CERDO', 'cerdo_corte'),
    ('CHORIZO', 'cerdo_corte'),
    ('CHORIZO SABORIZADO', 'cerdo_corte'),
    ('CHORIZO COLORADO', 'cerdo_corte'),
    ('CHORIZO CUNE', 'cerdo_corte'),
    ('MORCILLA', 'cerdo_corte'),
    ('CUERITO', 'cerdo_corte'),
    ('HUESITOS/PATITAS', 'cerdo_corte'),
    ('BOCADO CERDO', 'cerdo_corte'),
    ('OSOBUCO CERDO', 'cerdo_corte'),
    ('SALCHICHA PARRILLERA', 'cerdo_corte'),
    ('MILANESA CERDO', 'cerdo_corte'),
    -- CERDO PIEZAS (PLU 74-77)
    ('PECHITO', 'cerdo_pieza'),
    ('PIERNA CERDO', 'cerdo_pieza'),
    ('PALETA DE CERDO', 'cerdo_pieza'),
    ('CARRE', 'cerdo_pieza'),
    -- EMBUTIDOS (PLU 78-86)
    ('SALAME CASERO ENV.', 'embutido'),
    ('SALAME CASERO SIN ENVASAR', 'embutido'),
    ('PROVOLETA', 'embutido'),
    ('BONDIOLA EMBUTIDO', 'embutido'),
    ('LOMO EMBUTIDO', 'embutido'),
    ('PANCETA', 'embutido'),
    ('QUESO CERDO ENV.', 'embutido'),
    ('ARROLLADO DE CERDO', 'embutido'),
    ('JAMON CRUDO', 'embutido'),
    -- POLLO X KILO (PLU 87-94)
    ('PECHUGA', 'pollo'),
    ('POLLO FRESCO', 'pollo'),
    ('PATA MUSLO', 'pollo'),
    ('ALITA', 'pollo'),
    ('ARROLLADO DE POLLO', 'pollo'),
    ('MILANESA DE PECHUGA', 'pollo'),
    ('HAMBURGUESA POLLO', 'pollo'),
    ('HAMBURGUESA RELLENA C/MUZZARELLA POLLO', 'pollo'),
    -- REBOZADO X KILO (PLU 95-102)
    ('BOCADITOS/CANONCITOS MUZZARELLA GRANGYS', 'rebozado'),
    ('NUGGETS INDACOR', 'rebozado'),
    ('MEDALLON DE POLLO JYQ GRANGYS', 'rebozado'),
    ('MEDALLON DE MERLUZA GRANGYS', 'rebozado'),
    ('FILET DE MERLUZA', 'rebozado'),
    ('PAPAS BASTON CONGELADAS', 'rebozado'),
    ('PAPAS NOISETTE CONGELADAS', 'rebozado'),
    ('PAPAS CARITAS CONGELADAS', 'rebozado'),
    -- LINEA DORADA (PLU 103-106) — van como bovino_corte premium
    ('TOMAHAWK', 'bovino_corte'),
    ('RIB EYE/OJO DE BIFE', 'bovino_corte'),
    ('ASADO VENTANA', 'bovino_corte'),
    ('T-BONE', 'bovino_corte')
),
existentes as (
  select id, nombre,
         upper(regexp_replace(trim(nombre), '\s+', ' ', 'g')) as nn
  from precios
  where nombre not like 'ZZ_%'
),
-- Productos del PDF que NO tienen match estricto en la BD
faltantes as (
  select pdf.nombre, pdf.categoria
  from productos_pdf pdf
  where not exists (
    select 1 from existentes e
    where
      -- Igualdad exacta tras normalizar
      e.nn = upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g'))
      -- O uno es prefijo del otro (con separador)
      or e.nn like upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) || '-%'
      or e.nn like upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) || ' %'
      or e.nn like upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) || '/%'
      or e.nn like upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) || ' (%'
      or upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) like e.nn || '-%'
      or upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) like e.nn || ' %'
      or upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) like e.nn || '/%'
      or upper(regexp_replace(trim(pdf.nombre), '\s+', ' ', 'g')) like e.nn || ' (%'
  )
),
insertados as (
  insert into precios (nombre, categoria, pesable, dias_vencimiento)
  select nombre, categoria, true, 3 from faltantes
  returning id, nombre, categoria
)
select
  (select count(*) from productos_pdf) as productos_pdf_total,
  (select count(*) from faltantes)     as faltantes_detectados,
  (select count(*) from insertados)    as productos_insertados;
