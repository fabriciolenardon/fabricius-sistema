// ============================================================
// vite.config.js — build optimizado para Fabricius
// ============================================================
// Antes era un one-liner sin tuning, lo que dejaba TODO el codigo
// en un solo bundle de ~1,2 MB. Esto hacia que el primer load
// fuera lento, especialmente en conexiones de campo (Rio Primero).
//
// Ahora separamos:
//  - 'vendor-react': React + ReactDOM + react-router (estables, se
//     cachean entre deploys)
//  - 'vendor-supabase': cliente Supabase (estable, se cachea)
//  - Resto del codigo de la app dividido por Vite naturalmente con
//     los React.lazy() que pusimos en App.jsx (cada portal de rol
//     y las pantallas pesadas se cargan on-demand)
// ============================================================
import react from '@vitejs/plugin-react'

// ── ID de build para detectar pestañas viejas ─────────────────────────
// Cada deploy genera un id nuevo, embebido en el bundle (__BUILD_ID__) y
// publicado en /version.json. VersionWatcher (App.jsx) compara los dos: si no
// coinciden, esta pestaña corre código viejo. Nació del 27/08/2026: la caja
// de Monte Cristo estuvo un día entero escribiendo débitos inflados con un
// bug YA ARREGLADO, porque la pestaña nunca se refrescó y ningún deploy
// llega a un navegador que no recarga.
const BUILD_ID = String(Date.now())

export default {
  plugins: [
    react(),
    {
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: BUILD_ID }) })
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  build: {
    // El chunk principal se mantiene chico; lo que pasa el umbral
    // de 500 KB suele ser vendor (estables, no molestan).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
}
