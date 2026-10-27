import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { ensureSignedIn, supabase, supabaseKey, supabaseUrl } from './supabase';

// Test mode: one phone can play as several swimmers, so you can see what it
// looks like when other people steal your land. Each pretend swimmer is a
// real anonymous sign-in of its own, so the database treats them exactly like
// a separate person. Their sign-ins are kept on this phone only.

const STORE_KEY = 'sharked.swimmers';
export const MAX_SWIMMERS = 4;

// [{ id, nickname, colour, session }] for every swimmer on this phone. The
// session is only stored for swimmers that aren't the one in use, and is
// saved fresh each time you switch away (sign-ins renew themselves).
async function load() {
  try {
    return JSON.parse((await AsyncStorage.getItem(STORE_KEY)) ?? '[]');
  } catch (e) {
    return [];
  }
}

async function store(list) {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(list));
}

// Everyone this phone can play as, the current swimmer first.
export async function listSwimmers() {
  const me = await ensureSignedIn();
  const list = await load();
  const others = list.filter((s) => s.id !== me.id);
  const ids = [me.id, ...others.map((s) => s.id)];
  const { data } = await supabase.from('profiles').select('user_id, nickname, colour').in('user_id', ids);
  const profiles = Object.fromEntries((data ?? []).map((p) => [p.user_id, p]));
  return ids.map((id) => ({
    id,
    current: id === me.id,
    nickname: profiles[id]?.nickname ?? 'New swimmer',
    colour: profiles[id]?.colour ?? '#7F8C8D',
  }));
}

async function rememberCurrent(list) {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return list;
  const entry = {
    id: session.user.id,
    session: { access_token: session.access_token, refresh_token: session.refresh_token },
  };
  return [entry, ...list.filter((s) => s.id !== session.user.id)];
}

export async function switchToSwimmer(id) {
  let list = await rememberCurrent(await load());
  const target = list.find((s) => s.id === id);
  if (!target?.session) throw new Error('That swimmer isn’t on this phone any more.');
  const { error } = await supabase.auth.setSession(target.session);
  if (error) throw new Error('Couldn’t switch to that swimmer. Their sign-in may have expired.');
  // The stored copy is now out of date: the live sign-in renews itself.
  list = list.map((s) => (s.id === id ? { id } : s));
  await store(list);
}

// Signs in a brand new pretend swimmer and switches to them.
export async function addTestSwimmer() {
  let list = await rememberCurrent(await load());
  if (list.length >= MAX_SWIMMERS) throw new Error(`You can have up to ${MAX_SWIMMERS} swimmers on one phone.`);
  // A separate, throwaway client so the current swimmer stays signed in.
  const scratch = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await scratch.auth.signInAnonymously();
  if (error) throw error;
  const { error: switchError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (switchError) throw switchError;
  list = [{ id: data.user.id }, ...list];
  await store(list);
}
