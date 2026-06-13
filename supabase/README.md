# Scripts SQL — Carnicerías Fabricius

Ejecutá en **Supabase → SQL Editor** en este orden (proyecto nuevo o migración):

| Orden | Archivo | Qué hace |
|-------|---------|----------|
| 1 | `01_schema.sql` | Tablas base + datos iniciales de sucursales |
| 2 | `02_extensions.sql` | Tablas extra (precios, stock, remitos, etc.) y columnas adicionales |
| 3 | `03_triggers.sql` | Recálculo automático de `clientes.saldo` desde movimientos |
| 4 | `04_rls.sql` | Row Level Security (admin vs franquicia) |

Los scripts usan `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` para poder re-ejecutarse en una base ya en uso.

## Después del SQL

1. **Authentication → Users**: crear usuarios y filas en `profiles` (ver `INSTRUCCIONES_INSTALACION.md` Paso 4).
2. **Database → Replication**: habilitar Realtime en la tabla `remitos` (para notificaciones en franquicias).
3. **Settings → API**: si la anon key estuvo en git, **rotar** la clave y actualizar `.env` / Vercel.
4. Variables en Vercel (ver `.env.example`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GEMINI_API_KEY`
   - `OPENROUTER_API_KEY` (solo servidor, sin prefijo `VITE_`)

## Verificación rápida

- Login **admin** → Dashboard, Depósito, Precios.
- Login **franquicia** → solo cuenta corriente, remitos y precios (lectura).
- Usuario Auth **sin** `profiles` → pantalla "Acceso pendiente" (no admin automático).
- Chat del layout admin (`/api/chat-sistema`) responde con sesión iniciada.

## Backup

Antes de aplicar en producción: Supabase → Database → Backups (o export manual).
