-- Subgrupo dentro de una categoría de precios. Se usa para clasificar los
-- Insumos en los 3 grupos del PDF original: descartables / limpieza / carniceria.
-- NULL para el resto de las categorías.
ALTER TABLE precios ADD COLUMN IF NOT EXISTS subcategoria text;

-- Clasificación de los insumos ya cargados.
UPDATE precios SET subcategoria = 'descartables' WHERE categoria = 'insumos' AND subcategoria IS NULL;
UPDATE precios SET subcategoria = 'limpieza' WHERE categoria = 'insumos' AND nombre IN (
  'CLORO','PERFUMINA','DESENGRASANTE','DETERGENTE','PALO DE PISO','TRAPO DE PISO','REJILLAS',
  'ESPONJAS COMUN','ALCOHOL','SECADOR DE PISO','SOPAPA BAÑO','AROMATIZANTE DE AMBIENTE','BLEM',
  'GAMUZA','GUANTES DE LIMPIEZA','CEPILLOS DE MANO','ESCOBILLON','RAID','VINAGRE','TIZAS');
UPDATE precios SET subcategoria = 'carniceria' WHERE categoria = 'insumos' AND nombre IN ('SUSTI','SIERRAS','BOLETEROS');
