import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://uephtvbnkovbxhkatbtg.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcGh0dmJua292Ynhoa2F0YnRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzA5ODYsImV4cCI6MjA5Mzc0Njk4Nn0.aL8SdT-S5qKQzJFX9gfWLv5D7R6QxcnAQBgrKWkEtYk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
