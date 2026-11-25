-- END OF TEST PERIOD: wipe all test runs and restore the real event dates.
-- Run in the Supabase SQL editor on 30 Nov 2026 (any time before 1 Dec 00:00 Bangkok).
--
-- Keeps: accounts, profiles (name, team, avatar), groups and group members, admins, PIN setting.
-- Removes: every run dated before 1 Dec (all test runs) and the test-period run review audit entries.
--
-- Photos: Supabase does not allow deleting Storage files from SQL. After running this, open
--   Dashboard → Storage → run-images, select all folders and Delete.
--   (Before 1 Dec the bucket only holds test photos, so emptying it is safe.)

begin;

-- 1) What will be removed (check the numbers before COMMIT)
select count(*) as test_runs, count(distinct user_id) as runners, min(ran_on), max(ran_on)
from public.runs where ran_on < '2026-12-01';

-- 2) Remove test runs (leaderboard, achievements, streaks and totals are computed from runs, so they reset too)
delete from public.runs where ran_on < '2026-12-01';

-- 3) Remove audit entries about test runs (keep settings/user changes for the record)
delete from public.audit_log where action like 'run.%' and at < '2026-12-01 00:00:00+07';

-- 4) Restore the real event
update public.app_settings
set event_start      = '2026-12-01',
    event_end        = '2026-12-15',
    group_lock_at    = '2026-12-01 00:00:00+07',
    reveal_distances = false
where id = 1;

select event_start, event_end, group_lock_at, reveal_distances,
       (select count(*) from public.runs) as runs_left
from public.app_settings where id = 1;

commit;
-- If the numbers in step 1 look wrong, run ROLLBACK instead of letting it reach COMMIT
-- (in the SQL editor: run steps one at a time, or replace "commit" with "rollback" first).
