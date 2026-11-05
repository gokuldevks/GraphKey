/**
 * dashboard.js — GraphKey Dashboard
 *
 * Responsibilities:
 *  - On load: call GET /api/me to verify the session
 *  - If not authenticated: redirect to login
 *  - If authenticated: populate dashboard with user data
 *  - Handle logout via POST /api/logout
 */

'use strict';

// ── DOM References ───────────────────────────────────────────────
const loadingScreen    = document.getElementById('loadingScreen');
const dashboardMain    = document.getElementById('dashboardMain');
const welcomeName      = document.getElementById('welcomeName');
const sessionTimeEl    = document.getElementById('sessionTime');
const infoUsername     = document.getElementById('infoUsername');
const infoUserId       = document.getElementById('infoUserId');
const infoCreatedAt    = document.getElementById('infoCreatedAt');
const infoIterations   = document.getElementById('infoIterations');
const infoImage        = document.getElementById('infoImage');
const loginSuccessAlert = document.getElementById('loginSuccessAlert');

const logoutButtons = [
  document.getElementById('logoutBtn'),
  document.getElementById('logoutBtnHeader'),
  document.getElementById('logoutBtnBottom'),
].filter(Boolean);

// ── Image ID to friendly name mapping ───────────────────────────
const IMAGE_NAMES = {
  img1: 'Cybercity',
  img2: 'Cosmos',
  img3: 'Circuit',
};

// ── CSRF Token ───────────────────────────────────────────────────
// The dashboard fetches a fresh CSRF token (the one issued on login
// is returned in the /api/me response). Without it, POST /api/logout
// would be rejected with 403.
let _csrfToken = null;

async function fetchCsrfToken() {
  if (_csrfToken) return _csrfToken;
  try {
    const res  = await fetch('/api/csrf-token', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    _csrfToken = data.csrfToken || null;
  } catch (_) {
    _csrfToken = null;
  }
  return _csrfToken;
}

// ── Utilities ────────────────────────────────────────────────────
function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch (_) {
    return isoString;
  }
}

function formatNumber(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-IN');
}

// ── Show dashboard content ───────────────────────────────────────
function populateDashboard(user) {
  welcomeName.textContent    = user.username || '—';
  infoUsername.textContent   = user.username  || '—';
  infoUserId.textContent     = `#${user.id}`  || '—';
  infoCreatedAt.textContent  = formatDate(user.created_at);
  infoIterations.textContent = `${formatNumber(user.iterations)} rounds`;
  infoImage.textContent      = IMAGE_NAMES[user.image_id] || user.image_id || '—';

  // Session age
  const loginTime = new Date();
  sessionTimeEl.textContent = `Authenticated at ${loginTime.toLocaleTimeString('en-IN')}`;

  // Hide loading, show dashboard
  loadingScreen.style.display = 'none';
  dashboardMain.classList.remove('hidden');

  // Auto-hide the success alert after 4 seconds
  setTimeout(() => {
    loginSuccessAlert.style.opacity = '0';
    loginSuccessAlert.style.transition = 'opacity 0.5s ease';
    setTimeout(() => loginSuccessAlert.classList.add('hidden'), 500);
  }, 4000);
}

// ── Auth Check ───────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/api/me', {
      credentials: 'same-origin',
    });

    if (res.status === 401 || res.status === 403) {
      // Not logged in — redirect to login
      window.location.href = '/login.html';
      return;
    }

    if (!res.ok) {
      // Server error
      loadingScreen.innerHTML = `
        <p style="color:var(--error); font-size:0.9rem; text-align:center; padding:1rem;">
          Server error (${res.status}). <a href="/login.html">Return to login</a>
        </p>`;
      return;
    }

    const data = await res.json();
    populateDashboard(data.user || data);
    // Pre-fetch CSRF token for the logout button
    fetchCsrfToken();

  } catch (err) {
    // No server — helpful dev message
    loadingScreen.innerHTML = `
      <div style="text-align:center; padding:2rem;">
        <p style="color:var(--error); margin-bottom:0.75rem;">
          ⚠ Cannot reach the server.
        </p>
        <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:1rem;">
          Make sure the Node.js server is running (<code>node server.js</code>).
        </p>
        <a href="/login.html" class="btn btn-outline">← Back to Login</a>
      </div>`;
  }
}

// ── Logout ───────────────────────────────────────────────────────
async function logout() {
  logoutButtons.forEach(btn => {
    btn.disabled = true;
    btn.textContent = 'Signing out…';
  });

  try {
    const csrfToken = await fetchCsrfToken();
    await fetch('/api/logout', {
      method:      'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
      },
    });
  } catch (_) {
    // Even if the request fails, redirect to login
  }

  window.location.href = '/login.html';
}

logoutButtons.forEach(btn => {
  btn.addEventListener('click', logout);
});

// ── Modal Elements (Quick Actions) ─────────────────────────────────
const actionModal          = document.getElementById('actionModal');
const modalTitle            = document.getElementById('modalTitle');
const modalBody             = document.getElementById('modalBody');
const modalCloseBtn         = document.getElementById('modalCloseBtn');
const modalCloseActionBtn   = document.getElementById('modalCloseActionBtn');
const modalCopyBtn          = document.getElementById('modalCopyBtn');
const healthCheckBtn        = document.getElementById('healthCheckBtn');
const myProfileBtn          = document.getElementById('myProfileBtn');

let _currentModalJson = '';

function openModal(title, bodyHtml, jsonString = '') {
  if (!actionModal) return;
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  _currentModalJson = jsonString;
  if (modalCopyBtn) {
    modalCopyBtn.style.display = jsonString ? 'inline-flex' : 'none';
    modalCopyBtn.textContent = '📋 Copy JSON';
  }
  actionModal.classList.remove('hidden');
}

function closeModal() {
  if (!actionModal) return;
  actionModal.classList.add('hidden');
  _currentModalJson = '';
}

if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
if (modalCloseActionBtn) modalCloseActionBtn.addEventListener('click', closeModal);

if (actionModal) {
  actionModal.addEventListener('click', (e) => {
    if (e.target === actionModal) closeModal();
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && actionModal && !actionModal.classList.contains('hidden')) {
    closeModal();
  }
});

if (modalCopyBtn) {
  modalCopyBtn.addEventListener('click', async () => {
    if (!_currentModalJson) return;
    try {
      await navigator.clipboard.writeText(_currentModalJson);
      modalCopyBtn.textContent = '✓ Copied!';
      setTimeout(() => { modalCopyBtn.textContent = '📋 Copy JSON'; }, 1500);
    } catch (_) {
      modalCopyBtn.textContent = 'Failed to copy';
      setTimeout(() => { modalCopyBtn.textContent = '📋 Copy JSON'; }, 1500);
    }
  });
}

// ── Health Check Handler ──────────────────────────────────────────
async function handleHealthCheck() {
  openModal('❤️ System Health Check', `
    <div style="text-align:center; padding:1.5rem 0;">
      <p style="color:var(--cyan); margin-bottom:0.5rem;">Connecting to /api/health…</p>
      <div style="font-size:0.85rem; color:var(--text-muted);">Querying server status and database connectivity</div>
    </div>
  `);

  try {
    const startTime = performance.now();
    const res = await fetch('/api/health');
    const elapsed = Math.round(performance.now() - startTime);
    const data = await res.json();
    const jsonStr = JSON.stringify(data, null, 2);

    const isOk = data.status === 'ok';
    const statusClass = isOk ? 'ok' : 'error';
    const statusText = isOk ? 'System Healthy' : 'Degraded';

    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
        <span class="status-badge ${statusClass}">● ${statusText} (HTTP ${res.status})</span>
        <span style="font-size:0.8rem; color:var(--text-muted);">Response latency: ${elapsed} ms</span>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.6rem; margin-bottom:1rem;">
        <div style="background:rgba(255,255,255,0.02); padding:0.6rem; border-radius:4px; border:1px solid var(--border-dim);">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">Database</div>
          <div style="font-weight:600; color:var(--text-primary); margin-top:2px;">${data.database === 'connected' ? '🟢 Connected' : '🔴 ' + data.database}</div>
        </div>
        <div style="background:rgba(255,255,255,0.02); padding:0.6rem; border-radius:4px; border:1px solid var(--border-dim);">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">Server Uptime</div>
          <div style="font-weight:600; color:var(--text-primary); margin-top:2px;">${data.uptime_s || 0} seconds</div>
        </div>
        <div style="background:rgba(255,255,255,0.02); padding:0.6rem; border-radius:4px; border:1px solid var(--border-dim);">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">Node Runtime</div>
          <div style="font-weight:600; color:var(--text-primary); margin-top:2px;">${data.node_version || 'Node.js'}</div>
        </div>
      </div>
      <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:0.25rem;">Raw Endpoint Payload (<code>GET /api/health</code>):</div>
      <pre class="modal-json-pre">${escapeHtml(jsonStr)}</pre>
    `;

    openModal('❤️ System Health Check', html, jsonStr);
  } catch (err) {
    openModal('❤️ System Health Check', `
      <div style="color:var(--error); padding:1rem 0;">
        <p><strong>Failed to reach health endpoint.</strong></p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">${escapeHtml(err.message)}</p>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem;">Ensure the Node server is running on port 3000.</p>
      </div>
    `);
  }
}

// ── My Profile Handler ────────────────────────────────────────────
async function handleMyProfile() {
  openModal('👤 Authenticated User Profile', `
    <div style="text-align:center; padding:1.5rem 0;">
      <p style="color:var(--cyan); margin-bottom:0.5rem;">Fetching authenticated profile…</p>
      <div style="font-size:0.85rem; color:var(--text-muted);">Querying GET /api/me with active session credentials</div>
    </div>
  `);

  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    const data = await res.json();
    const jsonStr = JSON.stringify(data, null, 2);

    if (!res.ok) {
      openModal('👤 Authenticated User Profile', `
        <div style="color:var(--error); padding:1rem 0;">
          <p><strong>Session expired or unauthorized (HTTP ${res.status}).</strong></p>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">${escapeHtml(data.message || 'Please log in again.')}</p>
        </div>
      `, jsonStr);
      return;
    }

    const u = data.user || data;
    const html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
        <span class="status-badge ok">● Session Active (HTTP 200)</span>
        <span style="font-size:0.8rem; color:var(--text-muted);">User ID: #${u.id}</span>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.6rem; margin-bottom:1rem;">
        <div style="background:rgba(255,255,255,0.02); padding:0.6rem; border-radius:4px; border:1px solid var(--border-dim);">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">Username</div>
          <div style="font-weight:600; color:var(--cyan); margin-top:2px;">${escapeHtml(u.username)}</div>
        </div>
        <div style="background:rgba(255,255,255,0.02); padding:0.6rem; border-radius:4px; border:1px solid var(--border-dim);">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">Selected Image</div>
          <div style="font-weight:600; color:var(--text-primary); margin-top:2px;">${IMAGE_NAMES[u.image_id] || u.image_id}</div>
        </div>
        <div style="background:rgba(255,255,255,0.02); padding:0.6rem; border-radius:4px; border:1px solid var(--border-dim);">
          <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase;">PBKDF2 Rounds</div>
          <div style="font-weight:600; color:var(--text-primary); margin-top:2px;">${formatNumber(u.iterations)}</div>
        </div>
      </div>
      <div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:0.25rem;">JSON Payload (<code>GET /api/me</code>):</div>
      <pre class="modal-json-pre">${escapeHtml(jsonStr)}</pre>
    `;

    openModal('👤 Authenticated User Profile', html, jsonStr);
  } catch (err) {
    openModal('👤 Authenticated User Profile', `
      <div style="color:var(--error); padding:1rem 0;">
        <p><strong>Failed to fetch user profile.</strong></p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">${escapeHtml(err.message)}</p>
      </div>
    `);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (healthCheckBtn) healthCheckBtn.addEventListener('click', handleHealthCheck);
if (myProfileBtn)   myProfileBtn.addEventListener('click', handleMyProfile);

// ── Init ─────────────────────────────────────────────────────────
checkAuth();
