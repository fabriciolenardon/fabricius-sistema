import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { esCEO, esSucursal } from '../lib/permisos'
import { olvidarUsuarioCache } from '../lib/ctaProveedores'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileMissing, setProfileMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setProfileMissing(false); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (data) {
      setProfileMissing(false)
      if (data.sucursal_id) {
        const { data: sucursal } = await supabase
          .from('sucursales')
          .select('*')
          .eq('id', data.sucursal_id)
          .maybeSingle()
        setProfile({ ...data, sucursales: sucursal })
      } else {
        setProfile(data)
      }
    } else {
      setProfile(null)
      setProfileMissing(true)
    }
    setLoading(false)
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  async function signOut() {
    // El nombre del que registra queda cacheado en memoria para no pedirlo en
    // cada movimiento: si no se limpia, el proximo que entre firma con el
    // nombre del anterior.
    olvidarUsuarioCache()
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setProfileMissing(false)
  }

  // El personal de sucursal es admin DE LO SUYO: usa las mismas pantallas y
  // necesita los mismos permisos de app (anular una venta, borrar historial).
  // Quien lo encierra en su sucursal es la base, no esta bandera —
  // ver supabase/93 y supabase/94.
  const isSucursal = esSucursal(profile)
  const isAdmin = profile?.rol === 'admin' || isSucursal
  const isFranquicia = profile?.rol === 'franquicia'
  const isClienteMayorista = profile?.rol === 'cliente_mayorista'
  const isCajero = profile?.rol === 'cajero'
  // El mostrador no ve el TOTAL que se va acumulando mientras vende: ni el
  // "Facturado" del turno ni el "Total:" de las ventas del día. Son la cajera
  // de la central y las bocas (Monte Cristo, pedido de Fabricio 21/09/2026).
  // Es SÓLO ese número: el arqueo, la pestaña Historial y el resto de la Caja
  // siguen como estaban para la boca — lo que el rol cajero además no ve va
  // por `isCajero` (PRs #399/#402), no por acá.
  const cajaCiega = isCajero || isSucursal
  // Dueño de la empresa: los tres admin de la central no son equivalentes —
  // hay acciones reservadas a Fabricio. Ver lib/permisos.js.
  const isCEO = isAdmin && esCEO(profile, user)
  // Sucursal a la que pertenece (1 = central). Ver supabase/92.
  const sucursalId = profile?.sucursal_id ?? null

  return (
    <AuthContext.Provider value={{ user, profile, profileMissing, loading, isAdmin, isCEO, isSucursal, sucursalId, isFranquicia, isClienteMayorista, isCajero, cajaCiega, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
