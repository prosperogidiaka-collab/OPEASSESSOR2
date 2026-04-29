// OPE ASSESSOR - Complete Application Logic
// Blue Pastel Theme   Centered Layout   Protected Results Access

// ============================================================================
// STATE & STORAGE
// ============================================================================

const SUPER_ADMIN_EMAIL = 'prosperogidiaka@gmail.com';
const SUPER_ADMIN_PASSWORD = '7767737Prosper';
const ADMIN_CONTACT_EMAIL = SUPER_ADMIN_EMAIL;
const STORAGE_KEYS = {
  quizzes: 'ope_quizzes_v2',
  submissions: 'ope_submissions_v2',
  teacherId: 'ope_teacher_id',
  teachers: 'ope_teachers_v1',
  teacherSession: 'ope_teacher_session_v1',
  students: 'ope_teacher_students_v1'
};
const NETWORK_SYNC_KEYS = [
  STORAGE_KEYS.quizzes,
  STORAGE_KEYS.submissions,
  STORAGE_KEYS.teachers,
  STORAGE_KEYS.students
];
const NETWORK_STATE_KEY_MAP = {
  [STORAGE_KEYS.quizzes]: 'quizzes',
  [STORAGE_KEYS.submissions]: 'submissions',
  [STORAGE_KEYS.teachers]: 'teachers',
  [STORAGE_KEYS.students]: 'students'
};
const DEFAULT_NETWORK_SYNC_POLL_MS = 5000;
const PORTABLE_QUIZ_CODE_PREFIX = 'OPEQUIZ:';

function normalizeApiBaseUrl(value) {
  return (value || '').toString().trim().replace(/\/+$/, '');
}

function getNetworkSyncConfig() {
  const rawConfig = typeof window !== 'undefined' && window.OPE_CONFIG && typeof window.OPE_CONFIG === 'object'
    ? window.OPE_CONFIG
    : {};
  const apiBaseUrl = normalizeApiBaseUrl(rawConfig.apiBaseUrl);
  const pollIntervalMs = Number(rawConfig.syncPollIntervalMs) > 0
    ? Number(rawConfig.syncPollIntervalMs)
    : DEFAULT_NETWORK_SYNC_POLL_MS;
  return { apiBaseUrl, pollIntervalMs };
}

const NETWORK_SYNC_CONFIG = getNetworkSyncConfig();

function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return NETWORK_SYNC_CONFIG.apiBaseUrl
    ? `${NETWORK_SYNC_CONFIG.apiBaseUrl}${normalizedPath}`
    : normalizedPath;
}

function getTeacherId() {
  const session = load(STORAGE_KEYS.teacherSession);
  return session && session.teacherId ? session.teacherId : '';
}

const state = {
  view: 'home',
  currentQuiz: null,
  currentSubmission: null,
  inFullscreen: false,
  screenshotDetected: false,
  teacherId: getTeacherId(),
  prefillQuizCode: ''
};
let _didCompactSubmissions = false;
let networkSyncReady = false;
let networkSyncTimer = null;
let networkSyncInFlight = null;
let networkSyncFailed = false;
let networkSyncFailureMessage = '';
const pendingNetworkWrites = new Set();
let _historyApplying = false;
let _lastHistoryView = '';

function canUseNetworkSync() {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  if (NETWORK_SYNC_CONFIG.apiBaseUrl) return /^https?:\/\//i.test(NETWORK_SYNC_CONFIG.apiBaseUrl);
  return /^https?:$/i.test(window.location.protocol || '');
}

function writeLocalStorageValue(key, value) {
  try { localStorage[key] = JSON.stringify(value); return true; }
  catch(e) { showNotification('Storage quota exceeded', 'error'); return false; }
}

function readLocalStorageValue(key) {
  try { return JSON.parse(localStorage[key] || 'null'); }
  catch(e) { return null; }
}

function copyTextToClipboard(text, successMessage = 'Copied') {
  const value = (text || '').toString();
  const fallbackCopy = () => {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', left: '-10000px', top: '0' });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Copy command failed');
  };
  const done = () => { showNotification(successMessage, 'success'); return true; };
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(value).then(done).catch(() => {
      try { fallbackCopy(); return done(); } catch(e) { showNotification('Copy failed. Select and copy manually.', 'error'); return false; }
    });
  }
  try { fallbackCopy(); return Promise.resolve(done()); }
  catch(e) { showNotification('Copy failed. Select and copy manually.', 'error'); return Promise.resolve(false); }
}

function enhancePasswordFields(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-password-toggle-ready])').forEach((input) => {
    input.dataset.passwordToggleReady = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.textContent = 'Show';
    btn.onclick = () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    };
    wrapper.appendChild(btn);
  });
}

function isMeaningfulQuestion(question) {
  if (!question || typeof question !== 'object') return false;
  const text = (question.question || '').toString().trim();
  const options = Array.isArray(question.options) ? question.options.filter(opt => (opt || '').toString().trim()) : [];
  const answer = (question.answer || '').toString().trim();
  return !!text && options.length >= 2 && !!answer;
}

function isEmptySharedValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === 'object') return Object.keys(value).length === 0;
  return value == null;
}

function getRecordStamp(item) {
  const raw = item && (item.updatedAt || item.editedAt || item.submittedAt || item.uploadedAt || item.licenseUpdatedAt || item.licenseRequestedAt || item.idChangedAt || item.createdAt || item.startedAt);
  const stamp = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(stamp) ? stamp : 0;
}

function getStudentRecordKey(item, index = 0) {
  return normalizeEmail(item?.email || item?.registrationNo || item?.id || item?.name || `student-${index}`);
}

function mergeStudentListsForSync(localList = [], remoteList = []) {
  const merged = new Map();
  const add = (item, index) => {
    if (!item || typeof item !== 'object') return;
    const key = getStudentRecordKey(item, index);
    const current = merged.get(key);
    if (!current || getRecordStamp(item) >= getRecordStamp(current)) merged.set(key, item);
  };
  remoteList.forEach(add);
  localList.forEach(add);
  return Array.from(merged.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function mergeRecordMapForSync(localValue = {}, remoteValue = {}) {
  const merged = { ...(remoteValue || {}) };
  Object.keys(localValue || {}).forEach((key) => {
    const localItem = localValue[key];
    const remoteItem = remoteValue ? remoteValue[key] : undefined;
    if (Array.isArray(localItem) || Array.isArray(remoteItem)) {
      merged[key] = mergeStudentListsForSync(localItem || [], remoteItem || []);
      return;
    }
    if (!remoteItem || getRecordStamp(localItem) >= getRecordStamp(remoteItem)) merged[key] = localItem;
  });
  return merged;
}

function mergeTeacherRecord(localItem = {}, remoteItem = {}) {
  const localStamp = getRecordStamp(localItem);
  const remoteStamp = getRecordStamp(remoteItem);
  const base = remoteStamp >= localStamp ? { ...(localItem || {}), ...(remoteItem || {}) } : { ...(remoteItem || {}), ...(localItem || {}) };
  const localLicenseStamp = localItem?.licenseUpdatedAt ? new Date(localItem.licenseUpdatedAt).getTime() : 0;
  const remoteLicenseStamp = remoteItem?.licenseUpdatedAt ? new Date(remoteItem.licenseUpdatedAt).getTime() : 0;
  const licenseSource = remoteLicenseStamp >= localLicenseStamp ? remoteItem : localItem;
  ['licenseEndsAt', 'licenseStopped', 'licenseRequestStatus', 'licenseUpdatedAt'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(licenseSource || {}, field)) base[field] = licenseSource[field];
  });
  if (!base.role && normalizeEmail(base.teacherId || base.email) === SUPER_ADMIN_EMAIL) base.role = 'super_admin';
  return base;
}

function mergeTeacherMapForSync(localValue = {}, remoteValue = {}) {
  const merged = {};
  const keys = new Set([...Object.keys(remoteValue || {}), ...Object.keys(localValue || {})]);
  keys.forEach((key) => {
    merged[key] = mergeTeacherRecord(localValue ? localValue[key] : {}, remoteValue ? remoteValue[key] : {});
  });
  return merged;
}

function mergeSubmissionListsForSync(localList, remoteList) {
  const merged = new Map();
  const makeKey = (item, index) => {
    const quizId = item?.quizId || '';
    const email = (item?.email || '').toString().trim().toLowerCase();
    const stamp = item?.submittedAt || item?.updatedAt || item?.startedAt || `idx-${index}`;
    return `${quizId}::${email}::${stamp}`;
  };
  (remoteList || []).forEach((item, index) => merged.set(makeKey(item, index), item));
  (localList || []).forEach((item, index) => merged.set(makeKey(item, index), item));
  return Array.from(merged.values());
}

function mergeSharedValue(storageKey, localValue, remoteValue) {
  if (storageKey === STORAGE_KEYS.submissions) {
    return mergeSubmissionListsForSync(localValue || [], remoteValue || []);
  }
  if (storageKey === STORAGE_KEYS.teachers) {
    return mergeTeacherMapForSync(localValue || {}, remoteValue || {});
  }
  if (storageKey === STORAGE_KEYS.quizzes || storageKey === STORAGE_KEYS.teachers || storageKey === STORAGE_KEYS.students) {
    return mergeRecordMapForSync(localValue || {}, remoteValue || {});
  }
  if (localValue && typeof localValue === 'object' && remoteValue && typeof remoteValue === 'object' && !Array.isArray(localValue) && !Array.isArray(remoteValue)) {
    return { ...remoteValue, ...localValue };
  }
  return isEmptySharedValue(remoteValue) && !isEmptySharedValue(localValue) ? localValue : remoteValue;
}

function applyNetworkSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  let changed = false;
  NETWORK_SYNC_KEYS.forEach((storageKey) => {
    const stateKey = NETWORK_STATE_KEY_MAP[storageKey];
    if (!stateKey || pendingNetworkWrites.has(storageKey)) return;
    const localValue = readLocalStorageValue(storageKey);
    const remoteValue = snapshot[stateKey];
    const mergedValue = mergeSharedValue(storageKey, localValue, remoteValue);
    const localText = JSON.stringify(localValue);
    const mergedText = JSON.stringify(mergedValue);
    const remoteText = JSON.stringify(remoteValue);
    if (mergedText !== localText) changed = true;
    writeLocalStorageValue(storageKey, mergedValue);
    if (mergedText !== remoteText) {
      pushNetworkValue(storageKey, mergedValue);
    }
  });
  return changed;
}

async function pullNetworkState(force = false) {
  if (!canUseNetworkSync()) return false;
  if (networkSyncInFlight && !force) return networkSyncInFlight;
  networkSyncInFlight = fetch(buildApiUrl('/api/state'), { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error('Network sync unavailable');
      const snapshot = await res.json();
      const changed = applyNetworkSnapshot(snapshot);
      networkSyncReady = true;
      networkSyncFailed = false;
      networkSyncFailureMessage = '';
      return changed;
    })
    .catch((error) => {
      networkSyncFailed = true;
      networkSyncFailureMessage = error && error.message ? error.message : 'Network sync unavailable';
      return false;
    })
    .finally(() => { networkSyncInFlight = null; });
  return networkSyncInFlight;
}

async function pushNetworkValue(key, value) {
  if (!canUseNetworkSync() || !NETWORK_STATE_KEY_MAP[key]) return false;
  pendingNetworkWrites.add(key);
  try {
    const res = await fetch(buildApiUrl(`/api/state/${encodeURIComponent(NETWORK_STATE_KEY_MAP[key])}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    if (!res.ok) throw new Error('Failed to save shared state');
    networkSyncReady = true;
    networkSyncFailed = false;
    networkSyncFailureMessage = '';
    return true;
  } catch (err) {
    networkSyncFailed = true;
    networkSyncFailureMessage = err && err.message ? err.message : 'Failed to save shared state';
    console.error('Network sync save failed for', key, err);
    return false;
  } finally {
    pendingNetworkWrites.delete(key);
  }
}

function isSharedSyncAvailable() {
  return canUseNetworkSync() && networkSyncReady;
}

function getSharedSyncWarningMessage() {
  if (!canUseNetworkSync()) return 'Shared sync is not available in this browser session.';
  return networkSyncFailureMessage || 'Shared sync is not active on this deployment.';
}

async function syncSharedKeys(keys = []) {
  if (!canUseNetworkSync()) return false;
  const targetKeys = [...new Set((Array.isArray(keys) ? keys : []).filter((key) => NETWORK_SYNC_KEYS.includes(key)))];
  if (!targetKeys.length) return isSharedSyncAvailable();
  let ok = true;
  for (const key of targetKeys) {
    const saved = await pushNetworkValue(key, readLocalStorageValue(key));
    if (!saved) ok = false;
  }
  if (ok) await pullNetworkState(true);
  return ok;
}

function encodeTextToBase64(value) {
  try {
    const bytes = new TextEncoder().encode((value || '').toString());
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  } catch (error) {
    return btoa(unescape(encodeURIComponent((value || '').toString())));
  }
}

function decodeTextFromBase64(value) {
  try {
    const binary = atob((value || '').toString());
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (error) {
    return decodeURIComponent(escape(atob((value || '').toString())));
  }
}

function buildPortableQuizSnapshot(quiz) {
  if (!quiz || typeof quiz !== 'object') return {};
  return {
    id: quiz.id,
    examName: quiz.examName || '',
    title: quiz.title || '',
    timeLimit: quiz.timeLimit || 0,
    maxGrade: quiz.maxGrade || 100,
    attemptLimit: quiz.attemptLimit || 1,
    passMark: quiz.passMark || 50,
    negativeMarkEnabled: !!quiz.negativeMarkEnabled,
    negativeMarkValue: quiz.negativeMarkValue || 0,
    showInstantResult: quiz.showInstantResult !== false,
    showTopicsAfterSubmission: !!quiz.showTopicsAfterSubmission,
    shuffleQs: quiz.shuffleQs !== false,
    shuffleOpts: quiz.shuffleOpts !== false,
    verticalLayout: !!quiz.verticalLayout,
    rankingEnabled: !!quiz.rankingEnabled,
    whitelist: Array.isArray(quiz.whitelist) ? quiz.whitelist : [],
    certificateSignatories: Array.isArray(quiz.certificateSignatories) ? quiz.certificateSignatories : [],
    scheduleStart: quiz.scheduleStart || '',
    scheduleEnd: quiz.scheduleEnd || '',
    subjects: (quiz.subjects || []).map((subject) => ({
      name: subject && subject.name ? subject.name : 'General',
      questionCount: subject && subject.questionCount != null ? subject.questionCount : null,
      questions: ((subject && Array.isArray(subject.bankQuestions) && subject.bankQuestions.length ? subject.bankQuestions : subject && subject.questions) || []).map((question) => ({ ...question }))
    }))
  };
}

function encodeQuizToPortablePayload(quiz) {
  return encodeURIComponent(encodeTextToBase64(JSON.stringify(buildPortableQuizSnapshot(quiz))));
}

function encodeQuizToPortableCode(quiz) {
  return `${PORTABLE_QUIZ_CODE_PREFIX}${encodeQuizToPortablePayload(quiz)}`;
}

async function copyQuizAccessLink(quiz) {
  if (!quiz || !quiz.id) return false;
  const sharedSyncOk = await syncSharedKeys([STORAGE_KEYS.quizzes, STORAGE_KEYS.students]);
  const portableFallback = !sharedSyncOk;
  await copyTextToClipboard(encodeQuizToLink(quiz, { portable: portableFallback }), portableFallback ? 'Portable student link copied' : 'Quiz link copied');
  if (!sharedSyncOk) {
    showNotification(`Portable student link copied because shared sync is down. Students can open that link on another device right now. ${getSharedSyncWarningMessage()}`, 'warning', 9000);
  }
  return true;
}

async function copyQuizAccessCode(quiz) {
  if (!quiz || !quiz.id) return false;
  const sharedSyncOk = await syncSharedKeys([STORAGE_KEYS.quizzes, STORAGE_KEYS.students]);
  if (sharedSyncOk) {
    await copyTextToClipboard(quiz.id, 'Student code copied');
    return true;
  }
  await copyTextToClipboard(encodeQuizToPortableCode(quiz), 'Portable student code copied');
  showNotification('Shared sync is down, so a portable student code was copied. Students can paste it into the Quiz Code / Magic Link box.', 'warning', 9000);
  return true;
}

async function syncAllLocalDataToCloud() {
  if (!canUseNetworkSync()) {
    showNotification('Shared sync is not available on this deployment.', 'error');
    return false;
  }
  const ok = await syncSharedKeys([
    STORAGE_KEYS.quizzes,
    STORAGE_KEYS.students,
    STORAGE_KEYS.submissions,
    STORAGE_KEYS.teachers
  ]);
  if (ok) {
    const quizCount = Object.keys(getAllQuizzes() || {}).length;
    showNotification(`Cloud sync completed. ${quizCount} quiz(es) are now uploaded from this device.`, 'success', 7000);
  } else {
    showNotification(`Cloud sync failed. ${getSharedSyncWarningMessage()}`, 'error', 8000);
  }
  return ok;
}

function startNetworkSyncLoop() {
  if (!canUseNetworkSync() || networkSyncTimer) return;
  networkSyncTimer = setInterval(() => {
    pullNetworkState().then((changed) => {
      if (changed && state.view !== 'take') render();
    });
  }, NETWORK_SYNC_CONFIG.pollIntervalMs);
  window.addEventListener('focus', () => { pullNetworkState(true).then(() => render()); });
}

async function initializeApp() {
  await pullNetworkState(true);
  ensureSuperAdminAccount();
  migrateAndNormalizeSubmissions();
  const params = new URLSearchParams(window.location.search);
  if (params.has('q')) {
    const id = params.get('q');
    const quiz = getAllQuizzes()[id];
    if (quiz) {
      state.currentQuiz = quiz;
      state.prefillQuizCode = id;
      state.view = 'student';
    }
  }
  if (params.has('import')) {
    const quiz = decodeQuizFromString(params.get('import'));
    if (quiz) {
      const quizzes = getAllQuizzes();
      quizzes[quiz.id] = quiz;
      saveAllQuizzes(quizzes);
      state.currentQuiz = quiz;
      state.view = 'take';
    }
  }
  startNetworkSyncLoop();
  render();
}

function save(key, value) {
  if (!writeLocalStorageValue(key, value)) return;
  if (NETWORK_SYNC_KEYS.includes(key)) pushNetworkValue(key, value);
}

function load(key) {
  return readLocalStorageValue(key);
}

function getAllQuizzes() { return load(STORAGE_KEYS.quizzes) || {}; }
function getAllSubmissions() { return load(STORAGE_KEYS.submissions) || []; }
function getAllTeachers() { return load(STORAGE_KEYS.teachers) || {}; }
function getAllTeacherStudents() { return load(STORAGE_KEYS.students) || {}; }
function saveAllQuizzes(q) { save(STORAGE_KEYS.quizzes, q); }
function saveAllSubmissions(s) { save(STORAGE_KEYS.submissions, s); }
function saveAllTeachers(t) { save(STORAGE_KEYS.teachers, t); }
function saveAllTeacherStudents(s) { save(STORAGE_KEYS.students, s); }

function compactStoredSubmissions() {
  const submissions = getAllSubmissions();
  let changed = false;
  submissions.forEach((sub) => {
    if (!sub || !Array.isArray(sub.snapshots)) return;
    if (sub.snapshots.length > 6) {
      sub.snapshots = sub.snapshots.slice(-6);
      changed = true;
    }
  });
  if (changed) saveAllSubmissions(submissions);
}

function updateLatestSubmissionByQuizAndEmail(quizId, email, updater) {
  const submissions = getAllSubmissions();
  let index = -1;
  for (let i = submissions.length - 1; i >= 0; i--) {
    const item = submissions[i];
    if (item.quizId === quizId && normalizeEmail(item.email) === normalizeEmail(email)) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;
  const next = { ...submissions[index] };
  updater(next);
  next.updatedAt = new Date().toISOString();
  submissions[index] = next;
  saveAllSubmissions(submissions);
  return next;
}

function findSubmissionIndexByIdentity(submissions, quizId, email, submittedAt = '') {
  return (submissions || []).findIndex((item) =>
    item.quizId === quizId &&
    normalizeEmail(item.email) === normalizeEmail(email) &&
    (item.submittedAt || '') === (submittedAt || '')
  );
}

function getCurrentTeacher() {
  if (!state.teacherId) return null;
  return getAllTeachers()[normalizeEmail(state.teacherId)] || null;
}

function isTeacherLoggedIn() { return !!getCurrentTeacher(); }
function isSuperAdmin() { return normalizeEmail(state.teacherId) === SUPER_ADMIN_EMAIL; }

function getTeacherLicenseStatus(teacher = getCurrentTeacher()) {
  if (!teacher) return { active: false, label: 'Not logged in', detail: 'Login required', endsAt: '' };
  if (teacher.role === 'super_admin' || normalizeEmail(teacher.teacherId || teacher.email) === SUPER_ADMIN_EMAIL) {
    return { active: true, unlimited: true, label: 'Unlimited licence', detail: 'Admin licence never expires', endsAt: '' };
  }
  if (teacher.licenseStopped) return { active: false, stopped: true, label: 'Licence stopped', detail: 'Contact admin for a higher duration', endsAt: teacher.licenseEndsAt || '' };
  if (!teacher.licenseEndsAt) return { active: false, label: 'No active licence', detail: 'Request licence to set new questions', endsAt: '' };
  const ends = new Date(teacher.licenseEndsAt);
  if (Number.isNaN(ends.getTime())) return { active: false, label: 'Invalid licence', detail: 'Contact admin', endsAt: '' };
  if (ends.getTime() < Date.now()) return { active: false, expired: true, label: 'Licence expired', detail: 'Request a higher duration to set new questions', endsAt: teacher.licenseEndsAt };
  return { active: true, label: 'Licensed', detail: 'Licence ends ' + ends.toLocaleString(), endsAt: teacher.licenseEndsAt };
}

function canSetQuestions() {
  return isSuperAdmin() || getTeacherLicenseStatus().active;
}

function requestTeacherLicense() {
  const teacher = getCurrentTeacher();
  if (!teacher) { state.view = 'teacher.login'; render(); return; }
  const teachers = getAllTeachers();
  const id = normalizeEmail(teacher.teacherId || teacher.email);
  teachers[id] = { ...teachers[id], licenseRequestedAt: new Date().toISOString(), licenseRequestStatus: 'pending' };
  teachers[id].updatedAt = new Date().toISOString();
  saveAllTeachers(teachers);
  showNotification('Licence request saved. Please email admin for quicker response.', 'success', 6000);
  const subject = encodeURIComponent('OPE Assessor Licence Request');
  const body = encodeURIComponent(`Hello Admin,\n\nPlease activate or extend my OPE Assessor licence.\n\nTeacher ID: ${id}\nRequest time: ${new Date().toLocaleString()}\n\nThank you.`);
  setTimeout(() => {
    if (confirm('Your licence request has been saved. Do you want to email the admin now for quicker response?')) {
      window.location.href = `mailto:${encodeURIComponent(ADMIN_CONTACT_EMAIL)}?subject=${subject}&body=${body}`;
    }
  }, 100);
  render();
}

function showLicenseRequired() {
  const status = getTeacherLicenseStatus();
  let modal = document.getElementById('licenseRequiredModal'); if (modal) modal.remove();
  modal = document.createElement('div'); modal.id='licenseRequiredModal'; modal.style.position='fixed'; modal.style.inset='0'; modal.style.background='rgba(15,23,42,.45)'; modal.style.zIndex=30000; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center';
  const inner = document.createElement('div'); inner.className='card-beautiful p-6'; inner.style.width='min(520px,94%)';
  inner.innerHTML = `
    <div class="h2">${escapeHtml(status.label)}</div>
    <p class="small">${escapeHtml(status.detail)}</p>
    <p class="small">You can still view your existing quizzes, results, and students. A valid licence is required only to set new questions.</p>
    <p class="small"><strong>For quicker response:</strong> after requesting, send an email to ${escapeHtml(ADMIN_CONTACT_EMAIL)}.</p>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
      <button id="closeLicenseRequired" class="btn btn-ghost">Close</button>
      <button id="requestLicenseBtn" class="btn btn-primary">Request Licence</button>
    </div>
  `;
  modal.appendChild(inner); document.body.appendChild(modal);
  document.getElementById('closeLicenseRequired').onclick = () => modal.remove();
  document.getElementById('requestLicenseBtn').onclick = () => { modal.remove(); requestTeacherLicense(); };
}

function requireTeacher() {
  if (isTeacherLoggedIn()) return true;
  state.view = 'teacher.login';
  return false;
}

function logoutTeacher() {
  localStorage.removeItem(STORAGE_KEYS.teacherSession);
  state.teacherId = '';
  state.currentQuiz = null;
  state.view = 'teacher.login';
  render();
}

function addStudentsToTeacher(list, sourceQuizId = '') {
  if (!state.teacherId || !Array.isArray(list) || !list.length) return;
  const all = getAllTeacherStudents();
  const key = normalizeEmail(state.teacherId);
  const existing = all[key] || [];
  const byKey = {};
  existing.forEach(s => {
    byKey[normalizeEmail(s.email || s.id || s.registrationNo || s.name)] = s;
  });
  list.forEach(item => {
    const student = {
      name: (item.name || '').toString().trim(),
      email: (item.email || '').toString().trim(),
      id: (item.id || item.registrationNo || '').toString().trim(),
      registrationNo: (item.registrationNo || item.id || '').toString().trim(),
      sourceQuizId,
      uploadedAt: item.uploadedAt || new Date().toISOString()
    };
    const studentKey = normalizeEmail(student.email || student.id || student.registrationNo || student.name);
    if (studentKey) byKey[studentKey] = { ...(byKey[studentKey] || {}), ...student };
  });
  all[key] = Object.values(byKey);
  saveAllTeacherStudents(all);
}

function getTeacherStudents() {
  return getAllTeacherStudents()[normalizeEmail(state.teacherId)] || [];
}

function ensureSuperAdminAccount() {
  const teachers = getAllTeachers();
  const id = normalizeEmail(SUPER_ADMIN_EMAIL);
  teachers[id] = {
    ...(teachers[id] || {}),
    teacherId: id,
    email: id,
    password: SUPER_ADMIN_PASSWORD,
    role: 'super_admin',
    createdAt: teachers[id]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveAllTeachers(teachers);
}

// Normalize email helper
function normalizeEmail(email) {
  try { return (email || '').toString().trim().toLowerCase(); } catch(e) { return ''; }
}

// Migrate existing submissions: normalize emails and deduplicate by quizId+email (keep latest)
function migrateAndNormalizeSubmissions() {
  try {
    const subs = getAllSubmissions() || [];
    const map = {};
    for (const s of subs) {
      const key = `${s.quizId}::${normalizeEmail(s.email)}`;
      if (!map[key]) map[key] = s;
      else {
        const a = map[key];
        const b = s;
        const at = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        if (bt >= at) map[key] = b; // keep latest
      }
    }
    const out = Object.values(map);
    if (out.length !== subs.length) saveAllSubmissions(out);
  } catch (e) { console.warn('Migration error', e); }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function gen6Digit() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeQuestionId(question, index = 0) {
  const raw = [
    question._sourceId || question.id || '',
    question.subject || question._subject || '',
    question.question || '',
    (question.options || []).join('|'),
    question.answer || '',
    index
  ].join('::');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 'q_' + Math.abs(hash).toString(36);
}

function normalizeRichText(value) {
  return (value == null ? '' : String(value)).replace(/\r\n?/g, '\n');
}

function normalizeQuestionForStorage(question, index = 0, subjectName = 'General') {
  const normalized = {
    ...question,
    question: normalizeRichText(question.question || ''),
    subject: question.subject || subjectName,
    options: Array.isArray(question.options) ? question.options.map((option) => normalizeRichText(option)) : [],
    answer: (question.answer || '').toString().trim().toUpperCase(),
    difficulty: question.difficulty || 'Medium'
  };
  normalized._sourceId = question._sourceId || question.id || makeQuestionId(normalized, index);
  return normalized;
}

function prepareQuestionForStudent(question, shuffleOptions) {
  const prepared = JSON.parse(JSON.stringify(question));
  prepared.options = Array.isArray(prepared.options) ? prepared.options.slice() : [];
  const correctLetter = (prepared.answer || '').toString().trim().toUpperCase();
  const correctIndex = correctLetter.charCodeAt(0) - 65;
  const correctText = prepared.options[correctIndex] || '';
  if (shuffleOptions && prepared.options.length) {
    shuffle(prepared.options);
    const newIndex = prepared.options.findIndex(opt => opt === correctText);
    if (newIndex >= 0) prepared.answer = String.fromCharCode(65 + newIndex);
  }
  prepared._correctText = correctText;
  return prepared;
}

// Compute facility index for a quiz by aggregating stored submissions
function computeFacilityIndex(quizId) {
  const submissions = getAllSubmissions().filter(s => s.quizId === quizId);
  const quiz = getAllQuizzes()[quizId];
  if (!quiz) return [];

  // Build a stable source-question map. This lets a 100-question bank with per-student
  // random 50-question draws analyze all 100 questions correctly.
  const quizQuestions = [];
  for (const subj of (quiz.subjects || [])) {
    const source = Array.isArray(subj.bankQuestions) && subj.bankQuestions.length ? subj.bankQuestions : subj.questions;
    for (let i = 0; i < (source || []).length; i++) {
      const q = normalizeQuestionForStorage(source[i], i, subj.name || 'General');
      quizQuestions.push({ _sourceId: q._sourceId, question: q.question || '', subject: subj.name || q.subject || 'General', options: q.options || [], answer: q.answer || null, difficulty: q.difficulty || 'Medium' });
    }
  }

  const byId = {};
  quizQuestions.forEach((q, idx) => { byId[q._sourceId || makeQuestionId(q, idx)] = q; });

  const results = quizQuestions.map((qq, idx) => {
    const optionCounts = (qq.options || []).map((opt, optionIndex) => ({
      letter: String.fromCharCode(65 + optionIndex),
      option: opt,
      count: 0
    }));
    let seen = 0, attempted = 0, correct = 0, unanswered = 0;
    submissions.forEach(submission => {
      const allQuestions = submission.allQuestions || [];
      const answerMap = submission.answers || {};
      allQuestions.forEach((studentQ, studentIndex) => {
        const sourceId = studentQ._sourceId || makeQuestionId(studentQ, studentIndex);
        if (sourceId !== qq._sourceId) return;
        seen++;
        const ans = answerMap[studentIndex];
        if (typeof ans === 'undefined' || ans === null || ans === '') {
          unanswered++;
          return;
        }
        attempted++;
        if (ans === studentQ.answer) correct++;
        const chosenText = optionText(studentQ, ans);
        const originalOptionIndex = (qq.options || []).findIndex(opt => opt === chosenText);
        if (originalOptionIndex >= 0 && optionCounts[originalOptionIndex]) {
          optionCounts[originalOptionIndex].count++;
        }
      });
    });
    const fi = attempted > 0 ? (correct / attempted) : null;
    return {
      index: idx + 1,
      sourceId: qq._sourceId,
      subject: qq.subject,
      question: qq.question,
      options: qq.options,
      answer: qq.answer,
      difficulty: qq.difficulty,
      correct,
      seen,
      attempted,
      unanswered,
      notSeen: Math.max(0, submissions.length - seen),
      optionCounts,
      facilityIndex: fi
    };
  });

  return results;
}

function getQuizQuestionsForTaking(quiz) {
  let allQuestions = [];
  for (const subj of (quiz.subjects || [])) {
    const source = Array.isArray(subj.bankQuestions) && subj.bankQuestions.length ? subj.bankQuestions : subj.questions;
    let normalized = (source || []).filter(isMeaningfulQuestion).map((question, index) => {
      const item = normalizeQuestionForStorage(question, index, subj.name || 'General');
      item._subject = subj.name || item.subject || 'General';
      return item;
    });
    if (quiz.shuffleQs) shuffle(normalized);
    const subjectPickCount = parseInt(subj.questionCount || 0, 10) || 0;
    if (subjectPickCount > 0 && subjectPickCount < normalized.length) normalized = normalized.slice(0, subjectPickCount);
    allQuestions.push(...normalized);
  }
  if (quiz.shuffleQs) shuffle(allQuestions);
  return allQuestions.map(question => prepareQuestionForStudent(question, !!quiz.shuffleOpts));
}

function encodeQuizToLink(q, options = {}) {
  const base = window.location.href.split('?')[0];
  if (!q || !q.id) return base;
  if (options.portable) {
    return `${base}?q=${encodeURIComponent(q.id)}&import=${encodeQuizToPortablePayload(q)}`;
  }
  return `${base}?q=${encodeURIComponent(q.id)}`;
}

function parseQuizAccessInput(value) {
  const raw = (value || '').trim();
  if (!raw) return { code: '', link: '' };
  if (/^https?:\/\//i.test(raw)) return { code: '', link: raw };
  if (raw.toUpperCase().startsWith(PORTABLE_QUIZ_CODE_PREFIX)) return { code: `${PORTABLE_QUIZ_CODE_PREFIX}${raw.slice(PORTABLE_QUIZ_CODE_PREFIX.length).replace(/\s+/g, '')}`, link: '' };
  const qMatch = raw.match(/[?&]q=([^&]+)/i);
  if (qMatch) return { code: decodeURIComponent(qMatch[1]), link: raw };
  return { code: raw.replace(/\s+/g, ''), link: '' };
}

function decodeQuizFromString(encoded) {
  try {
    return JSON.parse(decodeTextFromBase64(decodeURIComponent(encoded)));
  } catch(e) { return null; }
}

function resolveQuizFromAccess(access) {
  const all = getAllQuizzes();
  if (access && access.link) {
    try {
      const params = new URLSearchParams((new URL(access.link)).search);
      if (params.has('q')) {
        const matchedQuiz = all[params.get('q')] || null;
        if (matchedQuiz) return matchedQuiz;
      }
      if (params.has('import')) {
        const importedQuiz = decodeQuizFromString(params.get('import'));
        if (importedQuiz) {
          all[importedQuiz.id] = importedQuiz;
          saveAllQuizzes(all);
          return importedQuiz;
        }
      }
    } catch (e) {
      return null;
    }
  }
  if (access && access.code) {
    if (access.code.toUpperCase().startsWith(PORTABLE_QUIZ_CODE_PREFIX)) {
      const importedQuiz = decodeQuizFromString(access.code.slice(PORTABLE_QUIZ_CODE_PREFIX.length));
      if (importedQuiz) {
        all[importedQuiz.id] = importedQuiz;
        saveAllQuizzes(all);
        return importedQuiz;
      }
      return null;
    }
    return all[access.code] || null;
  }
  return null;
}

async function resolveQuizFromAccessWithSync(access) {
  let quiz = resolveQuizFromAccess(access);
  if (quiz || !canUseNetworkSync()) return quiz;
  await pullNetworkState(true);
  quiz = resolveQuizFromAccess(access);
  return quiz;
}

// ============================================================================
// RENDER ROOT (modified to route sidebar "Quizzes" to teacher.quizzes)
// ============================================================================

function render() {
  if (!_didCompactSubmissions) {
    compactStoredSubmissions();
    _didCompactSubmissions = true;
  }
  if (window.history && !_historyApplying && state.view !== _lastHistoryView) {
    const historyState = { view: state.view, quizId: state.currentQuiz && state.currentQuiz.id ? state.currentQuiz.id : '' };
    if (!_lastHistoryView) window.history.replaceState(historyState, '', window.location.href);
    else window.history.pushState(historyState, '', window.location.href);
    _lastHistoryView = state.view;
  }
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Topbar (updated with Home / Teacher / Student nav)
  const top = document.createElement('header');
  top.className = 'topbar';
  top.innerHTML = `
    <div class="container" style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(90deg,var(--primary),var(--primary-600));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800">OPE</div>
        <div>
          <div class="title">OPE Assessor</div>
          <div class="small">Zero-friction assessments - privacy first</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px">
        <div class="header-nav" role="navigation" aria-label="Main">
          <button id="topHome" class="nav-btn">Home</button>
          <button id="topTeacher" class="nav-btn">Teacher</button>
          <button id="topStudent" class="nav-btn">Student</button>
        </div>
        <div class="top-actions">
          <button id="openTeacherQuiz" class="btn btn-ghost btn-sm">Open Quiz</button>
          ${isTeacherLoggedIn() || isSuperAdmin() ? '<button id="topAlerts" class="btn btn-ghost btn-sm" aria-label="Notifications">Alerts</button>' : ''}
          <div class="small" id="userBadge">${isSuperAdmin() ? 'Admin: ' + escapeHtml(SUPER_ADMIN_EMAIL) : isTeacherLoggedIn() ? 'Teacher' : 'Guest'}</div>
          ${isTeacherLoggedIn() ? '<button id="logoutTeacher" class="btn btn-ghost btn-sm">Logout</button>' : ''}
        </div>
      </div>
    </div>
  `;
  if (state.view !== 'take') app.appendChild(top);

  // Layout: sidebar + main
  const layout = document.createElement('div');
  layout.className = 'layout container';

  // Sidebar creation (no inline active logic)
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar card';
  sidebar.innerHTML = `
    <div class="section-title">Navigation</div>
    <div id="navOverview" class="nav-item">Overview</div>
    <div id="navBank" class="nav-item">Question Bank</div>
    <div class="section-title">Manage</div>
    <div id="navStudents" class="nav-item">Students</div>
    <div id="navSettings" class="nav-item">Settings</div>
  `;

  const main = document.createElement('main');
  main.className = 'main';

  // route dispatch (same as before)
  if (state.view === 'home') {
    const homeDiv = renderHomePage();
    main.appendChild(homeDiv);
  } else if (state.view === 'admin') {
    state.view = isSuperAdmin() ? 'teacher.settings' : 'teacher.login';
    return render();
  } else if (state.view === 'teacher.login') {
    main.appendChild(renderTeacherAuth());
  } else if (state.view === 'teacher') {
    if (!requireTeacher()) return render();
    main.appendChild(renderTeacherOverview());
  } else if (state.view === 'teacher.quizzes') {
    if (!requireTeacher()) return render();
    main.appendChild(renderTeacherQuizzes());
  } else if (state.view === 'teacher.bank') {
    if (!requireTeacher()) return render();
    main.appendChild(renderQuestionBankView());
  } else if (state.view === 'teacher.students') {
    if (!requireTeacher()) return render();
    main.appendChild(renderStudentsView());
  } else if (state.view === 'teacher.settings') {
    if (!requireTeacher()) return render();
    main.appendChild(renderSettingsView());
  } else if (state.view === 'student') {
    main.appendChild(renderStudentEntry());
  } else if (state.view === 'take') {
    main.appendChild(renderQuizTake());
  } else if (state.view === 'results' || state.view === 'teacher.results') {
    main.appendChild(renderResultsView());
  } else {
    // fallback: existing views
    // ...existing code...
  }

  if (state.view !== 'teacher.login' && state.view !== 'student' && state.view !== 'home' && state.view !== 'take' && state.view !== 'admin') layout.appendChild(sidebar);
  layout.appendChild(main);
  app.appendChild(layout);

  // Wire header and sidebar nav, set active classes
  setTimeout(() => {
    // header nav
    if (!document.getElementById('topHome')) return;
    document.getElementById('topHome').onclick = () => { state.view = 'home'; render(); };
    document.getElementById('topTeacher').onclick = () => { state.view = isTeacherLoggedIn() ? 'teacher' : 'teacher.login'; render(); };
    document.getElementById('topStudent').onclick = () => { state.view = 'student'; render(); };
    const openBtn = document.getElementById('openTeacherQuiz'); if (openBtn) openBtn.onclick = ()=> showTeacherAccessModal();
    const alertsBtn = document.getElementById('topAlerts'); if (alertsBtn) alertsBtn.onclick = () => showAlertsPanel();
    const logoutBtn = document.getElementById('logoutTeacher'); if (logoutBtn) logoutBtn.onclick = () => logoutTeacher();

    // sidebar nav handlers
    const navOverview = document.getElementById('navOverview');
    const navBank = document.getElementById('navBank');
    const navStudents = document.getElementById('navStudents');
    const navSettings = document.getElementById('navSettings');
    if (navOverview && navBank && navStudents && navSettings) {
      navOverview.onclick = () => { state.view = 'teacher'; render(); };
      navBank.onclick = () => { state.view = 'teacher.bank' ; render(); };
      navStudents.onclick = () => { state.view = 'teacher.students' ; render(); };
      navSettings.onclick = () => { state.view = 'teacher.settings' ; render(); };

      // set active classes robustly
      document.querySelectorAll('.sidebar .nav-item').forEach(n => n.classList.remove('active'));
      if (state.view === 'teacher') navOverview.classList.add('active');
      if (state.view === 'teacher.bank') navBank.classList.add('active');
      if (state.view === 'teacher.students') navStudents.classList.add('active');
      if (state.view === 'teacher.settings') navSettings.classList.add('active');
    }

    // header active style
    document.querySelectorAll('.header-nav .nav-btn').forEach(b => b.classList.remove('active'));
    if (state.view === 'home') document.getElementById('topHome').classList.add('active');
    if (state.view === 'teacher' || state.view.startsWith('teacher')) document.getElementById('topTeacher').classList.add('active');
    if (state.view === 'student') document.getElementById('topStudent').classList.add('active');
    enhancePasswordFields(app);
  }, 0);
}

window.addEventListener('popstate', (event) => {
  if (state.view === 'take') {
    window.history.pushState({ view: 'take', quizId: state.currentQuiz && state.currentQuiz.id ? state.currentQuiz.id : '' }, '', window.location.href);
    showNotification('Use the exam buttons to move during the quiz.', 'warning');
    return;
  }
  const view = event.state && event.state.view ? event.state.view : 'home';
  _historyApplying = true;
  state.view = view;
  if (event.state && event.state.quizId) state.currentQuiz = getAllQuizzes()[event.state.quizId] || state.currentQuiz;
  render();
  _lastHistoryView = state.view;
  _historyApplying = false;
});

// ============================================================================
// TEACHER OVERVIEW - clean, card-based (replaces old renderTeacher top portion)
// ============================================================================

function renderHomePage() {
  const wrapper = document.createElement('div');
  wrapper.className = 'home-page';
  wrapper.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="hero-eyebrow">Assessment Platform</div>
        <h1 class="hero-title">Create polished computer-based assessments with speed and clarity.</h1>
        <p class="hero-subtitle">Build quizzes, organize question banks, monitor performance, and deliver private browser-based testing in one clean workflow.</p>
        <div class="hero-actions">
          <button id="homeGetStarted" class="btn-main hero-cta">Get Started</button>
        </div>
        <div class="hero-metrics" aria-label="Platform highlights">
          <div class="hero-metric">
            <strong>Quiz-ready</strong>
            <span>Structured setup for teachers</span>
          </div>
          <div class="hero-metric">
            <strong>Insightful</strong>
            <span>Results and progress at a glance</span>
          </div>
        </div>
      </div>
      <div class="hero-illustration" aria-hidden="true">
        <div class="hero-orb hero-orb-one"></div>
        <div class="hero-orb hero-orb-two"></div>
        <div class="hero-dashboard-frame">
          <div class="hero-window-bar">
            <span></span><span></span><span></span>
          </div>
          <div class="hero-dashboard-body">
            <div class="hero-dashboard-sidebar">
              <div class="hero-nav-pill active"></div>
              <div class="hero-nav-pill"></div>
              <div class="hero-nav-pill"></div>
              <div class="hero-nav-pill short"></div>
            </div>
            <div class="hero-dashboard-main">
              <div class="hero-panel hero-panel-assessment">
                <div class="hero-panel-heading">
                  <div>
                    <strong>Physics Midterm</strong>
                    <span>Draft assessment setup</span>
                  </div>
                  <i class="hero-status-chip">Ready</i>
                </div>
                <div class="hero-score-bars">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div class="hero-progress-row">
                  <div class="hero-mini-stat">
                    <strong>48</strong>
                    <span>Questions</span>
                  </div>
                  <div class="hero-mini-stat">
                    <strong>92%</strong>
                    <span>Completion</span>
                  </div>
                </div>
              </div>
              <div class="hero-lower-grid">
                <div class="hero-panel hero-chart-card">
                  <div class="hero-chart-header">
                    <strong>Results</strong>
                    <span>This week</span>
                  </div>
                  <div class="hero-chart-bars">
                    <i></i><i></i><i></i><i></i><i></i>
                  </div>
                </div>
                <div class="hero-panel hero-student-card">
                  <div class="hero-chart-header">
                    <strong>Progress</strong>
                    <span>Live class</span>
                  </div>
                  <div class="hero-student-list">
                    <div><b></b><span></span></div>
                    <div><b></b><span></span></div>
                    <div><b></b><span></span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="feature-grid">
      <div class="feature-card">
        <div class="feature-icon shield">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l7 3v6c0 5-3.5 9.5-7 11-3.5-1.5-7-6-7-11V5l7-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </div>
        <h3>Efficient & Secure</h3>
        <p>Zero-friction assessments with privacy first security.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon lightning">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L5 14h5l-1 8 8-12h-5l1-8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        </div>
        <h3>Create Quizzes Quickly</h3>
        <p>Easily create and share quizzes with your students.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon chart">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M7 16V9m5 7V5m5 11v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
        <h3>Track Student Progress</h3>
        <p>View detailed results and insights at a glance.</p>
      </div>
    </section>
  `;
  setTimeout(() => {
    document.getElementById('homeGetStarted').onclick = () => { state.view = isTeacherLoggedIn() ? 'teacher' : 'teacher.login'; render(); };
  }, 0);
  return wrapper;
}

function renderAdminAuth() {
  const wrapper = document.createElement('div');
  wrapper.className = 'auth-shell';
  wrapper.innerHTML = `
    <div class="card auth-card">
      <div class="h1">Admin Login</div>
      <div class="small">Super admin access only.</div>
      <div style="height:18px"></div>
      <label class="small">Admin email</label>
      <input id="adminLoginId" class="input-beautiful" placeholder="Admin email" />
      <div style="height:10px"></div>
      <label class="small">Password</label>
      <input id="adminLoginPassword" class="input-beautiful" type="password" placeholder="Admin password" />
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
        <button id="btnAdminLogin" class="btn btn-primary">Login</button>
      </div>
    </div>
  `;
  setTimeout(() => {
    document.getElementById('btnAdminLogin').onclick = () => {
      const id = normalizeEmail(document.getElementById('adminLoginId').value);
      const password = document.getElementById('adminLoginPassword').value || '';
      if (id !== SUPER_ADMIN_EMAIL || password !== SUPER_ADMIN_PASSWORD) return showNotification('Invalid admin email or password', 'error');
      ensureSuperAdminAccount();
      save(STORAGE_KEYS.teacherSession, { teacherId: id, loggedInAt: new Date().toISOString() });
      localStorage.setItem(STORAGE_KEYS.teacherId, id);
      state.teacherId = id;
      state.view = 'admin';
      render();
    };
  }, 0);
  return wrapper;
}

function showAlertsPanel() {
  let modal = document.getElementById('alertsPanel');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'alertsPanel';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(15,23,42,.45)';
  modal.style.zIndex = 30000;
  modal.style.display = 'flex';
  modal.style.alignItems = 'flex-start';
  modal.style.justifyContent = 'flex-end';
  modal.style.padding = '72px 24px 24px';

  const quizzes = getAllQuizzes();
  const quizKeys = Object.keys(quizzes).filter(k => isSuperAdmin() || (state.teacherId && quizzes[k].teacherId === state.teacherId));
  const submissions = getAllSubmissions().filter(s => quizKeys.includes(s.quizId));
  const now = Date.now();
  const alerts = [];

  if (isTeacherLoggedIn()) {
    const licence = getTeacherLicenseStatus();
    if (!licence.active) alerts.push({ type: 'warning', title: licence.label, detail: licence.detail });
    const activeCount = quizKeys.filter(k => {
      const q = quizzes[k];
      return (!q.scheduleStart || new Date(q.scheduleStart).getTime() <= now) && (!q.scheduleEnd || new Date(q.scheduleEnd).getTime() >= now);
    }).length;
    if (activeCount) alerts.push({ type: 'info', title: `${activeCount} active exam(s)`, detail: 'These quizzes are currently available to students.' });
  } else {
    alerts.push({ type: 'info', title: 'Guest mode', detail: 'Log in as a teacher to see exam and monitoring alerts.' });
  }

  submissions.slice(-10).reverse().forEach(s => {
    const m = s.monitoring || {};
    const flags = [];
    if (m.tabSwitches) flags.push(`${m.tabSwitches} tab switch(es)`);
    if (m.fullscreenExits) flags.push(`${m.fullscreenExits} fullscreen exit(s)`);
    if (m.copyAttempts) flags.push(`${m.copyAttempts} copy attempt(s)`);
    if (m.screenshotAttempts) flags.push(`${m.screenshotAttempts} screenshot attempt(s)`);
    if (flags.length) alerts.push({ type: 'warning', title: s.name || s.email || 'Student alert', detail: `${quizzes[s.quizId]?.title || s.quizId}: ${flags.join(', ')}` });
  });

  const inner = document.createElement('div');
  inner.className = 'card-beautiful';
  inner.style.width = 'min(420px, 94vw)';
  inner.style.maxHeight = 'calc(100vh - 110px)';
  inner.style.overflow = 'auto';
  inner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px">
      <h3 style="margin:0">Alerts</h3>
      <button id="closeAlertsPanel" class="btn btn-ghost btn-sm">Close</button>
    </div>
    <div class="small" style="margin-bottom:12px">Exam notices, licence status, and recent monitoring warnings.</div>
    ${alerts.map(a => `
      <div class="alert-item alert-${escapeHtml(a.type)}">
        <strong>${escapeHtml(a.title)}</strong>
        <div class="small">${escapeHtml(a.detail)}</div>
      </div>
    `).join('') || '<div class="small">No alerts right now.</div>'}
  `;
  modal.appendChild(inner);
  document.body.appendChild(modal);
  document.getElementById('closeAlertsPanel').onclick = () => modal.remove();
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
}

function renderTeacherAuth() {
  const wrapper = document.createElement('div');
  wrapper.className = 'auth-shell';
  wrapper.innerHTML = `
    <div class="card auth-card">
      <div class="h1">Teacher Login</div>
      <div class="small">Use your teacher email ID and password. Registered admin emails open the admin tools from this same box.</div>
      <div style="height:18px"></div>
      <label class="small">Teacher email ID</label>
      <input id="teacherLoginId" class="input-beautiful" placeholder="teacher@example.com" />
      <div style="height:10px"></div>
      <label class="small">Password</label>
      <input id="teacherLoginPassword" class="input-beautiful" type="password" placeholder="Your password" />
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
        <button id="btnTeacherLogin" class="btn btn-primary">Login</button>
        <button id="btnTeacherCreate" class="btn btn-ghost">Create Teacher ID</button>
      </div>
    </div>
  `;

  setTimeout(() => {
    const login = (createMode = false) => {
      const id = normalizeEmail(document.getElementById('teacherLoginId').value);
      const password = document.getElementById('teacherLoginPassword').value || '';
      if (!id || !password) return showNotification('Enter teacher email ID and password', 'error');
      if (id === SUPER_ADMIN_EMAIL) ensureSuperAdminAccount();
      const teachers = getAllTeachers();
      if (createMode) {
        if (id === SUPER_ADMIN_EMAIL) return showNotification('Admin account already exists. Login instead.', 'error');
        if (teachers[id]) return showNotification('Teacher ID already exists. Login instead.', 'error');
        teachers[id] = { teacherId: id, email: id, password, role: 'teacher', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        saveAllTeachers(teachers);
        showNotification('Teacher ID created', 'success');
      } else {
        if (!teachers[id] || teachers[id].password !== password) return showNotification('Invalid teacher ID or password', 'error');
      }
      save(STORAGE_KEYS.teacherSession, { teacherId: id, loggedInAt: new Date().toISOString() });
      localStorage.setItem(STORAGE_KEYS.teacherId, id);
      state.teacherId = id;
      state.view = isSuperAdmin() ? 'teacher.settings' : 'teacher';
      render();
    };
    document.getElementById('btnTeacherLogin').onclick = () => login(false);
    document.getElementById('btnTeacherCreate').onclick = () => login(true);
  }, 0);
  return wrapper;
}

function renderTeacherOverview() {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="dashboard-heading">
      <div class="h1">Teacher Dashboard</div>
      <div class="small">Overview & quick actions</div>
    </div>
    <div id="licenseBanner" class="license-banner"></div>

    <div class="grid-cards stats-grid" style="margin-bottom:var(--space-3)">
      <div class="card stat stat-blue">
        <div class="stat-icon">Quiz</div>
        <div class="value" id="ovTotalQuizzes">0</div>
        <div class="label">Total quizzes</div>
        <span>Manage your quizzes</span>
      </div>
      <div class="card stat stat-green">
        <div class="stat-icon">Live</div>
        <div class="value" id="ovActiveExams">0</div>
        <div class="label">Active exams</div>
        <span>Currently available</span>
      </div>
      <div class="card stat stat-purple">
        <div class="stat-icon">Subs</div>
        <div class="value" id="ovTotalSubmissions">0</div>
        <div class="label">Total submissions</div>
        <span>Across your quizzes</span>
      </div>
      <div class="card stat stat-orange">
        <div class="stat-icon">Avg</div>
        <div class="value" id="ovAvgScore">0%</div>
        <div class="label">Average score</div>
        <span>Submission average</span>
      </div>
    </div>

    <div class="action-grid">
      <button id="quickCreate" class="action-card">Create Quiz</button>
      <button id="quickUpload" class="action-card">Upload Questions</button>
      <button id="btnFindIP" class="action-card">Track IP</button>
      <button id="gotoQuizzes" class="action-card">Manage Quizzes</button>
    </div>

    <div class="card" style="margin-bottom:var(--space-3);margin-top:var(--space-3)">
      <div class="h3">Recent activity</div>
      <div class="small" style="margin-top:8px">Your recent quizzes and submissions</div>
      <div id="recentActivity" style="margin-top:12px"></div>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('quickCreate').onclick = () => { canSetQuestions() ? showCreateQuizModal() : showLicenseRequired(); };
    document.getElementById('quickUpload').onclick = () => { canSetQuestions() ? showCreateQuizModal() : showLicenseRequired(); };
    document.getElementById('btnFindIP').onclick = () => { showLocalNetworkGuide(); };
    document.getElementById('gotoQuizzes').onclick = () => { state.view = 'teacher.quizzes'; render(); };
    const licence = getTeacherLicenseStatus();
    const banner = document.getElementById('licenseBanner');
    banner.className = 'license-banner ' + (licence.active ? 'license-active' : 'license-inactive');
    banner.innerHTML = `
      <div>
        <strong>${escapeHtml(licence.label)}</strong>
        <div class="small">${escapeHtml(licence.detail)}</div>
      </div>
      ${licence.active ? '' : '<button id="requestLicenceInline" class="btn btn-primary btn-sm">Request Licence</button>'}
    `;
    const req = document.getElementById('requestLicenceInline'); if (req) req.onclick = () => requestTeacherLicense();

    // populate overview stats from storage
    const quizzes = getAllQuizzes();
    const quizKeys = Object.keys(quizzes).filter(k => isSuperAdmin() || quizzes[k].teacherId === state.teacherId);
    document.getElementById('ovTotalQuizzes').textContent = quizKeys.length;
    const subs = getAllSubmissions().filter(s => quizKeys.includes(s.quizId));
    document.getElementById('ovTotalSubmissions').textContent = subs.length;
    const avg = subs.length ? Math.round(subs.reduce((a,b)=>a+b.percent,0)/subs.length) : 0;
    document.getElementById('ovAvgScore').textContent = avg + '%';
    const now = Date.now();
    const active = quizKeys.filter(k => {
      const q = quizzes[k];
      const startOk = !q.scheduleStart || new Date(q.scheduleStart).getTime() <= now;
      const endOk = !q.scheduleEnd || new Date(q.scheduleEnd).getTime() >= now;
      return startOk && endOk;
    }).length;
    document.getElementById('ovActiveExams').textContent = active;
    // quick recent activity (show last 5)
    const recent = quizKeys.slice(-5).reverse().map(k => `<div class="activity-item"><strong>  ${escapeHtml(quizzes[k].title)}</strong><div class="small">  ${new Date(quizzes[k].createdAt).toLocaleString()}</div></div>`).join('');
    document.getElementById('recentActivity').innerHTML = recent || '<div class="small">No recent activity</div>';
  }, 0);

  return wrapper;
}

// Teacher quick access by Quiz ID + Password (view summary)
function showTeacherAccessModal() {
  let m = document.getElementById('teacherAccess'); if (m) m.remove();
  m = document.createElement('div'); m.id='teacherAccess'; m.style.position='fixed'; m.style.inset='0'; m.style.zIndex=30000; m.style.background='rgba(0,0,0,0.4)';
  const inner = document.createElement('div'); inner.className='card-beautiful p-6'; inner.style.width='520px'; inner.style.margin='40px auto';
  inner.innerHTML = `
    <h3>Teacher   Open Quiz Summary</h3>
    <div class="small">You must be logged in as the owner teacher or super admin.</div>
    <div style="height:8px"></div>
    <input id="taQuizId" class="input-beautiful" placeholder="Quiz ID (6 digits)" />
    <div style="height:8px"></div>
      <input id="taPassword" class="input-beautiful" type="password" placeholder="Password (if set)" />
    <div style="height:12px"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button id="btnTeacherOpen" class="btn-pastel-primary">Open</button><button id="btnTeacherCancel" class="btn-pastel-secondary">Cancel</button></div>
  `;
  m.appendChild(inner); document.body.appendChild(m);
  document.getElementById('btnTeacherCancel').onclick = ()=>m.remove();
  document.getElementById('btnTeacherOpen').onclick = ()=>{
    const id = document.getElementById('taQuizId').value.trim(); const pw = document.getElementById('taPassword').value || '';
    if (!requireTeacher()) { m.remove(); return render(); }
    const quiz = getAllQuizzes()[id]; if (!quiz) return showNotification('Quiz not found','error');
    if (quiz.teacherId !== state.teacherId && !isSuperAdmin()) return showNotification('Access denied: this quiz belongs to another teacher', 'error');
    if (quiz.password && quiz.password !== pw && !isSuperAdmin()) return showNotification('Invalid quiz password','error');
    state.currentQuiz = quiz; state.view = 'teacher.results'; render(); m.remove();
  };
}

// ============================================================================
// TEACHER QUIZZES view - accessible via sidebar (removed from main teacher view)
// ============================================================================

function renderTeacherQuizzes() {
  const container = document.createElement('div');
  const portableMode = networkSyncFailed && !networkSyncReady;
  const syncButton = canUseNetworkSync()
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px"><button id="syncLocalToCloudBtn" class="btn btn-primary btn-sm">Sync To Cloud</button></div>`
    : '';
  const syncNotice = networkSyncFailed && !networkSyncReady
    ? `<div class="card small" style="margin:0 0 16px;padding:14px 16px;border-color:#FDE68A;background:#FFFBEB;color:#92400E">Shared sync is not active right now. Do not send the visible 6-digit quiz number by itself. Use Copy Student Code or Copy Portable Link so the app can send a cross-device version that still works.</div>`
    : '';
  container.innerHTML = `<div class="h1">Quizzes</div><div class="small" style="margin-bottom:var(--space-2)">Manage your quizzes (edit, copy link, view results)</div>${syncButton}${syncNotice}<div id="teacherQuizzesList" style="margin-top:16px"></div>`;
  setTimeout(() => {
    const syncBtn = document.getElementById('syncLocalToCloudBtn');
    if (syncBtn) syncBtn.onclick = async () => { await syncAllLocalDataToCloud(); };
    const all = getAllQuizzes();
    const keys = Object.keys(all).filter(k => isSuperAdmin() || all[k].teacherId === state.teacherId).sort((a,b)=> new Date(all[b].createdAt)-new Date(all[a].createdAt));
    const listEl = document.getElementById('teacherQuizzesList');
    if (!keys.length) {
      listEl.innerHTML = '<div class="card small">No quizzes yet. Click Create Quiz to start.</div>';
      return;
    }
    listEl.innerHTML = keys.map(k => {
      const q = all[k];
      return `<div class="card quiz-list-card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <div style="font-weight:700">${escapeHtml(q.title)} <span class="small" style="color:var(--muted);font-weight:500">(${q.id})</span></div>
          <div class="small">${(q.subjects || []).length} subject(s)   ${q.timeLimit}m   ${q.maxGrade} points</div>
        </div>
        <div class="quiz-list-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm btnCopyId" data-id="${q.id}">Copy Student Code</button>
          <button class="btn btn-ghost btn-sm btnCopyLink" data-id="${q.id}">${portableMode ? 'Copy Portable Link' : 'Copy Link'}</button>
          <button class="btn btn-ghost btn-sm btnEditQuiz" data-id="${q.id}">Edit</button>
          <button class="btn btn-ghost btn-sm btnView" data-id="${q.id}">View Results</button>
        </div>
      </div>`;
    }).join('');
    // wire actions
    setTimeout(()=> {
      document.querySelectorAll('.btnCopyId').forEach(b=>b.onclick=async (e)=>{const q=getAllQuizzes()[e.currentTarget.dataset.id]; await copyQuizAccessCode(q);});
      document.querySelectorAll('.btnCopyLink').forEach(b=>b.onclick=async (e)=>{const q=getAllQuizzes()[e.currentTarget.dataset.id]; await copyQuizAccessLink(q);});
      document.querySelectorAll('.btnEditQuiz').forEach(b=>b.onclick=(e)=>{ canSetQuestions() ? showCreateQuizModal(e.currentTarget.dataset.id) : showLicenseRequired(); });
      document.querySelectorAll('.btnView').forEach(b=>b.onclick=(e)=>{state.currentQuiz=getAllQuizzes()[e.currentTarget.dataset.id]; state.view='results'; render();});
    },0);
  },0);
  return container;
}

function getTeacherQuizKeys() {
  const all = getAllQuizzes();
  return Object.keys(all).filter(k => isSuperAdmin() || all[k].teacherId === state.teacherId);
}

function renderQuestionBankView() {
  const all = getAllQuizzes();
  const keys = getTeacherQuizKeys();
  const quizSets = keys.map(id => {
    const quiz = all[id];
    const questionCount = (quiz.subjects || []).reduce((sum, subject) => {
      const source = Array.isArray(subject.bankQuestions) && subject.bankQuestions.length ? subject.bankQuestions : subject.questions;
      return sum + ((source || []).filter(isMeaningfulQuestion).length);
    }, 0);
    return { ...quiz, questionCount };
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  const container = document.createElement('div');
  container.innerHTML = `
    <div class="page-heading">
      <div>
        <div class="h1">Question Bank</div>
        <div class="small">Your quiz sets. Questions and answers stay hidden until you open a quiz.</div>
      </div>
      <button id="bankCreateQuiz" class="btn btn-primary">Create Quiz</button>
    </div>
    <div class="card">
      <div class="card-header"><h3>Quiz Sets</h3></div>
      <div class="table-wrap">
        <table class="table-dense">
          <thead><tr><th>Quiz</th><th>Quiz ID</th><th>Subjects</th><th>Questions</th><th>Schedule</th><th>Actions</th></tr></thead>
          <tbody>
            ${quizSets.map(q => `
              <tr>
                <td>${escapeHtml(q.title)}</td>
                <td>${q.id}</td>
                <td>${(q.subjects || []).length}</td>
                <td>${q.questionCount}</td>
                <td>${q.scheduleStart ? new Date(q.scheduleStart).toLocaleString() : 'Any time'}${q.scheduleEnd ? ' - ' + new Date(q.scheduleEnd).toLocaleString() : ''}</td>
                <td><button class="btn btn-ghost btn-sm btnViewQuizSet" data-id="${q.id}">View Content</button></td>
              </tr>
            `).join('') || '<tr><td colspan="6">No quiz sets yet. Create a quiz and import questions to populate this bank.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  setTimeout(() => {
    document.getElementById('bankCreateQuiz').onclick = () => { canSetQuestions() ? showCreateQuizModal() : showLicenseRequired(); };
    document.querySelectorAll('.btnViewQuizSet').forEach(btn => btn.onclick = (ev) => showQuizSetDetails(ev.currentTarget.dataset.id));
  }, 0);
  return container;
}

function showQuizSetDetails(quizId) {
  const quiz = getAllQuizzes()[quizId];
  if (!quiz || (quiz.teacherId !== state.teacherId && !isSuperAdmin())) return showNotification('Quiz set not found', 'error');
  const portableMode = networkSyncFailed && !networkSyncReady;
  let modal = document.getElementById('quizSetDetails'); if (modal) modal.remove();
  modal = document.createElement('div'); modal.id='quizSetDetails'; modal.style.position='fixed'; modal.style.inset='0'; modal.style.background='rgba(0,0,0,0.45)'; modal.style.zIndex=20000; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center';
  const questions = [];
  (quiz.subjects || []).forEach(subject => {
    const source = Array.isArray(subject.bankQuestions) && subject.bankQuestions.length ? subject.bankQuestions : subject.questions;
    (source || []).filter(isMeaningfulQuestion).forEach((q, idx) => questions.push({ ...q, subject: subject.name || q.subject || 'General', idx: questions.length + 1 }));
  });
  const inner = document.createElement('div'); inner.className='card-beautiful p-6'; inner.style.width='94%'; inner.style.maxWidth='1000px'; inner.style.maxHeight='86vh'; inner.style.overflow='auto';
  inner.innerHTML = `
    <div class="page-heading">
      <div>
        <div class="h2">${escapeHtml(quiz.title)}</div>
        <div class="small">Quiz ID: ${quiz.id}</div>
        <div class="small">${isSharedSyncAvailable() ? `Student code: ${escapeHtml(quiz.id)}` : 'Student code: use Copy Student Code for the portable cross-device version'}</div>
      </div>
      <button id="closeQuizSetDetails" class="btn btn-ghost">Close</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button id="copyQuizSetId" class="btn btn-ghost btn-sm">Copy Student Code</button>
      <button id="copyQuizSetLink" class="btn btn-primary btn-sm">${portableMode ? 'Copy Portable Link' : 'Copy Link'}</button>
    </div>
    <div class="table-wrap">
      <table class="table-dense">
        <thead><tr><th>#</th><th>Subject</th><th>Question</th><th>Options</th><th>Answer</th></tr></thead>
        <tbody>${questions.map(q => `<tr><td>${q.idx}</td><td>${escapeHtml(q.subject)}</td><td style="white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(q.question)}</td><td style="white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere">${(q.options || []).map((o,i)=>`${String.fromCharCode(65+i)}. ${escapeHtml(o)}`).join('\n')}</td><td>${escapeHtml(q.answer)}</td></tr>`).join('') || '<tr><td colspan="5">No questions found.</td></tr>'}</tbody>
      </table>
    </div>
  `;
  modal.appendChild(inner); document.body.appendChild(modal);
  document.getElementById('closeQuizSetDetails').onclick = () => modal.remove();
  document.getElementById('copyQuizSetId').onclick = async () => { await copyQuizAccessCode(quiz); };
  document.getElementById('copyQuizSetLink').onclick = async () => { await copyQuizAccessLink(quiz); };
}

function renderStudentsView() {
  const students = getTeacherStudents().sort((a,b) => (a.name || '').localeCompare(b.name || ''));

  const container = document.createElement('div');
  container.innerHTML = `
    <div class="page-heading">
      <div>
        <div class="h1">Students</div>
        <div class="small">Only students uploaded by ${escapeHtml(state.teacherId)} are shown here.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="studentsImport" class="btn btn-primary">Upload Students</button>
        <button id="studentsTemplate" class="btn btn-ghost">Student Template</button>
        <button id="studentsExport" class="btn btn-ghost">Export Excel</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="table-dense">
          <thead><tr><th>Name</th><th>Email</th><th>Registration No / ID</th><th>Source Quiz</th><th>Uploaded</th></tr></thead>
          <tbody>
            ${students.map(s => `
              <tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.email)}</td>
                <td>${escapeHtml(s.registrationNo || s.id)}</td>
                <td>${escapeHtml(s.sourceQuizId || 'General upload')}</td>
                <td>${s.uploadedAt ? new Date(s.uploadedAt).toLocaleString() : ''}</td>
              </tr>
            `).join('') || '<tr><td colspan="5">No uploaded students yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  setTimeout(() => {
    document.getElementById('studentsImport').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
      inp.onchange = (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        parseQuestionsFile(f, true).then(list => {
          addStudentsToTeacher(list);
          showNotification('Students uploaded (' + list.length + ')', 'success');
          render();
        }).catch(err => { console.error(err); showNotification('Could not import students', 'error'); });
      };
      inp.click();
    };
    document.getElementById('studentsTemplate').onclick = () => {
      if (typeof XLSX === 'undefined') return showNotification('Excel library not loaded', 'error');
      const rows = [['Name','Email (optional if Reg No is provided)','Registration No / ID'], ['Ada Okafor', '', 'REG001']];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Students');
      XLSX.writeFile(wb, 'ope-student-template.xlsx');
      showNotification('Student template exported', 'success');
    };
    document.getElementById('studentsExport').onclick = () => {
      if (typeof XLSX === 'undefined') return showNotification('Excel library not loaded', 'error');
      const rows = [['Name','Email','Registration No / ID','Source Quiz','Uploaded']];
      students.forEach(s => rows.push([s.name, s.email, s.registrationNo || s.id, s.sourceQuizId || '', s.uploadedAt || '']));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Students');
      XLSX.writeFile(wb, 'ope-students.xlsx');
      showNotification('Students exported', 'success');
    };
  }, 0);
  return container;
}

function renderSettingsView() {
  const teachers = getAllTeachers();
  const teacherRows = Object.values(teachers).sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="h1">Settings</div>
    <div class="small" style="margin-bottom:var(--space-3)">Tools for backups, access identity, and local delivery.</div>
    <div class="settings-grid">
      <div class="card">
        <div class="h3">Teacher Identity</div>
        <div class="small">You are logged in with this teacher email ID.</div>
        <input class="input-beautiful" value="${escapeHtml(state.teacherId)}" readonly style="margin-top:12px" />
        <button id="copyTeacherId" class="btn btn-ghost" style="margin-top:12px">Copy Teacher ID</button>
      </div>
      <div class="card">
        <div class="h3">Data Backup</div>
        <div class="small">Download all quizzes and submissions stored in this browser.</div>
        <button id="downloadBackup" class="btn btn-primary" style="margin-top:12px">Download Backup</button>
      </div>
      <div class="card">
        <div class="h3">Local Network</div>
        <div class="small">Show instructions for sharing this app on a local Wi-Fi network.</div>
        <button id="openNetworkGuide" class="btn btn-ghost" style="margin-top:12px">Find IP Guide</button>
      </div>
    </div>
    ${isSuperAdmin() ? `
      <div class="card" style="margin-top:var(--space-3)">
        <div class="card-header"><h3>Super Admin - Teacher Accounts</h3></div>
        <div class="small" style="margin:12px 0">Manage teacher access, licence duration, and password resets.</div>
        <input id="teacherSearch" class="input-beautiful" placeholder="Search teacher ID..." style="margin-bottom:12px" />
        <div class="table-wrap">
          <table class="table-dense">
            <thead><tr><th>Teacher ID</th><th>Role</th><th>Licence</th><th>Request</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody id="teacherAdminRows">${teacherRows.map(t => {
              const id = t.teacherId || t.email;
              const status = getTeacherLicenseStatus(t);
              return `<tr data-teacher-row="${escapeHtml(id)}"><td>${escapeHtml(id)}</td><td>${escapeHtml(t.role || 'teacher')}</td><td>${escapeHtml(status.detail || status.label)}</td><td>${t.licenseRequestedAt ? new Date(t.licenseRequestedAt).toLocaleString() : '-'}</td><td>${t.createdAt ? new Date(t.createdAt).toLocaleString() : ''}</td><td><button class="btn btn-primary btn-sm btnViewTeacherExams" data-id="${escapeHtml(id)}">View Exams</button> <button class="btn btn-ghost btn-sm btnViewTeacherStudents" data-id="${escapeHtml(id)}">Students</button> <button class="btn btn-primary btn-sm btnGrantLicense" data-id="${escapeHtml(id)}">Grant</button> <button class="btn btn-ghost btn-sm btnStopLicense" data-id="${escapeHtml(id)}">Stop</button> <button class="btn btn-ghost btn-sm btnResetTeacher" data-id="${escapeHtml(id)}">Reset Password</button> <button class="btn btn-ghost btn-sm btnChangeTeacherId" data-id="${escapeHtml(id)}">Change ID</button></td></tr>`;
            }).join('') || '<tr><td colspan="6">No teachers yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    ` : ''}
  `;
  setTimeout(() => {
    document.getElementById('copyTeacherId').onclick = () => {
      copyTextToClipboard(state.teacherId, 'Teacher ID copied');
    };
    document.getElementById('downloadBackup').onclick = () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        teacherId: state.teacherId,
        quizzes: getAllQuizzes(),
        submissions: getAllSubmissions()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const filename = `ope-backup-${new Date().toISOString().slice(0,10)}.json`;
      if (typeof saveAs === 'function') {
        saveAs(blob, filename);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      showNotification('Backup downloaded', 'success');
    };
    document.getElementById('openNetworkGuide').onclick = () => showLocalNetworkGuide();
    const search = document.getElementById('teacherSearch');
    if (search) search.oninput = () => {
      const term = normalizeEmail(search.value);
      document.querySelectorAll('[data-teacher-row]').forEach(row => {
        row.style.display = normalizeEmail(row.dataset.teacherRow).includes(term) ? '' : 'none';
      });
    };
    document.querySelectorAll('.btnViewTeacherExams').forEach(btn => btn.onclick = (ev) => {
      if (!isSuperAdmin()) return;
      showAdminTeacherExams(ev.currentTarget.dataset.id);
    });
    document.querySelectorAll('.btnViewTeacherStudents').forEach(btn => btn.onclick = (ev) => {
      if (!isSuperAdmin()) return;
      showAdminTeacherStudents(ev.currentTarget.dataset.id);
    });
    document.querySelectorAll('.btnGrantLicense').forEach(btn => btn.onclick = (ev) => {
      if (!isSuperAdmin()) return;
      const id = normalizeEmail(ev.currentTarget.dataset.id);
      if (id === SUPER_ADMIN_EMAIL) return showNotification('Admin licence is unlimited', 'info');
      const days = parseInt(prompt('Licence duration in days for ' + id, '30') || '', 10);
      if (!days || days <= 0) return;
      const all = getAllTeachers();
      if (!all[id]) return showNotification('Teacher not found', 'error');
      all[id].licenseEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      all[id].licenseStopped = false;
      all[id].licenseRequestStatus = 'approved';
      all[id].licenseUpdatedAt = new Date().toISOString();
      all[id].updatedAt = all[id].licenseUpdatedAt;
      saveAllTeachers(all);
      showNotification('Licence granted', 'success');
      render();
    });
    document.querySelectorAll('.btnStopLicense').forEach(btn => btn.onclick = (ev) => {
      if (!isSuperAdmin()) return;
      const id = normalizeEmail(ev.currentTarget.dataset.id);
      if (id === SUPER_ADMIN_EMAIL) return showNotification('Admin licence cannot be stopped', 'info');
      const all = getAllTeachers();
      if (!all[id]) return showNotification('Teacher not found', 'error');
      all[id].licenseStopped = true;
      all[id].licenseRequestStatus = 'stopped';
      all[id].licenseUpdatedAt = new Date().toISOString();
      all[id].updatedAt = all[id].licenseUpdatedAt;
      saveAllTeachers(all);
      showNotification('Licence stopped', 'success');
      render();
    });
    document.querySelectorAll('.btnResetTeacher').forEach(btn => btn.onclick = (ev) => {
      if (!isSuperAdmin()) return;
      const id = normalizeEmail(ev.currentTarget.dataset.id);
      const next = prompt('Enter new password for ' + id);
      if (!next) return;
      const all = getAllTeachers();
      if (!all[id]) return showNotification('Teacher not found', 'error');
      all[id].password = next;
      all[id].passwordResetAt = new Date().toISOString();
      all[id].updatedAt = all[id].passwordResetAt;
      saveAllTeachers(all);
      showNotification('Password reset', 'success');
    });
    document.querySelectorAll('.btnChangeTeacherId').forEach(btn => btn.onclick = (ev) => {
      if (!isSuperAdmin()) return;
      const oldId = normalizeEmail(ev.currentTarget.dataset.id);
      const newId = normalizeEmail(prompt('Enter new teacher email ID for ' + oldId) || '');
      if (!newId || newId === oldId) return;
      const teachersAll = getAllTeachers();
      if (!teachersAll[oldId]) return showNotification('Teacher not found', 'error');
      if (teachersAll[newId]) return showNotification('New teacher ID already exists', 'error');
      teachersAll[newId] = { ...teachersAll[oldId], teacherId: newId, email: newId, idChangedFrom: oldId, idChangedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      delete teachersAll[oldId];
      saveAllTeachers(teachersAll);
      const quizzesAll = getAllQuizzes();
      Object.values(quizzesAll).forEach(q => { if (normalizeEmail(q.teacherId) === oldId) q.teacherId = newId; });
      saveAllQuizzes(quizzesAll);
      const studentsAll = getAllTeacherStudents();
      if (studentsAll[oldId]) { studentsAll[newId] = studentsAll[oldId]; delete studentsAll[oldId]; saveAllTeacherStudents(studentsAll); }
      showNotification('Teacher ID changed', 'success');
      render();
    });
  }, 0);
  return container;
}

function showAdminTeacherExams(teacherId) {
  if (!isSuperAdmin()) return showNotification('Admin access required', 'error');
  const id = normalizeEmail(teacherId);
  const quizzes = getAllQuizzes();
  const submissions = getAllSubmissions();
  const teacherQuizzes = Object.values(quizzes)
    .filter(q => normalizeEmail(q.teacherId) === id)
    .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  let modal = document.getElementById('adminTeacherExamsModal'); if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'adminTeacherExamsModal';
  modal.className = 'student-result-modal';
  const inner = document.createElement('div');
  inner.className = 'card-beautiful admin-modal-card';
  inner.innerHTML = `
    <div class="page-heading">
      <div>
        <div class="h2">Teacher Exams</div>
        <div class="small">${escapeHtml(id)}</div>
      </div>
      <button id="closeAdminTeacherExams" class="btn btn-ghost">Close</button>
    </div>
    <div class="table-wrap">
      <table class="table-dense">
        <thead><tr><th>Exam / Institution</th><th>Quiz</th><th>ID</th><th>Subjects</th><th>Submissions</th><th>Schedule</th><th>Actions</th></tr></thead>
        <tbody>
          ${teacherQuizzes.map(q => {
            const count = submissions.filter(s => s.quizId === q.id).length;
            return `<tr>
              <td>${escapeHtml(q.examName || '-')}</td>
              <td>${escapeHtml(q.title || 'Untitled Quiz')}</td>
              <td>${escapeHtml(q.id)}</td>
              <td>${(q.subjects || []).length}</td>
              <td>${count}</td>
              <td>${q.scheduleStart ? new Date(q.scheduleStart).toLocaleString() : 'Any time'}${q.scheduleEnd ? ' - ' + new Date(q.scheduleEnd).toLocaleString() : ''}</td>
              <td>
                <button class="btn btn-primary btn-sm adminEditQuiz" data-id="${escapeHtml(q.id)}">Edit</button>
                <button class="btn btn-ghost btn-sm adminResultsQuiz" data-id="${escapeHtml(q.id)}">Results</button>
                <button class="btn btn-ghost btn-sm adminContentQuiz" data-id="${escapeHtml(q.id)}">Content</button>
                <button class="btn btn-ghost btn-sm adminCopyQuizLink" data-id="${escapeHtml(q.id)}">Copy Link</button>
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="7">This teacher has not created any exams yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  modal.appendChild(inner);
  document.body.appendChild(modal);
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
  document.getElementById('closeAdminTeacherExams').onclick = () => modal.remove();
  document.querySelectorAll('.adminEditQuiz').forEach(btn => btn.onclick = (ev) => {
    modal.remove();
    showCreateQuizModal(ev.currentTarget.dataset.id);
  });
  document.querySelectorAll('.adminResultsQuiz').forEach(btn => btn.onclick = (ev) => {
    state.currentQuiz = getAllQuizzes()[ev.currentTarget.dataset.id];
    state.view = 'teacher.results';
    modal.remove();
    render();
  });
  document.querySelectorAll('.adminContentQuiz').forEach(btn => btn.onclick = (ev) => showQuizSetDetails(ev.currentTarget.dataset.id));
  document.querySelectorAll('.adminCopyQuizLink').forEach(btn => btn.onclick = async (ev) => {
    const q = getAllQuizzes()[ev.currentTarget.dataset.id];
    await copyQuizAccessLink(q);
  });
}

function showAdminTeacherStudents(teacherId) {
  if (!isSuperAdmin()) return showNotification('Admin access required', 'error');
  const id = normalizeEmail(teacherId);
  const students = (getAllTeacherStudents()[id] || []).sort((a,b) => (a.name || '').localeCompare(b.name || ''));
  let modal = document.getElementById('adminTeacherStudentsModal'); if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'adminTeacherStudentsModal';
  modal.className = 'student-result-modal';
  const inner = document.createElement('div');
  inner.className = 'card-beautiful admin-modal-card';
  inner.innerHTML = `
    <div class="page-heading">
      <div>
        <div class="h2">Teacher Students</div>
        <div class="small">${escapeHtml(id)}</div>
      </div>
      <button id="closeAdminTeacherStudents" class="btn btn-ghost">Close</button>
    </div>
    <div class="table-wrap">
      <table class="table-dense">
        <thead><tr><th>Name</th><th>Email</th><th>Registration No / ID</th><th>Source Quiz</th><th>Uploaded</th></tr></thead>
        <tbody>
          ${students.map(s => `<tr>
            <td>${escapeHtml(s.name || '')}</td>
            <td>${escapeHtml(s.email || '')}</td>
            <td>${escapeHtml(s.registrationNo || s.id || '')}</td>
            <td>${escapeHtml(s.sourceQuizId || 'General upload')}</td>
            <td>${s.uploadedAt ? new Date(s.uploadedAt).toLocaleString() : ''}</td>
          </tr>`).join('') || '<tr><td colspan="5">No uploaded students for this teacher yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  modal.appendChild(inner);
  document.body.appendChild(modal);
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
  document.getElementById('closeAdminTeacherStudents').onclick = () => modal.remove();
}

// ============================================================================
// EXAM / QUIZ TAKE - redesigned layout + palette logic
// ============================================================================

function renderQuizWelcome(quiz, questions) {
  const wrapper = document.createElement('div');
  wrapper.className = 'exam-shell quiz-welcome-shell';
  const totalMinutes = parseInt(quiz.timeLimit || 0, 10) || 0;
  wrapper.innerHTML = `
    <div class="card-beautiful quiz-welcome-card">
      <div class="small">OPE Assessor</div>
      <h1 class="display-font">${escapeHtml(quiz.title || 'Quiz')}</h1>
      <p class="text-muted">Read this before you begin. Your answers are saved in this browser and submitted when you finish.</p>
      <div class="quiz-welcome-grid">
        <div><strong>${questions.length}</strong><span>Questions</span></div>
        <div><strong>${(quiz.subjects || []).length || 1}</strong><span>Subject(s)</span></div>
        <div><strong>${totalMinutes || 'No limit'}</strong><span>${totalMinutes ? 'Minutes' : 'Timer'}</span></div>
      </div>
      <div class="quiz-instructions">
        <p><strong>Before you start:</strong> you may still leave this screen without penalty.</p>
        <p><strong>After Start Quiz:</strong> leaving the exam tab, exiting fullscreen, refreshing, closing the page, or using copy/screenshot shortcuts may be recorded and can submit the quiz automatically.</p>
        <p><strong>Desktop keys:</strong> A/B/C/D choose options, N moves next, P moves previous, and S submits.</p>
        <p>Click Start Quiz only when you are ready to begin.</p>
      </div>
      <div class="student-buttons">
        <button id="beginQuizBtn" class="btn-main">Start Quiz</button>
        <button id="leaveQuizBtn" class="btn-secondary">Back</button>
      </div>
    </div>
  `;
  setTimeout(() => {
    document.getElementById('beginQuizBtn').onclick = async () => {
      state.currentSubmission.examStarted = true;
      state.currentSubmission.startedAt = new Date().toISOString();
      try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); state.inFullscreen = true; } catch(e){}
      const webcamOn = !!state.currentSubmission.webcamRequested;
      if (webcamOn) startWebcam();
      render();
    };
    document.getElementById('leaveQuizBtn').onclick = () => {
      state.currentSubmission = null;
      state.currentQuiz = null;
      state.view = 'student';
      render();
    };
  }, 0);
  return wrapper;
}

function renderQuizTake() {
  const q = state.currentQuiz;
  if (!q) return document.createElement('div');
  const preparedQuestions = getQuizQuestionsForTaking(q);
  if (!preparedQuestions.length) {
    const empty = document.createElement('div');
    empty.className = 'exam-shell';
    empty.innerHTML = `
      <div class="card-beautiful quiz-welcome-card">
        <h2>This quiz has no questions yet</h2>
        <p class="text-muted">Ask your teacher to upload or paste questions, then save the quiz again.</p>
        <button id="backToStudentEntry" class="btn-secondary">Back</button>
      </div>
    `;
    setTimeout(() => {
      document.getElementById('backToStudentEntry').onclick = () => { state.view = 'student'; state.currentQuiz = null; state.currentSubmission = null; render(); };
    }, 0);
    return empty;
  }
  if (!state.currentSubmission) {
    state.currentSubmission = { quizId: q.id, answers: {}, flagged: {}, allQuestions: preparedQuestions, currentIndex: 0, startedAt: '', snapshots: [] };
  }
  if (!state.currentSubmission.allQuestions || !state.currentSubmission.allQuestions.length) {
    state.currentSubmission.allQuestions = preparedQuestions;
  }
  if (!state.currentSubmission.examStarted) return renderQuizWelcome(q, state.currentSubmission.allQuestions);
  // disable text selection while in exam
  try{ document.body.classList.add('exam-no-select'); }catch(e){}

  // Main wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'exam-shell';
  wrapper.innerHTML = `
    <div class="exam-header card exam-topbar" style="margin-bottom:var(--space-3);">
      <div class="exam-meta">
        <div>
          <div class="h2 exam-title">${escapeHtml(q.title)}</div>
          <div class="small" id="examSubjectLine">${escapeHtml(q.examName || '')}   ${(q.subjects || []).length} subject(s)</div>
        </div>
      </div>
      <div class="exam-status" style="display:flex;align-items:center;gap:12px">
        <div class="small" id="examAnswered">0 answered</div>
        <div class="small" id="examPercent">0.0%</div>
        <div class="timer" id="examTimer">--:--</div>
      </div>
    </div>
    <div class="exam-progress"><span id="examProgress"></span></div>

    <div class="exam-layout" style="display:flex;gap:var(--space-3);align-items:flex-start">
      <div class="exam-main" style="flex:1;min-width:320px">
        <div id="questionArea"></div>
      </div>
      <div id="rightPalette" class="palette exam-palette hidden md:block"></div>
    </div>

    <div class="exam-bottom-nav">
      <button id="examPrev" class="exam-nav-btn previous">Previous</button>
      <button id="submitExam" class="exam-nav-btn submit">Submit</button>
      <button id="examNext" class="exam-nav-btn next">Next</button>
    </div>

    <button class="fab-palette md:hidden" id="openPaletteFab" title="Open question palette">Q</button>
    <div id="paletteDrawer" class="card" style="position:fixed;right:12px;bottom:210px;width:260px;display:none;z-index:160"></div>
  `;

  setTimeout(()=> {
    // Prepare submission state if not yet created (existing logic)
    if (!state.currentSubmission || state.currentSubmission.quizId !== q.id) {
      // reuse existing 'proceedToQuiz' logic but simpler: flatten questions
      const allQuestions = preparedQuestions;
      state.currentSubmission = {
        quizId: q.id,
        name: state.currentSubmission?.name || '',
        email: state.currentSubmission?.email || '',
        answers: {},
        flagged: {},
        allQuestions,
        currentIndex: 0,
        examStarted: true,
        startedAt: new Date().toISOString()
      };
    }

    // render question(s) and palette
    const qa = document.getElementById('questionArea');
    const sub = state.currentSubmission;
    const updateExamChrome = () => {
      const total = (sub.allQuestions || []).length || 1;
      const answered = Object.keys(sub.answers || {}).filter(k => sub.answers[k]).length;
      const percent = Math.round((answered / total) * 1000) / 10;
      const progress = document.getElementById('examProgress'); if (progress) progress.style.width = percent + '%';
      const pct = document.getElementById('examPercent'); if (pct) pct.textContent = percent.toFixed(1) + '%';
      const ans = document.getElementById('examAnswered'); if (ans) ans.textContent = `${answered}/${total} answered`;
      const subj = document.getElementById('examSubjectLine');
      if (subj && sub.allQuestions[sub.currentIndex]) subj.textContent = `Question ${sub.currentIndex + 1} of ${total}`;
    };
    if (q.verticalLayout) {
      // render all questions stacked for easy scrolling
      qa.innerHTML = sub.allQuestions.map((qq, idx)=>{
        const opts = (qq.options||[]).map((opt,i)=>{
          const letter = String.fromCharCode(65+i);
          const checked = sub.answers[idx] === letter ? 'checked' : '';
          return `<label style="display:block;padding:10px;border-radius:8px;border:1px solid var(--border);margin-top:8px"><input type="radio" name="opt-${idx}" data-idx="${idx}" value="${letter}" ${checked} /> <span class="preserve-format" style="margin-left:8px;display:inline-block">${letter}. ${escapeHtml(opt)}</span></label>`;
        }).join('');
        return `
          <div class="question-card" style="margin-bottom:12px">
            <div class="h3">Question ${idx+1} of ${sub.allQuestions.length}</div>
            <div style="margin-top:8px" class="body preserve-format">${escapeHtml(qq.question)}</div>
            <div class="options" id="optionsList-${idx}">${opts}</div>
          </div>
        `;
      }).join('');
      // wire radio change handlers
      setTimeout(()=>{
        sub.allQuestions.forEach((qq, idx)=>{
          document.querySelectorAll(`input[name="opt-${idx}"]`).forEach(i=>i.onchange = (e)=>{ sub.answers[idx] = e.target.value; saveExamDraft(sub); updateExamChrome(); });
        });
        updateExamChrome();
      },0);
    } else {
      function renderQuestion(idx) {
        const qq = sub.allQuestions[idx];
        if (!qq) {
          qa.innerHTML = '<div class="question-card"><div class="h3">No question found</div><p class="text-muted">Please go back and ask the teacher to check the quiz questions.</p></div>';
          return;
        }
        const opts = (qq.options || []).map((opt, i) => {
          const letter = String.fromCharCode(65 + i);
          const checked = sub.answers[idx] === letter ? 'checked' : '';
          return `<label style="display:block;padding:10px;border-radius:8px;border:1px solid var(--border);margin-top:8px"><input type="radio" name="opt-${idx}" data-idx="${idx}" value="${letter}" ${checked} /> <span class="preserve-format" style="margin-left:8px;display:inline-block">${letter}. ${escapeHtml(opt)}</span></label>`;
        }).join('');

        qa.innerHTML = `
          <div class="question-card" style="margin-bottom:12px">
            <div class="h3">Question ${idx + 1} of ${sub.allQuestions.length}</div>
            <div style="margin-top:8px" class="body preserve-format">${escapeHtml(qq.question)}</div>
            <div class="options" id="optionsList-${idx}">${opts}</div>
            <div class="question-inline-actions" style="display:flex;justify-content:space-between;margin-top:12px">
              <div>
                <button id="prevQ" class="btn btn-ghost btn-sm">Prev</button>
                <button id="nextQ" class="btn btn-ghost btn-sm">Next</button>
              </div>
              <div>
                <button id="flagBtn" class="btn btn-ghost btn-sm">${sub.flagged[idx] ? 'Flagged' : 'Flag'}</button>
                <button id="saveQ" class="btn btn-primary btn-sm">Save</button>
              </div>
            </div>
          </div>
        `;

        setTimeout(() => {
          updateExamChrome();
          document.querySelectorAll(`#optionsList-${idx} input[type=\"radio\"]`).forEach(i => i.onchange = (e) => { sub.answers[idx] = e.target.value; saveExamDraft(sub); renderQuestionPalette(); updateExamChrome(); });
          const prev = document.getElementById('prevQ'); if (prev) prev.onclick = () => { if (sub.currentIndex > 0) { sub.currentIndex--; saveExamDraft(sub); renderQuestion(sub.currentIndex); renderQuestionPalette(); updateExamChrome(); } };
          const next = document.getElementById('nextQ'); if (next) next.onclick = () => { if (sub.currentIndex < sub.allQuestions.length - 1) { sub.currentIndex++; saveExamDraft(sub); renderQuestion(sub.currentIndex); renderQuestionPalette(); updateExamChrome(); } };
          const saveBtn = document.getElementById('saveQ'); if (saveBtn) saveBtn.onclick = () => { showNotification('Saved locally', 'success'); };
          const flag = document.getElementById('flagBtn'); if (flag) flag.onclick = () => { sub.flagged[idx] = !sub.flagged[idx]; saveExamDraft(sub); flag.textContent = sub.flagged[idx] ? 'Flagged' : 'Flag'; renderQuestionPalette(); };
        }, 0);
      }
      // palette render function
      function renderQuestionPalette() {
        const pal = document.getElementById('rightPalette');
        const drawer = document.getElementById('paletteDrawer');
        const total = sub.allQuestions.length;
        let items = [];
        for (let i=0;i<total;i++){
          const answered = !!sub.answers[i];
          const flagged = !!sub.flagged[i];
          const classes = ['palette-item'];
          if (answered) classes.push('palette-answered');
          if (flagged) classes.push('palette-flagged');
          if (i === sub.currentIndex) classes.push('palette-current');
          items.push(`<div class="${classes.join(' ')}" data-index="${i}">${i+1}</div>`);
        }
        pal.innerHTML = `<div class="small" style="margin-bottom:8px">Question Palette</div><div class="palette-grid">${items.join('')}</div>`;
        drawer.innerHTML = `<div class="small" style="margin-bottom:8px">Question Palette</div><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">${items.join('')}</div>`;
        setTimeout(()=>{
          [pal, drawer].forEach(scope => scope.querySelectorAll('.palette-item').forEach(el=>el.onclick=(ev)=>{
            const idx = parseInt(ev.currentTarget.dataset.index,10);
            sub.currentIndex = idx;
            saveExamDraft(sub);
            renderQuestion(idx);
            renderQuestionPalette();
            updateExamChrome();
            document.getElementById('paletteDrawer').style.display='none';
          }));
        },0);
      }

      // initial render for non-vertical
      renderQuestion(sub.currentIndex);
      renderQuestionPalette();
    }

    const examPrev = document.getElementById('examPrev');
    const examNext = document.getElementById('examNext');
    if (examPrev) examPrev.onclick = () => {
      if (q.verticalLayout) {
        window.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
      } else {
        document.getElementById('prevQ')?.click();
      }
      updateExamChrome();
    };
    if (examNext) examNext.onclick = () => {
      if (q.verticalLayout) {
        window.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
      } else {
        document.getElementById('nextQ')?.click();
      }
      updateExamChrome();
    };
    updateExamChrome();

    // mobile FAB open
    document.getElementById('openPaletteFab').onclick = ()=>{
      const d = document.getElementById('paletteDrawer');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    };

    // submit button
    document.getElementById('submitExam').onclick = ()=> {
      if (!confirm('Submit exam now?')) return;
      collectAndSubmit();
    };

    // timer display (reuse existing timer logic when exam starts)
    const timerEl = document.getElementById('examTimer');
    // if timeRemaining already set, update display; otherwise compute from q.timeLimit
    if (!timeRemaining || state.currentSubmission.quizId !== q.id) {
      let totalMinutes = q.timeLimit || 0;
      timeRemaining = (totalMinutes || 0) * 60;
      startTime = Date.now();
    }
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(()=> {
      const elapsed = Math.floor((Date.now() - startTime)/1000);
      const remaining = timeRemaining - elapsed;
      if (remaining <= 0) { timerEl.textContent = '00:00'; clearInterval(timerInterval); autoSubmit(); return; }
      const mins = Math.floor(remaining/60), secs = remaining%60;
      timerEl.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    },1000);

  },0);

  return wrapper;
}

// ============================================================================
// TEACHER RESULTS
// ============================================================================

function createPdfDocument(title, bodyHtml) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0B1220;background:#fff;padding:24px;line-height:1.45">
      <div style="border-bottom:2px solid #0F1724;padding-bottom:12px;margin-bottom:16px">
        <div style="font-size:12px;text-transform:uppercase;color:#07A3A3;font-weight:700">OPE Assessor</div>
        <h1 style="font-size:24px;margin:4px 0 0;color:#0F1724">${escapeHtml(title)}</h1>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function downloadPdfFromHtml(html, filename, successMessage = 'PDF downloaded', exportOptions = {}) {
  const sourceId = 'pdf-content-source';
  const paddingPx = exportOptions.paddingPx == null ? 24 : exportOptions.paddingPx;
  const sourceWidthPx = Math.max(320, Math.round(Number(exportOptions.sourceWidthPx) || 794));
  const sourceContentWidthPx = Math.max(240, sourceWidthPx - (paddingPx * 2));
  let source = document.getElementById(sourceId);
  if (source) source.remove();
  source = document.createElement('div');
  source.id = sourceId;
  source.innerHTML = html;
  Object.assign(source.style, {
    position: 'absolute',
    left: '-100000px',
    top: '0',
    width: `${sourceContentWidthPx}px`,
    background: '#ffffff',
    overflow: 'visible'
  });
  document.body.appendChild(source);
  return exportElementToPDF({ sourceSelector: `#${sourceId}`, filename, ...exportOptions })
    .then(() => { source.remove(); showNotification(successMessage, 'success'); return true; })
    .catch(err => {
      source.remove();
      showNotification('Error generating PDF', 'error');
      throw err;
    });
}

function makeSafeFilenamePart(value, fallback = 'student') {
  const cleaned = (value || '').toString().trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function getStudentResultPdfFilename(submission, quizId, prefix = '') {
  const studentName = makeSafeFilenamePart(submission?.name || submission?.registrationNo || submission?.email, 'student');
  const safeQuizId = makeSafeFilenamePart(quizId || submission?.quizId, 'quiz');
  const safePrefix = prefix ? `${makeSafeFilenamePart(prefix, prefix)}-` : '';
  return `${safePrefix}${studentName}-result-${safeQuizId}.pdf`;
}

async function renderElementToCanvas({
  sourceSelector,
  title = '',
  paddingPx = 24,
  debug = false,
  sourceWidthPx = 794
}) {
  const source = document.querySelector(sourceSelector);
  if (!source) throw new Error(`Export source not found: ${sourceSelector}`);
  if (typeof html2canvas === 'undefined') throw new Error('html2canvas is not loaded.');
  const exportSourceWidth = Math.max(320, Math.round(Number(sourceWidthPx) || 794));

  let tempRoot = null;
  let styleTag = null;
  try {
    tempRoot = document.createElement('div');
    tempRoot.className = 'pdf-export-root';
    Object.assign(tempRoot.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      width: `${exportSourceWidth}px`,
      minWidth: `${exportSourceWidth}px`,
      maxWidth: `${exportSourceWidth}px`,
      margin: '0',
      padding: `${paddingPx}px`,
      boxSizing: 'border-box',
      background: '#ffffff',
      overflow: 'visible',
      zIndex: '-1'
    });

    const clone = source.cloneNode(true);
    tempRoot.appendChild(clone);
    document.body.appendChild(tempRoot);

    styleTag = document.createElement('style');
    styleTag.setAttribute('data-pdf-export-style', 'true');
    styleTag.textContent = `
      .pdf-export-root,
      .pdf-export-root * {
        box-sizing: border-box !important;
        visibility: visible !important;
        opacity: 1 !important;
        transform: none !important;
        filter: none !important;
        clip: auto !important;
        clip-path: none !important;
        animation: none !important;
        transition: none !important;
        text-shadow: none !important;
      }
      .pdf-export-root {
        position: absolute !important;
        left: -100000px !important;
        top: 0 !important;
        width: ${exportSourceWidth}px !important;
        min-width: ${exportSourceWidth}px !important;
        max-width: ${exportSourceWidth}px !important;
        margin: 0 !important;
        padding: ${paddingPx}px !important;
        background: #ffffff !important;
        overflow: visible !important;
      }
      .pdf-export-root .no-print,
      .pdf-export-root [data-no-print="true"] { display: none !important; }
      .pdf-export-root .print-container,
      .pdf-export-root .sticky,
      .pdf-export-root .fixed,
      .pdf-export-root [style*="position: fixed"],
      .pdf-export-root [style*="position:sticky"] { position: static !important; }
      .pdf-export-root [class*="container"],
      .pdf-export-root [class*="wrapper"],
      .pdf-export-root [class*="layout"],
      .pdf-export-root [class*="content"] { max-width: 100% !important; }
      .pdf-export-root img,
      .pdf-export-root svg,
      .pdf-export-root canvas { max-width: 100% !important; height: auto !important; }
      .pdf-export-root table { width: 100% !important; table-layout: fixed !important; }
      .pdf-export-root td,
      .pdf-export-root th { word-wrap: break-word !important; overflow-wrap: break-word !important; }
      .pdf-export-root input,
      .pdf-export-root textarea,
      .pdf-export-root select,
      .pdf-export-root button { max-width: 100% !important; }
      .pdf-export-root .pdf-stack-on-export,
      .pdf-export-root .hero,
      .pdf-export-root .student-layout,
      .pdf-export-root .two-col-export-safe,
      .pdf-export-root .student-shell { display: block !important; }
      .pdf-export-root .pdf-stack-on-export > *,
      .pdf-export-root .hero > *,
      .pdf-export-root .student-layout > *,
      .pdf-export-root .two-col-export-safe > *,
      .pdf-export-root .student-shell > * { width: 100% !important; max-width: 100% !important; display: block !important; }
      .pdf-export-root .page-break-before { break-before: page; page-break-before: always; }
      .pdf-export-root .page-break-after { break-after: page; page-break-after: always; }
      .pdf-export-root .avoid-break { break-inside: avoid; page-break-inside: avoid; }
    `;
    document.head.appendChild(styleTag);

    sanitizeExportClone(clone);
    copyFormValues(source, clone);
    await waitForNextPaint();
    await waitForNextPaint();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await waitForImages(tempRoot);

    if (title) {
      const titleNode = document.createElement('div');
      titleNode.textContent = title;
      Object.assign(titleNode.style, { fontSize: '20px', fontWeight: '700', marginBottom: '16px', color: '#111827' });
      tempRoot.insertBefore(titleNode, tempRoot.firstChild);
    }

    const exportWidth = Math.ceil(tempRoot.scrollWidth);
    const exportHeight = Math.ceil(tempRoot.scrollHeight);
    if (debug) {
      console.log('Export root width:', exportWidth);
      console.log('Export root height:', exportHeight);
    }
    const canvas = await html2canvas(tempRoot, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: !!debug,
      width: exportWidth,
      height: exportHeight,
      windowWidth: exportWidth,
      windowHeight: exportHeight,
      scrollX: 0,
      scrollY: 0
    });

    if (styleTag && styleTag.parentNode) styleTag.remove();
    if (tempRoot && tempRoot.parentNode) tempRoot.remove();
    return canvas;
  } catch (error) {
    if (tempRoot && tempRoot.parentNode) tempRoot.parentNode.removeChild(tempRoot);
    if (styleTag && styleTag.parentNode) styleTag.remove();
    const exportStyle = document.querySelector('[data-pdf-export-style="true"]');
    if (exportStyle) exportStyle.remove();
    throw error;
  }
}

async function exportElementToPDF({
  sourceSelector,
  filename = 'export.pdf',
  title = '',
  orientation = 'p',
  paddingPx = 24,
  marginMm = 10,
  singlePage = false,
  debug = false,
  sourceWidthPx = 794
}) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF is not loaded.');
  try {
    const canvas = await renderElementToCanvas({ sourceSelector, title, paddingPx, debug, sourceWidthPx });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = marginMm;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const widthScale = usableWidth / canvas.width;
    const heightScale = usableHeight / canvas.height;
    const fitScale = Math.min(widthScale, heightScale);
    const imgWidth = canvas.width * fitScale;
    const imgHeight = canvas.height * fitScale;
    if (singlePage) {
      const offsetX = margin + ((usableWidth - imgWidth) / 2);
      const offsetY = margin + ((usableHeight - imgHeight) / 2);
      pdf.addImage(imgData, 'PNG', offsetX, offsetY, imgWidth, imgHeight, undefined, 'FAST');
    } else {
      const pageImgWidth = usableWidth;
      const pageImgHeight = (canvas.height * pageImgWidth) / canvas.width;
      let heightLeft = pageImgHeight;
      let currentY = margin;
      pdf.addImage(imgData, 'PNG', margin, currentY, pageImgWidth, pageImgHeight, undefined, 'FAST');
      heightLeft -= usableHeight;
      while (heightLeft > 0) {
        pdf.addPage();
        currentY = margin - (pageImgHeight - heightLeft);
        pdf.addImage(imgData, 'PNG', margin, currentY, pageImgWidth, pageImgHeight, undefined, 'FAST');
        heightLeft -= usableHeight;
      }
    }
    pdf.save(filename);
    return true;
  } catch (error) {
    console.error('PDF export failed:', error);
    throw error;
  }
}

function sanitizeExportClone(root) {
  const all = [root, ...root.querySelectorAll('*')];
  all.forEach((el) => {
    el.classList.remove('print-container', 'sticky', 'fixed', 'hidden', 'collapse', 'collapsed');
    const style = el.style;
    if (!style) return;
    if (style.position === 'fixed' || style.position === 'sticky') style.position = 'static';
    if (style.overflow === 'hidden') style.overflow = 'visible';
    if (style.transform) style.transform = 'none';
    if (style.clipPath) style.clipPath = 'none';
    if (style.filter) style.filter = 'none';
    if (style.maxHeight === '0px' || style.height === '0px') {
      style.maxHeight = '';
      style.height = '';
    }
    if (style.opacity === '0') style.opacity = '1';
    if (style.visibility === 'hidden') style.visibility = 'visible';
    if (style.left || style.right) {
      style.left = '';
      style.right = '';
    }
  });
}

function copyFormValues(sourceRoot, cloneRoot) {
  const sourceFields = sourceRoot.querySelectorAll('input, textarea, select');
  const cloneFields = cloneRoot.querySelectorAll('input, textarea, select');
  sourceFields.forEach((src, index) => {
    const dest = cloneFields[index];
    if (!dest) return;
    if (src.tagName === 'SELECT') dest.value = src.value;
    else if (src.type === 'checkbox' || src.type === 'radio') dest.checked = src.checked;
    else {
      dest.value = src.value;
      dest.setAttribute('value', src.value);
    }
  });
}

async function waitForImages(root) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }));
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function printHtmlAsSinglePage(html, options = {}) {
  const win = window.open('', '_blank', 'width=960,height=760');
  if (!win) throw new Error('Unable to open print window');
  win.document.write('<html><head><title>Preparing Print...</title></head><body style="font-family:Arial,sans-serif;padding:24px">Preparing print preview...</body></html>');
  win.document.close();

  const sourceId = 'print-html-source';
  let source = document.getElementById(sourceId);
  if (source) source.remove();
  source = document.createElement('div');
  source.id = sourceId;
  source.innerHTML = html;
  Object.assign(source.style, {
    position: 'absolute',
    left: '-100000px',
    top: '0',
    width: '794px',
    background: '#ffffff',
    overflow: 'visible'
  });
  document.body.appendChild(source);

  try {
    const canvas = await renderElementToCanvas({
      sourceSelector: `#${sourceId}`,
      paddingPx: options.paddingPx == null ? 10 : options.paddingPx,
      debug: !!options.debug
    });
    source.remove();
    const imgData = canvas.toDataURL('image/png');
    const safeTitle = escapeHtml(options.title || 'Print Result');
    win.document.open();
    win.document.write(`
      <html>
        <head>
          <title>${safeTitle}</title>
          <style>
            @page{size:A4 portrait;margin:6mm}
            html,body{margin:0;padding:0;background:#fff}
            body{display:flex;justify-content:center;align-items:flex-start;background:#fff}
            .print-image-shell{width:198mm;height:285mm;display:flex;justify-content:center;align-items:flex-start;overflow:hidden}
            .print-image{display:block;max-width:100%;max-height:285mm;width:auto;height:auto}
            @media print{
              html,body{background:#fff}
              .print-image-shell{width:100%;height:285mm}
              .print-image{max-width:100%;max-height:285mm}
            }
          </style>
        </head>
        <body>
          <div class="print-image-shell">
            <img id="printResultImage" class="print-image" src="${imgData}" alt="${safeTitle}" />
          </div>
          <script>
            (function () {
              var img = document.getElementById('printResultImage');
              function doPrint() {
                setTimeout(function () {
                  window.focus();
                  window.print();
                }, 180);
              }
              if (img && img.complete) doPrint();
              else if (img) {
                img.addEventListener('load', doPrint, { once: true });
                img.addEventListener('error', doPrint, { once: true });
              } else {
                doPrint();
              }
            })();
          </script>
        </body>
      </html>
    `);
    win.document.close();
    return true;
  } catch (error) {
    if (source && source.parentNode) source.remove();
    try { win.close(); } catch (e) {}
    console.error('Print render failed:', error);
    throw error;
  }
}

function optionText(question, letter) {
  const idx = (letter || '').toString().toUpperCase().charCodeAt(0) - 65;
  return (question.options || [])[idx] || letter || '';
}

function buildCorrectionPdfHtml(submission, quiz, opts = {}) {
  const showNegativePenalty = !!opts.showNegativePenalty;
  const questions = submission.allQuestions || [];
  const scoreNote = hasManualScoreOverride(submission) ? 'Teacher-adjusted score applied' : '';
  const rows = questions.map((question, idx) => {
    const chosen = submission.answers && submission.answers[idx] ? submission.answers[idx] : '';
    const correct = (question.answer || '').toString().toUpperCase();
    const isCorrect = chosen && chosen === correct;
    return `
      <tr>
        <td style="padding:8px;border:1px solid #CBD5E1;vertical-align:top">Q${idx + 1}</td>
        <td style="padding:8px;border:1px solid #CBD5E1;vertical-align:top;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(question.question || '')}</td>
        <td style="padding:8px;border:1px solid #CBD5E1;vertical-align:top;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(optionText(question, chosen))}</td>
        <td style="padding:8px;border:1px solid #CBD5E1;vertical-align:top;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(optionText(question, correct))}</td>
        <td style="padding:8px;border:1px solid #CBD5E1;vertical-align:top;color:${isCorrect ? '#047857' : '#B91C1C'};font-weight:700">${isCorrect ? 'Correct' : 'Incorrect'}</td>
      </tr>
    `;
  }).join('');
  return createPdfDocument(`Correction: ${submission.name || submission.email}`, `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px">
      <div><strong>Quiz:</strong> ${escapeHtml(quiz.title || submission.quizId)}</div>
      <div><strong>Student:</strong> ${escapeHtml(submission.name || '')}</div>
      <div><strong>Email/ID:</strong> ${escapeHtml(submission.email || '')}</div>
      <div><strong>Score:</strong> ${formatScoreValue(submission.score || 0)}/${questions.length} (${submission.percent || 0}%)</div>
      ${showNegativePenalty ? `<div><strong>Negative penalty:</strong> ${submission.negativePenalty || 0}</div>` : ''}
      ${scoreNote ? `<div><strong>Score note:</strong> ${escapeHtml(scoreNote)}</div>` : ''}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="background:#0F1724;color:#fff">
          <th style="padding:8px;border:1px solid #0F1724;text-align:left">#</th>
          <th style="padding:8px;border:1px solid #0F1724;text-align:left">Question</th>
          <th style="padding:8px;border:1px solid #0F1724;text-align:left">Your Answer</th>
          <th style="padding:8px;border:1px solid #0F1724;text-align:left">Correct Answer</th>
          <th style="padding:8px;border:1px solid #0F1724;text-align:left">Status</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:12px;border:1px solid #CBD5E1">No questions recorded for this submission.</td></tr>'}</tbody>
    </table>
  `);
}

function downloadCorrectionPdfFast(submission, quiz, opts = {}) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF is not loaded.');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const usableWidth = pageWidth - margin * 2;
  const questions = submission.allQuestions || [];
  const lineHeight = 5;
  let y = margin;

  const ensureSpace = (needed = 12) => {
    if (y + needed <= pageHeight - margin) return;
    pdf.addPage();
    y = margin;
  };
  const addText = (text, x, width, options = {}) => {
    const size = options.size || 10;
    const style = options.style || 'normal';
    const color = options.color || [15, 23, 36];
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize((text || '').toString(), width);
    ensureSpace(lines.length * lineHeight + 2);
    pdf.text(lines, x, y);
    y += lines.length * lineHeight + (options.after || 1);
  };
  const addMeta = (label, value, x, width) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(label, x, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(15, 23, 36);
    const lines = pdf.splitTextToSize((value || '').toString(), width);
    pdf.text(lines, x, y + 5);
  };

  pdf.setFillColor(15, 23, 36);
  pdf.rect(0, 0, pageWidth, 24, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Student Correction', margin, 14);
  pdf.setFontSize(9);
  pdf.text('OPE Assessor', pageWidth - margin, 14, { align: 'right' });
  y = 34;

  addText(quiz.title || submission.quizId || 'Quiz', margin, usableWidth, { size: 15, style: 'bold', after: 3 });
  const metaY = y;
  addMeta('STUDENT', submission.name || '', margin, 82);
  addMeta('EMAIL / ID', submission.email || submission.registrationNo || '', margin + 92, 82);
  y = metaY + 16;
  const scoreText = `${formatScoreValue(submission.score || 0)}/${questions.length} (${submission.percent || 0}%)${hasManualScoreOverride(submission) ? ' - Teacher adjusted' : ''}`;
  addMeta('SCORE', scoreText, margin, 52);
  addMeta('QUIZ ID', submission.quizId || quiz.id || '', margin + 62, 52);
  if (opts.showNegativePenalty) addMeta('NEGATIVE PENALTY', submission.negativePenalty || 0, margin + 124, 52);
  y += 18;

  pdf.setDrawColor(203, 213, 225);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 8;

  if (!questions.length) {
    addText('No questions recorded for this submission.', margin, usableWidth);
  } else {
    questions.forEach((question, idx) => {
      const chosen = submission.answers && submission.answers[idx] ? submission.answers[idx] : '';
      const correct = (question.answer || '').toString().toUpperCase();
      const isCorrect = chosen && chosen === correct;
      const questionText = `${idx + 1}. ${question.question || ''}`;
      const chosenText = chosen ? `${chosen}. ${optionText(question, chosen)}` : 'No answer';
      const correctText = correct ? `${correct}. ${optionText(question, correct)}` : 'Not set';
      const questionLines = pdf.splitTextToSize(questionText, usableWidth);
      const answerLines = pdf.splitTextToSize(`Your answer: ${chosenText}`, usableWidth - 6);
      const correctLines = pdf.splitTextToSize(`Correct answer: ${correctText}`, usableWidth - 6);
      const needed = (questionLines.length + answerLines.length + correctLines.length) * lineHeight + 19;
      ensureSpace(needed);

      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(margin, y - 4, usableWidth, needed - 3, 2, 2, 'FD');
      addText(questionText, margin + 4, usableWidth - 8, { size: 10, style: 'bold', after: 1 });
      addText(`Your answer: ${chosenText}`, margin + 4, usableWidth - 8, { size: 9, color: isCorrect ? [4, 120, 87] : [185, 28, 28], after: 0 });
      addText(`Correct answer: ${correctText}`, margin + 4, usableWidth - 8, { size: 9, color: [15, 23, 36], after: 1 });
      addText(isCorrect ? 'Status: Correct' : 'Status: Incorrect', margin + 4, usableWidth - 8, { size: 9, style: 'bold', color: isCorrect ? [4, 120, 87] : [185, 28, 28], after: 5 });
    });
  }

  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  pdf.save(getStudentResultPdfFilename(submission, quiz.id || submission.quizId, 'correction'));
  return Promise.resolve(true);
}

function downloadFacilityIndexPdfText(quiz, data) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF is not loaded.');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const width = pageWidth - margin * 2;
  let y = margin;
  const addPageIfNeeded = (needed = 12) => { if (y + needed > pageHeight - margin) { pdf.addPage(); y = margin; } };
  const write = (text, size = 10, style = 'normal', color = [15, 23, 36], after = 2) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize((text || '').toString(), width);
    addPageIfNeeded(lines.length * 5 + after);
    pdf.text(lines, margin, y);
    y += lines.length * 5 + after;
  };

  write(`Facility Index: ${quiz.title || quiz.id}`, 16, 'bold', [15, 23, 36], 5);
  write(`Quiz ID: ${quiz.id || ''}`, 9, 'normal', [71, 85, 105], 4);
  if (!data.length) write('No submissions yet to analyze.', 10);
  data.forEach((r) => {
    const fi = r.facilityIndex === null ? 'No attempts' : `${r.facilityIndex.toFixed(3)} (${Math.round(r.facilityIndex * 100)}%)`;
    const interp = r.facilityIndex === null ? 'No attempts' : (r.facilityIndex <= 0.3 ? 'Very difficult' : r.facilityIndex <= 0.5 ? 'Difficult' : r.facilityIndex <= 0.7 ? 'Moderate' : 'Easy');
    addPageIfNeeded(34);
    pdf.setDrawColor(226, 232, 240);
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(margin, y - 4, width, 28, 2, 2, 'FD');
    write(`Q${r.index} - ${r.subject || 'General'} - Facility: ${fi} - ${interp}`, 10, 'bold', [15, 23, 36], 1);
    write(r.question || '', 9, 'normal', [15, 23, 36], 1);
    write(`Seen: ${r.seen}, Attempted: ${r.attempted}, Correct: ${r.correct}, Unanswered: ${r.unanswered}, Not seen: ${r.notSeen}`, 8, 'normal', [71, 85, 105], 3);
    (r.optionCounts || []).forEach((item) => {
      const correct = (r.answer || '').toString().toUpperCase() === item.letter ? ' (Correct)' : '';
      write(`${item.letter}. ${item.option}${correct}: ${item.count} student(s)`, 8, correct ? 'bold' : 'normal', correct ? [4, 120, 87] : [71, 85, 105], 1);
    });
    y += 3;
  });
  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }
  pdf.save(`facility-index-${quiz.id}.pdf`);
  return Promise.resolve(true);
}

function getTeacherSummaryQuestionCount(quiz, submissions = []) {
  const maxFromSubmissions = (submissions || []).reduce((max, item) => {
    const questionCount = Array.isArray(item?.allQuestions) ? item.allQuestions.length : 0;
    return Math.max(max, questionCount);
  }, 0);
  const configuredMax = Number(quiz && quiz.maxGrade);
  const subjectTotal = Array.isArray(quiz?.subjects) ? quiz.subjects.reduce((sum, subject) => {
    const configuredCount = Number(subject?.questionCount);
    if (Number.isFinite(configuredCount) && configuredCount > 0) return sum + configuredCount;
    const bankCount = Array.isArray(subject?.bankQuestions) ? subject.bankQuestions.length : 0;
    const questionCount = Array.isArray(subject?.questions) ? subject.questions.length : 0;
    return sum + Math.max(bankCount, questionCount);
  }, 0) : 0;
  return Math.max(maxFromSubmissions, Number.isFinite(configuredMax) ? configuredMax : 0, subjectTotal);
}

function getTeacherSummaryStatus(submission, quiz) {
  const fallback = (submission?.percent || 0) >= (quiz?.passMark || 50) ? 'Pass' : 'Fail';
  const raw = (submission?.resultStatus || fallback || '').toString().trim().toLowerCase();
  return raw === 'pass' ? 'Pass' : 'Fail';
}

function formatOrdinal(value) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) return '-';
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return `${num}st`;
  if (mod10 === 2 && mod100 !== 12) return `${num}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${num}rd`;
  return `${num}th`;
}

function getTeacherSummaryRankTheme(rank) {
  const num = parseInt(rank, 10);
  if (!Number.isFinite(num) || num <= 0) {
    return { label: '-', bg: '#eef4ff', color: '#1f2a44', border: 'rgba(31,42,68,0.10)' };
  }
  if (num === 1) {
    return { label: formatOrdinal(num), bg: '#fff1b8', color: '#7a5400', border: 'rgba(122,84,0,0.18)' };
  }
  if (num === 2) {
    return { label: formatOrdinal(num), bg: '#edf2f7', color: '#475569', border: 'rgba(71,85,105,0.16)' };
  }
  if (num === 3) {
    return { label: formatOrdinal(num), bg: '#f7dfcf', color: '#8a4b2b', border: 'rgba(138,75,43,0.16)' };
  }
  return { label: formatOrdinal(num), bg: '#e7f0ff', color: '#1f2a44', border: 'rgba(31,42,68,0.10)' };
}

function getTeacherSummaryIcon(kind) {
  const icons = {
    users: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M16.5 13.5A3.5 3.5 0 1 0 13 10a3.5 3.5 0 0 0 3.5 3.5Zm-9 0A3 3 0 1 0 4.5 10a3 3 0 0 0 3 3.5Zm0 1.75c-2.7 0-4.9 1.4-4.9 3.15 0 .33.27.6.6.6h7.02a5.15 5.15 0 0 1 3.37-4.68 8.02 8.02 0 0 0-2.09-.27Zm9 0c-2.93 0-5.35 1.53-5.35 3.4 0 .33.27.6.6.6h9.5a.6.6 0 0 0 .6-.6c0-1.87-2.42-3.4-5.35-3.4Z" fill="currentColor"/>
      </svg>
    `,
    chart: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 19.25A1.25 1.25 0 0 1 3.75 18V5.5a.75.75 0 0 1 1.5 0v11.75H20a.75.75 0 0 1 0 1.5H5Zm3.2-3a.85.85 0 0 1-.85-.85v-4.3a.85.85 0 0 1 1.7 0v4.3a.85.85 0 0 1-.85.85Zm4.8 0a.85.85 0 0 1-.85-.85V8.2a.85.85 0 0 1 1.7 0v7.2a.85.85 0 0 1-.85.85Zm4.8 0a.85.85 0 0 1-.85-.85V6.1a.85.85 0 0 1 1.7 0v9.3a.85.85 0 0 1-.85.85Z" fill="currentColor"/>
      </svg>
    `,
    percent: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7.1 9.25a2.35 2.35 0 1 0 0-4.7 2.35 2.35 0 0 0 0 4.7Zm9.8 10.2a2.35 2.35 0 1 0 0-4.7 2.35 2.35 0 0 0 0 4.7ZM6.12 19.2a.75.75 0 0 1-.54-1.27L17.34 5.16a.75.75 0 1 1 1.08 1.04L6.66 18.97a.75.75 0 0 1-.54.23Z" fill="currentColor"/>
      </svg>
    `
  };
  return icons[kind] || icons.chart;
}

function computeTeacherSummaryRanks(submissions = []) {
  const ordered = (submissions || []).slice().sort((a, b) =>
    (b.percent || 0) - (a.percent || 0) ||
    (a.timeSpent || 0) - (b.timeSpent || 0) ||
    (a.name || '').localeCompare(b.name || '')
  );
  const ranks = {};
  ordered.forEach((item, index) => {
    ranks[normalizeEmail(item?.email)] = index + 1;
  });
  return ranks;
}

function buildTeacherSummaryPdfHtml(quiz, submissions) {
  const ranks = computeTeacherSummaryRanks(submissions);
  const questionCount = getTeacherSummaryQuestionCount(quiz, submissions);
  const avgScore = submissions.length ? Math.round(submissions.reduce((a, s) => a + (s.score || 0), 0) / submissions.length) : 0;
  const avgPercent = submissions.length ? Math.round(submissions.reduce((a, s) => a + (s.percent || 0), 0) / submissions.length) : 0;
  const quizTitle = escapeHtml(((quiz && quiz.title) || 'ENGLISH TEST').toString().trim().toUpperCase());
  const rowThemes = [
    { bg: '#e8f8f2', edge: '#d6efe6' },
    { bg: '#fff0e6', edge: '#ffe0d1' },
    { bg: '#f0eaff', edge: '#dfd4ff' },
    { bg: '#e7f0ff', edge: '#d5e4ff' }
  ];
  const sortedSubmissions = (submissions || []).slice().sort((left, right) => {
    const leftRank = Number(ranks[normalizeEmail(left.email)]) || Number.MAX_SAFE_INTEGER;
    const rightRank = Number(ranks[normalizeEmail(right.email)]) || Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    if ((right.percent || 0) !== (left.percent || 0)) return (right.percent || 0) - (left.percent || 0);
    return (left.name || '').localeCompare(right.name || '');
  });
  const rows = sortedSubmissions.map((s, idx) => {
    const tone = rowThemes[idx % rowThemes.length];
    const status = getTeacherSummaryStatus(s, quiz);
    const rankTheme = getTeacherSummaryRankTheme(ranks[normalizeEmail(s.email)] || '');
    const emailOrId = (s.email || s.registrationNo || '').toString().trim();
    const scoreBase = Array.isArray(s.allQuestions) && s.allQuestions.length ? s.allQuestions.length : questionCount;
    return `
      <tr>
        <td class="summary-cell summary-cell-rank" style="--row-bg:${tone.bg};--row-edge:${tone.edge}">
          <span class="summary-rank-badge" style="background:${rankTheme.bg};color:${rankTheme.color};border-color:${rankTheme.border}">${escapeHtml(rankTheme.label)}</span>
        </td>
        <td class="summary-cell summary-cell-name" style="--row-bg:${tone.bg};--row-edge:${tone.edge}">
          <div class="summary-name">${escapeHtml(s.name || '') || 'Unnamed Student'}</div>
        </td>
        <td class="summary-cell summary-cell-email" style="--row-bg:${tone.bg};--row-edge:${tone.edge}">
          <div class="summary-email">${escapeHtml(emailOrId)}</div>
        </td>
        <td class="summary-cell summary-cell-score" style="--row-bg:${tone.bg};--row-edge:${tone.edge}">
          <span class="summary-score">${formatScoreValue(s.score || 0)}/${scoreBase || 0}</span>
        </td>
        <td class="summary-cell summary-cell-percent" style="--row-bg:${tone.bg};--row-edge:${tone.edge}">
          <span class="summary-percent">${clampPercent(s.percent || 0)}%</span>
        </td>
        <td class="summary-cell summary-cell-status" style="--row-bg:${tone.bg};--row-edge:${tone.edge}">
          <span class="summary-status-badge ${status === 'Pass' ? 'summary-status-pass' : 'summary-status-fail'}">${status}</span>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="summary-pdf-root">
      <style>
        .summary-pdf-root{
          --navy:#1f2a44;
          --text:#263238;
          --muted:#6b7280;
          --pastel-blue:#e7f0ff;
          --pastel-mint:#e8f8f2;
          --pastel-peach:#fff0e6;
          --pastel-lavender:#f0eaff;
          --pastel-yellow:#fff7d6;
          --success-bg:#dff7e8;
          --success-text:#157347;
          --danger-bg:#ffe1e1;
          --danger-text:#b42318;
          color:var(--text);
          background:#ffffff;
          font-family:"Trebuchet MS","Segoe UI",Arial,sans-serif;
          line-height:1.45;
        }
        .summary-pdf-root *{box-sizing:border-box}
        .summary-sheet{
          width:100%;
          padding:16px 18px 18px;
          background:
            radial-gradient(circle at top left, rgba(231,240,255,0.55), transparent 36%),
            radial-gradient(circle at top right, rgba(240,234,255,0.5), transparent 34%),
            linear-gradient(180deg, #ffffff 0%, #fdfefe 100%);
          border-radius:26px;
        }
        .summary-header-card{
          margin-bottom:18px;
          padding:22px 26px 24px;
          text-align:center;
          border-radius:24px;
          background:linear-gradient(135deg, rgba(231,240,255,0.95) 0%, rgba(232,248,242,0.96) 34%, rgba(240,234,255,0.96) 68%, rgba(255,240,230,0.95) 100%);
          border:1px solid rgba(255,255,255,0.92);
          box-shadow:0 18px 34px rgba(31,42,68,0.08);
        }
        .summary-header-badge{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          padding:7px 16px;
          border-radius:999px;
          background:rgba(255,255,255,0.78);
          color:var(--navy);
          font-size:11px;
          font-weight:700;
          letter-spacing:0.08em;
          text-transform:uppercase;
        }
        .summary-header-brand{
          margin:16px 0 6px;
          font-size:13px;
          font-weight:800;
          letter-spacing:0.26em;
          color:var(--navy);
        }
        .summary-header-title{
          margin:0;
          font-size:28px;
          font-weight:800;
          letter-spacing:0.02em;
          color:var(--navy);
        }
        .summary-header-subtitle{
          margin:8px 0 0;
          font-size:12px;
          color:var(--muted);
          font-weight:600;
        }
        .summary-stat-grid{
          display:grid;
          grid-template-columns:repeat(3, minmax(0, 1fr));
          gap:16px;
          margin-bottom:18px;
        }
        .summary-stat-card{
          display:flex;
          align-items:center;
          gap:14px;
          padding:18px 18px 17px;
          border-radius:22px;
          border:1px solid rgba(255,255,255,0.88);
          box-shadow:0 14px 28px rgba(31,42,68,0.07);
        }
        .summary-stat-card.card-blue{background:linear-gradient(180deg, #edf4ff 0%, #e7f0ff 100%)}
        .summary-stat-card.card-mint{background:linear-gradient(180deg, #eefbf6 0%, #e8f8f2 100%)}
        .summary-stat-card.card-lavender{background:linear-gradient(180deg, #f5f1ff 0%, #f0eaff 100%)}
        .summary-stat-icon{
          width:46px;
          height:46px;
          border-radius:16px;
          display:flex;
          align-items:center;
          justify-content:center;
          color:var(--navy);
          background:rgba(255,255,255,0.76);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.6);
          flex:0 0 46px;
        }
        .summary-stat-icon svg{width:22px;height:22px;display:block}
        .summary-stat-label{
          margin:0 0 4px;
          font-size:11px;
          font-weight:700;
          color:var(--muted);
          letter-spacing:0.08em;
          text-transform:uppercase;
        }
        .summary-stat-value{
          margin:0;
          font-size:28px;
          line-height:1;
          font-weight:800;
          color:var(--navy);
          white-space:nowrap;
        }
        .summary-table-card{
          padding:18px 18px 14px;
          border-radius:24px;
          background:#ffffff;
          border:1px solid rgba(31,42,68,0.06);
          box-shadow:0 16px 30px rgba(31,42,68,0.08);
        }
        .summary-table-head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:16px;
          margin-bottom:12px;
        }
        .summary-table-title{
          margin:0;
          font-size:19px;
          font-weight:800;
          color:var(--navy);
        }
        .summary-table-note{
          font-size:12px;
          font-weight:600;
          color:var(--muted);
        }
        .summary-table{
          width:100%;
          border-collapse:separate;
          border-spacing:0 10px;
          table-layout:fixed;
        }
        .summary-table col:nth-child(1){width:11%}
        .summary-table col:nth-child(2){width:24%}
        .summary-table col:nth-child(3){width:27%}
        .summary-table col:nth-child(4){width:14%}
        .summary-table col:nth-child(5){width:10%}
        .summary-table col:nth-child(6){width:14%}
        .summary-table th{
          padding:0 14px 6px;
          text-align:left;
          font-size:11px;
          font-weight:800;
          letter-spacing:0.08em;
          text-transform:uppercase;
          color:var(--muted);
        }
        .summary-table th.th-right{text-align:right}
        .summary-table th.th-center{text-align:center}
        .summary-cell{
          padding:13px 14px;
          font-size:12.5px;
          vertical-align:middle;
          background:var(--row-bg);
          border-top:1px solid rgba(255,255,255,0.85);
          border-bottom:1px solid rgba(255,255,255,0.85);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.45);
        }
        .summary-cell:first-child{
          border-left:4px solid var(--row-edge);
          border-top-left-radius:18px;
          border-bottom-left-radius:18px;
        }
        .summary-cell:last-child{
          border-top-right-radius:18px;
          border-bottom-right-radius:18px;
        }
        .summary-cell-rank,
        .summary-cell-status{text-align:center}
        .summary-cell-score,
        .summary-cell-percent{text-align:right}
        .summary-name{
          font-size:14px;
          font-weight:700;
          color:var(--navy);
        }
        .summary-email{
          font-size:11.5px;
          line-height:1.4;
          color:#44515c;
          white-space:normal;
          word-break:break-word;
          overflow-wrap:break-word;
        }
        .summary-score,
        .summary-percent{
          font-size:13px;
          font-weight:800;
          color:var(--navy);
          white-space:nowrap;
        }
        .summary-status-badge,
        .summary-rank-badge{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          min-width:74px;
          padding:7px 12px;
          border-radius:999px;
          font-size:11.5px;
          font-weight:800;
          border:1px solid transparent;
          white-space:nowrap;
        }
        .summary-status-pass{
          background:var(--success-bg);
          color:var(--success-text);
        }
        .summary-status-fail{
          background:var(--danger-bg);
          color:var(--danger-text);
        }
        .summary-empty{
          padding:18px;
          border-radius:18px;
          background:var(--pastel-yellow);
          color:var(--navy);
          text-align:center;
          font-weight:700;
        }
      </style>
      <div class="summary-sheet">
        <div class="summary-header-card">
          <div class="summary-header-badge">Generated Result Summary</div>
          <div class="summary-header-brand">OPE ASSESSOR</div>
          <h1 class="summary-header-title">${quizTitle} &mdash; Result Summary</h1>
          <div class="summary-header-subtitle">Clean assessment broadsheet for parents, management, and school records.</div>
        </div>

        <div class="summary-stat-grid">
          <div class="summary-stat-card card-blue">
            <div class="summary-stat-icon">${getTeacherSummaryIcon('users')}</div>
            <div>
              <p class="summary-stat-label">Submissions</p>
              <p class="summary-stat-value">${submissions.length}</p>
            </div>
          </div>
          <div class="summary-stat-card card-mint">
            <div class="summary-stat-icon">${getTeacherSummaryIcon('chart')}</div>
            <div>
              <p class="summary-stat-label">Average Score</p>
              <p class="summary-stat-value">${avgScore} / ${questionCount || 0}</p>
            </div>
          </div>
          <div class="summary-stat-card card-lavender">
            <div class="summary-stat-icon">${getTeacherSummaryIcon('percent')}</div>
            <div>
              <p class="summary-stat-label">Average Percent</p>
              <p class="summary-stat-value">${avgPercent}%</p>
            </div>
          </div>
        </div>

        <div class="summary-table-card">
          <div class="summary-table-head">
            <h2 class="summary-table-title">Result Broadsheet</h2>
            <div class="summary-table-note">A4 landscape pastel layout with clean, readable ranking.</div>
          </div>
          <table class="summary-table">
            <colgroup>
              <col><col><col><col><col><col>
            </colgroup>
            <thead>
              <tr>
                <th class="th-center">Rank</th>
                <th>Name</th>
                <th>Email / ID</th>
                <th class="th-right">Score</th>
                <th class="th-right">Percent</th>
                <th class="th-center">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="6"><div class="summary-empty">No submissions yet.</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function getScoreTone(percent) {
  const p = parseFloat(percent || 0) || 0;
  if (p >= 70) return { key: 'good', color: '#059669', soft: '#ECFDF5' };
  if (p >= 50) return { key: 'warn', color: '#D97706', soft: '#FFFBEB' };
  return { key: 'bad', color: '#DC2626', soft: '#FEF2F2' };
}

function getPerformanceBandLabel(percent) {
  const value = clampPercent(percent);
  if (value >= 75) return 'Excellent';
  if (value >= 70) return 'Very Good';
  if (value >= 65) return 'Good';
  if (value >= 50) return 'Credit';
  if (value >= 40) return 'Pass';
  return 'Fail';
}

function formatScoreValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeCertificateSignatories(signatories = []) {
  return (Array.isArray(signatories) ? signatories : []).map((item) => {
    if (typeof item === 'string') return { name: item.trim(), title: '' };
    return {
      name: (item && item.name ? item.name : '').toString().trim(),
      title: (item && item.title ? item.title : '').toString().trim()
    };
  }).filter((item) => item.name);
}

function hasManualScoreOverride(submission) {
  if (!submission || submission.manualScoreOverride === '' || submission.manualScoreOverride == null) return false;
  return Number.isFinite(Number(submission.manualScoreOverride));
}

function buildSubmissionGradeState(submission, quiz, baseGrade = gradeSubmissionForQuiz(submission, quiz)) {
  const passMark = parseFloat((quiz && quiz.passMark) || submission.passMark || 50) || 50;
  if (!hasManualScoreOverride(submission)) {
    return {
      ...baseGrade,
      passMark,
      resultStatus: baseGrade.percent >= passMark ? 'Pass' : 'Fail',
      manualOverride: false
    };
  }
  const totalQuestions = (submission.allQuestions || []).length;
  const maxScore = totalQuestions > 0 ? totalQuestions : 0;
  const roundedScore = Math.round(Number(submission.manualScoreOverride) * 100) / 100;
  const score = Math.max(0, Math.min(maxScore, roundedScore));
  const percent = totalQuestions ? clampPercent((score / totalQuestions) * 100) : 0;
  return {
    ...baseGrade,
    score,
    percent,
    passMark,
    resultStatus: percent >= passMark ? 'Pass' : 'Fail',
    manualOverride: true
  };
}

function applyGradeToSubmission(submission, grade) {
  submission.score = grade.score;
  submission.percent = grade.percent;
  submission.correctCount = grade.correctCount;
  submission.wrongCount = grade.wrongCount;
  submission.attemptedCount = grade.attemptedCount;
  submission.negativePenalty = grade.negativePenalty;
  submission.passMark = grade.passMark;
  submission.resultStatus = grade.resultStatus;
}

function buildCertificateBrandMarkup() {
  return `
    <div class="cert-brand-lockup" aria-label="OPE Assessor logo">
      <div class="cert-logo-badge"><span>OPE</span></div>
      <div class="cert-logo-text">
        <strong>OPE Assessor</strong>
        <span>Verified Result Certificate</span>
      </div>
    </div>
  `;
}

function buildCertificateSignatureSvg(item, index = 0) {
  const rawName = ((item && item.name) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Signature';
  const chars = rawName.slice(0, 28).split('');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let x = 10;
  let path = 'M 10 36';
  const accentParts = [];
  let drawnLetters = 0;

  chars.forEach((char, idx) => {
    if (char === ' ') {
      x += 7;
      return;
    }
    const upper = char.toUpperCase();
    const code = upper.charCodeAt(0);
    const isWordStart = idx === 0 || chars[idx - 1] === ' ';
    const hasAscender = /[BDFHKLT]/.test(upper);
    const hasDescender = /[GJPQY]/.test(upper);
    const rounded = /[COAESUG]/.test(upper);
    const wide = /[MW]/.test(upper);
    const narrow = /[IJT]/.test(upper);
    const looped = /[ABDEGOPQR]/.test(upper);
    const width = isWordStart ? 15 : wide ? 13 : narrow ? 8.5 : 10.5;
    const topY = isWordStart ? 8 + (code % 3) : hasAscender ? 12 + (code % 4) : rounded ? 19 + (code % 3) : 16 + (code % 4);
    const midY = 28 + ((code + idx) % 5) - 2;
    const baseY = hasDescender ? 43 + (code % 2) : 33 + (code % 4);

    if (isWordStart) {
      path += ` C ${x + 1.5} 31, ${x + 1.5} ${topY}, ${x + 5} ${topY}`;
      path += ` C ${x + 8.5} ${topY + 1.5}, ${x + 7.2} ${midY}, ${x + 4.8} ${baseY - 1}`;
      accentParts.push(`M ${x + 4} ${midY - 5} C ${x + 6} ${topY + 1}, ${x + 10} ${topY + 2}, ${x + 10.5} ${midY - 1}`);
    } else {
      path += ` C ${x + width * 0.18} ${midY - 6}, ${x + width * 0.2} ${topY}, ${x + width * 0.34} ${topY + 1}`;
    }

    path += ` C ${x + width * 0.5} ${topY + 8}, ${x + width * 0.42} ${baseY}, ${x + width * 0.62} ${baseY - 1}`;
    path += ` C ${x + width * 0.82} ${baseY - 2}, ${x + width * 0.78} ${midY - 2}, ${x + width} ${midY + ((code % 3) - 1)}`;

    if (looped && !isWordStart) {
      accentParts.push(`M ${x + width * 0.28} ${midY - 1} C ${x + width * 0.4} ${topY + 4}, ${x + width * 0.58} ${topY + 5}, ${x + width * 0.58} ${midY + 1}`);
    }

    x += width;
    drawnLetters += 1;
  });

  const flourishEndX = clamp(x + 18, 158, 208);
  const flourishStartX = clamp(18 + drawnLetters * 1.5, 28, 74);
  const flourish = `M ${flourishStartX} 39 C ${clamp(flourishStartX + 26, 40, 92)} 43, ${clamp(flourishEndX - 42, 92, 164)} 43, ${flourishEndX} ${clamp(29 + ((index + drawnLetters) % 4), 28, 34)}`;
  const accent = accentParts.join(' ');
  return `
    <svg class="cert-signature-svg" viewBox="0 0 224 56" aria-hidden="true" focusable="false">
      <path d="${path}" fill="none" stroke="#101821" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${flourish}" fill="none" stroke="#101821" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
      ${accent ? `<path d="${accent}" fill="none" stroke="#101821" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" opacity="0.62"/>` : ''}
    </svg>
  `;
}

function renderCertificateSignatories(signatories = []) {
  const items = normalizeCertificateSignatories(signatories);
  if (!items.length) return '';
  return `
    <div class="cert-signatures">
      ${items.map((item, index) => {
        const seed = item.name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        const tilt = (((seed + index * 17) % 11) - 5) * 0.6;
        return `
          <div class="cert-signature-card">
            <div class="cert-signature-script" style="transform:rotate(${tilt}deg)">${buildCertificateSignatureSvg(item, index)}</div>
            <span></span>
            ${item.title ? `<p>${escapeHtml(item.title)}</p>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function buildStudentResultSupplementHtml(quiz, submission) {
  if (!quiz || !quiz.showTopicsAfterSubmission) return '';
  const analysis = computeStudentTopicPerformance(submission);
  const subjects = Object.keys(analysis);
  if (!subjects.length) return '';
  return `
    <div class="student-topic-card">
      <h4>Performance by Topic</h4>
      <div class="student-topic-grid">
        ${subjects.map((subject) => {
          const item = analysis[subject];
          const attempted = item.attempted || 0;
          const correct = item.correct || 0;
          const total = item.total || 0;
          const percent = attempted ? Math.round((correct / attempted) * 100) : 0;
          return `
            <div class="student-topic-item">
              <strong>${escapeHtml(subject)}</strong>
              <span>${percent}% correct</span>
              <small>${correct} correct • ${attempted} attempted • ${total} total</small>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function buildStudentResultFullHtml(quiz, submission, rankValue, opts = {}) {
  const cardHtml = buildStudentResultSummaryCardHtml(quiz, submission, rankValue, opts);
  const supplementHtml = buildStudentResultSupplementHtml(quiz, submission);
  return `<div class="student-result-full">${cardHtml}${supplementHtml}</div>`;
}

function buildStudentResultSummaryCardHtml(quiz, submission, rankValue, opts = {}) {
  const includeActions = !!opts.includeActions;
  const totalQuestions = (submission.allQuestions || []).length;
  const attemptedCount = submission.attemptedCount || Object.keys(submission.answers || {}).filter(key => !!submission.answers[key]).length;
  const submittedText = submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : 'N/A';
  const correctionRequested = !!submission.correctionRequested;
  const correctionRequestedText = submission.correctionRequestedAt ? new Date(submission.correctionRequestedAt).toLocaleString() : '';
  const scoreText = `${formatScoreValue(submission.score || 0)} / ${totalQuestions}`;
  const quizName = escapeHtml(quiz.title || submission.quizId || 'Quiz');
  const institutionName = escapeHtml(quiz.examName || quiz.institution || quiz.title || 'OPE Assessor');
  const studentName = escapeHtml((submission.name || '').toUpperCase() || 'STUDENT');
  const rankText = rankValue || '-';
  const percent = clampPercent(submission.percent || 0);
  const performanceLabel = getPerformanceBandLabel(percent);
  const identityLabel = (submission.email || '').includes('@') ? 'Email' : 'Registration No';
  const hasAdjustedScore = hasManualScoreOverride(submission);
  const adjustedNote = hasAdjustedScore
    ? (submission.manualScoreEditedAt
      ? `Teacher adjusted score on ${new Date(submission.manualScoreEditedAt).toLocaleString()}`
      : 'Teacher adjusted score applied')
    : '';
  const signatoriesHtml = renderCertificateSignatories(quiz.certificateSignatories);
  const displayedStatus = submission.resultStatus || (percent >= (submission.passMark || quiz.passMark || 50) ? 'Pass' : 'Fail');
  return `
    <div class="student-result-container cert-result">
      <div class="cert-inner">
        <div class="cert-top-rule"></div>
        <div class="cert-header">
          ${buildCertificateBrandMarkup()}
          <div class="cert-school">${institutionName}</div>
          <div class="cert-test">${quizName}</div>
        </div>

        <div class="cert-title">RESULT SUMMARY</div>
        <div class="cert-platform">Verified by OPE Assessor</div>

        <div class="cert-student-panel">
          <div class="cert-label">STUDENT NAME</div>
          <div class="cert-student-name">${studentName}</div>
        </div>

        <div class="cert-score-wrap">
          <div class="cert-score-ring" style="--cert-progress:${percent}">
            <div class="cert-score-ring-inner">
              <div class="cert-score-label">SCORE</div>
              <div class="cert-score-main">${escapeHtml(scoreText)}</div>
              <div class="cert-score-percent">${percent}%</div>
              <div class="cert-score-helper">${escapeHtml(displayedStatus)}</div>
            </div>
          </div>
          <div class="cert-performance">${performanceLabel}</div>
          ${hasAdjustedScore ? `<div class="cert-adjusted-note">${escapeHtml(adjustedNote)}</div>` : ''}
        </div>

        <div class="cert-rank">RANK: ${escapeHtml(rankText)}</div>

        <div class="cert-details-grid">
          <div class="cert-detail-card">
            <div class="cert-detail-label">Submitted</div>
            <div class="cert-detail-value">${escapeHtml(submittedText)}</div>
          </div>
          <div class="cert-detail-card">
            <div class="cert-detail-label">Answered</div>
            <div class="cert-detail-value">
              ${submission.correctCount || 0} correct / ${attemptedCount} attempted
              ${hasAdjustedScore ? '<div class="cert-detail-subline">Teacher score adjustment is active for this result.</div>' : ''}
            </div>
          </div>
          <div class="cert-detail-card">
            <div class="cert-detail-label">${identityLabel}</div>
            <div class="cert-detail-value">${escapeHtml(submission.email || '')}</div>
          </div>
          <div class="cert-detail-card">
            <div class="cert-detail-label">Quiz Name</div>
            <div class="cert-detail-value">${quizName}</div>
          </div>
          <div class="cert-detail-card cert-correction-card">
            <div class="cert-detail-label">Correction Request</div>
            <div class="cert-detail-value" id="correctionRequestStatus">
              ${correctionRequested ? '<span class="status-chip status-pending">Requested</span>' : '<span class="status-chip">Not requested</span>'}
              <div class="small muted-line" id="correctionRequestedAtText">${correctionRequestedText ? escapeHtml(correctionRequestedText) : ''}</div>
            </div>
          </div>
        </div>

        ${signatoriesHtml}

        <div class="cert-footer">Verified Digital Result • Generated by OPE Assessor</div>
        <div class="cert-footer-sub">Clean • Secure • Beautiful • Parent-ready</div>
      </div>

      ${includeActions ? `
        <div class="result-actions no-print">
          <button id="requestCorrectionBtn" class="btn btn-secondary">${correctionRequested ? 'Update Request' : 'Request Correction'}</button>
          <button id="downloadStudentResultPdf" class="btn btn-primary">Download PDF</button>
          <button id="printStudentResult" class="btn btn-secondary">Print Result</button>
          <button id="closeStudentResult" class="btn btn-secondary">Close</button>
        </div>
      ` : ''}
    </div>
  `;
}

function getCertificateResultCss() {
  return `
    .cert-result{font-family:Inter,Arial,sans-serif;background:#fff;color:#101821;border-radius:10px;padding:14px;box-shadow:0 18px 45px rgba(15,23,42,.12);border:5px solid #D9B45A}
    .cert-inner{position:relative;border:2px solid #E4BD5B;border-radius:8px;padding:28px 34px 26px;background:#fff;overflow:hidden}
    .cert-inner:before{content:"";position:absolute;inset:0;background:linear-gradient(105deg,rgba(15,23,42,.025) 0 8%,transparent 8% 14%,rgba(15,23,42,.018) 14% 22%,transparent 22%);pointer-events:none}
    .cert-top-rule{height:32px;border-radius:999px;background:#DDBB5E;margin:0 0 -12px;position:relative;z-index:2}
    .cert-header{background:linear-gradient(135deg,#08111C 0%,#101922 58%,#1F2937 100%);color:#fff;text-align:center;border-radius:0 0 24px 24px;padding:34px 16px 30px;position:relative;margin-top:-6px}
    .cert-brand-lockup{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
    .cert-logo-badge{width:74px;height:74px;border-radius:22px;background:linear-gradient(135deg,#DDBB5E,#F6E7B6);padding:3px;box-shadow:0 12px 30px rgba(0,0,0,.2)}
    .cert-logo-badge span{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:19px;background:linear-gradient(135deg,#0F172A,#1E293B);color:#F8E8B0;font-size:26px;font-weight:900;letter-spacing:.1em}
    .cert-logo-text{text-align:left}
    .cert-logo-text strong{display:block;font-size:24px;line-height:1;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .cert-logo-text span{display:block;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#DDBB5E;margin-top:6px}
    .cert-school{font-size:32px;line-height:1.12;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-top:6px}
    .cert-test{font-size:19px;color:#DDBB5E;font-weight:900;letter-spacing:.05em;text-transform:uppercase;margin-top:8px}
    .cert-title{text-align:center;font-size:36px;font-weight:900;letter-spacing:.12em;margin:38px 0 4px;color:#101821}
    .cert-platform{text-align:center;font-size:16px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#6B7280;margin-bottom:24px}
    .cert-student-panel{border:1px solid #DDE3EA;background:#F8FAFC;border-radius:16px;text-align:center;padding:18px 12px;margin:0 auto 0;max-width:780px}
    .cert-label,.cert-detail-label{font-weight:900;color:#6B7280;text-transform:uppercase;letter-spacing:.06em}
    .cert-student-name{font-size:40px;font-weight:900;letter-spacing:.08em;margin-top:8px;color:#101821}
    .cert-score-wrap{display:flex;flex-direction:column;align-items:center;gap:14px;margin:10px 0 24px}
    .cert-score-ring{--cert-progress:0;width:250px;height:250px;border-radius:999px;padding:14px;background:conic-gradient(from -90deg,#DDBB5E 0 calc(var(--cert-progress) * 1%),#F5E6B8 calc(var(--cert-progress) * 1%) 100%);box-shadow:0 18px 36px rgba(15,23,42,.08)}
    .cert-score-ring-inner{width:100%;height:100%;border-radius:999px;background:radial-gradient(circle at top,#172436 0%,#101922 68%);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;box-sizing:border-box;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
    .cert-score-label{font-size:14px;font-weight:900;color:#DDBB5E;letter-spacing:.13em;margin-bottom:10px}
    .cert-score-main{font-size:42px;font-weight:900;line-height:1.08}
    .cert-score-percent{font-size:36px;color:#fff;font-weight:900;margin-top:10px}
    .cert-score-helper{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#CBD5E1;margin-top:8px}
    .cert-performance{max-width:min(360px,92%);padding:10px 18px;border-radius:999px;background:#FEF3C7;color:#92400E;font-size:14px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;text-align:center}
    .cert-adjusted-note{font-size:12px;color:#B45309;background:#FFF7ED;border:1px solid #FED7AA;border-radius:999px;padding:7px 12px;text-align:center}
    .cert-rank{width:min(360px,80%);margin:0 auto 34px;text-align:center;background:#DDBB5E;color:#101821;border-radius:999px;padding:14px;font-size:26px;font-weight:900;letter-spacing:.04em}
    .cert-details-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:8px}
    .cert-detail-card{border:1px solid #DDE3EA;background:#F8FAFC;border-radius:14px;padding:18px 20px;min-height:92px}
    .cert-detail-value{font-size:17px;line-height:1.45;margin-top:12px;color:#202938;word-break:break-word}
    .cert-detail-subline{font-size:12px;color:#B45309;margin-top:8px}
    .cert-correction-card{grid-column:1/-1}
    .cert-signatures{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:28px;margin:32px auto 12px;max-width:880px;text-align:center;color:#6B7280}
    .cert-signature-card{padding-top:6px;display:flex;flex-direction:column;align-items:center}
    .cert-signature-script{width:min(220px,100%);min-height:36px;margin:0 auto -8px;display:flex;align-items:flex-end;justify-content:center;transform-origin:center bottom}
    .cert-signature-svg{display:block;width:min(196px,100%);height:42px;overflow:visible}
    .cert-signatures span{display:block;border-top:2px solid #6B7280;margin:0 auto 8px;width:min(220px,100%)}
    .cert-signatures p{margin:0;font-size:14px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#101821}
    .cert-footer{text-align:center;font-weight:900;font-size:17px;margin-top:18px;color:#101821}
    .cert-footer-sub{text-align:center;color:#6B7280;margin-top:8px}
    .cert-result .result-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:18px}
    .student-result-full{display:flex;flex-direction:column;gap:12px}
    .student-topic-card{margin-top:0;background:#F8FAFC;padding:16px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,.05)}
    .student-topic-card h4{margin:0 0 12px;color:#111827;font-size:16px}
    .student-topic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .student-topic-item{border:1px solid #E2E8F0;border-radius:12px;background:#fff;padding:12px}
    .student-topic-item strong{display:block;color:#0F172A;font-size:14px;line-height:1.35}
    .student-topic-item span{display:block;margin-top:6px;color:#0F766E;font-weight:800}
    .student-topic-item small{display:block;margin-top:6px;color:#64748B;font-size:12px;line-height:1.45}
    @media(max-width:640px){.cert-result{border-width:3px;padding:8px}.cert-inner{padding:18px 12px}.cert-top-rule{height:24px}.cert-header{padding:26px 10px 22px}.cert-brand-lockup{gap:10px}.cert-logo-badge{width:58px;height:58px;border-radius:18px}.cert-logo-badge span{border-radius:15px;font-size:20px}.cert-logo-text{text-align:center}.cert-logo-text strong{font-size:18px}.cert-logo-text span{font-size:10px;letter-spacing:.13em}.cert-school{font-size:22px}.cert-test{font-size:15px}.cert-title{font-size:25px;margin-top:26px}.cert-platform{font-size:12px;letter-spacing:.14em}.cert-student-name{font-size:30px}.cert-score-ring{width:190px;height:190px;padding:10px}.cert-score-ring-inner{padding:20px}.cert-score-main{font-size:31px}.cert-score-percent{font-size:27px}.cert-score-helper{font-size:10px}.cert-performance{font-size:12px;padding:9px 14px}.cert-adjusted-note{font-size:11px;width:100%}.cert-rank{font-size:21px;width:90%;margin-bottom:24px}.cert-details-grid{grid-template-columns:1fr;gap:12px}.cert-correction-card{grid-column:auto}.cert-signatures{gap:20px}.cert-signature-script{min-height:30px;margin-bottom:-6px}.cert-signature-svg{height:36px}.student-topic-grid{grid-template-columns:1fr}.cert-footer{font-size:14px}}
    @media print{.cert-result{box-shadow:none;border-color:#D9B45A}.cert-result .result-actions{display:none!important}}
  `;
}

function buildStudentSummaryPdfHtml(quiz, submission) {
  const ranks = computeRankingForQuiz(submission.quizId);
  const rankValue = ranks[normalizeEmail(submission.email)] || '-';
  const resultHtml = buildStudentResultFullHtml(quiz, submission, rankValue, { includeActions: false });
  return `
    <div class="student-result-export-page" style="font-family:Inter,Arial,sans-serif;background:#ffffff;color:#0B1220;padding:0">
      <style>
        ${getCertificateResultCss()}
        .student-result-export-page{width:100%;max-width:746px;margin:0 auto}
        .student-result-export-page .student-result-full{page-break-inside:avoid;break-inside:avoid}
        .student-result-export-page .student-topic-card{margin-top:12px;padding:14px;border:1px solid #E5E7EB;box-shadow:none}
      </style>
      ${resultHtml}
    </div>
  `;
}

function printStudentSummary(quiz, submission) {
  const ranks = computeRankingForQuiz(submission.quizId);
  const rankValue = ranks[normalizeEmail(submission.email)] || '-';
  const html = buildStudentResultFullHtml(quiz, submission, rankValue, { includeActions: false });
  const printHtml = `
    <div class="student-result-export-page" style="font-family:Inter,Arial,sans-serif;background:#ffffff;color:#0B1220;padding:0">
      <style>
        ${getCertificateResultCss()}
        .student-result-export-page{width:100%;max-width:746px;margin:0 auto}
        .student-result-export-page .student-result-full{page-break-inside:avoid;break-inside:avoid}
        .student-result-export-page .student-topic-card{margin-top:12px;padding:14px;border:1px solid #E5E7EB;box-shadow:none}
      </style>
      ${html}
    </div>
  `;
  printHtmlAsSinglePage(printHtml, { title: 'Student Result Summary', paddingPx: 10 })
    .catch(() => showNotification('Unable to open print window', 'error'));
}

function renderResultsView() {
  const q = state.currentQuiz;
  if (!q) return document.createElement('div');
  regradeSubmissionsForQuiz(q);
  const submissions = getAllSubmissions().filter(s => s.quizId === q.id);
  const avgScore = submissions.length > 0 ? Math.round(submissions.reduce((a,s) => a + (s.score || 0), 0) / submissions.length) : 0;
  const avgPercent = submissions.length > 0 ? Math.round(submissions.reduce((a,s) => a + (s.percent || 0), 0) / submissions.length) : 0;
  const highestPercent = submissions.length ? Math.max(...submissions.map(s => s.percent || 0)) : 0;
  const lowestPercent = submissions.length ? Math.min(...submissions.map(s => s.percent || 0)) : 0;
  const passCount = submissions.filter(s => (s.resultStatus || ((s.percent || 0) >= (q.passMark || 50) ? 'Pass' : 'Fail')) === 'Pass').length;
  const correctionRequestCount = submissions.filter(s => !!s.correctionRequested).length;
  const failCount = submissions.length - passCount;
  const div = document.createElement('div');
  div.className = 'max-w-7xl mx-auto';
  div.innerHTML = `
    <div class="mb-10 text-center">
      <h2 class="display-font text-4xl font-bold text-gradient mb-3">${q.title} - Results</h2>
      <div class="text-sm text-gray-600">Facility: ${q.facility || ' '}</div>
      <div class="flex gap-3 justify-center mt-4">
        <button id="btnBackTeacher" class="btn-pastel-primary">Back to Dashboard</button>
        <button id="btnExamAnalysis" class="btn-pastel-secondary">Exam Analysis</button>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="card-beautiful p-6 text-center">
        <div class="text-sm text-gray-600 mb-2">Submissions</div>
        <div class="text-3xl font-bold text-blue-600">${submissions.length}</div>
      </div>
      <div class="card-beautiful p-6 text-center">
        <div class="text-sm text-gray-600 mb-2">Avg Score</div>
        <div class="text-3xl font-bold text-cyan-600">${avgScore}</div>
      </div>
      <div class="card-beautiful p-6 text-center">
        <div class="text-sm text-gray-600 mb-2">Avg %</div>
        <div class="text-3xl font-bold text-sky-600">${avgPercent}%</div>
      </div>
      <div class="card-beautiful p-6 text-center">
        <div class="text-sm text-gray-600 mb-2">Export</div>
        <button id="btnExportXLSX" class="btn-pastel-secondary text-sm w-full">Excel</button>
        <button id="btnExportSummaryPDF" class="btn-pastel-secondary text-sm w-full" style="margin-top:8px">PDF Summary</button>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div class="card-beautiful p-6 text-center"><div class="text-sm text-gray-600 mb-2">Highest</div><div class="text-3xl font-bold text-blue-600">${highestPercent}%</div></div>
      <div class="card-beautiful p-6 text-center"><div class="text-sm text-gray-600 mb-2">Lowest</div><div class="text-3xl font-bold text-blue-600">${lowestPercent}%</div></div>
      <div class="card-beautiful p-6 text-center"><div class="text-sm text-gray-600 mb-2">Pass</div><div class="text-3xl font-bold text-cyan-600">${passCount}</div></div>
      <div class="card-beautiful p-6 text-center"><div class="text-sm text-gray-600 mb-2">Fail</div><div class="text-3xl font-bold text-sky-600">${failCount}</div></div>
    </div>
    <div class="card-beautiful p-4 mb-8">
      <div class="small">Correction requests pending: <strong>${correctionRequestCount}</strong></div>
    </div>

    <div class="card-beautiful p-8 mb-8">
      <h3 class="text-2xl font-bold text-blue-900 mb-6">Charts</h3>
      <div class="result-chart-row"><span>Average</span><div class="result-chart-track"><i style="width:${avgPercent}%"></i></div><strong>${avgPercent}%</strong></div>
      <div class="result-chart-row"><span>Highest</span><div class="result-chart-track"><i style="width:${highestPercent}%"></i></div><strong>${highestPercent}%</strong></div>
      <div class="result-chart-row"><span>Lowest</span><div class="result-chart-track"><i style="width:${lowestPercent}%"></i></div><strong>${lowestPercent}%</strong></div>
      <div class="result-pie" style="--pass:${submissions.length ? Math.round((passCount/submissions.length)*100) : 0}%"><span>Pass ${passCount}</span><span>Fail ${failCount}</span></div>
    </div>

    <div class="card-beautiful p-8">
      <h3 class="text-2xl font-bold text-blue-900 mb-6">Submissions</h3>
      <div id="submissionsList" class="space-y-4"></div>
    </div>
  `;

  setTimeout(() => {
    document.getElementById('btnBackTeacher').onclick = () => {
      state.view = 'teacher';
      render();
    };
    const btnAnalysis = document.getElementById('btnExamAnalysis');
    if (btnAnalysis) btnAnalysis.onclick = () => showExamAnalysisModal(q);
    document.getElementById('btnExportXLSX').onclick = () => {
      if (typeof XLSX === 'undefined') return showNotification('Excel library not loaded', 'error');
      const ranks = computeRankingForQuiz(q.id);
      const header = ['Name','Email / Reg No','Facility','Score','%','Status','Adjusted','Correction Request','Correction Message','IP','Tab switches','Time (min)','Rank','Submitted'];
      const data = [header];
      submissions.forEach(s => {
        data.push([s.name, s.email, s.facility || q.facility || '', formatScoreValue(s.score), s.percent, s.resultStatus || ((s.percent || 0) >= (q.passMark || 50) ? 'Pass' : 'Fail'), hasManualScoreOverride(s) ? 'Teacher adjusted' : 'Auto', s.correctionRequested ? 'Requested' : '', s.correctionMessage || '', (s.monitoring && s.monitoring.ipAddress) || '', (s.monitoring && s.monitoring.tabSwitches) || 0, Math.round((s.timeSpent||0)/60), ranks[normalizeEmail(s.email)]||'', new Date(s.submittedAt).toLocaleString()]);
      });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Results');
      XLSX.writeFile(wb, `results-${q.id}.xlsx`);
      showNotification('  Exported to Excel', 'success');
    };
    document.getElementById('btnExportSummaryPDF').onclick = () => {
      downloadPdfFromHtml(
        buildTeacherSummaryPdfHtml(q, submissions),
        `results-summary-${q.id}.pdf`,
        'Teacher result summary PDF downloaded',
        { orientation: 'l', singlePage: true, marginMm: 8, paddingPx: 8, sourceWidthPx: 1123 }
      );
    };

    const list = document.getElementById('submissionsList');
    if (submissions.length === 0) {
      list.innerHTML = '<p class="text-gray-500 text-center py-8">No submissions yet.</p>';
    } else {
      const ranks = computeRankingForQuiz(q.id);
      const rows = submissions.map(s => {
        return `
          <tr>
            <td>${escapeHtml(s.name || '')}</td>
            <td>${escapeHtml(s.email || '')}</td>
            <td>${s.facility || q.facility || ''}</td>
            <td class="text-right">${formatScoreValue(s.score)}/${(s.allQuestions || []).length}${hasManualScoreOverride(s) ? '<div class="small" style="color:#B45309;font-weight:700">Adjusted</div>' : ''}</td>
            <td class="text-right">${s.percent}%</td>
            <td class="text-right">${escapeHtml(s.resultStatus || ((s.percent || 0) >= (q.passMark || 50) ? 'Pass' : 'Fail'))}</td>
            <td class="text-right">${escapeHtml((s.monitoring && s.monitoring.ipAddress) || '')}</td>
            <td class="text-right">${(s.monitoring && s.monitoring.tabSwitches) || 0}</td>
            <td class="text-right">${Math.floor((s.timeSpent||0) / 60)}m</td>
            <td class="text-right">${ranks[normalizeEmail(s.email)] || ''}</td>
            <td class="text-right">
              ${s.correctionRequested
                ? `<span class="req-badge req-pending" title="${escapeHtml(s.correctionMessage || '')}">Requested</span>`
                : '<span class="req-badge">None</span>'}
            </td>
            <td class="text-right">
              <button class="btn-pastel-secondary btnEditSubmissionScore" data-quiz="${q.id}" data-email="${encodeURIComponent(s.email)}" data-submitted="${escapeHtml(s.submittedAt || '')}">Edit Score</button>
              <button class="btn-pastel-secondary btnDownloadCorrection" data-quiz="${q.id}" data-email="${encodeURIComponent(s.email)}" data-submitted="${escapeHtml(s.submittedAt || '')}">Download Correction</button>
              <button class="btn-pastel-secondary btnEmailCorrection" title="Send email to student" data-quiz="${q.id}" data-email="${encodeURIComponent(s.email)}" data-submitted="${escapeHtml(s.submittedAt || '')}">Send Email</button>
              <button class="btn-pastel-secondary btnDeleteSubmission" data-quiz="${q.id}" data-email="${encodeURIComponent(s.email)}" data-submitted="${escapeHtml(s.submittedAt || '')}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');

      list.innerHTML = `
        <div class="card-beautiful p-4">
          <div class="overflow-x-auto">
            <table class="table-dense w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email / Reg No</th>
                  <th>Facility</th>
                  <th class="text-right">Score</th>
                  <th class="text-right">%</th>
                  <th class="text-right">Status</th>
                  <th class="text-right">IP</th>
                  <th class="text-right">Tabs</th>
                  <th class="text-right">Time</th>
                  <th class="text-right">Rank</th>
                  <th class="text-right">Correction</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Wire per-student correction PDF buttons
    setTimeout(() => {
      document.querySelectorAll('.btnEditSubmissionScore').forEach(btn => btn.onclick = (ev) => {
        const quizId = ev.currentTarget.dataset.quiz;
        const email = decodeURIComponent(ev.currentTarget.dataset.email || '');
        const submittedAt = ev.currentTarget.dataset.submitted || '';
        const all = getAllSubmissions();
        const index = findSubmissionIndexByIdentity(all, quizId, email, submittedAt);
        if (index < 0) return showNotification('Submission not found', 'error');
        showEditSubmissionScoreModal(getAllQuizzes()[quizId] || q, all[index]);
      });
      document.querySelectorAll('.btnDownloadCorrection').forEach(btn => btn.onclick = (ev) => {
        try {
          const quizId = ev.currentTarget.dataset.quiz;
          const email = decodeURIComponent(ev.currentTarget.dataset.email || '');
          const submittedAt = ev.currentTarget.dataset.submitted || '';
          const subsAll = getAllSubmissions();
          const index = findSubmissionIndexByIdentity(subsAll, quizId, email, submittedAt);
          const s = index >= 0 ? subsAll[index] : null;
          if (!s) return showNotification('Submission not found', 'error');
          const quiz = getAllQuizzes()[quizId] || {};
          downloadCorrectionPdfFast(s, quiz, { showNegativePenalty: true }).then(() => {
            showNotification('Student correction PDF downloaded', 'success');
            s._correctionDownloaded = true;
            s.updatedAt = new Date().toISOString();
            const subsAll2 = getAllSubmissions();
            const idx2 = findSubmissionIndexByIdentity(subsAll2, s.quizId, s.email, s.submittedAt || '');
            if (idx2 >= 0) {
              subsAll2[idx2] = s;
              saveAllSubmissions(subsAll2);
            }
          }).catch(() => {});
        } catch (e) { console.error(e); showNotification('Error generating PDF', 'error'); }
      });
      document.querySelectorAll('.btnEmailCorrection').forEach(btn => btn.onclick = (ev) => {
        try {
          const quizId = ev.currentTarget.dataset.quiz;
          const email = decodeURIComponent(ev.currentTarget.dataset.email || '');
          const submittedAt = ev.currentTarget.dataset.submitted || '';
          const subsAll = getAllSubmissions();
          const index = findSubmissionIndexByIdentity(subsAll, quizId, email, submittedAt);
          const s = index >= 0 ? subsAll[index] : null;
          if (!s) return showNotification('Submission not found', 'error');
          const quiz = getAllQuizzes()[quizId] || {};
          downloadCorrectionPdfFast(s, quiz, { showNegativePenalty: true }).then(() => {
            showNotification('PDF generated. Opening email client...', 'success');
            const subject = encodeURIComponent(`Correction for ${quiz.title || quizId}`);
            const reqLine = s.correctionRequested
              ? `\nStudent request: ${s.correctionMessage || 'Correction review requested.'}\nRequested at: ${s.correctionRequestedAt ? new Date(s.correctionRequestedAt).toLocaleString() : 'N/A'}\n`
              : '';
            const body = encodeURIComponent(`Hi ${s.name},\n\nPlease find the correction PDF for quiz ${quiz.title || quizId}.${reqLine}\nBest regards,`);
            window.location.href = `mailto:${encodeURIComponent(s.email)}?subject=${subject}&body=${body}`;
            const subsAfterEmail = getAllSubmissions();
            const emailIndex = findSubmissionIndexByIdentity(subsAfterEmail, quizId, s.email, s.submittedAt || '');
            if (emailIndex >= 0) {
              subsAfterEmail[emailIndex] = {
                ...subsAfterEmail[emailIndex],
                correctionStatus: 'emailed',
                correctionEmailedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              saveAllSubmissions(subsAfterEmail);
            }
            showNotification('Email draft opened. Your mail app cannot auto-attach files in browser mode, so attach the downloaded PDF and click Send.', 'warning', 9000);
          }).catch(() => {});
        } catch (e) { console.error(e); showNotification('Error preparing email', 'error'); }
      });
      document.querySelectorAll('.btnDeleteSubmission').forEach(btn => btn.onclick = (ev) => {
        const quizId = ev.currentTarget.dataset.quiz;
        const email = decodeURIComponent(ev.currentTarget.dataset.email || '');
        const submittedAt = ev.currentTarget.dataset.submitted || '';
        if (!confirm('Delete this student submission/result? This cannot be undone.')) return;
        const all = getAllSubmissions();
        const index = findSubmissionIndexByIdentity(all, quizId, email, submittedAt);
        if (index < 0) return showNotification('Submission not found', 'error');
        const next = all.slice(0, index).concat(all.slice(index + 1));
        saveAllSubmissions(next);
        showNotification('Submission deleted', 'success');
        render();
      });
    }, 100);
  }, 0);

  return div;
}

// Render exam analysis modal (facility index) for a quiz
function showExamAnalysisModal(q) {
  try {
    const data = computeFacilityIndex(q.id);
    let modal = document.getElementById('analysisModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'analysisModal';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.background = 'rgba(0,0,0,0.4)';
    modal.style.zIndex = 20000;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    const inner = document.createElement('div');
    inner.className = 'card-beautiful p-6';
    inner.style.width = '90%';
    inner.style.maxWidth = '1000px';
    inner.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-2xl font-bold">  Exam Analysis   Facility Index</h3>
        <div class="flex gap-2">
          <button id="btnAnalysisExportXLS" class="btn-pastel-secondary">  Export Excel</button>
          <button id="btnAnalysisExportPDF" class="btn-pastel-primary">  Export PDF</button>
          <button id="btnCloseAnalysis" class="btn-pastel-secondary">  Close</button>
        </div>
      </div>
      <div id="analysisContent" style="max-height:60vh;overflow:auto;"></div>
    `;

    modal.appendChild(inner);
    document.body.appendChild(modal);

    const content = inner.querySelector('#analysisContent');
    if (!data || !data.length) {
      content.innerHTML = '<p class="text-gray-600">No submissions yet to analyze.</p>';
    } else {
      // Group by subject, sort each subject's questions by facilityIndex ascending (most failed first)
      const grouped = {};
      for (const r of data) {
        const subj = r.subject || 'General'; if (!grouped[subj]) grouped[subj]=[]; grouped[subj].push(r);
      }
      const subjKeys = Object.keys(grouped);
      let html = '';
      for (const sk of subjKeys) {
        const items = grouped[sk].slice().sort((a,b)=>{
          const va = a.facilityIndex === null ? 1 : a.facilityIndex;
          const vb = b.facilityIndex === null ? 1 : b.facilityIndex;
          return va - vb;
        });
        html += `<h4 style="margin-top:12px;margin-bottom:6px">Subject: ${escapeHtml(sk)}</h4>`;
        for (const r of items) {
          const fi = r.facilityIndex === null ? ' ' : (r.facilityIndex.toFixed(3) + ' (' + Math.round(r.facilityIndex*100) + '%)');
          const interp = r.facilityIndex === null ? 'No attempts' : (r.facilityIndex <= 0.3 ? 'Very difficult' : r.facilityIndex <= 0.5 ? 'Difficult' : r.facilityIndex <= 0.7 ? 'Moderate' : 'Easy');
          const opts = (r.optionCounts || []).map(item => {
            const isCorrect = (r.answer || '').toString().toUpperCase() === item.letter;
            return `<li style="list-style:none;margin:6px 0;padding:8px;border-radius:8px;display:flex;justify-content:space-between;gap:12px;${isCorrect ? 'background:#ecfdf5;border:1px solid #10b981;font-weight:700;' : 'background:#fbfdff;border:1px solid #e6eef6;'}"><span>${item.letter}. ${escapeHtml(item.option)} ${isCorrect ? '<span style="color:#059669;margin-left:8px">Correct answer</span>' : ''}</span><strong>${item.count} student(s)</strong></li>`;
          }).join('');
          html += `<div class="p-4 mb-4" style="border-bottom:1px solid rgba(2,6,23,0.06);"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;"><div style="font-weight:700">Q${r.index}   <span style="font-weight:600">${escapeHtml(r.subject)}</span></div><div style="color:#475569">Facility: ${fi} &nbsp;   &nbsp; ${interp}</div></div><div style="margin-top:8px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font-size:1rem;color:#0b1220">${escapeHtml(r.question)}</div><div class="small" style="margin-top:8px">Seen by ${r.seen} student(s), attempted by ${r.attempted}, correct ${r.correct}, unanswered ${r.unanswered}, not seen by ${r.notSeen}</div><ul style="margin-top:12px;padding:0">${opts}</ul></div>`;
        }
      }
      content.innerHTML = `<div style="max-height:60vh;overflow:auto;padding-right:8px">${html}</div>`;
    }

    // Wire close
    document.getElementById('btnCloseAnalysis').onclick = () => modal.remove();

    // Export handlers
    document.getElementById('btnAnalysisExportXLS').onclick = () => {
      if (typeof XLSX === 'undefined') return showNotification('Excel library not loaded', 'error');
      const maxOptions = Math.max(0, ...data.map(r => (r.optionCounts || []).length));
      const optionHeaders = [];
      for (let i = 0; i < maxOptions; i++) optionHeaders.push(`Option ${String.fromCharCode(65+i)} Count`);
      const header = ['Q#','Subject','Question','Seen','Attempted','Correct','Unanswered','Not Seen','Facility','Interpretation', ...optionHeaders];
      const rows = data.map(r => {
        const optionValues = [];
        for (let i = 0; i < maxOptions; i++) optionValues.push((r.optionCounts || [])[i]?.count || 0);
        return [r.index, r.subject, r.question, r.seen, r.attempted, r.correct, r.unanswered, r.notSeen, r.facilityIndex === null ? '' : (r.facilityIndex.toFixed(3)), r.facilityIndex === null ? 'No attempts' : (r.facilityIndex <= 0.3 ? 'Very difficult' : r.facilityIndex <= 0.5 ? 'Difficult' : r.facilityIndex <= 0.7 ? 'Moderate' : 'Easy'), ...optionValues];
      });
      const aoa = [header, ...rows];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, 'FacilityIndex');
      XLSX.writeFile(wb, `facility-index-${q.id}.xlsx`);
      showNotification('  Exported Facility Index', 'success');
    };
    document.getElementById('btnAnalysisExportPDF').onclick = () => {
      try {
        downloadFacilityIndexPdfText(q, data).then(() => showNotification('Facility index PDF downloaded', 'success'));
      } catch(e) { console.error(e); showNotification('Error exporting PDF', 'error'); }
    };

  } catch (e) { console.error('Analysis error', e); showNotification('Error generating analysis', 'error'); }
}

// Small helper to escape HTML in strings
function escapeHtml(s) { return (s || '').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ============================================================================
// INITIALIZATION
// ============================================================================

let timerInterval = null;
let timeRemaining = 0;
let startTime = null;

function autoSubmit() {
  showNotification('  Time up! Auto-submitting...', 'warning');
  setTimeout(() => collectAndSubmit(), 1000);
}

// =================== Quiz Creation / Import / Template ===================
function gen6DigitId() { return Math.floor(100000 + Math.random()*900000).toString(); }

function showCreateQuizModal(editQuizId = '') {
  if (!requireTeacher()) return render();
  if (!canSetQuestions()) return showLicenseRequired();
  const editingQuiz = editQuizId ? getAllQuizzes()[editQuizId] : null;
  if (editingQuiz && editingQuiz.teacherId !== state.teacherId && !isSuperAdmin()) return showNotification('Access denied: this quiz belongs to another teacher', 'error');
  let m = document.getElementById('createQuizModal'); if (m) m.remove();
  m = document.createElement('div'); m.id = 'createQuizModal'; m.style.position='fixed'; m.style.inset='0'; m.style.zIndex=20000; m.style.background='rgba(0,0,0,0.35)'; m.style.overflowY='auto'; m.style.padding='24px 12px';
  const inner = document.createElement('div'); inner.className='card-beautiful quiz-builder-shell'; inner.style.width='1180px'; inner.style.maxWidth='96%'; inner.style.maxHeight='calc(100vh - 48px)'; inner.style.margin='0 auto'; inner.style.padding='24px'; inner.style.overflowY='auto';
  inner.innerHTML = `
    <div class="quiz-builder-header">
      <div>
        <div class="quiz-builder-kicker">Quiz Workspace</div>
        <h3>${editingQuiz ? 'Edit Quiz' : 'Create Quiz'}</h3>
        <p>Organize your assessment settings in clear sections, then save without changing the underlying quiz logic.</p>
      </div>
      <button id="closeCreate" class="btn-secondary quiz-close-btn" aria-label="Close quiz editor">Close</button>
    </div>
    <div class="quiz-form-grid create-quiz-grid">
      <div class="quiz-main-column">
        <section class="form-section">
          <div class="section-title-row">
            <div class="section-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h8l4 4v12H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 4v4h4M10 12h6M10 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </div>
            <div>
              <h4 class="section-title">Basic Quiz Info</h4>
              <p class="section-subtitle">Set the core details students and teachers rely on.</p>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="cqExamName">Exam Name / Institution</label>
            <input id="cqExamName" class="input-beautiful" placeholder="e.g. ABC University" />
            <p class="helper-text">This appears as the main institution/exam heading on student result summaries and PDFs.</p>
          </div>
          <div class="form-group">
            <label class="form-label" for="cqTitle">Quiz title</label>
            <input id="cqTitle" class="input-beautiful" />
          </div>
          <div class="field-grid-2">
            <div class="form-group">
              <label class="form-label" for="cqPassword">Password</label>
              <input id="cqPassword" class="input-beautiful" type="password" placeholder="Optional password for teacher access" />
              <p class="helper-text">Teachers can use this with the Quiz ID to reopen the quiz securely.</p>
            </div>
            <div class="form-group">
              <label class="form-label" for="cqTime">Time limit</label>
              <input id="cqTime" class="input-beautiful" placeholder="Time limit (minutes)" />
            </div>
            <div class="form-group">
              <label class="form-label" for="cqMaxGrade">Max grade</label>
              <input id="cqMaxGrade" class="input-beautiful" placeholder="Max grade" />
            </div>
            <div class="form-group">
              <label class="form-label" for="cqAttemptLimit">Attempt limit</label>
              <input id="cqAttemptLimit" class="input-beautiful" placeholder="Attempt limit (default 1)" />
            </div>
            <div class="form-group">
              <label class="form-label" for="cqPassMark">Pass mark</label>
              <input id="cqPassMark" class="input-beautiful" placeholder="Pass mark % (e.g. 50)" />
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="section-title-row">
            <div class="section-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v4M17 2v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 12v4m0 0 2-2m-2 2-2-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <h4 class="section-title">Marking & Schedule</h4>
              <p class="section-subtitle">Control grading behavior, access windows, and subject setup.</p>
            </div>
          </div>
          <div class="field-grid-2">
            <div class="form-group">
              <label class="form-label">Negative marking</label>
              <label class="check-row"><input type="checkbox" id="cqNegativeEnabled" /> <span>Enable mark deduction for wrong answers</span></label>
            </div>
            <div class="form-group">
              <label class="form-label" for="cqNegativeValue">Mark deduction per wrong answer</label>
              <input id="cqNegativeValue" class="input-beautiful" placeholder="e.g. 0.25" />
            </div>
            <div class="form-group">
              <label class="form-label" for="cqStart">Start date/time</label>
              <input id="cqStart" class="input-beautiful" type="datetime-local" />
            </div>
            <div class="form-group">
              <label class="form-label" for="cqEnd">End date/time</label>
              <input id="cqEnd" class="input-beautiful" type="datetime-local" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Subjects</label>
            <div class="subjects-section">
              <div id="subjectsList" class="subjects-list"></div>
              <button type="button" id="btnAddSubject" class="btn-secondary subject-add-btn">+ Add Subject</button>
            </div>
            <p class="helper-text">For multiple subjects, upload one question file per subject. The template column named Topic is only for topic tagging inside that subject.</p>
          </div>
        </section>

        <section class="form-section">
          <div class="section-title-row">
            <div class="section-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 4v6m10-6v6M5 11h14v8H5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 16h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </div>
            <div>
              <h4 class="section-title">Certificate Signatories</h4>
              <p class="section-subtitle">Add only the signatories you want on the result certificate. Leave this empty if you do not want any signatory line.</p>
            </div>
          </div>
          <div class="form-group">
            <div id="signatoriesList" class="signatories-list"></div>
            <button type="button" id="btnAddSignatory" class="btn-secondary subject-add-btn">+ Add Signatory</button>
            <p class="helper-text">Each signatory shows a drawn signature mark above the line. Only the title or label is printed on the certificate.</p>
          </div>
        </section>

        <section class="form-section">
          <div class="section-title-row">
            <div class="section-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 16v3h14v-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div>
              <h4 class="section-title">Question Import</h4>
              <p class="section-subtitle">Use the upload button inside each subject row. Paste CSV below only when creating a single-subject quiz.</p>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="cqPaste">Paste CSV</label>
            <textarea id="cqPaste" class="input-beautiful" placeholder="question,optionA,optionB,optionC,optionD,answer,topic,difficulty"></textarea>
          </div>
          <div class="field-grid-2">
            <div class="form-group form-toggle-stack">
              <label class="form-label">Delivery options</label>
              <label class="check-row"><input type="checkbox" id="cqShuffleQs" checked /> <span>Shuffle questions</span></label>
              <label class="check-row"><input type="checkbox" id="cqShuffleOpts" checked /> <span>Shuffle options</span></label>
            </div>
          </div>
        </section>
      </div>

      <aside class="advanced-panel">
        <div class="section-title-row compact">
          <div class="section-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3h4l1 3 3 1v4l-3 1-1 3h-4l-1-3-3-1V7l3-1 1-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
          </div>
          <div>
            <h3>Advanced Settings</h3>
            <p>Refine delivery, result visibility, and student restrictions.</p>
          </div>
        </div>

        <div class="advanced-block">
          <label class="check-row"><input type="checkbox" id="cqRanking" /> <span>Enable ranking</span></label>
          <p class="helper-text">Students can see their rank when ranking is turned on.</p>
        </div>

        <div class="advanced-block">
          <label class="check-row"><input type="checkbox" id="cqInstantResult" checked /> <span>Show score after submission</span></label>
          <p class="helper-text">Reveal scores immediately after the student submits the quiz.</p>
        </div>

        <div class="advanced-block">
          <label class="check-row"><input type="checkbox" id="cqShowTopicsAfter" /> <span>Show topic breakdown after submission</span></label>
          <p class="helper-text">Let students see performance by topic after the quiz has been submitted.</p>
        </div>

        <div class="advanced-block">
          <label class="check-row"><input type="checkbox" id="cqVertical" /> <span>Vertical UI</span></label>
          <p class="helper-text">Display questions on one page instead of the step-by-step layout.</p>
        </div>

        <div class="advanced-block">
          <div class="form-label">Restrict to uploaded students</div>
          <p class="helper-text">Import a CSV or Excel list to limit access to approved students only.</p>
          <button id="btnImportWhitelist" class="btn-secondary advanced-action">Import Students</button>
        </div>

        <div class="advanced-block">
          <div class="form-label">Export Excel Template</div>
          <p class="helper-text">Download the starter spreadsheet with the supported question columns.</p>
          <button id="btnExportTemplate" class="btn-secondary advanced-action">Export Excel Template</button>
        </div>
      </aside>
    </div>
    <div class="form-actions">
      <button id="btnCancelCreate" class="btn-secondary">Cancel</button>
      <button id="btnCreateSave" class="btn-primary">${editingQuiz ? 'Save Changes' : 'Save Quiz'}</button>
    </div>
  `;
  m.appendChild(inner); document.body.appendChild(m);
  enhancePasswordFields(inner);

  // handlers
  setTimeout(()=>{
    const subjectsList = document.getElementById('subjectsList');
    const signatoriesList = document.getElementById('signatoriesList');
    const createSubjectRow = (subject = {}) => {
      const row = document.createElement('div');
      row.className = 'subject-row';
      row._importedQuestions = Array.isArray(subject.importedQuestions) ? subject.importedQuestions : [];
      row.innerHTML = `
        <div class="subject-field">
          <label class="small">Subject name</label>
          <input type="text" class="input-beautiful subject-name" placeholder="Subject name (e.g. Math)" value="${escapeHtml(subject.name || '')}" />
        </div>
        <div class="subject-field">
          <label class="small">Upload quiz CSV/Excel</label>
          <button type="button" class="btn-secondary subject-upload-btn">Upload File</button>
          <div class="small subject-file-status">${row._importedQuestions.length ? row._importedQuestions.length + ' question(s) loaded' : 'No file uploaded'}</div>
        </div>
        <div class="subject-field">
          <label class="small">Questions per student</label>
          <div class="subject-time-wrap">
            <input type="number" class="input-beautiful subject-count" min="0" placeholder="Questions per student" value="${subject.questionCount ? escapeHtml(subject.questionCount) : ''}" />
            <span class="subject-time-unit">questions</span>
          </div>
        </div>
        <button type="button" class="subject-remove-btn" aria-label="Remove subject">✕</button>
      `;
      row.querySelector('.subject-upload-btn').onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
        inp.onchange = async (ev) => {
          const f = ev.target.files[0]; if (!f) return;
          try {
            row._importedQuestions = (await parseQuestionsFile(f, false)).filter(isMeaningfulQuestion);
            row.querySelector('.subject-file-status').textContent = `${row._importedQuestions.length} question(s) loaded`;
            showNotification(`${row._importedQuestions.length} question(s) loaded for this subject`, 'success');
          } catch (err) {
            console.error(err);
            showNotification('Could not import subject questions', 'error');
          }
        };
        inp.click();
      };
      row.querySelector('.subject-remove-btn').onclick = () => {
        row.remove();
        if (!subjectsList.children.length) createSubjectRow();
      };
      subjectsList.appendChild(row);
    };
    const createSignatoryRow = (signatory = {}) => {
      const row = document.createElement('div');
      row.className = 'signatory-row';
      row.innerHTML = `
        <div class="subject-field">
          <label class="small">Signatory name</label>
          <input type="text" class="input-beautiful signatory-name" placeholder="e.g. Grace Okafor" value="${escapeHtml(signatory.name || '')}" />
        </div>
        <div class="subject-field">
          <label class="small">Title / label (optional)</label>
          <input type="text" class="input-beautiful signatory-title" placeholder="e.g. Principal" value="${escapeHtml(signatory.title || '')}" />
        </div>
        <button type="button" class="subject-remove-btn signatory-remove-btn" aria-label="Remove signatory">✕</button>
      `;
      row.querySelector('.signatory-remove-btn').onclick = () => row.remove();
      signatoriesList.appendChild(row);
    };
    const getSubjectRows = () => Array.from(subjectsList.querySelectorAll('.subject-row')).map(row => {
      const name = row.querySelector('.subject-name').value.trim();
      const countValue = row.querySelector('.subject-count').value;
      return {
        name,
        questionCount: countValue === '' ? null : (parseInt(countValue, 10) || 0),
        importedQuestions: (row._importedQuestions || []).filter(isMeaningfulQuestion)
      };
    }).filter(subject => subject.name);
    const getSignatoryRows = () => Array.from(signatoriesList.querySelectorAll('.signatory-row')).map((row) => ({
      name: row.querySelector('.signatory-name').value.trim(),
      title: row.querySelector('.signatory-title').value.trim()
    })).filter((item) => item.name);

    if (editingQuiz) {
      document.getElementById('cqExamName').value = editingQuiz.examName || '';
      document.getElementById('cqTitle').value = editingQuiz.title || '';
      document.getElementById('cqPassword').value = editingQuiz.password || '';
      document.getElementById('cqTime').value = editingQuiz.timeLimit || '';
      document.getElementById('cqMaxGrade').value = editingQuiz.maxGrade || '';
      document.getElementById('cqAttemptLimit').value = editingQuiz.attemptLimit || 1;
      document.getElementById('cqPassMark').value = editingQuiz.passMark || 50;
      document.getElementById('cqNegativeEnabled').checked = !!editingQuiz.negativeMarkEnabled;
      document.getElementById('cqNegativeValue').value = editingQuiz.negativeMarkValue || '';
      document.getElementById('cqStart').value = editingQuiz.scheduleStart ? new Date(editingQuiz.scheduleStart).toISOString().slice(0,16) : '';
      document.getElementById('cqEnd').value = editingQuiz.scheduleEnd ? new Date(editingQuiz.scheduleEnd).toISOString().slice(0,16) : '';
      subjectsList.innerHTML = '';
      (editingQuiz.subjects || []).forEach(subject => createSubjectRow({
        name: subject.name || 'General',
        questionCount: subject.questionCount ?? null,
        importedQuestions: Array.isArray(subject.bankQuestions) && subject.bankQuestions.length ? subject.bankQuestions : subject.questions
      }));
      document.getElementById('cqShuffleQs').checked = editingQuiz.shuffleQs !== false;
      document.getElementById('cqShuffleOpts').checked = editingQuiz.shuffleOpts !== false;
      document.getElementById('cqRanking').checked = !!editingQuiz.rankingEnabled;
      document.getElementById('cqInstantResult').checked = editingQuiz.showInstantResult !== false;
      document.getElementById('cqShowTopicsAfter').checked = !!editingQuiz.showTopicsAfterSubmission;
      document.getElementById('cqVertical').checked = !!editingQuiz.verticalLayout;
      normalizeCertificateSignatories(editingQuiz.certificateSignatories).forEach(createSignatoryRow);
    }
    if (!subjectsList.children.length) createSubjectRow();
    document.getElementById('btnAddSubject').onclick = () => createSubjectRow();
    document.getElementById('btnAddSignatory').onclick = () => createSignatoryRow();
    document.getElementById('closeCreate').onclick = ()=>m.remove();
    document.getElementById('btnCancelCreate').onclick = ()=>m.remove();
    document.getElementById('btnExportTemplate').onclick = ()=> exportQuizTemplate();
    enhancePasswordFields(inner);
    document.getElementById('btnImportWhitelist').onclick = ()=>{
      const inp = document.createElement('input'); inp.type='file'; inp.accept='.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'; inp.onchange = (ev)=>{
        const f = ev.target.files[0]; if (!f) return; parseQuestionsFile(f, true).then(list=>{ showNotification('Students imported ('+list.length+')','success'); window._importedWhitelist=list; });
      }; inp.click();
    };

    document.getElementById('btnCreateSave').onclick = async ()=>{
      const examName = document.getElementById('cqExamName').value.trim();
      const title = document.getElementById('cqTitle').value.trim();
      const password = document.getElementById('cqPassword').value || '';
      const time = parseInt(document.getElementById('cqTime').value,10) || 0;
      const maxGrade = parseFloat(document.getElementById('cqMaxGrade').value) || 100;
      const attemptLimit = parseInt(document.getElementById('cqAttemptLimit').value,10) || 1;
      const passMark = parseFloat(document.getElementById('cqPassMark').value) || 50;
      const negativeMarkEnabled = document.getElementById('cqNegativeEnabled').checked;
      const negativeMarkValue = parseFloat(document.getElementById('cqNegativeValue').value) || 0;
      const scheduleStart = document.getElementById('cqStart').value || '';
      const scheduleEnd = document.getElementById('cqEnd').value || '';
      if (scheduleStart && scheduleEnd && new Date(scheduleStart) >= new Date(scheduleEnd)) return showNotification('End time must be after start time', 'error');
      const subjects = getSubjectRows();
      const pastedBank = (document.getElementById('cqPaste').value||'').trim()
        ? parseQuestionsFromCSVString(document.getElementById('cqPaste').value.trim()).filter(isMeaningfulQuestion)
        : [];
      const shuffleQs = document.getElementById('cqShuffleQs').checked;
      const shuffleOpts = document.getElementById('cqShuffleOpts').checked;
      let subjectsArr;
      const hasSubjectUploads = subjects.some(subject => subject.importedQuestions && subject.importedQuestions.length);
      if (hasSubjectUploads || pastedBank.length || !editingQuiz) {
        subjectsArr = subjects.map((subject, subjectIndex) => {
          const sourceBank = subject.importedQuestions && subject.importedQuestions.length
            ? subject.importedQuestions
            : (subjectIndex === 0 ? pastedBank : []);
          const questions = sourceBank.map((item, index) => normalizeQuestionForStorage({ ...item, subject: subject.name }, index, subject.name));
          return {
            name: subject.name,
            questions,
            bankQuestions: questions.slice(),
            questionCount: subject.questionCount || null
          };
        });
      } else {
        subjectsArr = (editingQuiz.subjects || []).map((subject, idx) => ({
          ...subject,
          name: subjects[idx]?.name || subject.name || 'General',
          questionCount: subjects[idx]?.questionCount ?? subject.questionCount ?? null
        }));
      }

      const id = editingQuiz ? editingQuiz.id : gen6DigitId();
      const now = new Date().toISOString();
      const importedWhitelist = window._importedWhitelist || editingQuiz?.whitelist || [];
      const qobj = { ...(editingQuiz || {}), id, examName, title: title || 'Untitled Quiz', password: password || '', timeLimit: time, maxGrade: maxGrade, attemptLimit, passMark, negativeMarkEnabled, negativeMarkValue, showInstantResult: document.getElementById('cqInstantResult').checked, showTopicsAfterSubmission: document.getElementById('cqShowTopicsAfter').checked, subjects: subjectsArr, questionPickCount: 0, createdAt: editingQuiz?.createdAt || now, editedAt: editingQuiz ? now : '', updatedAt: now, teacherId: editingQuiz?.teacherId || state.teacherId, shuffleQs, shuffleOpts, verticalLayout: document.getElementById('cqVertical').checked, rankingEnabled: document.getElementById('cqRanking').checked, whitelist: importedWhitelist, certificateSignatories: getSignatoryRows(), scheduleStart: scheduleStart ? new Date(scheduleStart).toISOString() : '', scheduleEnd: scheduleEnd ? new Date(scheduleEnd).toISOString() : '' };
      const quizzes = getAllQuizzes(); quizzes[id]=qobj; saveAllQuizzes(quizzes);
      const didRegrade = regradeSubmissionsForQuiz(qobj);
      if (state.currentQuiz && state.currentQuiz.id === id) state.currentQuiz = qobj;
      addStudentsToTeacher(importedWhitelist, id);
      const sharedSyncOk = await syncSharedKeys([
        STORAGE_KEYS.quizzes,
        STORAGE_KEYS.students,
        ...(didRegrade ? [STORAGE_KEYS.submissions] : [])
      ]);
      if (sharedSyncOk) {
        showNotification((editingQuiz ? 'Quiz updated' : 'Quiz saved') + '   ID: '+id,'success');
      } else {
        showNotification(`${editingQuiz ? 'Quiz updated' : 'Quiz saved'}   ID: ${id}. ${getSharedSyncWarningMessage()} Quiz IDs may not open on other devices yet.`, 'warning', 8000);
      }
      window._importedWhitelist = [];
      m.remove(); render();
    };
  },0);
}

function parseQuestionsFromCSVString(s) {
  const lines = s.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(/\s*,\s*/);
    if ((parts[0] || '').toLowerCase() === 'question') continue;
    // question, optA, optB, optC, optD, answer, topic, difficulty
    const q = { question: parts[0] || '', options: parts.slice(1,5).filter(Boolean), answer: (parts[5]||'').toString().trim().toUpperCase(), topic: parts[6]||'', difficulty: parts[7]||'Medium' };
    if (isMeaningfulQuestion(q)) out.push(q);
  }
  return out;
}

function parseQuestionsFile(file, whitelistOnly) {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      try {
        const data = e.target.result;
        let workbook;
        if (typeof XLSX !== 'undefined') {
          workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header:1, defval: '' });
          const rows = aoa.slice(1).map(r=>r.map(c=>c.toString()));
          if (whitelistOnly) {
            const list = rows.map(r=>({ name: r[0]||'', email: (r[1]||'').toString(), id: (r[2]||'').toString(), registrationNo: (r[2]||'').toString() } )).filter(x=>x.name && (x.email || x.id));
            resolve(list);
          } else {
            // assume columns: question,optA,optB,optC,optD,answer,topic,difficulty
            const list = rows.map(r=>({ question: r[0]||'', options: [r[1]||'',r[2]||'',r[3]||'',r[4]||''].filter(Boolean), answer: (r[5]||'').toString().toUpperCase(), topic: r[6]||'', difficulty: r[7]||'Medium' })).filter(isMeaningfulQuestion);
            resolve(list);
          }
        } else {
          // Fallback CSV
          const text = data;
          if (whitelistOnly) {
            const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean); const list = lines.map(l=>{ const p = l.split(','); return { name: p[0]||'', email: p[1]||'', id: p[2]||'', registrationNo: p[2]||'' }; }).filter(x => x.name && (x.email || x.id)); resolve(list);
          } else { const list = parseQuestionsFromCSVString(text); resolve(list); }
        }
      } catch (err) { reject(err); }
    };
    // read as binary string for XLSX
    try { reader.readAsBinaryString(file); } catch(e) { reader.readAsText(file); }
  });
}

function showLocalNetworkGuide() {
  let m = document.getElementById('localNetGuide'); if (m) m.remove();
  m = document.createElement('div'); m.id='localNetGuide'; m.style.position='fixed'; m.style.inset='0'; m.style.zIndex=20000; m.style.background='rgba(0,0,0,0.4)';
  const inner = document.createElement('div'); inner.className='card-beautiful p-6'; inner.style.width='720px'; inner.style.maxWidth='94%';
  inner.innerHTML = `
    <h3>How to find your computer's IP (local network)</h3>
    <p class="small">Students on the same Wi Fi can open a browser and visit <strong>http://YOUR_IP:8000</strong> after you run a simple local server. Steps:</p>
    <ol class="small">
      <li>On Windows: open Command Prompt and run <code>ipconfig</code>. Look for "IPv4 Address" under your active adapter.</li>
      <li>On macOS / Linux: run <code>ifconfig</code> or <code>ip addr</code> in Terminal and find the active interface's address (usually 192.168.x.x).</li>
      <li>Start a simple server in your quiz folder, e.g. <code>python -m http.server 8000</code>.</li>
      <li>Share the address: <code>http://192.168.x.y:8000</code> with students on the same Wi Fi.</li>
    </ol>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button id="closeNetGuide" class="btn-pastel-secondary">Close</button></div>
  `;
  m.appendChild(inner); document.body.appendChild(m);
  document.getElementById('closeNetGuide').onclick = ()=>m.remove();
}

function exportQuizTemplate() {
  // columns: question,optA,optB,optC,optD,answer,topic,difficulty
  const header = ['question','optA','optB','optC','optD','answer','topic','difficulty'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ['What is 2+2?','3','4','5','6','B','Arithmetic','Easy']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'ope-quiz-template.xlsx');
  showNotification('Template exported','success');
}

// =================== Visibility / Tab Detection ===================
let _visibilityTimer = null;
document.addEventListener('visibilitychange', ()=>{
  if (state.view === 'take' && state.currentSubmission?.examStarted) {
    if (document.hidden) {
      if (state.currentSubmission) {
        state.currentSubmission.monitoring = state.currentSubmission.monitoring || {};
        state.currentSubmission.monitoring.tabSwitches = (state.currentSubmission.monitoring.tabSwitches || 0) + 1;
      }
      // show overlay warning and start 5s timer
      showNotification('You left the exam tab   return within 5s or exam auto-submits','warning',5000);
      _visibilityTimer = setTimeout(()=>{ collectAndSubmit(); }, 5000);
    } else {
      if (_visibilityTimer) { clearTimeout(_visibilityTimer); _visibilityTimer = null; showNotification('Returned to exam','success'); }
    }
  }
});

// =================== Submission Locking & Ranking ===================
function hasSubmittedBefore(quizId, email) {
  const subs = getAllSubmissions().filter(s=>s.quizId===quizId);
  return subs.some(s => normalizeEmail(s.email) === normalizeEmail(email));
}

function getAttemptCount(quizId, email) {
  const key = normalizeEmail(email);
  return getAllSubmissions().filter(s => s.quizId === quizId && normalizeEmail(s.email) === key).length;
}

function getDraftKey(quizId, email) {
  return `ope_exam_draft_${quizId}_${normalizeEmail(email)}`;
}

function saveExamDraft(submission) {
  if (!submission || !submission.quizId || !submission.email) return;
  try {
    localStorage[getDraftKey(submission.quizId, submission.email)] = JSON.stringify({
      answers: submission.answers || {},
      flagged: submission.flagged || {},
      currentIndex: submission.currentIndex || 0,
      startedAt: submission.startedAt || '',
      savedAt: new Date().toISOString()
    });
  } catch(e) {}
}

function loadExamDraft(quizId, email) {
  try { return JSON.parse(localStorage[getDraftKey(quizId, email)] || 'null'); } catch(e) { return null; }
}

function clearExamDraft(quizId, email) {
  try { localStorage.removeItem(getDraftKey(quizId, email)); } catch(e) {}
}

function getQuizAnswerMap(quiz) {
  const map = {};
  (quiz.subjects || []).forEach(subject => {
    const source = Array.isArray(subject.bankQuestions) && subject.bankQuestions.length ? subject.bankQuestions : subject.questions;
    (source || []).forEach((question, index) => {
      const normalized = normalizeQuestionForStorage(question, index, subject.name || 'General');
      map[normalized._sourceId] = normalized.answer;
    });
  });
  return map;
}

function gradeSubmissionForQuiz(submission, quiz) {
  const all = submission.allQuestions || [];
  const answers = submission.answers || {};
  const answerMap = getQuizAnswerMap(quiz);
  const negativeEnabled = !!quiz.negativeMarkEnabled;
  const negativeValue = parseFloat(quiz.negativeMarkValue || 0) || 0;
  let correctCount = 0, wrongCount = 0, attemptedCount = 0;
  all.forEach((question, index) => {
    const chosen = (answers[index] || '').toString().toUpperCase();
    if (!chosen) return;
    attemptedCount++;
    const sourceId = question._sourceId || makeQuestionId(question, index);
    // Use the student's rendered answer key first (important when options were shuffled).
    const correctAnswer = (question.answer || answerMap[sourceId] || '').toString().toUpperCase();
    if (chosen === correctAnswer) correctCount++;
    else wrongCount++;
  });
  const rawScore = correctCount - (negativeEnabled ? wrongCount * negativeValue : 0);
  const score = Math.max(0, Math.round(rawScore * 100) / 100);
  const percent = all.length ? Math.min(100, Math.max(0, Math.round((score / all.length) * 100))) : 0;
  return { score, percent, correctCount, wrongCount, attemptedCount, negativePenalty: negativeEnabled ? wrongCount * negativeValue : 0 };
}

function regradeSubmissionsForQuiz(quiz) {
  const allSubs = getAllSubmissions();
  let changed = false;
  allSubs.forEach(sub => {
    if (sub.quizId !== quiz.id) return;
    const grade = buildSubmissionGradeState(sub, quiz, gradeSubmissionForQuiz(sub, quiz));
    const hasDiff =
      sub.score !== grade.score ||
      sub.percent !== grade.percent ||
      sub.correctCount !== grade.correctCount ||
      sub.wrongCount !== grade.wrongCount ||
      sub.attemptedCount !== grade.attemptedCount ||
      sub.negativePenalty !== grade.negativePenalty ||
      sub.passMark !== grade.passMark ||
      sub.resultStatus !== grade.resultStatus;
    if (!hasDiff) return;
    applyGradeToSubmission(sub, grade);
    sub.regradedAt = new Date().toISOString();
    changed = true;
  });
  if (changed) saveAllSubmissions(allSubs);
  return changed;
}

function computeStudentTopicPerformance(submission) {
  const grouped = {};
  const all = submission.allQuestions || [];
  const answers = submission.answers || {};
  all.forEach((question, index) => {
    const subject = question._subject || question.subject || 'General';
    if (!grouped[subject]) grouped[subject] = { total: 0, attempted: 0, correct: 0 };
    grouped[subject].total++;
    const chosen = (answers[index] || '').toString().toUpperCase();
    if (!chosen) return;
    grouped[subject].attempted++;
    const correct = (question.answer || '').toString().toUpperCase();
    if (chosen === correct) grouped[subject].correct++;
  });
  return grouped;
}

async function getClientIpAddress() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    return data.ip || '';
  } catch(e) {
    return '';
  }
}

function computeRankingForQuiz(quizId) {
  const subs = getAllSubmissions().filter(s=>s.quizId===quizId).slice();
  subs.sort((a,b)=>(b.percent || 0) - (a.percent || 0) || (a.timeSpent || 0) - (b.timeSpent || 0));
  const ranks = {};
  for (let i=0;i<subs.length;i++) ranks[normalizeEmail(subs[i].email)] = i+1;
  return ranks;
}

function getQuizScheduleStatus(quiz) {
  const now = Date.now();
  if (quiz.scheduleStart && new Date(quiz.scheduleStart).getTime() > now) return { ok: false, message: 'This quiz has not started yet. Start time: ' + new Date(quiz.scheduleStart).toLocaleString() };
  if (quiz.scheduleEnd && new Date(quiz.scheduleEnd).getTime() < now) return { ok: false, message: 'This quiz has ended. End time: ' + new Date(quiz.scheduleEnd).toLocaleString() };
  return { ok: true, message: '' };
}


// ======= Helper UI & Exam Functions (restored features) =======

function showNotification(msg, type = 'info', ttl = 3000) {
  try {
    const id = 'site-notification';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'notification ' + (type || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; try{el.remove()}catch(e){} }, ttl);
  } catch (e) { console.warn('notify', e); }
}

function showStudentResultModalByLookup(quizId, identifier, includeActions = true) {
  const id = (quizId || '').trim();
  const key = normalizeEmail(identifier || '');
  if (!id || !key) return showNotification('Enter quiz ID and email or registration number', 'error');
  const quizForRegrade = getAllQuizzes()[id];
  if (quizForRegrade) regradeSubmissionsForQuiz(quizForRegrade);
  const subs = getAllSubmissions().filter(s=>s.quizId===id && normalizeEmail(s.email)===key);
  if (!subs || subs.length===0) return showNotification('No submission found for that quiz/email or registration number','error');
  const s = subs[subs.length-1];
  const ranks = computeRankingForQuiz(id);
  let modal = document.getElementById('studentResultModal'); if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'studentResultModal';
  modal.className = 'student-result-modal';
  const inner = document.createElement('div');
  inner.className = 'student-result-modal-card';
  const quiz = getAllQuizzes()[id] || { id };
  inner.innerHTML = buildStudentResultFullHtml(quiz, s, ranks[normalizeEmail(s.email)] || '-', { includeActions });
  modal.appendChild(inner); document.body.appendChild(modal);
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };
  const closeBtn = document.getElementById('closeStudentResult'); if (closeBtn) closeBtn.onclick = ()=>modal.remove();
  const downloadBtn = document.getElementById('downloadStudentResultPdf');
  if (downloadBtn) downloadBtn.onclick = () => {
    downloadPdfFromHtml(
      buildStudentSummaryPdfHtml(quiz, s),
      getStudentResultPdfFilename(s, id),
      'Student result summary PDF downloaded',
      { singlePage: true, marginMm: 6, paddingPx: 10 }
    );
  };
  const requestBtn = document.getElementById('requestCorrectionBtn');
  if (requestBtn) requestBtn.onclick = () => {
    const note = (prompt('Add a short correction request message for your teacher (optional):', s.correctionMessage || '') || '').trim();
    const updated = updateLatestSubmissionByQuizAndEmail(id, s.email, (item) => {
      item.correctionRequested = true;
      item.correctionRequestedAt = new Date().toISOString();
      item.correctionMessage = note;
      item.correctionStatus = 'pending';
    });
    if (!updated) return showNotification('Unable to save correction request', 'error');
    s.correctionRequested = true;
    s.correctionRequestedAt = updated.correctionRequestedAt;
    s.correctionMessage = note;
    s.correctionStatus = 'pending';
    showNotification('Correction request sent to teacher', 'success', 5000);
    const statusEl = document.getElementById('correctionRequestStatus');
    if (statusEl) statusEl.innerHTML = `<span class="status-chip status-pending">Requested</span><div class="small muted-line" id="correctionRequestedAtText">${escapeHtml(new Date(updated.correctionRequestedAt).toLocaleString())}</div>`;
    requestBtn.textContent = 'Update Request';
  };
  const printBtn = document.getElementById('printStudentResult');
  if (printBtn) printBtn.onclick = () => {
    printStudentSummary(quiz, s);
  };
  return s;
}

function showEditSubmissionScoreModal(quiz, submission) {
  if (!submission) return showNotification('Submission not found', 'error');
  let modal = document.getElementById('scoreEditModal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'scoreEditModal';
  modal.className = 'student-result-modal';

  const totalQuestions = (submission.allQuestions || []).length;
  const baseGrade = gradeSubmissionForQuiz(submission, quiz || {});
  const currentScore = hasManualScoreOverride(submission) ? Number(submission.manualScoreOverride) : Number(submission.score || 0);
  const currentValue = Number.isFinite(currentScore) ? formatScoreValue(currentScore) : '0';

  const card = document.createElement('div');
  card.className = 'card-beautiful admin-modal-card score-edit-modal-card';
  card.innerHTML = `
    <div class="score-edit-header">
      <div>
        <h3>Edit Student Score</h3>
        <p>Change this student's stored score before exporting. The updated score will flow into the result certificate, ranking, Excel, and PDF exports.</p>
      </div>
      <button type="button" id="closeScoreEditModal" class="btn-pastel-secondary">Close</button>
    </div>

    <div class="score-edit-summary">
      <div class="score-edit-summary-card">
        <span>Student</span>
        <strong>${escapeHtml(submission.name || submission.email || 'Student')}</strong>
      </div>
      <div class="score-edit-summary-card">
        <span>Quiz</span>
        <strong>${escapeHtml((quiz && quiz.title) || submission.quizId || 'Quiz')}</strong>
      </div>
      <div class="score-edit-summary-card">
        <span>Questions</span>
        <strong>${totalQuestions}</strong>
      </div>
      <div class="score-edit-summary-card">
        <span>Original Auto Score</span>
        <strong>${formatScoreValue(baseGrade.score)} / ${totalQuestions}</strong>
      </div>
    </div>

    <div class="score-edit-grid">
      <div class="form-group">
        <label class="form-label" for="scoreEditValue">Adjusted score</label>
        <input id="scoreEditValue" class="input-beautiful" type="number" min="0" max="${totalQuestions}" step="0.01" value="${currentValue}" />
        <p class="helper-text">Enter a score between 0 and ${totalQuestions}. You can use decimals when needed.</p>
      </div>
      <div class="score-edit-preview" id="scoreEditPreview"></div>
    </div>

    <div class="score-edit-actions">
      <button type="button" id="resetScoreEdit" class="btn-pastel-secondary"${hasManualScoreOverride(submission) ? '' : ' disabled'}>Reset to Auto Score</button>
      <button type="button" id="saveScoreEdit" class="btn-pastel-primary">Save Score</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);
  modal.onclick = (ev) => { if (ev.target === modal) modal.remove(); };

  const input = card.querySelector('#scoreEditValue');
  const preview = card.querySelector('#scoreEditPreview');
  const close = card.querySelector('#closeScoreEditModal');
  const save = card.querySelector('#saveScoreEdit');
  const reset = card.querySelector('#resetScoreEdit');

  const renderPreview = () => {
    const raw = Number(input.value);
    if (input.value === '' || !Number.isFinite(raw)) {
      preview.innerHTML = '<div class="score-edit-preview-label">Preview</div><strong>Enter a valid score to preview the result.</strong>';
      return;
    }
    if (raw < 0 || raw > totalQuestions) {
      preview.innerHTML = `<div class="score-edit-preview-label">Preview</div><strong>Score must stay between 0 and ${totalQuestions}.</strong>`;
      return;
    }
    const draftSubmission = { ...submission, manualScoreOverride: raw };
    const nextGrade = buildSubmissionGradeState(draftSubmission, quiz || {}, baseGrade);
    preview.innerHTML = `
      <div class="score-edit-preview-label">Preview</div>
      <strong>${formatScoreValue(nextGrade.score)} / ${totalQuestions}</strong>
      <div>${nextGrade.percent}% • ${escapeHtml(nextGrade.resultStatus)}</div>
      <div class="score-edit-preview-note">Exports will use this adjusted score until you reset it.</div>
    `;
  };

  renderPreview();
  input.oninput = renderPreview;
  close.onclick = () => modal.remove();

  save.onclick = () => {
    const raw = Number(input.value);
    if (input.value === '' || !Number.isFinite(raw)) return showNotification('Enter a valid score', 'error');
    if (raw < 0 || raw > totalQuestions) return showNotification(`Score must be between 0 and ${totalQuestions}`, 'error');
    const all = getAllSubmissions();
    const index = findSubmissionIndexByIdentity(all, submission.quizId, submission.email, submission.submittedAt || '');
    if (index < 0) return showNotification('Submission not found', 'error');
    all[index].manualScoreOverride = Math.round(raw * 100) / 100;
    all[index].manualScoreEditedAt = new Date().toISOString();
    all[index].manualScoreEditedBy = state.teacherId || 'teacher';
    all[index].updatedAt = new Date().toISOString();
    const nextGrade = buildSubmissionGradeState(all[index], quiz || {}, gradeSubmissionForQuiz(all[index], quiz || {}));
    applyGradeToSubmission(all[index], nextGrade);
    saveAllSubmissions(all);
    modal.remove();
    showNotification('Student score updated', 'success');
    render();
  };

  reset.onclick = () => {
    const all = getAllSubmissions();
    const index = findSubmissionIndexByIdentity(all, submission.quizId, submission.email, submission.submittedAt || '');
    if (index < 0) return showNotification('Submission not found', 'error');
    delete all[index].manualScoreOverride;
    delete all[index].manualScoreEditedAt;
    delete all[index].manualScoreEditedBy;
    all[index].updatedAt = new Date().toISOString();
    const nextGrade = buildSubmissionGradeState(all[index], quiz || {}, gradeSubmissionForQuiz(all[index], quiz || {}));
    applyGradeToSubmission(all[index], nextGrade);
    saveAllSubmissions(all);
    modal.remove();
    showNotification('Student score reset to auto grade', 'success');
    render();
  };
}

function renderStudentEntry() {
  const wrapper = document.createElement('div');
  wrapper.className = 'student-page';
  const quizzes = getAllQuizzes();
  wrapper.innerHTML = `
    <div class="h1">Student - Enter Details</div>
    <div class="small">Provide your name, email or registration number, then enter the Quiz Code or paste the short link.</div>
    <div class="student-shell">
      <div class="form-card">
        <div class="student-fields">
        <label class="small">Full name</label>
        <input id="stuName" class="input-beautiful" />
        <div style="height:8px"></div>
        <label class="small">Email / Registration No</label>
        <input id="stuIdentity" class="input-beautiful" placeholder="Email or registration number" />
        <div style="height:8px"></div>
        <label class="small">Quiz Code / Magic Link</label>
        <input id="stuAccess" class="input-beautiful" placeholder="123456, OPEQUIZ:..., or https://..." value="${escapeHtml(state.prefillQuizCode || '')}" />
        <div style="height:8px"></div>
        <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="stuWebcamToggle" /> Enable webcam (optional)</label>
        <div style="height:12px"></div>
        <div class="student-buttons"><button id="startExamBtn" class="btn-main">Start Exam</button><button id="previewLink" class="btn-secondary">Copy Link</button><button id="checkResultBtn" class="btn-secondary">Check Result</button></div>
        </div>
      </div>
      <div class="info-card">
          <h3 class="display-font">Quick Info</h3>
          <p class="text-muted">Enter the Quiz Code provided by your teacher, paste the student link, or paste the portable access code that starts with OPEQUIZ:</p>
          <p class="text-muted">The app will not show other teachers' quizzes.</p>
      </div>
    </div>
  `;

  setTimeout(()=>{
    document.getElementById('startExamBtn').onclick = async () => {
      const name = document.getElementById('stuName').value.trim();
      const studentKey = document.getElementById('stuIdentity').value.trim();
      const access = parseQuizAccessInput(document.getElementById('stuAccess').value || '');
      const email = studentKey.includes('@') ? studentKey : '';
      const registrationNo = studentKey.includes('@') ? '' : studentKey;
      if (!name || !studentKey) return showNotification('Please enter name and email or registration number','error');
      let quiz = await resolveQuizFromAccessWithSync(access);
      if (!quiz) {
        const syncHelp = canUseNetworkSync()
          ? 'Ask the teacher to resend the student link or portable student code from the Copy Portable Link / Copy Student Code button.'
          : 'This deployment is not connected to shared sync, so students must use the student link or portable access code instead of only the 6-digit number.';
        return showNotification(`Quiz not found or invalid code/link. ${syncHelp}`, 'error', 8000);
      }
      let qid = null;
      qid = quiz.id;
      const schedule = getQuizScheduleStatus(quiz);
      if (!schedule.ok) return showNotification(schedule.message, 'error', 6000);
      const attemptLimit = parseInt(quiz.attemptLimit || 1, 10) || 1;
      const usedAttempts = getAttemptCount(qid, studentKey);
      if (usedAttempts >= attemptLimit) return showNotification(`Attempt limit reached (${usedAttempts}/${attemptLimit})`, 'error');
      // enforce whitelist if present on quiz
      if (quiz.whitelist && Array.isArray(quiz.whitelist) && quiz.whitelist.length) {
        const normalized = normalizeEmail(email);
        const normalizedReg = normalizeEmail(registrationNo);
        const found = quiz.whitelist.some(w => {
          const allowedEmail = normalizeEmail((w.email||'').toString());
          const allowedId = normalizeEmail((w.id||w.registrationNo||'').toString());
          return (!!normalized && allowedEmail === normalized) || (!!normalizedReg && allowedId === normalizedReg);
        });
        if (!found) return showNotification('You are not on the allowed list for this quiz', 'error');
      }
      state.currentQuiz = quiz;
      state.currentSubmission = null; // reset
      state.view = 'take';
      // set student details into submission placeholder
      state.currentSubmission = { name, email: studentKey, registrationNo, answers: {}, flagged: {}, quizId: quiz.id, allQuestions: [], currentIndex: 0, examStarted: false, startedAt: '', snapshots: [], attemptNo: usedAttempts + 1, monitoring: { tabSwitches: 0, fullscreenExits: 0, copyAttempts: 0, screenshotAttempts: 0, webcamEnabled: false, ipAddress: '', userAgent: navigator.userAgent || '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '' } };
      const draft = loadExamDraft(quiz.id, studentKey);
      if (draft && confirm('A saved exam draft was found. Resume from where you stopped?')) {
        state.currentSubmission.answers = draft.answers || {};
        state.currentSubmission.flagged = draft.flagged || {};
        state.currentSubmission.currentIndex = draft.currentIndex || 0;
        state.currentSubmission.startedAt = draft.startedAt || '';
      }
      const webcamOn = document.getElementById('stuWebcamToggle').checked;
      state.currentSubmission.webcamRequested = webcamOn;
      state.currentSubmission.monitoring.webcamEnabled = webcamOn;
      getClientIpAddress().then(ip => { if (state.currentSubmission && state.currentSubmission.quizId === quiz.id) state.currentSubmission.monitoring.ipAddress = ip; });
      render();
    };
    document.getElementById('previewLink').onclick = async ()=>{
      const q = await resolveQuizFromAccessWithSync(parseQuizAccessInput(document.getElementById('stuAccess').value || ''));
      if (!q) return showNotification('Quiz not found or invalid code/link', 'error');
      await copyQuizAccessLink(q);
    };
    document.getElementById('checkResultBtn').onclick = ()=>{
      const id = prompt('Enter Quiz ID to check'); if (!id) return;
      const identifier = prompt('Enter your email or registration number used for submission'); if (!identifier) return;
      showStudentResultModalByLookup(id, identifier, true);
    };
  },0);

  return wrapper;
}

let _webcamStream = null;
function startWebcam() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showNotification('Webcam not supported in this browser','error');
    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } }).then(stream => {
      _webcamStream = stream;
      let feed = document.getElementById('webcamFeed');
      if (!feed) {
        feed = document.createElement('div'); feed.id = 'webcamFeed'; feed.className = 'webcam-feed card-beautiful';
        feed.style.position = 'fixed'; feed.style.right = '18px'; feed.style.bottom = '18px'; feed.style.width = '140px'; feed.style.height = '100px'; feed.style.zIndex = 9999; feed.style.padding = '6px';
        const v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; v.className = 'webcam-video'; v.srcObject = stream; feed.appendChild(v); document.body.appendChild(feed);
      } else {
        const v = feed.querySelector('video'); if (v) v.srcObject = stream;
      }
      // take random snapshots occasionally
      if (state.currentSubmission) {
        state.currentSubmission._snapshotInterval = setInterval(()=>{
          try {
            const v = document.querySelector('#webcamFeed video');
            if (!v) return;
            const c = document.createElement('canvas'); c.width = v.videoWidth || 320; c.height = v.videoHeight || 240; c.getContext('2d').drawImage(v,0,0,c.width,c.height);
            const data = c.toDataURL('image/jpeg', 0.4);
            state.currentSubmission.snapshots = state.currentSubmission.snapshots || [];
            state.currentSubmission.snapshots.push({ at: new Date().toISOString(), data });
            // Keep storage bounded to avoid UI freezes from very large localStorage writes.
            if (state.currentSubmission.snapshots.length > 6) state.currentSubmission.snapshots = state.currentSubmission.snapshots.slice(-6);
          } catch(e){}
        }, 1000 * (25 + Math.floor(Math.random()*50)));
      }
    }).catch(err => { console.warn('webcam denied', err); showNotification('Webcam permission denied','error'); });
  } catch (e) { console.warn(e); }
}

function stopWebcam() {
  try {
    if (state.currentSubmission && state.currentSubmission._snapshotInterval) { clearInterval(state.currentSubmission._snapshotInterval); delete state.currentSubmission._snapshotInterval; }
    if (_webcamStream) { _webcamStream.getTracks().forEach(t=>t.stop()); _webcamStream = null; }
    const feed = document.getElementById('webcamFeed'); if (feed) feed.remove();
  } catch (e) { console.warn(e); }
}

function collectAndSubmit() {
  try {
    const sub = state.currentSubmission;
    if (!sub) return showNotification('Nothing to submit','error');
    if (hasSubmittedBefore(sub.quizId, sub.email)) return showNotification('This email has already submitted this quiz', 'error');
    const quiz = getAllQuizzes()[sub.quizId] || state.currentQuiz || {};
    const all = sub.allQuestions || [];
    const grade = buildSubmissionGradeState(sub, quiz, gradeSubmissionForQuiz(sub, quiz));
    const score = grade.score;
    const percent = grade.percent;
    applyGradeToSubmission(sub, grade);
    sub.timeSpent = sub.startedAt ? (Date.now() - new Date(sub.startedAt).getTime())/1000 : 0;
    sub.submittedAt = new Date().toISOString();
    const allSubs = getAllSubmissions(); allSubs.push(sub); saveAllSubmissions(allSubs);
    clearExamDraft(sub.quizId, sub.email);
    showNotification('Submission saved  ','success');
    // cleanup proctoring
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch(e){}
    stopWebcam();
    // re-enable selection
    try{ document.body.classList.remove('exam-no-select'); }catch(e){}
    state.currentSubmission = null;
    state.view = 'student';
    state.currentQuiz = null;
    render();
    if (quiz.showInstantResult !== false) {
      showNotification(`Submitted. Score: ${formatScoreValue(score)}/${all.length} (${percent}%) - ${sub.resultStatus}`, sub.resultStatus === 'Pass' ? 'success' : 'warning', 7000);
      setTimeout(() => showStudentResultModalByLookup(sub.quizId, sub.email, true), 100);
    } else {
      showNotification('Submitted. Result will be released by your teacher.', 'success', 7000);
    }
  } catch (e) { console.error(e); showNotification('Error submitting','error'); }
}

// Global key/context handlers for copy protection while taking
document.addEventListener('contextmenu', (e)=>{
  if (state.view === 'take' && state.currentSubmission?.examStarted) { e.preventDefault(); showNotification('Right click disabled during exam','warning'); }
});
document.addEventListener('keydown', (e)=>{
  if (state.view === 'take' && state.currentSubmission?.examStarted) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C' || e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S')) {
      if (state.currentSubmission) {
        state.currentSubmission.monitoring = state.currentSubmission.monitoring || {};
        state.currentSubmission.monitoring.copyAttempts = (state.currentSubmission.monitoring.copyAttempts || 0) + 1;
      }
      e.preventDefault(); showNotification('This action is disabled during exam','warning');
    }
  }
});

// detect common screenshot keys and auto-submit (best-effort)
document.addEventListener('keydown', (e)=>{
  if (state.view === 'take' && state.currentSubmission?.examStarted) {
    const k = e.key || '';
    if (k === 'PrintScreen' || (e.ctrlKey && e.shiftKey && (k === 'S' || k === 's')) || (e.metaKey && e.shiftKey && (k === '4' || k === '5'))) {
      state.screenshotDetected = true;
      if (state.currentSubmission) {
        state.currentSubmission.monitoring = state.currentSubmission.monitoring || {};
        state.currentSubmission.monitoring.screenshotAttempts = (state.currentSubmission.monitoring.screenshotAttempts || 0) + 1;
      }
      showNotification('Screenshot attempt detected   submitting exam', 'warning');
      setTimeout(()=>collectAndSubmit(), 800);
      e.preventDefault();
    }
  }
});

// Fullscreen exit detection -> auto submit
document.addEventListener('fullscreenchange', ()=>{
  if (state.view === 'take' && state.currentSubmission?.examStarted && !document.fullscreenElement) {
    state.currentSubmission.monitoring = state.currentSubmission.monitoring || {};
    state.currentSubmission.monitoring.fullscreenExits = (state.currentSubmission.monitoring.fullscreenExits || 0) + 1;
    // student left fullscreen; auto-submit as configured
    showNotification('Left fullscreen   exam will be submitted','warning');
    setTimeout(()=>collectAndSubmit(), 1200);
  }
});

document.addEventListener('keydown', (e) => {
  if (state.view !== 'take' || !state.currentSubmission?.examStarted) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = (e.key || '').toLowerCase();
  if (!['a', 'b', 'c', 'd', 'n', 'p', 's'].includes(key)) return;
  const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(activeTag)) return;
  if (['a', 'b', 'c', 'd'].includes(key)) {
    const idx = state.currentSubmission.currentIndex || 0;
    const radio = document.querySelector(`input[name="opt-${idx}"][value="${key.toUpperCase()}"]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      e.preventDefault();
    }
  } else if (key === 'n') {
    document.getElementById('examNext')?.click();
    e.preventDefault();
  } else if (key === 'p') {
    document.getElementById('examPrev')?.click();
    e.preventDefault();
  } else if (key === 's') {
    document.getElementById('submitExam')?.click();
    e.preventDefault();
  }
});


