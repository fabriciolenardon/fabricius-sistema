import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
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
      else { setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    // Primero intentar sin el join de sucursales
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (data) {
      // Si tiene sucursal_id, traer la sucursal por separado
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
      // Solo si NO hay perfil en la tabla asumimos admin
      // (esto es para tu usuario principal que puede no tener perfil)
      setProfile({ id: userId, nombre: 'Admin', rol: 'admin' })
    }
    setLoading(false)
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const isAdmin = profile?.rol === 'admin'
  const isFranquicia = profile?.rol === 'franquicia'

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, isFranquicia, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
