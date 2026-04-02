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
let loadedProfile = false;
let userRsaKey = '';

function toggleSidebar(showOrHide) {
  if (showOrHide) {
    sbOverlay.classList.add('open');
    sbSidebar.classList.add('open');
    if (!loadedProfile) fetchUserProfile();
  } else {
    sbOverlay.classList.remove('open');
    sbSidebar.classList.remove('open');
  }
}

$('avatar-btn').addEventListener('click', () => toggleSidebar(true));
$('sb-close').addEventListener('click', () => toggleSidebar(false));
sbOverlay.addEventListener('click', () => toggleSidebar(false));

async function fetchUserProfile() {
  try {
    // Fetch basic details
    const resMe = await fetch('/api/user/me');
    if (resMe.ok) {
      const { username, email } = await resMe.json();
      $('sb-username').value = username;
      $('sb-email').value = email;
      $('sb-avatar').textContent = username.charAt(0).toUpperCase();
      $('avatar-btn').textContent = username.charAt(0).toUpperCase();
    }

    // Fetch private key
    const resKey = await fetch('/api/user/private-key');
    if (resKey.ok) {
      const { privateKey } = await resKey.json();
      userRsaKey = privateKey;
      $('sb-rsa-key').textContent = privateKey;
    } else {
      $('sb-rsa-key').textContent = 'Failed to fetch private key.';
    }
    
    loadedProfile = true;
  } catch (err) {
    console.error('Failed to load profile', err);
  }
}

// RSA Toggle Mask
let isMasked = true;
$('sb-rsa-toggle').addEventListener('click', () => {
  isMasked = !isMasked;
  if (isMasked) {
    $('sb-rsa-key').classList.add('masked');
    $('sb-rsa-icon').textContent = '👁';
    $('sb-rsa-toggle').childNodes[2].textContent = ' Reveal';
  } else {
    $('sb-rsa-key').classList.remove('masked');
    $('sb-rsa-icon').textContent = '🙈';
    $('sb-rsa-toggle').childNodes[2].textContent = ' Hide';
  }
});

// RSA Copy Key
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

// Inline Edit Logic & Validation
function setupInlineEdit(field, inputId, editBtnId, statusId) {
  const input = $(inputId);
  const btn = $(editBtnId);
  const status = $(statusId);
  let timeout;

  btn.addEventListener('click', async () => {
    if (input.readOnly) {
      input.readOnly = false;
      input.focus();
      btn.textContent = '💾';
      status.textContent = '';
    } else {
      // Save
      input.readOnly = true;
      btn.textContent = '✏️';
      if (status.textContent === '❌') {
         // Revert if invalid
         fetchUserProfile();
         return;
      }
      
      const newUsername = $('sb-username').value;
      const newEmail = $('sb-email').value;
      
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ username: newUsername, email: newEmail })
        });
        const data = await res.json();
        if (res.ok && data.token) {
           localStorage.setItem('token', data.token);
           $('sb-avatar').textContent = newUsername.charAt(0).toUpperCase();
           $('avatar-btn').textContent = newUsername.charAt(0).toUpperCase();
           status.textContent = '✓';
           setTimeout(() => status.textContent='', 2000);
        } else {
           throw new Error('Update failed');
        }
      } catch(err) {
        status.textContent = '❌';
      }
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(timeout);
    status.innerHTML = '<span class="step-spinner" style="display:inline-block; border-color:var(--text-3); border-top-color:var(--blue); width:12px; height:12px; margin-top:5px;"></span>';
    
    timeout = setTimeout(async () => {
      const val = input.value.trim();
      if (!val || (field==='email' && !val.includes('@'))) {
         status.textContent = '❌';
         return;
      }
      
      try {
        const res = await fetch('/api/user/validate', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ field, value: val })
        });
        const { available } = await res.json();
        status.textContent = available ? '✅' : '❌';
      } catch(e) {
        status.textContent = '❌';
      }
    }, 500);
  });
}

setupInlineEdit('username', 'sb-username', 'sb-username-edit', 'sb-username-status');
setupInlineEdit('email', 'sb-email', 'sb-email-edit', 'sb-email-status');

window.togglePwd = function(inputId, btnEl) {
  const input = document.getElementById(inputId);
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
  const btn = $('sb-pwd-btn');
  const msg = $('sb-pwd-msg');

  btn.disabled = true;
  msg.textContent = 'Updating and re-encrypting keys...';
  msg.style.color = 'var(--blue)';

  try {
    const res = await fetch('/api/user/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update');

    msg.textContent = 'Password updated successfully!';
    msg.style.color = 'var(--green)';
    sessionStorage.setItem('mlefps_pass', newPassword);
    e.target.reset();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
});
