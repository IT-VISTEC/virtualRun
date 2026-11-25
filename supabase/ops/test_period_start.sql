-- TEST PERIOD on the real project: open the event from today (24 Nov 2026) to 30 Nov 2026.
-- Run in the Supabase SQL editor. Undo with test_period_end.sql BEFORE 1 Dec 2026.
-- Requires migration 0010 (photo-date flag) if you want to test that too.

update public.app_settings
set event_start      = '2026-11-24',
    event_end        = '2026-11-30',
    group_lock_at    = '2026-11-30 23:59:59+07',  -- groups stay editable during the test
    reveal_distances = false
where id = 1;

select event_start, event_end, group_lock_at, reveal_distances, public.bkk_today() as today_bangkok
from public.app_settings where id = 1;
