// ============================================================================
// RUNPULSE - Main UI Controller & Event Handlers
// ============================================================================

import {
    ROUTE_SVGS,
    formatPace,
    formatDurationShort,
    stepsToKm,
    kmToSteps,
    getLogDisplayMetrics,
    compressImageFile
} from './utils.js';

import {
    dbState,
    isCloudEnabled,
    initDatabase,
    insertRunner,
    uploadProofImage,
    insertRunLog,
    updateLogStatus,
    incrementLogKudos,
    removeRunLog,
    resetLocalDemoData
} from './db.js';

import {
    currentUser,
    setCurrentUser,
    getSavedSession,
    loginWithMicrosoft365,
    checkOAuthSession,
    signOutUser
} from './auth.js';

let currentLogMode = 'km'; // 'km' | 'steps'
let uploadedProofDataUrl = '';
let uploadedProofFile = null;
let personalChartInstance = null;

// ==========================================
// 1. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const dateInput = document.getElementById('log-date');
    if (dateInput) dateInput.valueAsDate = new Date();

    const dbResult = await initDatabase();
    updateDbModeBadge(dbResult.mode);
    populateLoginDropdowns();

    // ตรวจสอบว่ากลับมาจากหน้า Login Microsoft 365 หรือไม่
    const oauthResult = await checkOAuthSession();
    if (oauthResult?.status === 'authenticated') {
        enterApp();
        showToast(`เข้าสู่ระบบผ่าน Microsoft 365 สำเร็จ (${oauthResult.user.name})`);
    } else if (oauthResult?.status === 'needs_onboarding') {
        openQuickRegisterModal(oauthResult.profile);
        showToast('ยินดีต้อนรับ! กรุณาเลือกทีมสังกัดเพื่อเริ่มต้นใช้งาน');
    } else {
        // ตรวจสอบ Session เดิมที่ค้างไว้
        const saved = getSavedSession();
        if (saved && (saved.role === 'admin' || dbState.runners.some(r => r.id === saved.runnerId))) {
            setCurrentUser(saved);
            enterApp();
        }
    }

    if (window.lucide) window.lucide.createIcons();
});

function updateDbModeBadge(mode) {
    const dot = document.getElementById('db-mode-dot');
    const txt = document.getElementById('db-mode-text');
    if (!dot || !txt) return;
    if (mode === 'SUPABASE') {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
        txt.textContent = 'SUPABASE';
    } else {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-amber-500';
        txt.textContent = 'LOCAL';
    }
}

// ==========================================
// 2. AUTHENTICATION & LOGIN HANDLERS
// ==========================================
export async function handleMicrosoftLogin() {
    const btn = document.getElementById('login-ms-btn');
    const txt = document.getElementById('login-ms-text');
    const errBox = document.getElementById('login-error-box');

    if (errBox) errBox.classList.add('hidden');
    if (btn) btn.disabled = true;
    if (txt) txt.textContent = 'กำลังเชื่อมต่อ Microsoft 365...';

    const res = await loginWithMicrosoft365();
    if (res?.error) {
        if (btn) btn.disabled = false;
        if (txt) txt.textContent = 'เข้าสู่ระบบด้วย Microsoft 365';
        if (errBox) {
            errBox.textContent = res.error;
            errBox.classList.remove('hidden');
        } else {
            showToast(res.error);
        }
    }
}

export function populateLoginDropdowns() {
    const loginSelect = document.getElementById('login-runner-select');
    if (loginSelect) {
        loginSelect.innerHTML = dbState.runners
            .map(r => `<option value="${r.id}">${r.name} (${r.bib}) — ทีม${r.team}</option>`)
            .join('');
    }

    const qregTeam = document.getElementById('qreg-team');
    if (qregTeam) {
        const teams = getTeamsList().filter(t => t !== 'ไม่มีทีม');
        qregTeam.innerHTML = `<option value="ไม่มีทีม">ไม่มีทีม (วิ่งเดี่ยว)</option>` +
            teams.map(t => `<option value="${t}">${t}</option>`).join('');
    }
}

export function switchLoginMode(mode) {
    const isRunner = mode === 'runner';
    document.getElementById('form-login-runner').classList.toggle('hidden', !isRunner);
    document.getElementById('form-login-admin').classList.toggle('hidden', isRunner);

    document.getElementById('login-tab-runner').className = isRunner
        ? 'py-3 text-strava-orange border-b-2 border-strava-orange bg-white transition-colors'
        : 'py-3 text-strava-muted border-b-2 border-transparent hover:text-strava-dark transition-colors';

    document.getElementById('login-tab-admin').className = !isRunner
        ? 'py-3 text-strava-orange border-b-2 border-strava-orange bg-white transition-colors'
        : 'py-3 text-strava-muted border-b-2 border-transparent hover:text-strava-dark transition-colors';
}

export function handleRunnerLogin(e) {
    e.preventDefault();
    const runnerId = document.getElementById('login-runner-select').value;
    const pin = document.getElementById('login-runner-pin').value.trim();
    const runner = dbState.runners.find(r => r.id === runnerId);
    if (!runner || !pin) return;

    const expectedPin = runner.pin || '1234';
    if (pin !== expectedPin && pin.toUpperCase() !== runner.bib.toUpperCase()) {
        showToast('รหัส PIN หรือหมายเลข BIB ไม่ถูกต้อง');
        return;
    }

    setCurrentUser({ role: 'runner', runnerId: runner.id, name: runner.name, email: runner.email || '' });
    enterApp();
    showToast(`ยินดีต้อนรับ ${runner.name}`);
}

export function handleAdminLogin(e) {
    e.preventDefault();
    const user = document.getElementById('login-admin-user').value.trim();
    const pass = document.getElementById('login-admin-pass').value.trim();
    if (user !== 'admin' || pass !== 'admin123') {
        showToast('ชื่อผู้ใช้หรือรหัสผ่าน Admin ไม่ถูกต้อง (ใช้ admin / admin123)');
        return;
    }
    setCurrentUser({ role: 'admin', runnerId: null, name: 'Club Admin' });
    enterApp();
    showToast('เข้าสู่ระบบผู้ดูแล (Admin) สำเร็จ');
}

export function enterApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('flex');

    const isAdmin = currentUser.role === 'admin';
    document.getElementById('header-role-badge').textContent = isAdmin ? 'ADMIN' : 'RUNNER';
    document.getElementById('header-user-name').textContent = currentUser.name;

    // Role-based UI visibility
    document.getElementById('nav-admin').classList.toggle('hidden', !isAdmin);
    document.getElementById('nav-register').classList.toggle('hidden', !isAdmin);
    document.getElementById('m-nav-admin').classList.toggle('hidden', !isAdmin);

    refreshAllViews();

    // Lock runner selection if logged in as regular runner
    const logSelect = document.getElementById('log-runner-id');
    if (!isAdmin && currentUser.runnerId) {
        logSelect.value = currentUser.runnerId;
        logSelect.disabled = true;
        document.getElementById('personal-runner-select').value = currentUser.runnerId;
    } else {
        logSelect.disabled = false;
    }

    switchTab('overview');
}

export async function logout() {
    await signOutUser();
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('flex');
    document.getElementById('login-screen').classList.remove('hidden');
    populateLoginDropdowns();
}

export function openQuickRegisterModal(prefillProfile = null) {
    populateLoginDropdowns();
    const nameInput = document.getElementById('qreg-name');
    const emailInput = document.getElementById('qreg-email');
    const bibInput = document.getElementById('qreg-bib');

    if (bibInput) {
        const nextNum = String(dbState.runners.length + 1).padStart(3, '0');
        bibInput.value = `RUN-${nextNum}`;
    }

    if (prefillProfile) {
        if (nameInput) nameInput.value = prefillProfile.name || '';
        if (emailInput) {
            emailInput.value = prefillProfile.email || '';
            emailInput.readOnly = true;
        }
    } else {
        if (emailInput) {
            emailInput.value = '';
            emailInput.readOnly = false;
        }
    }

    document.getElementById('quick-register-modal').classList.remove('hidden');
    document.getElementById('quick-register-modal').classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
}

export function closeQuickRegisterModal() {
    document.getElementById('quick-register-modal').classList.add('hidden');
    document.getElementById('quick-register-modal').classList.remove('flex');
}

export function toggleQuickTeamInput() {
    const mode = document.querySelector('input[name="qreg-team-mode"]:checked').value;
    document.getElementById('qreg-existing-team-wrapper').classList.toggle('hidden', mode !== 'existing');
    document.getElementById('qreg-new-team-wrapper').classList.toggle('hidden', mode === 'existing');
}

export async function handleQuickRegister(e) {
    e.preventDefault();
    const name = document.getElementById('qreg-name').value.trim();
    const email = (document.getElementById('qreg-email')?.value || '').trim().toLowerCase();
    const bib = document.getElementById('qreg-bib').value.trim().toUpperCase();
    const teamMode = document.querySelector('input[name="qreg-team-mode"]:checked').value;
    const team = teamMode === 'existing'
        ? document.getElementById('qreg-team').value
        : document.getElementById('qreg-team-new').value.trim();
    const goal = 100;
    const pin = '1234';

    if (!name || !bib || !team) {
        showToast('กรุณากรอกข้อมูลและชื่อทีมให้ครบถ้วน');
        return;
    }

    const newRunner = { id: 'r_' + Date.now(), name, email, bib, team, goal, pin };
    try {
        await insertRunner(newRunner);
        closeQuickRegisterModal();
        setCurrentUser({ role: 'runner', runnerId: newRunner.id, name: newRunner.name, email: newRunner.email });
        enterApp();
        showToast(`ลงทะเบียนและเข้าสู่ระบบในชื่อ ${name} สำเร็จ`);
    } catch (err) {
        showToast('บันทึกข้อมูลไม่สำเร็จ: ' + err.message);
    }
}

// ==========================================
// 3. NAVIGATION & MODALS
// ==========================================
export function openProofModal(imgUrl, title) {
    document.getElementById('proof-modal-img').src = imgUrl;
    document.getElementById('proof-modal-title').textContent = title || 'หลักฐานการวิ่ง';
    document.getElementById('proof-modal').classList.remove('hidden');
    document.getElementById('proof-modal').classList.add('flex');
    if (window.lucide) window.lucide.createIcons();
}

export function closeProofModal() {
    document.getElementById('proof-modal').classList.add('hidden');
    document.getElementById('proof-modal').classList.remove('flex');
}

export function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('border-strava-orange', 'text-strava-dark', 'font-semibold');
        btn.classList.add('border-transparent', 'text-strava-muted', 'font-medium');
    });
    const activeNav = document.getElementById(`nav-${tabName}`);
    if (activeNav) {
        activeNav.classList.add('border-strava-orange', 'text-strava-dark', 'font-semibold');
        activeNav.classList.remove('border-transparent', 'text-strava-muted', 'font-medium');
    }

    document.querySelectorAll('.m-nav-btn').forEach(btn => {
        btn.classList.remove('text-strava-orange', 'border-strava-orange', 'font-bold');
        btn.classList.add('text-strava-muted', 'border-transparent', 'font-medium');
    });
    const activeMNav = document.getElementById(`m-nav-${tabName}`);
    if (activeMNav) {
        activeMNav.classList.add('text-strava-orange', 'border-strava-orange', 'font-bold');
        activeMNav.classList.remove('text-strava-muted', 'border-transparent', 'font-medium');
    }

    if (tabName === 'personal') renderPersonalDashboard();
    if (tabName === 'overview') renderOverview();
    if (tabName === 'admin') renderAdminDashboard();
    if (window.lucide) window.lucide.createIcons();
}

export function showToast(message) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').textContent = message;
    toast.classList.remove('translate-y-16', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-16', 'opacity-0');
    }, 2800);
}

// ==========================================
// 4. STATS & STANDINGS CALCULATIONS
// ==========================================
function getTeamsList() {
    return Array.from(new Set(dbState.runners.map(r => r.team)));
}

function getRunnerStats() {
    return dbState.runners.map(runner => {
        // นับเฉพาะรายการที่ Admin อนุมัติแล้ว (approved) ขึ้นตารางอันดับ
        const approvedLogs = dbState.runLogs.filter(l => l.runnerId === runner.id && l.status === 'approved');
        const pendingLogs = dbState.runLogs.filter(l => l.runnerId === runner.id && l.status === 'pending');
        const totalKm = approvedLogs.reduce((sum, l) => sum + Number(l.distance), 0);
        const pendingKm = pendingLogs.reduce((sum, l) => sum + Number(l.distance), 0);
        const totalMin = approvedLogs.reduce((sum, l) => sum + Number(l.duration), 0);
        return {
            ...runner,
            totalKm: Number(totalKm.toFixed(2)),
            pendingKm: Number(pendingKm.toFixed(2)),
            totalMin,
            runCount: approvedLogs.length,
            avgPace: formatPace(totalKm, totalMin)
        };
    }).sort((a, b) => b.totalKm - a.totalKm);
}

function getTeamStats() {
    const runnerStats = getRunnerStats();
    return getTeamsList()
        .filter(teamName => teamName !== 'ไม่มีทีม')
        .map(teamName => {
            const members = runnerStats.filter(r => r.team === teamName);
            const totalKm = members.reduce((sum, m) => sum + m.totalKm, 0);
            const avgKm = members.length > 0 ? totalKm / members.length : 0;
            return {
                name: teamName,
                memberCount: members.length,
                totalKm: Number(totalKm.toFixed(2)),
                avgKm: Number(avgKm.toFixed(1))
            };
        }).sort((a, b) => b.totalKm - a.totalKm);
}

// ==========================================
// 5. RENDER VIEWS
// ==========================================
function refreshAllViews() {
    populateDropdowns();
    renderOverview();
    renderPersonalDashboard();
    renderAdminDashboard();
    updateAdminBadge();
}

function updateAdminBadge() {
    const pendingCount = dbState.runLogs.filter(l => l.status === 'pending').length;
    const badge = document.getElementById('admin-pending-badge');
    if (badge) badge.textContent = pendingCount;
}

function populateDropdowns() {
    const teams = getTeamsList();

    const filterTeamSelect = document.getElementById('filter-leaderboard-team');
    const currentFilter = filterTeamSelect.value;
    filterTeamSelect.innerHTML = `<option value="ALL">ทุกทีม (${teams.length})</option>` +
        teams.map(t => `<option value="${t}">${t}</option>`).join('');
    if (teams.includes(currentFilter)) filterTeamSelect.value = currentFilter;

    const regTeamSelect = document.getElementById('reg-team-select');
    regTeamSelect.innerHTML = teams.map(t => `<option value="${t}">${t}</option>`).join('');

    const runnerOptions = dbState.runners.map(r => `<option value="${r.id}">${r.name} (${r.bib}) — ${r.team}</option>`).join('');

    const logSelect = document.getElementById('log-runner-id');
    const prevLog = logSelect.value;
    logSelect.innerHTML = runnerOptions;
    if (dbState.runners.some(r => r.id === prevLog)) logSelect.value = prevLog;

    const pdSelect = document.getElementById('personal-runner-select');
    const prevPd = pdSelect.value;
    pdSelect.innerHTML = runnerOptions;
    if (dbState.runners.some(r => r.id === prevPd)) pdSelect.value = prevPd;
}

export function renderOverview() {
    const runnerStats = getRunnerStats();
    const teamStats = getTeamStats();

    const totalKm = runnerStats.reduce((sum, r) => sum + r.totalKm, 0);
    document.getElementById('stat-total-km').textContent = totalKm.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    document.getElementById('stat-total-runners').textContent = dbState.runners.length;
    document.getElementById('stat-total-logs').textContent = dbState.runLogs.filter(l => l.status === 'approved').length;
    document.getElementById('stat-total-teams-label').textContent = `${teamStats.length} ทีม`;

    const teamContainer = document.getElementById('team-leaderboard-list');
    const maxTeamKm = teamStats.length > 0 && teamStats[0].totalKm > 0 ? teamStats[0].totalKm : 1;

    teamContainer.innerHTML = teamStats.map((team, idx) => {
        const pct = Math.min(100, Math.round((team.totalKm / maxTeamKm) * 100));
        const isFirst = idx === 0;
        return `
            <div class="p-3.5 hover:bg-strava-bg/60 transition-colors">
                <div class="flex justify-between items-baseline mb-1">
                    <div class="flex items-center gap-2">
                        <span class="font-mono text-xs font-bold ${isFirst ? 'text-strava-orange' : 'text-strava-muted'} w-4">${idx + 1}</span>
                        <span class="text-xs font-bold text-strava-dark">${team.name}</span>
                        <span class="text-[11px] text-strava-muted">(${team.memberCount} คน)</span>
                    </div>
                    <span class="font-mono text-xs font-bold text-strava-dark tabular-nums">${team.totalKm.toFixed(1)} km</span>
                </div>
                <div class="flex justify-between items-center text-[10px] text-strava-muted mb-1.5 pl-6">
                    <span>เฉลี่ยต่อคน</span>
                    <span class="font-mono">${team.avgKm.toFixed(1)} km/คน</span>
                </div>
                <div class="w-full bg-zinc-100 h-1.5 rounded-sm overflow-hidden">
                    <div class="${isFirst ? 'bg-strava-orange' : 'bg-zinc-700'} h-1.5 transition-all duration-300" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');

    renderLeaderboards();

    const feedContainer = document.getElementById('recent-activities-list');
    const sortedLogs = [...dbState.runLogs].filter(l => l.status !== 'rejected').sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sortedLogs.length === 0) {
        feedContainer.innerHTML = `<div class="bg-white border border-strava-border rounded p-8 text-center text-xs text-strava-muted">ยังไม่มีกิจกรรมในคลับ</div>`;
    } else {
        feedContainer.innerHTML = sortedLogs.map((log, index) => {
            const runner = dbState.runners.find(r => r.id === log.runnerId) || { name: 'นักวิ่ง', bib: '-', team: '-' };
            const metrics = getLogDisplayMetrics(log);
            const svgPath = ROUTE_SVGS[index % ROUTE_SVGS.length];
            const kudosCount = log.kudos || 0;
            const isPending = log.status === 'pending';

            return `
                <article class="bg-white border border-strava-border rounded p-5 hover:border-zinc-300 transition-colors">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3 cursor-pointer" onclick="viewRunnerProfile('${runner.id}')">
                            <div class="w-10 h-10 rounded-full bg-strava-dark text-white font-bold text-sm flex items-center justify-center shrink-0">
                                ${runner.name.charAt(0)}
                            </div>
                            <div>
                                <h3 class="text-sm font-bold text-strava-dark hover:text-strava-orange transition-colors leading-tight">${runner.name}</h3>
                                <p class="text-[11px] text-strava-muted mt-0.5 flex items-center gap-1.5">
                                    <span>${log.date}</span>
                                    <span>•</span>
                                    <span class="font-semibold text-zinc-700">${runner.team}</span>
                                </p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            ${isPending
                    ? `<span class="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded">รอตรวจสอบ</span>`
                    : `<span class="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded flex items-center gap-1"><i data-lucide="check-circle-2" class="w-3 h-3"></i> ยืนยันแล้ว</span>`
                }
                            <span class="text-[11px] font-mono text-strava-muted bg-strava-bg px-2 py-0.5 rounded border border-strava-border">${runner.bib}</span>
                        </div>
                    </div>

                    <div class="mt-3.5">
                        <h4 class="text-base font-extrabold text-strava-dark">${log.location || 'Morning Run'}</h4>
                        ${log.note ? `<p class="text-xs text-zinc-600 mt-1 leading-relaxed">${log.note}</p>` : ''}
                    </div>

                    <div class="mt-4 pt-3.5 border-t border-strava-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div class="grid grid-cols-2 divide-x divide-strava-border flex-grow max-w-sm">
                            <div class="pr-4">
                                <span class="block text-[10px] uppercase tracking-wider text-strava-muted font-semibold">Distance & Steps</span>
                                <div class="text-lg font-extrabold tabular-nums ${!metrics.isStepInput ? 'text-strava-orange' : 'text-strava-dark'}">
                                    ${metrics.kmValue} <span class="text-xs font-normal">km</span>
                                </div>
                                <div class="text-xs font-mono mt-0.5 tabular-nums ${metrics.isStepInput ? 'text-strava-orange font-bold' : 'text-strava-muted'}">
                                    ${metrics.stepsFormatted} ก้าว ${!metrics.isStepInput ? '(คำนวณ)' : ''}
                                </div>
                            </div>
                            <div class="pl-4">
                                <span class="block text-[10px] uppercase tracking-wider text-strava-muted font-semibold">Time</span>
                                <span class="text-lg font-extrabold text-strava-dark tabular-nums">${formatDurationShort(log.duration)}</span>
                            </div>
                        </div>

                        ${log.proofImg ? `
                            <button type="button" onclick="openProofModal('${log.proofImg}', '${runner.name} — ${Number(log.distance).toFixed(2)} km')" class="group relative flex items-center gap-2 bg-strava-bg border border-strava-border hover:border-strava-orange rounded p-1.5 shrink-0 transition-colors" title="คลิกเพื่อดูภาพหลักฐาน">
                                <img src="${log.proofImg}" alt="หลักฐาน" class="w-16 h-10 object-cover rounded-sm">
                                <span class="text-[10px] font-bold text-strava-dark group-hover:text-strava-orange pr-1">ดูหลักฐาน</span>
                            </button>
                        ` : `
                            <div class="hidden sm:flex items-center justify-center bg-strava-bg border border-strava-border rounded px-3 py-1.5 shrink-0">
                                <svg width="90" height="32" viewBox="0 0 120 42" fill="none">
                                    <path d="${svgPath}" stroke="#FC4C02" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                        `}
                    </div>

                    <div class="mt-3.5 pt-2.5 border-t border-strava-border flex items-center justify-between text-xs text-strava-muted">
                        <span class="text-[11px]">${kudosCount} Kudos</span>
                        <button onclick="giveKudos('${log.id}')" class="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-strava-light hover:text-strava-orange transition-colors font-semibold">
                            <i data-lucide="thumbs-up" class="w-3.5 h-3.5"></i>
                            <span>Give Kudos</span>
                        </button>
                    </div>
                </article>
            `;
        }).join('');
    }
    if (window.lucide) window.lucide.createIcons();
}

export async function giveKudos(logId) {
    await incrementLogKudos(logId);
    renderOverview();
    showToast('ส่ง Kudos ให้เพื่อนนักวิ่งแล้ว!');
}

export function renderLeaderboards() {
    const filterTeam = document.getElementById('filter-leaderboard-team').value;
    let runnerStats = getRunnerStats();

    if (filterTeam !== 'ALL') {
        runnerStats = runnerStats.filter(r => r.team === filterTeam);
    }

    const tbody = document.getElementById('individual-leaderboard-body');
    if (runnerStats.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-strava-muted">ไม่พบข้อมูลนักวิ่ง</td></tr>`;
        return;
    }

    tbody.innerHTML = runnerStats.map((r, idx) => {
        const isTop3 = idx < 3;
        return `
            <tr onclick="viewRunnerProfile('${r.id}')" class="hover:bg-strava-bg cursor-pointer transition-colors group">
                <td class="py-2.5 px-3 text-center font-mono font-bold ${idx === 0 ? 'text-strava-orange' : isTop3 ? 'text-strava-dark' : 'text-strava-muted'}">
                    ${idx + 1}
                </td>
                <td class="py-2.5 px-2">
                    <div class="font-bold text-strava-dark group-hover:text-strava-orange transition-colors">${r.name}</div>
                    <div class="text-[11px] text-strava-muted">${r.team}</div>
                </td>
                <td class="py-2.5 px-3 text-right font-mono font-bold text-strava-dark tabular-nums">
                    <div>${r.totalKm.toFixed(1)} <span class="font-sans font-normal text-[10px] text-strava-muted">km</span></div>
                    ${r.pendingKm > 0 ? `<div class="text-[10px] font-normal text-amber-600">รอตรวจ +${r.pendingKm.toFixed(1)}</div>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

export function viewRunnerProfile(runnerId) {
    document.getElementById('personal-runner-select').value = runnerId;
    switchTab('personal');
}

export function renderPersonalDashboard() {
    const runnerId = document.getElementById('personal-runner-select').value;
    if (!runnerId) return;

    const allStats = getRunnerStats();
    const rankIndex = allStats.findIndex(r => r.id === runnerId);
    const runner = allStats[rankIndex];
    if (!runner) return;

    document.getElementById('pd-avatar').textContent = runner.name.charAt(0).toUpperCase();
    document.getElementById('pd-name').textContent = runner.name;
    document.getElementById('pd-bib').textContent = runner.bib;
    document.getElementById('pd-team-badge').textContent = `ทีม ${runner.team}`;
    document.getElementById('pd-rank').textContent = `#${rankIndex + 1} / ${allStats.length}`;

    const goalPct = runner.goal > 0 ? Math.min(100, Math.round((runner.totalKm / runner.goal) * 100)) : 0;
    document.getElementById('pd-goal-percent').textContent = goalPct;
    document.getElementById('pd-goal-bar').style.width = `${goalPct}%`;
    document.getElementById('pd-current-km').textContent = runner.totalKm.toFixed(1);
    document.getElementById('pd-target-km').textContent = runner.goal;

    document.getElementById('pd-pace').textContent = runner.avgPace;
    document.getElementById('pd-total-time').textContent = formatDurationShort(runner.totalMin);
    document.getElementById('pd-calories').textContent = Math.round(runner.totalKm * 62).toLocaleString();

    const userLogs = dbState.runLogs
        .filter(l => l.runnerId === runnerId)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    renderPersonalChart(userLogs.filter(l => l.status === 'approved'));

    const reversedLogs = [...userLogs].reverse();
    document.getElementById('pd-run-count').textContent = `${reversedLogs.length} กิจกรรม`;
    const tbody = document.getElementById('pd-history-body');

    if (reversedLogs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-strava-muted">ยังไม่มีประวัติการวิ่ง</td></tr>`;
    } else {
        tbody.innerHTML = reversedLogs.map(log => {
            const metrics = getLogDisplayMetrics(log);
            const statusBadge = log.status === 'approved'
                ? `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">อนุมัติแล้ว</span>`
                : log.status === 'rejected'
                    ? `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold">ไม่ผ่าน</span>`
                    : `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">รอตรวจ</span>`;

            const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.runnerId === log.runnerId);

            return `
                <tr class="hover:bg-strava-bg/60 transition-colors">
                    <td class="py-3 px-4 font-mono text-strava-muted whitespace-nowrap">${log.date}</td>
                    <td class="py-3 px-4">
                        <div class="font-bold text-strava-dark">${log.location || 'Running Activity'}</div>
                        ${log.note ? `<div class="text-[11px] text-strava-muted truncate max-w-xs">${log.note}</div>` : ''}
                    </td>
                    <td class="py-3 px-4 text-right font-mono tabular-nums">
                        <div class="font-bold ${!metrics.isStepInput ? 'text-strava-orange' : 'text-strava-dark'}">${metrics.kmValue} km</div>
                        <div class="text-[10px] ${metrics.isStepInput ? 'text-strava-orange font-bold' : 'text-strava-muted font-normal'}">${metrics.stepsFormatted} ก้าว ${!metrics.isStepInput ? '(คำนวณ)' : ''}</div>
                    </td>
                    <td class="py-3 px-4 text-right font-mono text-strava-muted tabular-nums">${formatDurationShort(log.duration)}</td>
                    <td class="py-3 px-4 text-center">
                        ${log.proofImg ? `<button onclick="openProofModal('${log.proofImg}', '${log.location}')" class="text-strava-orange hover:underline font-semibold text-[11px]">ดูรูป</button>` : '-'}
                    </td>
                    <td class="py-3 px-4 text-center">${statusBadge}</td>
                    <td class="py-3 px-4 text-center">
                        ${canDelete ? `
                            <button onclick="deleteRunLog('${log.id}')" class="text-strava-muted hover:text-red-600 p-1 transition-colors" title="ลบรายการ">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                            </button>
                        ` : '-'}
                    </td>
                </tr>
            `;
        }).join('');
    }
    if (window.lucide) window.lucide.createIcons();
}

function renderPersonalChart(logs) {
    const ctx = document.getElementById('personalRunChart').getContext('2d');
    if (personalChartInstance) personalChartInstance.destroy();

    const labels = logs.length > 0 ? logs.map(l => l.date.slice(5)) : ['ไม่มีข้อมูล'];
    const data = logs.length > 0 ? logs.map(l => Number(l.distance)) : [0];

    personalChartInstance = new window.Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Distance (km)',
                data: data,
                backgroundColor: '#FC4C02',
                hoverBackgroundColor: '#E34402',
                borderRadius: 2,
                maxBarThickness: 28
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#18181B',
                    titleFont: { family: 'JetBrains Mono', size: 11 },
                    bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
                    callbacks: { label: (ctx) => `${ctx.parsed.y} km` }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    grid: { color: '#E4E4E7' },
                    ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#6D6D78' }
                },
                x: {
                    border: { display: false },
                    grid: { display: false },
                    ticks: { font: { family: 'JetBrains Mono', size: 10 }, color: '#6D6D78' }
                }
            }
        }
    });
}

export function renderAdminDashboard() {
    const tbody = document.getElementById('admin-logs-body');
    if (!tbody) return;

    const sortedLogs = [...dbState.runLogs].sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.date) - new Date(a.date);
    });

    tbody.innerHTML = sortedLogs.map(log => {
        const runner = dbState.runners.find(r => r.id === log.runnerId) || { name: 'ไม่ทราบชื่อ', team: '-' };
        const metrics = getLogDisplayMetrics(log);
        const statusBadge = log.status === 'approved'
            ? `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">อนุมัติแล้ว</span>`
            : log.status === 'rejected'
                ? `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold">ปฏิเสธ</span>`
                : `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">รอตรวจสอบ</span>`;

        return `
            <tr class="hover:bg-strava-bg/60">
                <td class="py-3 px-4">
                    <div class="font-bold text-strava-dark">${runner.name}</div>
                    <div class="text-[11px] text-strava-muted font-mono">${log.date} • ${runner.team}</div>
                </td>
                <td class="py-3 px-4">
                    <div class="font-semibold text-strava-dark">${log.location}</div>
                    <div class="text-[11px] text-strava-muted">${log.note || '-'}</div>
                </td>
                <td class="py-3 px-4 text-right font-mono">
                    <div class="font-bold ${!metrics.isStepInput ? 'text-strava-orange' : 'text-strava-dark'}">${metrics.kmValue} km</div>
                    <div class="text-[10px] ${metrics.isStepInput ? 'text-strava-orange font-bold' : 'text-strava-muted'}">${metrics.stepsFormatted} ก้าว ${!metrics.isStepInput ? '(คำนวณ)' : ''}</div>
                </td>
                <td class="py-3 px-4 text-center">
                    ${log.proofImg
                ? `<button onclick="openProofModal('${log.proofImg}', '${runner.name} — ${log.distance} km')" class="inline-block border border-strava-border hover:border-strava-orange rounded overflow-hidden"><img src="${log.proofImg}" class="w-14 h-9 object-cover"></button>`
                : '<span class="text-strava-muted">-</span>'
            }
                </td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                    <button onclick="setLogStatus('${log.id}', 'approved')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold">อนุมัติ</button>
                    <button onclick="setLogStatus('${log.id}', 'rejected')" class="px-2.5 py-1 bg-zinc-200 hover:bg-red-600 hover:text-white text-zinc-700 rounded text-[11px] font-bold transition-colors">ปฏิเสธ</button>
                </td>
            </tr>
        `;
    }).join('');
    if (window.lucide) window.lucide.createIcons();
}

export async function setLogStatus(logId, status) {
    try {
        await updateLogStatus(logId, status);
        refreshAllViews();
        showToast(status === 'approved' ? 'อนุมัติผลวิ่งและอัปเดตอันดับเรียบร้อย' : 'ปฏิเสธรายการผลวิ่งแล้ว');
    } catch (err) {
        showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message);
    }
}

// ==========================================
// 6. FORM HANDLERS
// ==========================================
export function setLogInputMode(mode) {
    currentLogMode = mode;
    const isKm = mode === 'km';
    document.getElementById('input-group-km').classList.toggle('hidden', !isKm);
    document.getElementById('input-group-steps').classList.toggle('hidden', isKm);

    document.getElementById('mode-btn-km').className = isKm
        ? 'px-3 py-1 rounded-sm bg-strava-orange text-white transition-colors'
        : 'px-3 py-1 rounded-sm text-strava-muted hover:text-strava-dark transition-colors';

    document.getElementById('mode-btn-steps').className = !isKm
        ? 'px-3 py-1 rounded-sm bg-strava-orange text-white transition-colors'
        : 'px-3 py-1 rounded-sm text-strava-muted hover:text-strava-dark transition-colors';
}

export function calculateStepsToKm() {
    const steps = parseInt(document.getElementById('log-steps').value, 10) || 0;
    const km = stepsToKm(steps);
    document.getElementById('converted-km-display').textContent = km.toFixed(2);
    return km;
}

export function calculateKmToSteps() {
    const km = parseFloat(document.getElementById('log-distance').value) || 0;
    const steps = kmToSteps(km);
    document.getElementById('converted-steps-display').textContent = steps.toLocaleString();
    return steps;
}

export async function handleProofImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const { dataUrl, blob } = await compressImageFile(file);
    uploadedProofDataUrl = dataUrl;
    uploadedProofFile = blob;
    document.getElementById('proof-preview-img').src = uploadedProofDataUrl;
    document.getElementById('proof-preview-container').classList.remove('hidden');
}

export function clearProofImage() {
    uploadedProofDataUrl = '';
    uploadedProofFile = null;
    document.getElementById('log-proof-file').value = '';
    document.getElementById('proof-preview-container').classList.add('hidden');
}

export async function handleLogRun(e) {
    e.preventDefault();
    const runnerId = document.getElementById('log-runner-id').value;
    const date = document.getElementById('log-date').value;
    const duration = parseInt(document.getElementById('log-duration').value, 10);
    const location = document.getElementById('log-location').value.trim();
    const note = document.getElementById('log-note').value.trim();

    let distance = 0;
    let steps = null;

    if (currentLogMode === 'km') {
        distance = parseFloat(document.getElementById('log-distance').value);
        steps = calculateKmToSteps();
    } else {
        steps = parseInt(document.getElementById('log-steps').value, 10);
        distance = calculateStepsToKm();
    }

    if (!runnerId || isNaN(distance) || distance <= 0) {
        showToast('กรุณาระบุระยะทางหรือจำนวนก้าวให้ถูกต้อง');
        return;
    }

    if (!uploadedProofDataUrl) {
        showToast('กรุณาอัปโหลดรูปภาพหลักฐานการวิ่ง');
        return;
    }

    const logId = 'l_' + Date.now();
    try {
        const finalProofUrl = await uploadProofImage(runnerId, logId, uploadedProofFile, uploadedProofDataUrl);

        const newLog = {
            id: logId,
            runnerId,
            date,
            distance,
            steps,
            inputType: currentLogMode,
            duration,
            location: location || (currentLogMode === 'steps' ? `Step Run (${steps.toLocaleString()} ก้าว)` : 'Running Activity'),
            note,
            kudos: 1,
            status: currentUser && currentUser.role === 'admin' ? 'approved' : 'pending',
            proofImg: finalProofUrl
        };

        await insertRunLog(newLog);

        document.getElementById('log-distance').value = '';
        document.getElementById('converted-steps-display').textContent = '0';
        document.getElementById('log-steps').value = '';
        document.getElementById('converted-km-display').textContent = '0.00';
        document.getElementById('log-duration').value = '';
        document.getElementById('log-location').value = '';
        document.getElementById('log-note').value = '';
        clearProofImage();

        refreshAllViews();
        showToast(newLog.status === 'approved'
            ? `บันทึกและอนุมัติผลวิ่ง ${distance.toFixed(2)} km เรียบร้อย!`
            : `ส่งผลวิ่ง ${distance.toFixed(2)} km แล้ว (รอ Admin ตรวจสอบ)`);
        switchTab('overview');
    } catch (err) {
        showToast('ส่งผลวิ่งไม่สำเร็จ: ' + err.message);
    }
}

export function toggleTeamInput() {
    const mode = document.querySelector('input[name="team-mode"]:checked').value;
    document.getElementById('existing-team-wrapper').classList.toggle('hidden', mode !== 'existing');
    document.getElementById('new-team-wrapper').classList.toggle('hidden', mode === 'existing');
}

export async function handleRegisterRunner(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = (document.getElementById('reg-email')?.value || '').trim().toLowerCase();
    const bib = document.getElementById('reg-bib').value.trim().toUpperCase();
    const goal = parseFloat(document.getElementById('reg-goal').value) || 100;
    const pin = document.getElementById('reg-pin').value.trim() || '1234';
    const mode = document.querySelector('input[name="team-mode"]:checked').value;
    const team = mode === 'existing'
        ? document.getElementById('reg-team-select').value
        : document.getElementById('reg-team-new').value.trim();

    if (!name || !bib || !team) return;

    const newRunner = { id: 'r_' + Date.now(), name, email, bib, team, goal, pin };
    try {
        await insertRunner(newRunner);
        document.getElementById('reg-name').value = '';
        if (document.getElementById('reg-email')) document.getElementById('reg-email').value = '';
        document.getElementById('reg-bib').value = '';
        document.getElementById('reg-team-new').value = '';

        refreshAllViews();
        showToast(`เพิ่มนักวิ่ง "${name}" เข้าทีม ${team} สำเร็จ`);
        document.getElementById('log-runner-id').value = newRunner.id;
        switchTab('log');
    } catch (err) {
        showToast('เพิ่มนักวิ่งไม่สำเร็จ: ' + err.message);
    }
}

export async function deleteRunLog(logId) {
    try {
        await removeRunLog(logId);
        refreshAllViews();
        showToast('ลบกิจกรรมเรียบร้อยแล้ว');
    } catch (err) {
        showToast('ลบกิจกรรมไม่สำเร็จ: ' + err.message);
    }
}

export function resetDemoData() {
    if (isCloudEnabled) {
        showToast('โหมด Supabase ออนไลน์: กรุณาจัดการข้อมูลผ่านหน้า Admin หรือ Supabase Dashboard');
        return;
    }
    resetLocalDemoData();
    refreshAllViews();
    showToast('รีเซ็ตข้อมูลเริ่มต้นแล้ว');
}

// ผูกฟังก์ชันเข้ากับ window เพื่อให้ inline onclick ใน HTML เรียกใช้งานได้
Object.assign(window, {
    handleMicrosoftLogin,
    switchLoginMode,
    handleRunnerLogin,
    handleAdminLogin,
    logout,
    openQuickRegisterModal,
    closeQuickRegisterModal,
    toggleQuickTeamInput,
    handleQuickRegister,
    openProofModal,
    closeProofModal,
    switchTab,
    renderLeaderboards,
    renderPersonalDashboard,
    viewRunnerProfile,
    giveKudos,
    setLogStatus,
    setLogInputMode,
    calculateStepsToKm,
    calculateKmToSteps,
    handleProofImageSelect,
    clearProofImage,
    handleLogRun,
    toggleTeamInput,
    handleRegisterRunner,
    deleteRunLog,
    resetDemoData
});
