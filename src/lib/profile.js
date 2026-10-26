import { ensureSignedIn, supabase } from './supabase';

// Map colours a swimmer can pick from. Orange is kept for pending challenges
// and light blue for shapes being drawn, so neither is here.
export const SWIMMER_COLOURS = [
  '#00A79D', '#E74C3C', '#8E44AD', '#2980B9', '#27AE60',
  '#C2185B', '#FBC02D', '#34495E', '#7CB342', '#6D4C41',
];

export const NICKNAME_RULE = '2 to 20 letters, numbers, spaces, - or _';

export function isValidNickname(nickname) {
  return /^[A-Za-z0-9 _-]{2,20}$/.test(nickname);
}

function friendly(error) {
  if (error.code === '23505') return new Error('That nickname is taken. Try another.');
  if (error.code === '23514') return new Error(`Nicknames can be ${NICKNAME_RULE}.`);
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return new Error('Nicknames aren’t set up in the database yet.');
  }
  return error;
}

// The swimmer's own profile, or null if they haven't picked a nickname yet.
export async function getMyProfile() {
  const me = await ensureSignedIn();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, nickname, colour')
    .eq('user_id', me.id)
    .maybeSingle();
  if (error) throw friendly(error);
  return data;
}

export async function saveMyProfile({ nickname, colour }) {
  const me = await ensureSignedIn();
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: me.id, nickname: nickname.trim(), colour })
    .select('user_id, nickname, colour')
    .single();
  if (error) throw friendly(error);
  return data;
}

// Nickname and colour for each of the given swimmers, keyed by user id.
export async function getProfiles(userIds) {
  if (userIds.length === 0) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, nickname, colour')
    .in('user_id', userIds);
  if (error) throw friendly(error);
  return Object.fromEntries(data.map((p) => [p.user_id, p]));
}
