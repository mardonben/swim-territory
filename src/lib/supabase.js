import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Ben's Sharked project. The publishable key is meant to ship inside apps:
// row-level security in the supabase/ scripts is what protects the data.
// .env.local can point at a different project instead.
export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://lgdupjgrcxkdkhjfoymf.supabase.co';
export const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'sb_publishable_J0Bs1CnDo3hA_U0L3mqcYw_TlsfJAnO';

export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

// Swimmers don't make an account yet: each phone gets its own anonymous
// sign-in, remembered between app launches.
export async function ensureSignedIn() {
  if (!supabase) throw new Error('Online saving isn’t set up yet (Supabase keys missing).');
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user;
  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signedIn.user;
}
