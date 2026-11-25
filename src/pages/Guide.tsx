import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import './Guide.css';

const IMG = `${import.meta.env.BASE_URL}guide/`;
const LOGO = `${import.meta.env.BASE_URL}logo.webp`;

function Shot({ src, alt, caption }: { src: string; alt: string; caption?: React.ReactNode }) {
  return (
    <figure className="gd-fig">
      <div className="gd-phone">
        <img src={`${IMG}${src}.webp`} alt={alt} loading="lazy" />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

const Ui = ({ children }: { children: React.ReactNode }) => <span className="gd-ui">{children}</span>;

const TOC: [string, string][] = [
  ['signin', 'Sign in'],
  ['register', 'Register'],
  ['group', 'Group & team'],
  ['home', 'Home'],
  ['log', 'Log a run'],
  ['proof', 'Good screenshots'],
  ['status', 'Run status'],
  ['board', 'Leaderboard'],
  ['profile', 'Profile'],
  ['faq', 'FAQ'],
];

/** Public user guide (no sign-in needed). Screens use sample data. */
export default function Guide() {
  const { session } = useAuth();
  const back = session ? '/' : '/login';
  const go = (id: string) => document.getElementById(`gd-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="gd">
      <header className="gd-bar">
        <Link to={back} className="gd-logo" aria-label="VISTEC Virtual Run">
          <img src={LOGO} alt="VISTEC Virtual Run" />
        </Link>
        <Link to={back} className="btn-ghost gd-back">
          {session ? 'Back to app' : 'Sign in'}
        </Link>
      </header>

      <div className="gd-wrap">
        <section className="gd-hero">
          <span className="gd-eyebrow">User guide</span>
          <h1>How to take part</h1>
          <p className="muted">
            Run anywhere with the running app you like, then log your distance here with a screenshot as proof. Your
            distance counts for you, your group and your team. This guide walks you from your first sign-in to your first
            logged run.
          </p>
          <div className="gd-facts">
            <span>Event <b>1–15 Dec 2026</b></span>
            <span>Log runs <b>on the same day</b></span>
            <span>Groups lock <b>1 Dec, 00:00</b></span>
          </div>
          <p className="gd-sample">Screens in this guide use sample data.</p>
        </section>

        <nav className="card gd-toc" aria-label="Contents">
          <h2>Contents</h2>
          <ol>
            {TOC.map(([id, label]) => (
              <li key={id}>
                <button type="button" onClick={() => go(id)}>{label}</button>
              </li>
            ))}
          </ol>
        </nav>

        <section id="gd-signin" className="gd-sec">
          <h2><span className="gd-n">01</span>Sign in</h2>
          <div className="gd-split">
            <div className="gd-txt">
              <ol className="gd-steps">
                <li>Open the site and tap <Ui>Sign in with Microsoft</Ui>.</li>
                <li>Use your VISTEC Microsoft 365 account (@vistec.ac.th).</li>
              </ol>
              <p>If the organisers turn on PIN sign-in, you can set a 6-digit PIN in your Profile and sign in with your email and PIN next time.</p>
            </div>
            <div className="gd-screens">
              <Shot src="01-login" alt="Sign-in page with the Sign in with Microsoft button" caption="Sign-in page" />
            </div>
          </div>
        </section>

        <section id="gd-register" className="gd-sec">
          <h2><span className="gd-n">02</span>Register (first time only)</h2>
          <p>Your first sign-in takes you through four short steps.</p>
          <div className="gd-row">
            <Shot src="02-onboard-name" alt="Step 1, display name" caption={<><b>1. Name</b> shown on the leaderboard and in your group</>} />
            <Shot src="03-onboard-team" alt="Step 2, choose a team" caption={<><b>2. Team</b> your distance adds to your team's total</>} />
            <Shot src="04-onboard-avatar" alt="Step 3, choose an avatar" caption={<><b>3. Avatar</b> pick a runner buddy and a background colour</>} />
            <Shot src="05-onboard-group" alt="Step 4, create, join or skip a group" caption={<><b>4. Group</b> create one, join with a code, or skip for now</>} />
          </div>
          <p className="gd-note warn"><b>Pick your team carefully.</b> You can't change it yourself after registering. If you chose the wrong one, ask an admin.</p>
        </section>

        <section id="gd-group" className="gd-sec">
          <h2><span className="gd-n">03</span>Group &amp; team</h2>
          <div className="gd-split">
            <div className="gd-txt">
              <p>Form a <b>group of up to 4 people</b>. Every member's counted km adds up to the group's total. Open <Ui>Group</Ui> in the menu.</p>
              <h3>Create a group</h3>
              <p>On the <Ui>Create</Ui> tab, choose a unique name and a group avatar, then tap <Ui>Create group</Ui>. You become the leader and get an <b>8-character join code</b> to share.</p>
              <h3>Join a group</h3>
              <p>On the <Ui>Join with code</Ui> tab, enter the code from your group leader.</p>
              <h3>Once you're in</h3>
              <p>You'll see your group's km, its rank, and each member's counted km. The join code is at the bottom of the page.</p>
              <p className="gd-note warn"><b>Groups lock on 1 Dec at 00:00 (Bangkok).</b> After that nobody can create, join or leave a group. Your km still count for you and your team.</p>
            </div>
            <div className="gd-screens">
              <Shot src="07a-group-none" alt="Group page before joining, with Create and Join with code tabs" caption="Not in a group yet" />
              <Shot src="07-group" alt="Group page showing group km and members" caption="In a group" />
            </div>
          </div>
        </section>

        <section id="gd-home" className="gd-sec">
          <h2><span className="gd-n">04</span>Home</h2>
          <div className="gd-split">
            <div className="gd-txt">
              <ul>
                <li><b>Total</b>: your counted km for the event, estimated steps and active days.</li>
                <li><b>Today</b>: today's km, your streak once you run 2 days in a row, and a shortcut to log today's run.</li>
                <li><b>Daily distance</b>: a bar for each day of the event.</li>
                <li><b>Achievements</b>: badges you've earned and the next one to go for.</li>
              </ul>
              <div className="gd-table">
                <table>
                  <thead><tr><th scope="col">Badges</th><th scope="col">Goals</th></tr></thead>
                  <tbody>
                    <tr><td>Distance</td><td>5 km · 10 km · Half marathon · Marathon · 60 km</td></tr>
                    <tr><td>Active days</td><td>1 · 3 · 5 · 10 · 15 days</td></tr>
                    <tr><td>Streaks</td><td>3 · 7 days in a row</td></tr>
                  </tbody>
                </table>
              </div>
              <p>Everything on Home counts only <span className="gd-chip ok">Counted</span> runs.</p>
            </div>
            <div className="gd-screens">
              <Shot src="06-home" alt="Home page with Total, Today and the daily chart" caption="Home" />
            </div>
          </div>
        </section>

        <section id="gd-log" className="gd-sec">
          <h2><span className="gd-n">05</span>Log a run</h2>
          <p>After your run, tap the orange <Ui>+ Log Run</Ui> button in the middle of the bottom menu (on a computer it's in the left menu).</p>
          <div className="gd-row">
            <Shot src="08-log-empty" alt="Log Run page before adding a screenshot" caption={<><b>1.</b> Tap <b>Choose screenshot</b> and pick one from your running app</>} />
            <Shot src="09-log-filled-green" alt="Distance 5.21 km and time 31:45 filled in from the screenshot, green frame" caption={<><b>2.</b> Distance and time fill in. Check them, then tap <b>Save run</b></>} />
            <Shot src="10-log-saved" alt="Saved 5.21 km message and the My runs list" caption={<><b>3.</b> Saved. Your run appears under <b>My runs</b></>} />
          </div>
          <ol className="gd-steps">
            <li><b>Add a screenshot</b> from your running app (Strava, Garmin, Apple Fitness, Mi Fitness and others). JPG, PNG, WebP, GIF, BMP or AVIF, up to 15 MB.</li>
            <li><b>Wait 2–5 seconds</b> while it reads the screenshot. English and Thai both work.</li>
            <li><b>Check the numbers.</b> Fix anything it misread, or type the values in. Distance is in km (for example 5.25); time is your moving time in hours : minutes : seconds.</li>
            <li>Tap <Ui>Save run</Ui>.</li>
          </ol>
          <h3>What the frame colour means</h3>
          <div className="gd-split">
            <div className="gd-txt">
              <ul>
                <li><span className="gd-frame g" /> <b>Green</b>: the screenshot was read and shows today's date. It counts right away.</li>
                <li><span className="gd-frame o" /> <b>Orange</b>: no date was found, or the date isn't today. You can still save it; an admin checks it before it counts.</li>
              </ul>
              <p>Tap the thumbnail to see the screenshot full size. Picked the wrong one? Tap <Ui>Change</Ui> or <Ui>Remove</Ui>.</p>
              <p className="gd-note warn"><b>Log on the day you run.</b> A run is saved under the day you submit it (Bangkok time). You can't log past days, so log before midnight.</p>
              <h3>Deleting a run</h3>
              <p>In <Ui>My runs</Ui> you can delete only today's runs (bin icon). To fix an earlier day, contact an admin.</p>
            </div>
            <div className="gd-screens">
              <Shot src="11-log-filled-orange" alt="Orange frame with the message No date found on screenshot" caption="Orange: no date on the screenshot, an admin will check" />
            </div>
          </div>
        </section>

        <section id="gd-proof" className="gd-sec">
          <h2><span className="gd-n">06</span>Good screenshots</h2>
          <p>The best screenshot shows <b>distance, time and date</b> together.</p>
          <div className="gd-proofs">
            <div className="gd-proof good">
              <img src={`${IMG}proof-detail.webp`} alt="Sample activity detail screen with a date" loading="lazy" />
              <div><h4>Best: the activity detail screen</h4><p>Date, distance and time are all visible, so the date can be checked and the run counts right away.</p></div>
            </div>
            <div className="gd-proof meh">
              <img src={`${IMG}proof-share.webp`} alt="Sample share card without a date" loading="lazy" />
              <div><h4>OK, but reviewed: a share card</h4><p>Distance and time are there but there's no date, so an admin checks it first.</p></div>
            </div>
          </div>
          <ul>
            <li>Use a real screenshot from your app and don't crop out the numbers.</li>
            <li>Each screenshot can be used once. Sending the same one again holds that run for review.</li>
            <li>Images are resized for you; there's no need to shrink them first.</li>
          </ul>
        </section>

        <section id="gd-status" className="gd-sec">
          <h2><span className="gd-n">07</span>Run status</h2>
          <div className="gd-table">
            <table>
              <thead><tr><th scope="col">Status</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                <tr><td><span className="gd-chip ok">Counted</span></td><td>Your km count.</td></tr>
                <tr><td><span className="gd-chip warn">Pending</span></td><td>Waiting for an admin. It counts once approved.</td></tr>
                <tr><td><span className="gd-chip bad">Rejected</span></td><td>Not approved and doesn't count. See the admin's note on the run.</td></tr>
              </tbody>
            </table>
          </div>
          <h3>When a run waits for an admin</h3>
          <ul>
            <li>More than 20 km in one run</li>
            <li>Pace faster than 4:30 /km</li>
            <li>No date on the screenshot, or a date other than today</li>
            <li>The same screenshot as an earlier run</li>
          </ul>
          <p>Your Profile shows when runs are waiting for review. There's no need to submit them again.</p>
        </section>

        <section id="gd-board" className="gd-sec">
          <h2><span className="gd-n">08</span>Leaderboard</h2>
          <div className="gd-split">
            <div className="gd-txt">
              <p>See rankings for individuals, groups and teams. Your own row is highlighted.</p>
              <ul>
                <li><b>Distances stay hidden until the event ends.</b> During the event you see the order only.</li>
                <li><b>Today's runs join the ranking after midnight</b>, so your rank may not move until the next day.</li>
                <li>Members of the same group can see each other's km on the Group page.</li>
              </ul>
            </div>
            <div className="gd-screens">
              <Shot src="12-leaderboard" alt="Leaderboard with distances hidden" caption="Leaderboard" />
            </div>
          </div>
        </section>

        <section id="gd-profile" className="gd-sec">
          <h2><span className="gd-n">09</span>Profile</h2>
          <div className="gd-split">
            <div className="gd-txt">
              <ul>
                <li>See your counted km, steps, activities, team and group.</li>
                <li>Tap the orange pencil on your picture to change your display name, avatar and background colour.</li>
                <li>Set a sign-in PIN (when the organisers have turned it on).</li>
                <li><Ui>Sign out</Ui> is at the bottom.</li>
              </ul>
            </div>
            <div className="gd-screens">
              <Shot src="13-profile" alt="Profile page with name, team, group and stats" caption="Profile" />
            </div>
          </div>
        </section>

        <section id="gd-faq" className="gd-sec">
          <h2><span className="gd-n">10</span>FAQ</h2>
          <details className="gd-faq"><summary>I forgot to log yesterday's run. Can I add it now?</summary><p>No. Runs can only be logged on the day you submit them. If something went wrong, contact an admin.</p></details>
          <details className="gd-faq"><summary>The numbers were read wrong.</summary><p>Correct them in the form before you tap Save run. An admin may compare them with the screenshot.</p></details>
          <details className="gd-faq"><summary>I logged a run but my total didn't go up.</summary><p>Check its status in My runs. Pending means it's waiting for an admin. The leaderboard adds today's runs after midnight.</p></details>
          <details className="gd-faq"><summary>Can I log more than one run a day?</summary><p>Yes. Log each run separately, each with its own screenshot.</p></details>
          <details className="gd-faq"><summary>I picked the wrong team, or need to change group after the lock.</summary><p>Ask an admin; they can move you.</p></details>
        </section>

        <footer className="gd-foot muted small">
          Questions or problems? Contact the organisers at <b>it@vistec.ac.th</b>.
        </footer>
      </div>
    </div>
  );
}
