import { supabase } from './supabase';
import type {
  AdminRun,
  AdminUser,
  AppSettings,
  AuditEntry,
  GroupMemberRow,
  LeaderGroup,
  LeaderIndividual,
  LeaderTeam,
  MyGroup,
  NewRun,
  Profile,
  Run,
  RunStatus,
  Summary,
  Team,
} from './types';
import { kmToSteps } from './format';

export * from './types';

// Contract: supabase/API.md (migration 0005). Every wrapper throws Error(server message).

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };

function unwrap<T>(res: Res<T>): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

async function rpc<T>(fn: string, params?: Record<string, unknown>): Promise<T> {
  return unwrap((await supabase.rpc(fn, params)) as Res<T>);
}

async function rows<T>(fn: string, params?: Record<string, unknown>): Promise<T[]> {
  return (await rpc<T[] | null>(fn, params)) ?? [];
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('Please sign in again.');
  return data.user.id;
}

// ───────── Profile ─────────

const PROFILE_COLS = 'id, display_name, avatar_url, team, registered_at, group_id';
const PROFILE_COLS_CHIBI = `${PROFILE_COLS}, avatar_chibi`;
const isMissingColumn = (m: string) => /avatar_chibi/i.test(m) && /(column|schema cache)/i.test(m);

export async function getProfile(userId: string): Promise<Profile | null> {
  let res = await supabase.from('profiles').select(PROFILE_COLS_CHIBI).eq('id', userId).maybeSingle();
  // Before migration 0006 is applied the column does not exist: fall back so the app keeps working.
  if (res.error && isMissingColumn(res.error.message)) {
    res = (await supabase.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle()) as typeof res;
  }
  if (res.error) throw new Error(res.error.message);
  return (res.data as unknown as Profile | null) ?? null;
}

export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  const res = await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId);
  if (res.error) throw new Error(res.error.message);
}

/** chibiId = preset the avatar was composed from ('chibi-1'..'chibi-10'), or null for custom/reset. */
export async function updateAvatarUrl(userId: string, avatarUrl: string | null, chibiId: string | null = null): Promise<void> {
  let res = await supabase.from('profiles').update({ avatar_url: avatarUrl, avatar_chibi: chibiId }).eq('id', userId);
  if (res.error && isMissingColumn(res.error.message)) {
    res = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId);
  }
  if (res.error) throw new Error(res.error.message);
}

// ───────── Settings ─────────

export async function getAppSettings(): Promise<AppSettings> {
  const res = await supabase
    .from('app_settings')
    .select('reveal_distances, event_start, event_end, group_lock_at')
    .eq('id', 1)
    .single();
  return unwrap(res as Res<AppSettings>);
}

/** Today's date (YYYY-MM-DD) in Asia/Bangkok according to the server. */
export function bkkToday(): Promise<string> {
  return rpc<string>('bkk_today');
}

export function isAdmin(): Promise<boolean> {
  return rpc<boolean>('is_admin').then(Boolean);
}

// ───────── Registration ─────────

export function completeRegistration(displayName: string, team: Team, avatarUrl: string | null): Promise<void> {
  return rpc<void>('complete_registration', { p_display_name: displayName, p_team: team, p_avatar_url: avatarUrl });
}

// ───────── Runs (own) ─────────

const RUN_COLS =
  'id, ran_on, distance_km, duration_sec, steps, entry_type, note, image_path, image_sha256, status, flags, review_note, reviewed_at, created_at';

function normRun(r: Run): Run {
  return { ...r, distance_km: num(r.distance_km), flags: r.flags ?? [] };
}

/** Own runs, newest first. */
export async function listRuns(limit = 500): Promise<Run[]> {
  const res = await supabase
    .from('runs')
    .select(RUN_COLS)
    .order('ran_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((unwrap(res as Res<Run[]>) ?? []) as Run[]).map(normRun);
}

/** Insert a run whose photo is already uploaded. Returns the created row (status set by server). */
export async function insertRun(run: NewRun): Promise<Run> {
  const steps = kmToSteps(run.distance_km);
  const res = await supabase
    .from('runs')
    .insert({
      distance_km: run.distance_km,
      duration_sec: run.duration_sec,
      image_path: run.image_path,
      image_sha256: run.image_sha256,
      note: run.note ?? null,
      entry_type: 'km',
      ...(steps > 0 ? { steps } : {}),
    })
    .select(RUN_COLS)
    .single();
  if (res.error) {
    const msg = res.error.message.includes('runs_image_path_uniq')
      ? 'This photo is already used by another run'
      : res.error.message;
    throw new Error(msg);
  }
  return normRun(res.data as Run);
}

/**
 * Full submit flow: upload PNG to run-images, insert the run, remove the photo if the insert fails.
 * `sha256` must be the hex SHA-256 of the ORIGINAL file bytes (see sha256Hex in ./image).
 */
export async function submitRun(
  run: { distance_km: number; duration_sec: number; note?: string | null },
  png: Blob,
  sha256: string,
): Promise<Run> {
  const image_path = await uploadRunPhoto(png);
  try {
    return await insertRun({ ...run, image_path, image_sha256: sha256 });
  } catch (err) {
    await removeRunPhoto(image_path).catch(() => {});
    throw err;
  }
}

/**
 * Delete an own run (server allows only runs dated today, Bangkok). Removes its photo afterwards.
 * Throws if nothing was deleted.
 */
export async function deleteRun(id: string, imagePath?: string | null): Promise<void> {
  const res = await supabase.from('runs').delete().eq('id', id).select('id');
  if (res.error) throw new Error(res.error.message);
  if (!res.data || res.data.length === 0) throw new Error('Only today’s runs can be deleted.');
  if (imagePath) await removeRunPhoto(imagePath).catch(() => {});
}

// ───────── Storage (bucket run-images) ─────────

export const RUN_BUCKET = 'run-images';

/** Upload a PNG to `${uid}/${uuid}.png`; returns the object path. */
export async function uploadRunPhoto(png: Blob): Promise<string> {
  const uid = await currentUserId();
  const path = `${uid}/${crypto.randomUUID()}.png`;
  const up = await supabase.storage.from(RUN_BUCKET).upload(path, png, { contentType: 'image/png', upsert: false });
  if (up.error) throw new Error(`Image upload failed: ${up.error.message}`);
  return path;
}

export async function removeRunPhoto(path: string): Promise<void> {
  const res = await supabase.storage.from(RUN_BUCKET).remove([path]);
  if (res.error) throw new Error(res.error.message);
}

/** Signed URLs (default 1 h) keyed by object path. Missing/forbidden paths are omitted. */
export async function signedUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const res = await supabase.storage.from(RUN_BUCKET).createSignedUrls(unique, expiresIn);
  if (res.error) throw new Error(res.error.message);
  const out: Record<string, string> = {};
  for (const r of res.data) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
  return out;
}

// ───────── Summary & leaderboards ─────────

export async function mySummary(): Promise<Summary> {
  const r = (await rows<Record<string, unknown>>('my_summary'))[0] ?? {};
  return {
    total_km: num(r.total_km),
    today_km: num(r.today_km),
    steps: num(r.steps),
    active_days: num(r.active_days),
    pending_count: num(r.pending_count),
  };
}

export async function leaderboardIndividual(): Promise<LeaderIndividual[]> {
  return (await rows<LeaderIndividual>('leaderboard_individual')).map((r) => ({
    ...r,
    rank: num(r.rank),
    total_km: numOrNull(r.total_km),
  }));
}

export async function leaderboardGroups(): Promise<LeaderGroup[]> {
  return (await rows<LeaderGroup>('leaderboard_groups')).map((r) => ({
    ...r,
    rank: num(r.rank),
    member_count: num(r.member_count),
    total_km: numOrNull(r.total_km),
  }));
}

export async function leaderboardTeams(): Promise<LeaderTeam[]> {
  return (await rows<LeaderTeam>('leaderboard_teams')).map((r) => ({
    ...r,
    rank: num(r.rank),
    member_count: num(r.member_count),
    total_km: numOrNull(r.total_km),
  }));
}

// ───────── Groups ─────────

/** Raw my_group rows (0..4). */
export async function myGroup(): Promise<GroupMemberRow[]> {
  return (await rows<GroupMemberRow>('my_group')).map((r) => ({ ...r, member_km: num(r.member_km) }));
}

/** my_group folded into one object, or null when the caller has no group. */
export async function getMyGroup(): Promise<MyGroup | null> {
  const list = await myGroup();
  if (list.length === 0) return null;
  const g = list[0];
  return {
    id: g.group_id,
    name: g.group_name,
    avatar_url: g.group_avatar_url,
    join_code: g.join_code,
    leader_id: g.leader_id,
    i_am_leader: list.some((m) => m.is_me && m.is_leader),
    members: list.map((m) => ({
      id: m.member_id,
      name: m.member_name,
      avatar_url: m.member_avatar_url,
      team: m.member_team,
      km: m.member_km,
      is_leader: m.is_leader,
      is_me: m.is_me,
    })),
  };
}

/** Returns true if the group name is valid and not already taken (case-insensitive). */
export function isGroupNameAvailable(name: string): Promise<boolean> {
  return rpc<boolean>('is_group_name_available', { p_name: name }).then(Boolean);
}

/** Returns the new group id. */
export function createGroup(name: string, avatarUrl: string | null): Promise<string> {
  return rpc<string>('create_group', { p_name: name, p_avatar_url: avatarUrl });
}

/** Returns the joined group id. */
export function joinGroup(code: string): Promise<string> {
  return rpc<string>('join_group', { p_code: code.trim().toUpperCase() });
}

export function leaveGroup(): Promise<void> {
  return rpc<void>('leave_group');
}

export function removeMember(userId: string): Promise<void> {
  return rpc<void>('remove_member', { p_user_id: userId });
}

/** Returns the new 8-char join code. */
export function regenerateJoinCode(): Promise<string> {
  return rpc<string>('regenerate_join_code');
}

export function transferLeadership(userId: string): Promise<void> {
  return rpc<void>('transfer_leadership', { p_user_id: userId });
}

export function updateGroup(name: string, avatarUrl: string | null): Promise<void> {
  return rpc<void>('update_group', { p_name: name, p_avatar_url: avatarUrl });
}

// ───────── Admin ─────────

export async function adminListUsers(): Promise<AdminUser[]> {
  return (await rows<AdminUser>('admin_list_users')).map((u) => ({
    ...u,
    counted_km: num(u.counted_km),
    pending_count: num(u.pending_count),
  }));
}

export async function adminListRuns(opts: { status?: RunStatus | null; flaggedOnly?: boolean } = {}): Promise<AdminRun[]> {
  return (
    await rows<AdminRun>('admin_list_runs', { p_status: opts.status ?? null, p_flagged_only: opts.flaggedOnly ?? false })
  ).map((r) => ({
    ...r,
    distance_km: num(r.distance_km),
    pace_sec_per_km: numOrNull(r.pace_sec_per_km),
    flags: r.flags ?? [],
  }));
}

export function adminSetRunStatus(runId: string, status: RunStatus, note: string | null = null): Promise<void> {
  return rpc<void>('admin_set_run_status', { p_run_id: runId, p_status: status, p_note: note });
}

export function adminEditRun(runId: string, distanceKm: number, durationSec: number, note: string | null = null): Promise<void> {
  return rpc<void>('admin_edit_run', {
    p_run_id: runId,
    p_distance_km: distanceKm,
    p_duration_sec: durationSec,
    p_note: note,
  });
}

/** Rejects both runs. */
export function adminVoidDuplicatePair(runIdA: string, runIdB: string, note: string | null = null): Promise<void> {
  return rpc<void>('admin_void_duplicate_pair', { p_run_id_a: runIdA, p_run_id_b: runIdB, p_note: note });
}

export function adminSetReveal(reveal: boolean): Promise<void> {
  return rpc<void>('admin_set_reveal', { p_reveal: reveal });
}

export function adminSetTeam(userId: string, team: Team): Promise<void> {
  return rpc<void>('admin_set_team', { p_user_id: userId, p_team: team });
}

/** groupId null removes the user from their group. */
export function adminSetUserGroup(userId: string, groupId: string | null): Promise<void> {
  return rpc<void>('admin_set_user_group', { p_user_id: userId, p_group_id: groupId });
}

export function adminDeleteRun(runId: string, note: string | null = null): Promise<void> {
  return rpc<void>('admin_delete_run', { p_run_id: runId, p_note: note });
}

/** Latest audit entries (admins only via RLS). */
export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  const res = await supabase
    .from('audit_log')
    .select('id, actor, action, target, before, after, at')
    .order('at', { ascending: false })
    .limit(limit);
  return (unwrap(res as Res<AuditEntry[]>) ?? []) as AuditEntry[];
}

/** Groups for admin pickers (admins can read all groups via leaderboard_groups). */
export async function adminListGroups(): Promise<{ id: string; name: string; member_count: number }[]> {
  return (await leaderboardGroups()).map((g) => ({ id: g.group_id, name: g.name, member_count: g.member_count }));
}
