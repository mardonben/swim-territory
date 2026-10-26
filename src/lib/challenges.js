import { ensureSignedIn, supabase } from './supabase';

// Turn database errors into something a swimmer can act on.
function friendly(error) {
  if (error.code === '23505') return new Error('You already have a pending challenge.');
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return new Error('The database isn’t set up yet. Run supabase/schema.sql in Supabase.');
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

// Pretend swim for testing: marks the pending challenge as swum. Once Strava is
// connected, a real watch-recorded swim will do this instead.
export async function completeChallenge(id) {
  await ensureSignedIn();
  const { error } = await supabase
    .from('challenges')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw friendly(error);
}

// Every area the swimmer has claimed, oldest first so newer claims draw on top.
export async function getTerritory() {
  await ensureSignedIn();
  const { data, error } = await supabase
    .from('challenges')
    .select('id, boundary, swim_metres, completed_at')
    .eq('status', 'completed')
    .order('completed_at', { ascending: true });
  if (error) throw friendly(error);
  return data;
}

export async function cancelChallenge(id) {
  await ensureSignedIn();
  const { error } = await supabase.from('challenges').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw friendly(error);
}
