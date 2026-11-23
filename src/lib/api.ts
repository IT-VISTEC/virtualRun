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
  image_path: string | null;
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

export async function updateAvatarUrl(userId: string, avatarUrl: string | null): Promise<void> {
  const res = await supabase.from('profiles').upsert({ id: userId, avatar_url: avatarUrl });
  if (res.error) throw new Error(res.error.message);
}

export async function listRuns(limit = 500): Promise<Run[]> {
  const res = await supabase
    .from('runs')
    .select('id, ran_on, distance_km, duration_min, elevation_m, steps, entry_type, note, image_path')
    .order('ran_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrap(res) ?? [];
}

const BUCKET = 'run-images';

/** บันทึกการวิ่ง พร้อมรูป PNG (ถ้ามี): อัปโหลดรูปก่อน ถ้าบันทึกแถวไม่สำเร็จจะลบรูปทิ้ง */
export async function addRun(run: NewRun, image?: Blob | null): Promise<void> {
  let image_path: string | null = null;
  if (image) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new Error('Please sign in again.');
    image_path = `${data.user.id}/${crypto.randomUUID()}.png`;
    const up = await supabase.storage.from(BUCKET).upload(image_path, image, { contentType: 'image/png', upsert: false });
    if (up.error) throw new Error(`Image upload failed: ${up.error.message}`);
  }
  const res = await supabase.from('runs').insert({ ...run, image_path });
  if (res.error) {
    if (image_path) await supabase.storage.from(BUCKET).remove([image_path]);
    throw new Error(res.error.message);
  }
}

export async function deleteRun(id: string, imagePath?: string | null): Promise<void> {
  const res = await supabase.from('runs').delete().eq('id', id);
  if (res.error) throw new Error(res.error.message);
  if (imagePath) await supabase.storage.from(BUCKET).remove([imagePath]);
}

/** ลิงก์ชั่วคราว (1 ชม.) สำหรับดูรูปใน bucket แบบ private */
export async function getImageUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const res = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (res.error) throw new Error(res.error.message);
  const out: Record<string, string> = {};
  for (const r of res.data) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
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
