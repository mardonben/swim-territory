import { ensureSignedIn, supabase } from './supabase';

// Swimmers ranked by the total outline of the territory they hold right now.
export async function getLeaderboard() {
  const me = await ensureSignedIn();
  const { data, error } = await supabase
    .from('leaderboard')
    .select('user_id, nickname, colour, areas, perimeter_metres, area_m2')
    .order('perimeter_metres', { ascending: false });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      throw new Error('The leaderboard isn’t set up in the database yet.');
    }
    throw error;
  }
  return data.map((row) => ({ ...row, mine: row.user_id === me.id }));
}
