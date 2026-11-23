import { FormEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  AppSettings,
  GroupMember,
  LeaderGroup,
  LeaderTeam,
  MyGroup,
  createGroup,
  getAppSettings,
  getMyGroup,
  isGroupNameAvailable,
  joinGroup,
  leaderboardGroups,
  leaderboardTeams,
  leaveGroup,
  regenerateJoinCode,
  removeMember,
  transferLeadership,
  updateGroup,
} from '../lib/api';
import { AVATAR_BG_COLORS, CHIBI_AVATARS, DEFAULT_AVATAR_BG, composeChibiAvatar, getDefaultAvatar } from '../lib/avatars';
import { fmtKm } from '../lib/format';
import { Icon } from '../components/Icons';
import './Team.css';

const MAX_MEMBERS = 4;
const NAME_MAX = 40;
const CODE_LEN = 8;

// ───────── helpers ─────────

function fmtLock(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function timeLeft(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'} left`;
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return `${m} minute${m === 1 ? '' : 's'} left`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const errText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.');

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
    </svg>
  );
}

// ───────── accessible dialog ─────────

function Dialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>('button, input');
    first?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab' && boxRef.current) {
        const items = Array.from(
          boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        ref={boxRef}
        className="modal tm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function AvatarPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const [bgColor, setBgColor] = useState<string>(DEFAULT_AVATAR_BG);
  const [selectedUrl, setSelectedUrl] = useState<string>(() =>
    CHIBI_AVATARS.find((c) => c.url === value)?.url || CHIBI_AVATARS[0].url,
  );

  async function apply(chibiUrl: string, color: string) {
    setSelectedUrl(chibiUrl);
    setBgColor(color);
    try {
      const composed = await composeChibiAvatar(chibiUrl, color);
      onChange(composed);
    } catch {
      onChange(chibiUrl);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="muted small" style={{ marginRight: 4 }}>Background:</span>
        {AVATAR_BG_COLORS.map((b) => {
          const active = bgColor.toLowerCase() === b.color.toLowerCase();
          return (
            <button
              key={b.id}
              type="button"
              title={b.label}
              aria-label={`Background ${b.label}`}
              disabled={disabled}
              onClick={() => void apply(selectedUrl, b.color)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: b.color,
                border: active ? '2px solid var(--ink)' : '1px solid rgba(0,0,0,0.18)',
                boxShadow: active ? '0 0 0 2px var(--accent)' : 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          );
        })}
      </div>
      <div className="tm-avatars" role="radiogroup" aria-label={label}>
        {CHIBI_AVATARS.map((c) => {
          const on = selectedUrl === c.url || value === c.url;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={c.label}
              title={c.label}
              className={on ? 'on' : ''}
              style={{ background: bgColor, transition: 'background-color .15s ease' }}
              disabled={disabled}
              onClick={() => void apply(c.url, bgColor)}
            >
              <img src={c.url} alt="" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────── page ─────────

type DialogState =
  | { kind: 'leave' }
  | { kind: 'regen' }
  | { kind: 'edit' }
  | { kind: 'member'; member: GroupMember }
  | { kind: 'remove'; member: GroupMember }
  | { kind: 'transfer'; member: GroupMember };

type Flash = { kind: 'ok' | 'err'; text: string } | null;

export default function Team() {
  const { profile, isAdmin, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [group, setGroup] = useState<MyGroup | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [teams, setTeams] = useState<LeaderTeam[] | null>(null);
  const [groups, setGroups] = useState<LeaderGroup[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [flash, setFlash] = useState<Flash>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogErr, setDialogErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [g, s, t, gs] = await Promise.allSettled([getMyGroup(), getAppSettings(), leaderboardTeams(), leaderboardGroups()]);
    if (g.status === 'fulfilled') {
      setGroup(g.value);
      setLoadErr(null);
    } else {
      setLoadErr(errText(g.reason));
    }
    if (s.status === 'fulfilled') setSettings(s.value);
    if (t.status === 'fulfilled') setTeams(t.value);
    if (gs.status === 'fulfilled') setGroups(gs.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const lockAt = settings ? new Date(settings.group_lock_at).getTime() : null;
  const lockPassed = lockAt != null && now >= lockAt;
  const locked = lockPassed && !isAdmin; // admins are exempt server-side

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDialogErr(null);
  }, []);

  /** Run a mutation from inside a dialog; closes it and reloads on success. */
  async function act(fn: () => Promise<unknown>, okText: string, membershipChanged = false) {
    setBusy(true);
    setDialogErr(null);
    try {
      await fn();
      setDialog(null);
      setFlash({ kind: 'ok', text: okText });
      await load();
      if (membershipChanged) await refreshProfile();
    } catch (err) {
      setDialogErr(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!group) return;
    const ok = await copyText(group.join_code);
    if (ok) setCopied(true);
    else setFlash({ kind: 'err', text: 'Could not copy. Select the code and copy it manually.' });
  }

  const myTeamRow = teams?.find((t) => t.is_mine) ?? (profile?.team ? teams?.find((t) => t.team === profile.team) : undefined);
  const myGroupRow = groups?.find((g) => g.is_mine);

  return (
    <div className="page tm">
      <header className="page-head reveal">
        <div>
          <h1>Group &amp; Team</h1>
          <p className="muted">Every counted km you run adds to your group and your team.</p>
        </div>
      </header>

      {settings && (
        <LockNotice lockAtIso={settings.group_lock_at} lockPassed={lockPassed} isAdmin={isAdmin} msLeft={(lockAt ?? 0) - now} />
      )}

      {flash && (
        <div className={`${flash.kind === 'ok' ? 'ok' : 'alert'} tm-flash`} role={flash.kind === 'ok' ? 'status' : 'alert'}>
          <span>{flash.text}</span>
          <button type="button" className="tm-icon-btn" aria-label="Dismiss message" onClick={() => setFlash(null)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <div className="tm-grid">
        <div className="tm-main">
          {loading ? (
            <section className="card tm-skeleton reveal" aria-busy="true" aria-label="Loading your group">
              <div className="tm-sk tm-sk-head" />
              <div className="tm-sk" />
              <div className="tm-sk" />
              <div className="tm-sk" />
            </section>
          ) : loadErr ? (
            <section className="card reveal">
              <h2>My group</h2>
              <p className="alert" role="alert">Could not load your group: {loadErr}</p>
              <button type="button" className="btn-ghost" onClick={() => { setLoading(true); void load(); }}>
                <Icon name="refresh" size={18} /> Try again
              </button>
            </section>
          ) : group ? (
            <GroupCard
              group={group}
              rankRow={myGroupRow}
              groupCount={groups?.length ?? null}
              locked={locked}
              copied={copied}
              onCopy={onCopy}
              onEdit={() => setDialog({ kind: 'edit' })}
              onRegen={() => setDialog({ kind: 'regen' })}
              onLeave={() => setDialog({ kind: 'leave' })}
              onMember={(m) => setDialog({ kind: 'member', member: m })}
            />
          ) : (
            <NoGroup
              locked={locked}
              registered={!!profile?.registered_at}
              onDone={async (text) => {
                setFlash({ kind: 'ok', text });
                await load();
                await refreshProfile();
              }}
            />
          )}
        </div>

        <aside className="tm-side">
          <TeamCard team={profile?.team ?? null} row={myTeamRow} all={teams} />
        </aside>
      </div>

      {/* ───── dialogs ───── */}
      {dialog?.kind === 'member' && group && (
        <Dialog title="Manage member" onClose={closeDialog} busy={busy}>
          <div className="tm-sheet-head">
            <img src={dialog.member.avatar_url || getDefaultAvatar(dialog.member.id)} alt="" />
            <div>
              <strong>{dialog.member.name}</strong>
              <span className="muted small">
                {dialog.member.team ?? 'No team'} · {fmtKm(dialog.member.km)} km
              </span>
            </div>
          </div>
          <div className="tm-sheet-actions">
            <button type="button" className="btn-ghost" data-autofocus onClick={() => setDialog({ kind: 'transfer', member: dialog.member })}>
              <Icon name="award" size={18} /> Make group leader
            </button>
            <button
              type="button"
              className="btn-ghost tm-danger"
              disabled={locked}
              onClick={() => setDialog({ kind: 'remove', member: dialog.member })}
            >
              <Icon name="trash" size={18} /> Remove from group
            </button>
            {locked && <p className="muted small">Removing members is closed because groups are locked.</p>}
            <button type="button" className="btn-link" onClick={closeDialog}>Cancel</button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'transfer' && (
        <Dialog title="Make group leader?" onClose={closeDialog} busy={busy}>
          <p className="tm-modal-text">
            <strong>{dialog.member.name}</strong> will become the leader. You will stay in the group as a member and lose
            the leader tools.
          </p>
          {dialogErr && <p className="alert" role="alert">{dialogErr}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={closeDialog} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="btn-accent"
              data-autofocus
              disabled={busy}
              onClick={() => act(() => transferLeadership(dialog.member.id), `${dialog.member.name} is now the group leader.`)}
            >
              {busy ? 'Saving…' : 'Make leader'}
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'remove' && (
        <Dialog title="Remove member?" onClose={closeDialog} busy={busy}>
          <p className="tm-modal-text">
            <strong>{dialog.member.name}</strong> will leave the group. Their km will no longer count for the group.
          </p>
          {dialogErr && <p className="alert" role="alert">{dialogErr}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" data-autofocus onClick={closeDialog} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="btn-ghost tm-danger-solid"
              disabled={busy}
              onClick={() => act(() => removeMember(dialog.member.id), `${dialog.member.name} was removed from the group.`)}
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'regen' && (
        <Dialog title="New join code?" onClose={closeDialog} busy={busy}>
          <p className="tm-modal-text">The current code stops working right away. Anyone you shared it with will need the new one.</p>
          {dialogErr && <p className="alert" role="alert">{dialogErr}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={closeDialog} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="btn-accent"
              data-autofocus
              disabled={busy}
              onClick={() => act(() => regenerateJoinCode(), 'New join code created.')}
            >
              {busy ? 'Creating…' : 'New code'}
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'leave' && group && (
        <LeaveDialog group={group} busy={busy} err={dialogErr} onClose={closeDialog}
          onConfirm={() => act(() => leaveGroup(), group.members.length <= 1 ? 'You left, so the group was closed.' : 'You left the group.', true)} />
      )}

      {dialog?.kind === 'edit' && group && (
        <EditGroupDialog group={group} busy={busy} err={dialogErr} onClose={closeDialog}
          onSave={(name, avatar) => act(() => updateGroup(name, avatar), 'Group updated.')} />
      )}
    </div>
  );
}

// ───────── lock notice ─────────

function LockNotice({ lockAtIso, lockPassed, isAdmin, msLeft }: { lockAtIso: string; lockPassed: boolean; isAdmin: boolean; msLeft: number }) {
  const when = fmtLock(lockAtIso);
  if (lockPassed) {
    return (
      <div className="tm-lock locked reveal" role="note">
        <Icon name="lock" size={18} />
        <p>
          <strong>Groups are locked</strong> since {when} (Bangkok). Members can no longer create, join, leave or be removed.
          {isAdmin && <span className="muted"> As an admin you are exempt.</span>}
        </p>
      </div>
    );
  }
  return (
    <div className="tm-lock reveal" role="note">
      <Icon name="clock" size={18} />
      <p>
        Group changes close on <strong>{when}</strong> (Bangkok) <span className="tm-lock-left">· {timeLeft(msLeft)}</span>
      </p>
    </div>
  );
}

// ───────── group card ─────────

function GroupCard({
  group,
  rankRow,
  groupCount,
  locked,
  copied,
  onCopy,
  onEdit,
  onRegen,
  onLeave,
  onMember,
}: {
  group: MyGroup;
  rankRow: LeaderGroup | undefined;
  groupCount: number | null;
  locked: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onRegen: () => void;
  onLeave: () => void;
  onMember: (m: GroupMember) => void;
}) {
  const leader = group.i_am_leader;
  const count = group.members.length;
  const full = count >= MAX_MEMBERS;
  const totalKm = group.members.reduce((a, m) => a + m.km, 0);
  const openSlots = Math.max(0, MAX_MEMBERS - count);
  const leaderMustTransfer = leader && count > 1;

  return (
    <section className="card tm-group reveal" aria-labelledby="tm-group-name">
      <div className="tm-ghead">
        <img className="tm-gavatar" src={group.avatar_url || getDefaultAvatar(group.id)} alt="" />
        <div className="tm-gtitle">
          <span className="tm-eyebrow">My group</span>
          <h2 id="tm-group-name">{group.name}</h2>
          <span className="muted small">
            {count} of {MAX_MEMBERS} members{leader ? ' · You are the leader' : ''}
          </span>
        </div>
        {leader && (
          <button type="button" className="btn-ghost tm-edit" onClick={onEdit} aria-label="Edit group name and avatar">
            <Icon name="edit" size={18} /><span className="tm-edit-label">Edit</span>
          </button>
        )}
      </div>

      <div className="tm-stats">
        <div>
          <span className="muted small">Group km</span>
          <strong>{fmtKm(totalKm)}<small> km</small></strong>
        </div>
        <div>
          <span className="muted small">Group rank</span>
          <strong>
            {rankRow ? <>#{rankRow.rank}{groupCount ? <small> of {groupCount}</small> : null}</> : '–'}
          </strong>
        </div>
      </div>

      <div>
        <h3 className="tm-subhead">Members</h3>
        <ul className="tm-members">
          {group.members.map((m) => (
            <li key={m.id} className={m.is_me ? 'me' : ''}>
              <img className="tm-mavatar" src={m.avatar_url || getDefaultAvatar(m.id)} alt="" />
              <div className="tm-minfo">
                <span className="tm-mname">
                  {m.name}
                  {m.is_me && <span className="tm-you">You</span>}
                </span>
                <span className="tm-mmeta">
                  {m.team && <span className="team-tag">{m.team}</span>}
                  {m.is_leader && (
                    <span className="tm-badge"><Icon name="award" size={13} strokeWidth={2.4} /> Leader</span>
                  )}
                </span>
              </div>
              <span className="tm-mkm">{fmtKm(m.km)}<small> km</small></span>
              {leader && !m.is_me ? (
                <button type="button" className="tm-icon-btn" aria-label={`Manage ${m.name}`} onClick={() => onMember(m)}>
                  <MoreIcon />
                </button>
              ) : leader ? (
                <span className="tm-icon-spacer" aria-hidden="true" />
              ) : null}
            </li>
          ))}
          {!locked &&
            Array.from({ length: openSlots }, (_, i) => (
              <li key={`open-${i}`} className="tm-open" aria-label="Open spot">
                <span className="tm-mavatar tm-open-dot" aria-hidden="true"><Icon name="plus" size={18} /></span>
                <span className="muted small">Open spot · share the join code</span>
              </li>
            ))}
        </ul>
        <p className="muted small tm-note">Members can see each other&apos;s counted km, including today&apos;s runs.</p>
      </div>

      <div className="tm-invite">
        <div className="tm-invite-text">
          <span className="tm-eyebrow">Join code</span>
          {locked ? (
            <span className="muted small">Joining is closed. Groups are locked.</span>
          ) : full ? (
            <span className="muted small">Group is full ({MAX_MEMBERS}/{MAX_MEMBERS}).</span>
          ) : (
            <span className="muted small">Share it with up to {openSlots} more {openSlots === 1 ? 'person' : 'people'}.</span>
          )}
        </div>
        {!locked && (
          <div className="tm-code-row">
            <code className="tm-code" aria-label={`Join code ${group.join_code.split('').join(' ')}`}>{group.join_code}</code>
            <button type="button" className="btn-ghost tm-sm" onClick={onCopy}>
              <Icon name={copied ? 'check' : 'copy'} size={17} /> {copied ? 'Copied' : 'Copy'}
            </button>
            {leader && (
              <button type="button" className="btn-ghost tm-sm" onClick={onRegen} aria-label="Create a new join code">
                <Icon name="refresh" size={17} /> New code
              </button>
            )}
          </div>
        )}
        <span className="tm-sr" aria-live="polite">{copied ? 'Join code copied' : ''}</span>
      </div>

      <div className="tm-leave">
        <button
          type="button"
          className="btn-ghost tm-danger"
          onClick={onLeave}
          disabled={locked || leaderMustTransfer}
          aria-describedby={locked || leaderMustTransfer ? 'tm-leave-hint' : undefined}
        >
          <Icon name="logout" size={18} /> Leave group
        </button>
        {(locked || leaderMustTransfer) && (
          <p id="tm-leave-hint" className="muted small">
            {locked
              ? 'Leaving is closed because groups are locked.'
              : 'As the leader, make another member leader before you leave (use the ••• button next to their name).'}
          </p>
        )}
      </div>
    </section>
  );
}

function LeaveDialog({
  group,
  busy,
  err,
  onClose,
  onConfirm,
}: {
  group: MyGroup;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const alone = group.members.length <= 1;
  return (
    <Dialog title={alone ? 'Leave and close group?' : 'Leave group?'} onClose={onClose} busy={busy}>
      <p className="tm-modal-text">
        {alone ? (
          <>You are the only member, so <strong>{group.name}</strong> will be closed and its join code will stop working.</>
        ) : (
          <>You will leave <strong>{group.name}</strong>. Your km will no longer count for this group.</>
        )}{' '}
        You can join or create another group until groups lock.
      </p>
      {err && <p className="alert" role="alert">{err}</p>}
      <div className="modal-actions">
        <button type="button" className="btn-ghost" data-autofocus onClick={onClose} disabled={busy}>Stay</button>
        <button type="button" className="btn-ghost tm-danger-solid" onClick={onConfirm} disabled={busy}>
          {busy ? 'Leaving…' : 'Leave'}
        </button>
      </div>
    </Dialog>
  );
}

function EditGroupDialog({
  group,
  busy,
  err,
  onClose,
  onSave,
}: {
  group: MyGroup;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onSave: (name: string, avatar: string | null) => void;
}) {
  const [name, setName] = useState(group.name);
  const [avatar, setAvatar] = useState(group.avatar_url ?? '');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const nameId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 1 || n.length > NAME_MAX) return setLocalErr(`Group name must be 1-${NAME_MAX} characters`);
    setLocalErr(null);
    onSave(n, avatar || null);
  }

  return (
    <Dialog title="Edit group" onClose={onClose} busy={busy}>
      <form className="form tm-edit-form" onSubmit={submit}>
        <label htmlFor={nameId}>Group name</label>
        <input id={nameId} data-autofocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} required disabled={busy} />
        <span className="field-label">Group avatar</span>
        <AvatarPicker value={avatar} onChange={setAvatar} disabled={busy} label="Group avatar" />
        {(localErr || err) && <p className="alert" role="alert">{localErr || err}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-accent" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────── no group: create / join ─────────

function NoGroup({
  locked,
  registered,
  onDone,
}: {
  locked: boolean;
  registered: boolean;
  onDone: (text: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [avatar, setAvatar] = useState(CHIBI_AVATARS[7]?.url ?? CHIBI_AVATARS[0].url);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameId = useId();
  const codeId = useId();
  const disabled = locked || !registered || busy;

  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameStatus('idle');
      return;
    }
    setNameStatus('checking');
    let alive = true;
    const t = window.setTimeout(() => {
      isGroupNameAvailable(trimmed)
        .then((ok) => alive && setNameStatus(ok ? 'ok' : 'taken'))
        .catch(() => alive && setNameStatus('idle'));
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [name]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 1 || n.length > NAME_MAX) return setErr(`Group name must be 1-${NAME_MAX} characters`);
    setBusy(true);
    setErr(null);
    try {
      await createGroup(n, avatar || null);
      await onDone(`Group "${n}" created. Share the join code below with up to ${MAX_MEMBERS - 1} friends.`);
    } catch (e2) {
      setErr(errText(e2));
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length !== CODE_LEN) return setErr(`Join codes have ${CODE_LEN} characters.`);
    setBusy(true);
    setErr(null);
    try {
      await joinGroup(c);
      await onDone('You joined the group. Welcome aboard!');
    } catch (e2) {
      setErr(errText(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card tm-nogroup reveal" aria-labelledby="tm-nogroup-title">
      <div className="tm-nogroup-head">
        <span className="tm-nogroup-icon" aria-hidden="true"><Icon name="users" size={26} /></span>
        <div>
          <h2 id="tm-nogroup-title">You&apos;re not in a group yet</h2>
          <p className="muted small">
            Team up with up to {MAX_MEMBERS} people. Your group&apos;s score is the sum of every member&apos;s counted km.
          </p>
        </div>
      </div>

      {locked ? (
        <p className="tm-lock locked" role="note">
          <Icon name="lock" size={18} />
          <span>Groups are locked, so new groups can&apos;t be created or joined. You still count for your team.</span>
        </p>
      ) : !registered ? (
        <p className="alert" role="alert">Finish registration first to create or join a group.</p>
      ) : null}

      <div className="seg" role="group" aria-label="Create or join a group">
        <button type="button" aria-pressed={mode === 'create'} className={mode === 'create' ? 'on' : ''}
          onClick={() => { setMode('create'); setErr(null); }}>
          Create
        </button>
        <button type="button" aria-pressed={mode === 'join'} className={mode === 'join' ? 'on' : ''}
          onClick={() => { setMode('join'); setErr(null); }}>
          Join with code
        </button>
      </div>

      {mode === 'create' ? (
        <form className="form" onSubmit={onCreate} aria-label="Create a group">
          <fieldset className="tm-fieldset" disabled={disabled}>
            <label htmlFor={nameId}>Group name</label>
            <input id={nameId} value={name} maxLength={NAME_MAX} placeholder="e.g. Pace Pandas" onChange={(e) => setName(e.target.value)} aria-invalid={nameStatus === 'taken'} required />
            {nameStatus === 'checking' && <span className="muted small">Checking name…</span>}
            {nameStatus === 'taken' && <span className="alert" style={{ padding: '6px 10px', fontSize: 12 }}>This group name is already taken</span>}
            {nameStatus === 'ok' && <span className="ok" style={{ padding: '6px 10px', fontSize: 12 }}>Available</span>}
            <span className="field-label">Group avatar</span>
            <AvatarPicker value={avatar} onChange={setAvatar} disabled={disabled} label="Group avatar" />
            {err && <p className="alert" role="alert">{err}</p>}
            <button type="submit" className="btn-accent" disabled={disabled || !name.trim() || nameStatus === 'taken' || nameStatus === 'checking'}>{busy ? 'Creating…' : 'Create group'}</button>
          </fieldset>
        </form>
      ) : (
        <form className="form" onSubmit={onJoin} aria-label="Join a group">
          <fieldset className="tm-fieldset" disabled={disabled}>
            <label htmlFor={codeId}>Join code</label>
            <input
              id={codeId}
              className="tm-code-input"
              value={code}
              maxLength={CODE_LEN}
              placeholder="ABCD1234"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
              aria-describedby={`${codeId}-hint`}
              required
            />
            <span id={`${codeId}-hint`} className="muted small">Ask your group leader for the {CODE_LEN}-character code.</span>
            {err && <p className="alert" role="alert">{err}</p>}
            <button type="submit" className="btn-accent">{busy ? 'Joining…' : 'Join group'}</button>
          </fieldset>
        </form>
      )}
    </section>
  );
}

// ───────── team card ─────────

function TeamCard({ team, row, all }: { team: string | null; row: LeaderTeam | undefined; all: LeaderTeam[] | null }) {
  const revealed = all?.some((t) => t.total_km != null) ?? false;
  return (
    <section className="card tm-team reveal" style={{ animationDelay: '80ms' }} aria-labelledby="tm-team-title">
      <span className="tm-eyebrow" id="tm-team-title">My team</span>
      {team ? (
        <>
          <div className="tm-team-hero">
            <strong className="tm-team-code">{team}</strong>
            <div className="tm-team-rank">
              <span className="muted small">Team rank</span>
              <strong>{row ? `#${row.rank}` : '–'}{row && all ? <small> of {all.length}</small> : null}</strong>
            </div>
          </div>
          <p className="muted small">
            {row ? `${row.member_count} registered ${row.member_count === 1 ? 'member' : 'members'}` : 'Team members'}
            {row?.total_km != null ? ` · ${fmtKm(row.total_km)} km` : ''}
          </p>
        </>
      ) : (
        <p className="muted">You don&apos;t have a team yet. Finish registration to pick one.</p>
      )}

      {all && all.length > 0 && (
        <ol className="tm-teams" aria-label="Team standings">
          {all.map((t) => (
            <li key={t.team} className={t.is_mine || t.team === team ? 'mine' : ''}>
              <span className="tm-trank">{t.rank}</span>
              <span className="tm-tname">{t.team}</span>
              <span className="muted small">{t.member_count} runners</span>
              {revealed && <span className="tm-tkm">{t.total_km != null ? `${fmtKm(t.total_km)} km` : '–'}</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="muted small tm-note">
        {revealed ? 'Final distances are revealed.' : 'Distances are hidden until the event ends. Ranks update daily.'}
      </p>
    </section>
  );
}
