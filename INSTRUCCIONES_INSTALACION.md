# 🥩 CARNICERIAS FABRICIUS — GUÍA DE INSTALACIÓN
## Sistema de Gestión Web — Paso a paso

---

## LO QUE VAS A NECESITAR
- Una computadora con internet
- 30 minutos de tu tiempo
- Todo es GRATIS hasta cierto volumen

---

## PASO 1 — Instalar Node.js en tu computadora

1. Entrá a https://nodejs.org
2. Descargá la versión "LTS" (la recomendada)
3. Instalala como cualquier programa
4. Para verificar: abrí el símbolo del sistema (CMD en Windows) y escribí:
   ```
   node --version
   ```
   Tiene que aparecer algo como: v20.0.0

---

## PASO 2 — Crear cuenta en Supabase (base de datos GRATIS)

1. Entrá a https://supabase.com
2. Hacé clic en "Start your project" → "Sign up"
3. Registrate con tu email (ej: fabricio@fabricius.com.ar)
4. Una vez adentro, hacé clic en "New project"
5. Completá:
   - Organization: Carnicerias Fabricius
   - Name: fabricius-sistema
   - Database Password: anotá esta contraseña en un lugar seguro
   - Region: South America (São Paulo)
6. Esperá 2 minutos que se crea el proyecto

---

## PASO 3 — Crear las tablas en Supabase

1. En tu proyecto Supabase, hacé clic en **SQL Editor** (menú izquierdo)
2. Ejecutá los scripts de la carpeta **`supabase/`** en este orden (cada uno en una query nueva → Run):
   - `01_schema.sql` — tablas base
   - `02_extensions.sql` — precios, stock, remitos, ventas, etc.
   - `03_triggers.sql` — saldo automático en cuenta corriente
   - `04_rls.sql` — seguridad por rol (admin / franquicia)
3. En **Database → Replication**, habilitá Realtime para la tabla **`remitos`**
4. Detalles y checklist: leé `supabase/README.md`

> Si ya tenías una base creada con el SQL viejo, los scripts usan `IF NOT EXISTS` y no deberían borrar datos. Igual conviene hacer backup antes.

## PASO 4 — Crear los usuarios en Supabase

1. En Supabase, andá a "Authentication" → "Users"
2. Hacé clic en "Add user" para cada uno:

| Nombre | Email | Contraseña | Rol |
|--------|-------|-----------|-----|
| Fabricio Lenardon | fabricio@fabricius.com.ar | (elegí una contraseña segura) | admin |
| Ariel Garrone | ariel@fabricius.com.ar | (contraseña) | admin |
| Giuliana Frontera | giuliana@fabricius.com.ar | (contraseña) | admin |
| Sucursal Alvear | alvear@fabricius.com.ar | (contraseña) | franquicia |
| Sucursal Monte Cristo | montecRisto@fabricius.com.ar | (contraseña) | franquicia |

3. Después de crear cada usuario, ejecutá en SQL Editor (cambiando los valores):

```sql
-- Ejecutar para CADA usuario admin (cambiar el email y nombre)
insert into profiles (id, nombre, rol)
select id, 'Fabricio Lenardon', 'admin'
from auth.users where email = 'fabricio@fabricius.com.ar';

insert into profiles (id, nombre, rol)
select id, 'Ariel Garrone', 'admin'
from auth.users where email = 'ariel@fabricius.com.ar';

insert into profiles (id, nombre, rol)
select id, 'Giuliana Frontera', 'admin'
from auth.users where email = 'giuliana@fabricius.com.ar';

-- Para las sucursales (vinculadas a su sucursal)
insert into profiles (id, nombre, rol, sucursal_id)
select id, 'Fabricius Alvear', 'franquicia', 2
from auth.users where email = 'alvear@fabricius.com.ar';

insert into profiles (id, nombre, rol, sucursal_id)
select id, 'Fabricius Monte Cristo', 'franquicia', 3
from auth.users where email = 'montecRisto@fabricius.com.ar';
```

---

## PASO 5 — Obtener las claves de Supabase

1. En Supabase, andá a "Settings" → "API"
2. Copiá:
   - **Project URL**: algo como https://abcdefgh.supabase.co
   - **anon public key**: una clave larga que empieza con "eyJ..."

---

## PASO 6 — Configurar el proyecto en tu computadora

1. Descomprimí la carpeta `fabricius-app` que te pasó Claude
2. Abrí esa carpeta
3. Creá un archivo llamado `.env` (con el punto adelante) y escribí:

```
VITE_SUPABASE_URL=https://TU_URL.supabase.co
VITE_SUPABASE_ANON_KEY=tu_clave_anon_aqui
VITE_GEMINI_API_KEY=tu_gemini_api_key_aqui
```

(Reemplazá con los datos del Paso 5)

**Seguridad:** si la anon key estuvo en el repositorio, regenerala en Supabase → Settings → API.

---

## PASO 7 — Instalar dependencias y probar localmente

Abrí el símbolo del sistema (CMD) dentro de la carpeta `fabricius-app` y ejecutá:

```bash
npm install
npm run dev
```

Abrí el navegador en http://localhost:5173

¡Deberías ver el sistema funcionando! Probá iniciar sesión con algún usuario.

---

## PASO 8 — Subir a internet (deploy en Vercel)

1. Creá una cuenta en https://github.com (gratis)
2. Creá un repositorio nuevo llamado "fabricius-sistema"
3. Subí todos los archivos de la carpeta `fabricius-app` al repositorio

4. Creá una cuenta en https://vercel.com (gratis)
5. Hacé clic en "Add new project"
6. Conectá tu cuenta de GitHub y seleccioná "fabricius-sistema"
7. En "Environment Variables" agregá:
   - VITE_SUPABASE_URL = tu URL de Supabase
   - VITE_SUPABASE_ANON_KEY = tu clave anon
   - VITE_GEMINI_API_KEY = tu clave Gemini
   - OPENROUTER_API_KEY = tu clave OpenRouter (solo servidor)
8. Hacé clic en "Deploy"

En 2 minutos Vercel te va a dar una URL como:
**https://fabricius-sistema.vercel.app**

¡Esa es tu app online! Cualquiera puede entrar desde esa URL.

---

## PASO 9 — Dominio propio (opcional)

Si querés que sea **https://sistema.fabricius.com.ar** o similar:

1. Comprá un dominio en NIC Argentina (https://nic.ar) o en Namecheap
2. En Vercel → tu proyecto → "Domains" → agregá tu dominio
3. Vercel te explica cómo apuntar el DNS

---

## ACCESOS FINALES

| Usuario | Email | Qué puede hacer |
|---------|-------|----------------|
| Fabricio | fabricio@fabricius.com.ar | TODO |
| Ariel | ariel@fabricius.com.ar | TODO |
| Giuliana | giuliana@fabricius.com.ar | TODO |
| Sucursal Alvear | alvear@fabricius.com.ar | Solo su cta. cte. y remitos |
| Monte Cristo | montecRisto@fabricius.com.ar | Solo su cta. cte. y remitos |

---

## ¿PROBLEMAS?

Si algo no funciona, los errores más comunes son:
- **"Invalid API key"**: Revisá que las claves en el .env sean correctas
- **"Row level security"**: Verificá que los profiles estén creados en el SQL
- **Página en blanco**: Revisá la consola del navegador (F12) y buscá el error

---

## SOPORTE

Este sistema fue construido específicamente para Carnicerias Fabricius.
Cualquier duda o ajuste: seguí trabajando con Claude en claude.ai

Versión 1.0 — Mayo 2026
