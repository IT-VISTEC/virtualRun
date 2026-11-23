# VISTEC Virtual Run — API contract (migration 0005)

All RPCs: `supabase.rpc(name, params)`, authenticated only. Errors come back as `error.message` = the text below.
Common errors: `Not signed in`, `Admin only`.
Event window and settings: `app_settings` (readable): `reveal_distances bool, event_start date, event_end date, group_lock_at timestamptz` (membership locked when now() >= group_lock_at = 2026-12-01 00:00:00 Asia/Bangkok; admins exempt).
Teams: `MSE | ESE | BSE | IST | STAFF`. Ranks use standard `rank()` (ties share a rank; next rank skips).

## Runs — direct table access
Insert (client sends ONLY these):
```ts
supabase.from('runs').insert({ distance_km, duration_sec, image_path, image_sha256, note?, steps?, entry_type? })
```
- `image_path` = `<uid>/<uuid>.png` (upload to bucket `run-images` FIRST; the object must exist at insert time, and each photo path can back only one run); `image_sha256` = lowercase hex SHA-256 of the ORIGINAL file bytes.
- Set by trigger (client values ignored): `user_id` (auth.uid()), `ran_on` (today, Asia/Bangkok), `created_at` (now()), `status` (`pending` if distance_km > 20 or duration_sec/distance_km < 270, else `counted`), `flags` (`{}`; `duplicate_image` added to BOTH rows if another run has the same sha), `reviewed_*`.
- Insert errors: `Duration is required`, `A run photo is required` (also when the object was not uploaded), `Invalid image path`, `This photo is already used by another run` (or a unique violation on `runs_image_path_uniq` under a race), `Image hash is required`, `Runs can only be submitted during the event (YYYY-MM-DD to YYYY-MM-DD)` (admins exempt), check violations (distance must be > 0, no upper cap; steps must be > 0 if sent, no upper cap; sha must be 64 hex).
- Select: own runs only; columns incl. `status, flags, review_note, duration_sec`.
- Update: not allowed. Delete: own runs with `ran_on` = today (Bangkok) only (otherwise silently 0 rows).
- Derived on client: pace = duration_sec / distance_km (sec/km); steps = round(km / 0.00075) (display only).

## Profiles
Direct update of `display_name`, `avatar_url` still allowed. Changing `team`, `group_id`, `registered_at` directly raises `Team, group and registration can only be changed through the app`.
New columns: `team text|null`, `registered_at timestamptz|null` (null => show onboarding), `group_id uuid|null`.

## User RPCs
| RPC | Params | Returns | Errors |
|---|---|---|---|
| is_admin | – | boolean | |
| bkk_today | – | date | |
| complete_registration | p_display_name text, p_team text, p_avatar_url text | void | `Display name must be 1-60 characters`, `Invalid team`, `Team cannot be changed` (an admin changing own team here is audited) |
| my_summary | – | 1 row: total_km numeric, today_km numeric, steps bigint, active_days bigint, pending_count bigint (event window, counted only except pending_count) | |
| leaderboard_individual | – | rank bigint, user_id uuid, display_name text, avatar_url text, team text, is_me bool, total_km numeric\|null | |
| leaderboard_groups | – | rank bigint, group_id uuid, name text, avatar_url text, member_count bigint, is_mine bool, total_km numeric\|null | |
| leaderboard_teams | – | rank bigint, team text, member_count bigint, is_mine bool, total_km numeric\|null | |
| my_group | – | 0..4 rows: group_id, group_name, group_avatar_url, join_code, leader_id, member_id, member_name, member_avatar_url, member_team, member_km numeric, is_leader bool, is_me bool | |
| create_group | p_name text, p_avatar_url text | uuid | `Group membership is locked`, `Complete registration first`, `You are already in a group`, `Group name must be 1-40 characters` |
| join_group | p_code text | uuid | `Group membership is locked`, `Complete registration first`, `You are already in a group`, `Invalid join code`, `Group is full (max 4 members)`, `Group not found` (the group was disbanded while joining) |
| leave_group | – | void | `Group membership is locked`, `You are not in a group`, `Transfer leadership before leaving the group` (last member leaving disbands group) |
| remove_member | p_user_id uuid | void | `Group membership is locked`, `Only the group leader can do this`, `Use leave group instead`, `User is not in your group` |
| regenerate_join_code | – | text (new 8-char code) | `Only the group leader can do this` |
| transfer_leadership | p_user_id uuid | void | `Only the group leader can do this`, `User is not in your group` |
| update_group | p_name text, p_avatar_url text | void | `Only the group leader can do this`, `Group name must be 1-40 characters` |

`total_km` is null unless `reveal_distances` is true or caller is admin. Leaderboard individual/teams include only registered profiles. `is_mine` is false (never null) when the caller has no group/team.
While distances are hidden (non-admin, `reveal_distances` false), leaderboard ranks use only counted runs with `ran_on` before today (Bangkok); today's runs start counting toward rank the next day. `my_summary`, `my_group` and `admin_list_users` still include today's counted runs.
`create_group` / `join_group` raise `Complete registration first` when the caller's `registered_at` is null.

## Admin RPCs (all raise `Admin only` for non-admins; mutations write `audit_log`)
| RPC | Params | Returns | Errors |
|---|---|---|---|
| admin_list_users | – | user_id, email, display_name, team, group_id, group_name, registered_at, counted_km numeric, pending_count bigint, is_admin bool (same rule as `is_admin()`, never `auth.users.email`) | |
| admin_list_runs | p_status text = null, p_flagged_only bool = false | run_id, user_id, display_name, email, team, ran_on date, distance_km, duration_sec int, pace_sec_per_km numeric, image_path, image_sha256, status, flags text[], review_note, reviewed_at, created_at | |
| admin_set_run_status | p_run_id uuid, p_status text, p_note text = null | void | `Invalid status`, `Run not found` |
| admin_edit_run | p_run_id uuid, p_distance_km numeric, p_duration_sec int, p_note text = null | void | `Invalid distance`, `Invalid duration`, `Run not found` |
| admin_void_duplicate_pair | p_run_id_a uuid, p_run_id_b uuid, p_note text = null | void (both rejected) | `Choose two different runs`, `Run not found` |
| admin_set_reveal | p_reveal bool | void | |
| admin_set_team | p_user_id uuid, p_team text | void | `Invalid team`, `User not found` |
| admin_set_user_group | p_user_id uuid, p_group_id uuid\|null | void (null removes; ignores lock; old group disbanded if it becomes empty) | `User not found`, `User's group changed concurrently; please retry`, `Transfer leadership before moving the group leader`, `Group not found`, `Group is full (max 4 members)` |
| admin_delete_run | p_run_id uuid, p_note text = null | void | `Run not found` |

`audit_log` (admin select): id, actor uuid, action text, target text, before jsonb, after jsonb, at timestamptz.
Admins have no direct `select` on other users' `runs` rows: the admin UI reads runs through `admin_list_runs` (and changes them only through the admin RPCs).
Storage: admins can `createSignedUrl` for any object in `run-images`. Owners can delete only their own photos that no run references.
Legacy `challenge_leaderboard` is no longer callable by clients.
Admins: `public.admins(email, user_id)`; is_admin() matches user_id, else (while user_id is unbound) the email of the caller's Azure identity in `auth.identities` (never `auth.users.email`). The migration binds user_id from `auth.identities` for any admin who has already signed in with Azure. The Supabase Azure provider must use the VISTEC tenant URL (single-tenant).
