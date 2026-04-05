'use strict';

// ── Utilities ──────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }
function fmt(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
function show(el) { el && el.classList.remove('hidden'); }
function hide(el) { el && el.classList.add('hidden'); }

// ── Tab switching ──────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'files') loadFiles();
  });
});

// ── Step progress controller ───────────────────────────────────────────────────
class StepController {
  constructor(prefix, totalSteps) {
    this.prefix = prefix;
    this.total = totalSteps;
    this.current = 0;
    this.barFill = $(prefix + '-bar-fill');
    this.pctEl = $(prefix + '-pct');
    this.statusEl = $(prefix + '-status');
  }

  setState(stepNum, state) {
    const el = $(this.prefix + '-s' + stepNum);
    if (el) el.dataset.state = state;
  }

  setBar(pct, statusMsg) {
    this.barFill.style.width = pct + '%';
    this.pctEl.textContent = Math.round(pct) + '%';
    if (statusMsg && this.statusEl) this.statusEl.textContent = statusMsg;
  }

  // Animate through steps with realistic delays
  // steps: array of { id, label, duration }
  async run(steps, apiCall) {
    show($(this.prefix + '-progress'));

    // Mark all pending
    steps.forEach((s, i) => this.setState(i + 1, 'pending'));

    // Start first step immediately, rest simulate in parallel with API
    const totalDuration = steps.reduce((a, s) => a + s.duration, 0);
    let elapsed = 0;

    // Kick off API call
    const apiPromise = apiCall();

    // Animate steps concurrently
    const animateSteps = async () => {
      for (let i = 0; i < steps.length - 1; i++) {
        const s = steps[i];
        this.setState(i + 1, 'active');
        this.setBar((elapsed / totalDuration) * 90, s.label + '...');
        await delay(s.duration);
        this.setState(i + 1, 'done');
        elapsed += s.duration;
      }
      // Last step waits for API to complete
      this.setState(steps.length, 'active');
      this.setBar(92, steps[steps.length - 1].label + '...');
    };

    const [result] = await Promise.all([apiPromise, animateSteps()]);

    // All done
    steps.forEach((s, i) => this.setState(i + 1, 'done'));
    this.setBar(100, 'Complete');
    return result;
  }

  markError(stepNum, msg) {
    this.setState(stepNum, 'error');
    if (this.statusEl) this.statusEl.textContent = msg;
    this.pctEl.textContent = 'Failed';
  }

  reset() {
    hide($(this.prefix + '-progress'));
    this.setBar(0, '');
    for (let i = 1; i <= this.total; i++) this.setState(i, 'pending');
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── DROP ZONE helper ───────────────────────────────────────────────────────────
function setupDrop(dropEl, inputEl, onFile) {
  dropEl.addEventListener('click', () => inputEl.click());
  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('dragover'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('dragover'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault(); dropEl.classList.remove('dragover');
    const f = e.dataTransfer.files[0]; if (f) onFile(f);
  });
  inputEl.addEventListener('change', () => { if (inputEl.files[0]) onFile(inputEl.files[0]); });
}

// ══════════════════════════════════════════════════════════════════════════════
// ENCRYPT TAB
// ══════════════════════════════════════════════════════════════════════════════

const encSteps = new StepController('enc', 4);
let encFile = null, lastEncResult = null;

setupDrop($('enc-drop'), $('enc-input'), setEncFile);
$('enc-browse').addEventListener('click', e => { e.stopPropagation(); $('enc-input').click(); });

function setEncFile(file) {
  encFile = file;
  const reader = new FileReader();
  reader.onload = ev => {
    $('enc-preview').src = ev.target.result;
    show($('enc-preview-block'));
    $('enc-meta').textContent = `${file.name} · ${fmt(file.size)} · ${file.type || 'image'}`;
  };
  reader.readAsDataURL(file);
  $('enc-btn').disabled = false;
  hide($('enc-result')); hide($('enc-error'));
  encSteps.reset();
}

$('enc-btn').addEventListener('click', async () => {
  if (!encFile) return;
  $('enc-btn').disabled = true;
  hide($('enc-result')); hide($('enc-error'));
  encSteps.reset();

  try {
    const result = await encSteps.run([
      { id: 's1', label: 'AES-256 encryption', duration: 600 },
      { id: 's2', label: 'Triple-DES encryption', duration: 600 },
      { id: 's3', label: 'RSA-2048 key wrapping', duration: 700 },
      { id: 's4', label: 'Building .mlenc file', duration: 400 },
    ], async () => {
      const fd = new FormData();
      fd.append('image', encFile);
      const res = await fetch('/api/encrypt', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Encryption failed');
      return data;
    });

    lastEncResult = result;
    $('enc-result-body').innerHTML =
      `<strong>Original:</strong> ${result.originalName} (${fmt(result.originalSize)})<br>` +
      `<strong>Encrypted:</strong> ${result.filename} (${fmt(result.encryptedSize)})<br>` +
      `<strong>File ID:</strong> <code style="font-family:monospace;font-size:11px;opacity:.7">${result.fileId}</code>`;
    show($('enc-result'));
  } catch (err) {
    // Find which step we were on and mark it error
    const activeStep = document.querySelector('#panel-encrypt .step[data-state="active"]');
    const stepNum = activeStep ? activeStep.id.replace('enc-s', '') : 4;
    encSteps.markError(parseInt(stepNum), err.message);
    $('enc-error-body').textContent = err.message;
    show($('enc-error'));
  } finally {
    $('enc-btn').disabled = false;
  }
});

$('enc-download-btn').addEventListener('click', async () => {
  if (!lastEncResult) return;
  // Use the binary-safe download endpoint
  const res = await fetch(`/api/decrypt/download/${lastEncResult.fileId}`);
  if (!res.ok) { alert('Download failed.'); return; }
  const blob = await res.blob();
  triggerDownload(blob, lastEncResult.filename);
});

// ══════════════════════════════════════════════════════════════════════════════
// DECRYPT TAB
// ══════════════════════════════════════════════════════════════════════════════

const decSteps = new StepController('dec', 4);
let decFile = null;
let lastDecResult = null;

setupDrop($('dec-drop'), $('dec-input'), setDecFile);
$('dec-browse').addEventListener('click', e => { e.stopPropagation(); $('dec-input').click(); });

function setDecFile(file) {
  decFile = file;
  lastDecResult = null;
  $('dec-pill').textContent = `📄 ${file.name} · ${fmt(file.size)}`;
  show($('dec-pill'));
  $('dec-btn').disabled = false;
  hide($('dec-result')); hide($('dec-error'));
  decSteps.reset();
}

$('dec-btn').addEventListener('click', async () => {
  if (!decFile) return;
  $('dec-btn').disabled = true;
  hide($('dec-result')); hide($('dec-error'));
  decSteps.reset();

  try {
    const { blob, originalName } = await decSteps.run([
      { id: 's1', label: 'Validating file header', duration: 400 },
      { id: 's2', label: 'RSA-2048 key decryption', duration: 800 },
      { id: 's3', label: 'Reversing Triple-DES layer', duration: 600 },
      { id: 's4', label: 'Restoring original image', duration: 500 },
    ], async () => {
      const fd = new FormData();
      fd.append('encfile', decFile);
      const res = await fetch('/api/decrypt', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || 'Decryption failed');
      }
      const blob = await res.blob();
      const rawName = res.headers.get('X-Original-Name') || 'decrypted_image';
      const originalName = decodeURIComponent(rawName);
      return { blob, originalName };
    });

    lastDecResult = { blob, originalName };
    const imgUrl = URL.createObjectURL(blob);
    $('dec-result-body').innerHTML =
      `<strong>Recovered:</strong> ${originalName}<br>` +
      `<strong>Size:</strong> ${fmt(blob.size)}`;
    $('dec-preview').src = imgUrl;
    show($('dec-result'));

  } catch (err) {
    const activeStep = document.querySelector('#panel-decrypt .step[data-state="active"]');
    const stepNum = activeStep ? parseInt(activeStep.id.replace('dec-s', '')) : 1;
    decSteps.markError(stepNum, err.message);
    $('dec-error-body').innerHTML =
      err.message.replace(/\n/g, '<br>').replace(/(Solution:.*)/g, '<strong style="color:var(--amber)">$1</strong>');
    show($('dec-error'));
  } finally {
    $('dec-btn').disabled = false;
  }
});

$('dec-download-btn').addEventListener('click', () => {
  if (!lastDecResult) return;
  triggerDownload(lastDecResult.blob, lastDecResult.originalName);
});

// ══════════════════════════════════════════════════════════════════════════════
// FILES TAB
// ══════════════════════════════════════════════════════════════════════════════

async function loadFiles() {
  const listEl = $('files-list');
  listEl.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    if (!data.files.length) {
      listEl.innerHTML = '<div class="empty-state">No encrypted files stored yet.<br>Encrypt an image to get started.</div>';
      return;
    }
    listEl.innerHTML = data.files.map(f => `
      <div class="file-row">
        <div>
          <div class="file-name">🔒 ${f.filename}</div>
          <div class="file-meta">${fmt(f.size)} · ${new Date(f.createdAt).toLocaleString()}</div>
        </div>
        <div class="file-actions">
          <button class="btn-outline" onclick="downloadMlenc('${f.fileId}','${f.filename}')">⬇ .mlenc</button>
          <button class="btn-outline" onclick="decryptById('${f.fileId}')">🔑 Decrypt</button>
          <button class="btn-danger"  onclick="deleteFile('${f.fileId}', this)">✕</button>
        </div>
      </div>`).join('');
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Failed to load files: ${err.message}</div>`;
  }
}

window.downloadMlenc = async (fileId, filename) => {
  const res = await fetch(`/api/decrypt/download/${fileId}`);
  if (!res.ok) { alert('Download failed.'); return; }
  triggerDownload(await res.blob(), filename);
};

window.decryptById = async (fileId) => {
  const res = await fetch(`/api/decrypt/${fileId}`);
  if (!res.ok) { const e = await res.json().catch(() => ({})); alert('Decryption failed: ' + (e.error || 'unknown')); return; }
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get('X-Original-Name') || 'decrypted_image');
  triggerDownload(blob, name);
};

window.deleteFile = async (fileId, btn) => {
  if (!confirm('Permanently delete this encrypted file?')) return;
  btn.disabled = true;
  const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
  if (res.ok) loadFiles(); else { btn.disabled = false; alert('Delete failed.'); }
};

$('files-refresh').addEventListener('click', loadFiles);

// ── Shared helpers ─────────────────────────────────────────────────────────────
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ══════════════════════════════════════════════════════════════════════════════
// SIDEBAR LOGIC
// ══════════════════════════════════════════════════════════════════════════════

const sbOverlay = $('sb-overlay');
const sbSidebar = $('profile-sidebar');
let userRsaKey = '';
let isMasked = true;
let availabilityTimers = {
  username: null,
  email: null
};
let availabilityState = {
  username: null,
  email: null
};

function applyAvatarLetter(username) {
  if (!username || typeof username !== 'string') return;
  const letter = username.trim().charAt(0).toUpperCase();
  if (!letter) return;
  $('avatar-btn').textContent = letter;
  $('sb-avatar').textContent = letter;
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function hydrateAvatarFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return;
  const payload = decodeJwtPayload(token);
  if (payload && payload.username) applyAvatarLetter(payload.username);
}

function toggleSidebar(showOrHide) {
  if (showOrHide) {
    sbOverlay.classList.add('open');
    sbSidebar.classList.add('open');
    fetchUserProfile();
  } else {
    sbOverlay.classList.remove('open');
    sbSidebar.classList.remove('open');
  }
}

$('avatar-btn').addEventListener('click', () => toggleSidebar(true));
$('sb-close').addEventListener('click', () => toggleSidebar(false));
sbOverlay.addEventListener('click', () => toggleSidebar(false));

function setSidebarMessage(id, type, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'feedback-msg ' + type;
  el.textContent = type === 'success' ? '✓ ' + text : '✕ ' + text;
}

function setFieldStatus(id, state, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'field-status' + (state ? ' ' + state : '');
  el.textContent = text || '';
}

async function checkAvailability(field, value) {
  if (!value) return null;
  const res = await fetch('/api/user/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, value })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Validation failed');
  return !!data.available;
}

function scheduleAvailabilityCheck(field, inputId, statusId) {
  const input = $(inputId);
  if (!input) return;

  input.addEventListener('input', () => {
    const value = input.value.trim();
    clearTimeout(availabilityTimers[field]);

    if (!value) {
      availabilityState[field] = null;
      setFieldStatus(statusId, '', '');
      return;
    }

    if (field === 'email' && !value.includes('@')) {
      availabilityState[field] = false;
      setFieldStatus(statusId, 'bad', 'Enter a valid email address.');
      return;
    }

    setFieldStatus(statusId, '', 'Checking availability...');
    availabilityTimers[field] = setTimeout(async () => {
      try {
        const available = await checkAvailability(field, value);
        availabilityState[field] = available;
        setFieldStatus(statusId, available ? 'good' : 'bad', available ? 'Available' : 'Already taken');
      } catch {
        availabilityState[field] = false;
        setFieldStatus(statusId, 'bad', 'Unable to verify right now.');
      }
    }, 450);
  });
}

function setLoading(btnId, spinnerId, loading) {
  const btn = $(btnId);
  const spinner = $(spinnerId);
  if (btn) btn.disabled = loading;
  if (spinner) spinner.style.display = loading ? 'block' : 'none';
}

async function fetchUserProfile() {
  try {
    const resMe = await fetch('/api/user/me');
    if (resMe.ok) {
      const { username, email } = await resMe.json();
      $('sb-display-username').textContent = username || 'User';
      $('sb-display-email').textContent = email || '—';
      $('sb-avatar').textContent = (username || 'U').charAt(0).toUpperCase();
      $('sb-new-username').value = username || '';
      $('sb-new-email').value = email || '';
      applyAvatarLetter(username);
      setFieldStatus('sb-username-status', '', '');
      setFieldStatus('sb-email-status', '', '');
    }

    const password = sessionStorage.getItem('mlefps_pass');
    if (!password) {
      userRsaKey = '';
      $('sb-rsa-key').textContent = 'Private key locked for this session. Please re-login to unlock it.';
      localStorage.removeItem('token');
      window.location.href = '/login';
      return;
    } else {
      const resKey = await fetch('/api/user/private-key');
      if (resKey.ok) {
        const { privateKey } = await resKey.json();
        userRsaKey = privateKey;
        $('sb-rsa-key').textContent = privateKey;
      } else {
        const err = await resKey.json().catch(() => ({}));
        $('sb-rsa-key').textContent = err.error || 'Failed to fetch private key.';
      }
    }

    isMasked = true;
    $('sb-rsa-key').classList.add('masked');
    $('sb-rsa-icon').textContent = '👁';
    $('sb-rsa-label').textContent = ' Reveal';
  } catch (err) {
    console.error('Failed to load profile', err);
  }
}

hydrateAvatarFromToken();
fetchUserProfile();
scheduleAvailabilityCheck('username', 'sb-new-username', 'sb-username-status');
scheduleAvailabilityCheck('email', 'sb-new-email', 'sb-email-status');

$('sb-profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('sb-new-username').value.trim();
  const email = $('sb-new-email').value.trim();

  if (!username || !email) {
    setSidebarMessage('sb-profile-msg', 'error', 'Username and email are required.');
    return;
  }

  if (availabilityState.username === false || availabilityState.email === false) {
    setSidebarMessage('sb-profile-msg', 'error', 'Fix the availability checks before saving.');
    return;
  }

  setLoading('sb-profile-btn', 'sb-profile-spinner', true);
  try {
    const res = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed');

    if (data.token) localStorage.setItem('token', data.token);
    $('sb-display-username').textContent = username;
    $('sb-display-email').textContent = email;
    applyAvatarLetter(username);
    availabilityState.username = null;
    availabilityState.email = null;
    setFieldStatus('sb-username-status', 'good', 'Saved');
    setFieldStatus('sb-email-status', 'good', 'Saved');
    setSidebarMessage('sb-profile-msg', 'success', 'Profile updated');
  } catch (err) {
    setSidebarMessage('sb-profile-msg', 'error', err.message);
  } finally {
    setLoading('sb-profile-btn', 'sb-profile-spinner', false);
  }
});

window.togglePwd = function (inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btnEl.textContent = '🙈';
    btnEl.style.opacity = '1';
  } else {
    input.type = 'password';
    btnEl.textContent = '👁';
    btnEl.style.opacity = '0.7';
  }
};

$('sb-pwd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = $('sb-current-pwd').value;
  const newPassword = $('sb-new-pwd').value;
  const confirmPassword = $('sb-confirm-pwd').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    setSidebarMessage('sb-pwd-msg', 'error', 'All fields are required.');
    return;
  }

  if (newPassword.length < 8) {
    setSidebarMessage('sb-pwd-msg', 'error', 'Password must be at least 8 characters.');
    return;
  }

  if (newPassword !== confirmPassword) {
    setSidebarMessage('sb-pwd-msg', 'error', 'Passwords do not match.');
    return;
  }

  setLoading('sb-pwd-btn', 'sb-pwd-spinner', true);
  setSidebarMessage('sb-pwd-msg', 'success', 'Updating and re-encrypting keys...');

  try {
    const res = await fetch('/api/user/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update');

    sessionStorage.setItem('mlefps_pass', newPassword);
    e.target.reset();
    setSidebarMessage('sb-pwd-msg', 'success', 'Password updated successfully!');
  } catch (err) {
    setSidebarMessage('sb-pwd-msg', 'error', err.message);
  } finally {
    setLoading('sb-pwd-btn', 'sb-pwd-spinner', false);
  }
});

$('sb-rsa-toggle').addEventListener('click', () => {
  isMasked = !isMasked;
  if (isMasked) {
    $('sb-rsa-key').classList.add('masked');
    $('sb-rsa-icon').textContent = '👁';
    $('sb-rsa-label').textContent = ' Reveal';
  } else {
    $('sb-rsa-key').classList.remove('masked');
    $('sb-rsa-icon').textContent = '🙈';
    $('sb-rsa-label').textContent = ' Hide';
  }
});

$('sb-rsa-copy').addEventListener('click', async () => {
  if (!userRsaKey) return;
  try {
    await navigator.clipboard.writeText(userRsaKey);
    const originalText = $('sb-rsa-copy').innerHTML;
    $('sb-rsa-copy').innerHTML = '✓ Copied!';
    setTimeout(() => {
      $('sb-rsa-copy').innerHTML = originalText;
    }, 2000);
  } catch (err) {
    alert('Failed to copy');
  }
});

$('sb-logout').addEventListener('click', () => logout());
