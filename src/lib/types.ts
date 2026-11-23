// Shared data types for the event (migration 0005). Runtime-free except TEAMS.

export type Team = 'MSE' | 'ESE' | 'BSE' | 'IST' | 'STAFF';
export const TEAMS: readonly Team[] = ['MSE', 'ESE', 'BSE', 'IST', 'STAFF'];

export type RunStatus = 'counted' | 'pending' | 'rejected';
export const RUN_STATUSES: readonly RunStatus[] = ['counted', 'pending', 'rejected'];

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  /** id of the chibi preset (e.g. 'chibi-3') when the avatar was composed from one; lets the UI show the transparent cut-out */
  avatar_chibi?: string | null;
  team: Team | null;
  /** null => onboarding not finished */
  registered_at: string | null;
  group_id: string | null;
};

/** One of the caller's own runs (table `runs`). */
export type Run = {
  id: string;
  ran_on: string; // YYYY-MM-DD (Bangkok)
  distance_km: number;
  duration_sec: number | null; // null only on legacy rows
  steps: number | null;
  entry_type: 'km' | 'steps';
  note: string | null;
  image_path: string | null;
  image_sha256: string | null;
  status: RunStatus;
  flags: string[]; // e.g. ['duplicate_image']
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/** Values the client sends when inserting a run (everything else is set by the server). */
export type NewRun = {
  distance_km: number;
  duration_sec: number;
  image_path: string;
  image_sha256: string;
  note?: string | null;
};

export type Summary = {
  total_km: number;
  today_km: number;
  steps: number;
  active_days: number;
  pending_count: number;
};

export type LeaderIndividual = {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  team: Team | null;
  is_me: boolean;
  /** null while distances are hidden */
  total_km: number | null;
};

export type LeaderGroup = {
  rank: number;
  group_id: string;
  name: string;
  avatar_url: string | null;
  member_count: number;
  is_mine: boolean;
  total_km: number | null;
};

export type LeaderTeam = {
  rank: number;
  team: Team;
  member_count: number;
  is_mine: boolean;
  total_km: number | null;
};

/** Raw row of rpc my_group (one row per member; leader first). */
export type GroupMemberRow = {
  group_id: string;
  group_name: string;
  group_avatar_url: string | null;
  join_code: string;
  leader_id: string;
  member_id: string;
  member_name: string;
  member_avatar_url: string | null;
  member_team: Team | null;
  member_km: number;
  is_leader: boolean;
  is_me: boolean;
};

export type GroupMember = {
  id: string;
  name: string;
  avatar_url: string | null;
  team: Team | null;
  km: number;
  is_leader: boolean;
  is_me: boolean;
};

/** my_group rows folded into one object. */
export type MyGroup = {
  id: string;
  name: string;
  avatar_url: string | null;
  join_code: string;
  leader_id: string;
  /** true when the caller is the leader */
  i_am_leader: boolean;
  members: GroupMember[];
};

export type AdminUser = {
  user_id: string;
  email: string | null;
  display_name: string;
  team: Team | null;
  group_id: string | null;
  group_name: string | null;
  registered_at: string | null;
  counted_km: number;
  pending_count: number;
  is_admin: boolean;
};

export type AdminRun = {
  run_id: string;
  user_id: string;
  display_name: string;
  email: string | null;
  team: Team | null;
  ran_on: string;
  distance_km: number;
  duration_sec: number | null;
  pace_sec_per_km: number | null;
  image_path: string | null;
  image_sha256: string | null;
  status: RunStatus;
  flags: string[];
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type AppSettings = {
  reveal_distances: boolean;
  event_start: string; // YYYY-MM-DD
  event_end: string; // YYYY-MM-DD
  group_lock_at: string; // ISO timestamp
};

export type AuditEntry = {
  id: number;
  actor: string | null;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  at: string;
};
