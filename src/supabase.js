import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wvuykvmcdppukjzceybk.supabase.co'
const SUPABASE_KEY = 'sb_publishable_SwPXayw6TTteqpGLll9PBg_kTKOtIiq'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
