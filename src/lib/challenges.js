import { getProfiles } from './profile';
import { ensureSignedIn, supabase } from './supabase';

const NO_NICKNAME = { nickname: 'Unknown swimmer', colour: '#7F8C8D' };

// Turn database errors into something a swimmer can act on.
function friendly(error) {
  if (error.code === '23505') return new Error('You already have a pending challenge.');
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return new Error('The database isn’t set up yet. Run the scripts in the supabase folder.');
  }
  return error;
}

// The swimmer's one pending challenge, or null.
export async function getPendingChallenge() {
  await ensureSignedIn();
  const { data, error } = await supabase
    .from('challenges')
    .select('id, boundary, boundary_metres, swim_metres, created_at')
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw friendly(error);
  return data;
}

export async function lockInChallenge({ coordinates, boundaryMetres, swimMetres }) {
  await ensureSignedIn();
  const { data, error } = await supabase
    .from('challenges')
    .insert({
      boundary: { type: 'Polygon', coordinates: [coordinates] },
      boundary_metres: boundaryMetres,
      swim_metres: swimMetres,
    })
    .select('id, boundary, boundary_metres, swim_metres, created_at')
    .single();
  if (error) throw friendly(error);
  return data;
}

// Pretend swim for testing: marks the pending challenge as swum and claims its
// area, cutting it out of anyone's older territory. Once Strava is connected, a
// real watch-recorded swim will do this instead.
export async function completeChallenge(id) {
  await ensureSignedIn();
  const { error } = await supabase.rpc('complete_challenge_test', { p_challenge_id: id });
  if (error) throw friendly(error);
}

// Everyone's territory as it stands now, each with its holder's nickname and
// colour, and marked with whether it's yours.
export async function getTerritory() {
  const me = await ensureSignedIn();
  const { data, error } = await supabase
    .from('territory')
    .select('id, user_id, boundary, claimed_at')
    .order('claimed_at', { ascending: true });
  if (error) throw friendly(error);
  // Still show the map if nicknames can't be loaded, just without them.
  const profiles = await getProfiles([...new Set(data.map((t) => t.user_id))]).catch(() => ({}));
  return data.map((t) => ({
    ...t,
    ...(profiles[t.user_id] ?? NO_NICKNAME),
    mine: t.user_id === me.id,
  }));
}

export async function cancelChallenge(id) {
  await ensureSignedIn();
  const { error } = await supabase.from('challenges').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw friendly(error);
}
