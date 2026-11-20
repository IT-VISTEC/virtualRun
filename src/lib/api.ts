import { supabase } from './supabase';

export type Profile = { id: string; display_name: string; avatar_url: string | null };

export type Run = {
  id: string;
  ran_on: string;
  distance_km: number;
  duration_min: number | null;
  elevation_m: number | null;
  steps: number | null;
  entry_type: 'km' | 'steps';
  note: string | null;
};

export type NewRun = {
  ran_on: string;
  distance_km: number;
  duration_min: number | null;
  elevation_m: number | null;
  steps: number | null;
  entry_type: 'km' | 'steps';
  note: string | null;
};

export type ChallengeRow = {
  id: string;
  title: string;
  description: string | null;
  starts_on: string;
  ends_on: string;
  target_km: number | null;
  member_count: number;
  joined: boolean;
};

export type LeaderRow = { rank: number; user_id: string; display_name: string; total_km: number };

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const res = await supabase.from('profiles').select('id, display_name, avatar_url').eq('id', userId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  const res = await supabase.from('profiles').upsert({ id: userId, display_name: displayName });
  if (res.error) throw new Error(res.error.message);
}

export async function updateAvatarUrl(userId: string, avatarUrl: string): Promise<void> {
  const res = await supabase.from('profiles').upsert({ id: userId, avatar_url: avatarUrl });
  if (res.error) throw new Error(res.error.message);
}

export async function listRuns(limit = 500): Promise<Run[]> {
  const res = await supabase
    .from('runs')
    .select('id, ran_on, distance_km, duration_min, elevation_m, steps, entry_type, note')
    .order('ran_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrap(res) ?? [];
}

export async function addRun(run: NewRun): Promise<void> {
  const res = await supabase.from('runs').insert(run);
  if (res.error) throw new Error(res.error.message);
}

export async function deleteRun(id: string): Promise<void> {
  const res = await supabase.from('runs').delete().eq('id', id);
  if (res.error) throw new Error(res.error.message);
}

export async function listChallenges(): Promise<ChallengeRow[]> {
  const res = await supabase.rpc('list_challenges');
  return (unwrap(res) ?? []) as ChallengeRow[];
}

export async function joinChallenge(challengeId: string): Promise<void> {
  const res = await supabase.from('challenge_members').insert({ challenge_id: challengeId });
  if (res.error) throw new Error(res.error.message);
}

export async function leaveChallenge(challengeId: string, userId: string): Promise<void> {
  const res = await supabase
    .from('challenge_members')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('user_id', userId);
  if (res.error) throw new Error(res.error.message);
}

export async function getLeaderboard(challengeId: string): Promise<LeaderRow[]> {
  const res = await supabase.rpc('challenge_leaderboard', { p_challenge: challengeId });
  return (unwrap(res) ?? []) as LeaderRow[];
}
