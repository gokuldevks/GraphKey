/**
 * login.js — GraphKey Login Page
 *
 * Responsibilities (Stage 2: UI only):
 *  - Image thumbnail selection (same as register)
 *  - Capture 4 ordered click points on the image
 *  - Normalize to a 10×10 grid (must match registration logic exactly)
 *  - Draw numbered markers
 *  - Enable submit only when all inputs are complete
 *  - Track failed attempts and show warning counter
 *  - Stub: API call will be wired in Stage 4
 */

'use strict';

// ── Constants (must match register.js) ──────────────────────────
const GRID_SIZE    = 10;
const MAX_POINTS   = 4;
const POINT_RADIUS = 14;
const POINT_COLOURS = ['#06b6d4', '#2563eb', '#f59e0b', '#10b981'];

// ── DOM References ───────────────────────────────────────────────
const form           = document.getElementById('loginForm');
const usernameInput  = document.getElementById('username');
const imageGrid      = document.getElementById('imageGrid');
const thumbs         = imageGrid.querySelectorAll('.image-thumb');
const canvasWrapper  = document.getElementById('canvasWrapper');
const passwordImage  = document.getElementById('passwordImage');
const pointCanvas    = document.getElementById('pointCanvas');
const clearBtn       = document.getElementById('clearPointsBtn');
const submitBtn      = document.getElementById('submitBtn');
const alertBox       = document.getElementById('alertBox');
const rateLimitBox   = document.getElementById('rateLimitBox');
const attemptBox     = document.getElementById('attemptBox');
const attemptCount   = document.getElementById('attemptCount');
const pointCountText = document.getElementById('pointCountText');
const pointStatusMsg = document.getElementById('pointStatusMsg');
const dots = [
  document.getElementById('dot1'),
  document.getElementById('dot2'),
  document.getElementById('dot3'),
  document.getElementById('dot4'),
];

// ── State ────────────────────────────────────────────────────────
let selectedImageId = null;
let clickedPoints   = [];
let ctx             = null;
let failedAttempts  = 0;

// ── Alert Helpers ────────────────────────────────────────────────
function showAlert(message, type = 'error') {
  alertBox.textContent = '';
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
  alertBox.classList.remove('hidden');
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert() {
  alertBox.classList.add('hidden');
}

// ── Image Selection ──────────────────────────────────────────────
function selectImage(thumb) {
  thumbs.forEach(t => {
    t.classList.remove('selected');
    t.setAttribute('aria-checked', 'false');
  });

  thumb.classList.add('selected');
  thumb.setAttribute('aria-checked', 'true');
  selectedImageId = thumb.dataset.imageId;

  const imgSrc = thumb.querySelector('img').src;
  passwordImage.src = imgSrc;
  passwordImage.alt = thumb.getAttribute('aria-label');

  passwordImage.onload = () => {
    canvasWrapper.classList.add('ready');
    resizeCanvas();
    redrawPoints();
  };

  clearPoints();
  hideAlert();
  checkSubmitReady();
}

thumbs.forEach(thumb => {
  thumb.addEventListener('click', () => selectImage(thumb));
  thumb.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectImage(thumb);
    }
  });
});

// ── Canvas Sizing ────────────────────────────────────────────────
function resizeCanvas() {
  if (!passwordImage.naturalWidth) return;
  pointCanvas.width  = canvasWrapper.clientWidth;
  pointCanvas.height = canvasWrapper.clientHeight;
  ctx = pointCanvas.getContext('2d');
  redrawPoints();
}

window.addEventListener('resize', () => {
  if (selectedImageId) resizeCanvas();
});

// ── Point Drawing ────────────────────────────────────────────────
function redrawPoints() {
  if (!ctx) return;
  ctx.clearRect(0, 0, pointCanvas.width, pointCanvas.height);

  const W = pointCanvas.width;
  const H = pointCanvas.height;

  clickedPoints.forEach((pt, i) => {
    const px = (pt.gridX / GRID_SIZE + 0.5 / GRID_SIZE) * W;
    const py = (pt.gridY / GRID_SIZE + 0.5 / GRID_SIZE) * H;
    const colour = POINT_COLOURS[i];

    // Glow
    ctx.beginPath();
    ctx.arc(px, py, POINT_RADIUS + 4, 0, Math.PI * 2);
    ctx.fillStyle = colour + '30';
    ctx.fill();

    // White border
    ctx.beginPath();
    ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Filled
    ctx.beginPath();
    ctx.arc(px, py, POINT_RADIUS - 2, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    // Number
    ctx.font = `bold ${POINT_RADIUS}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(i + 1), px, py + 1);

    // Connecting line
    if (i > 0) {
      const prev = clickedPoints[i - 1];
      const ppx = (prev.gridX / GRID_SIZE + 0.5 / GRID_SIZE) * W;
      const ppy = (prev.gridY / GRID_SIZE + 0.5 / GRID_SIZE) * H;
      ctx.beginPath();
      ctx.moveTo(ppx, ppy);
      ctx.lineTo(px, py);
      ctx.strokeStyle = '#ffffff50';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });
}

// ── Point Status ─────────────────────────────────────────────────
function updatePointStatus() {
  const n = clickedPoints.length;
  pointCountText.textContent = `(${n} of ${MAX_POINTS})`;

  dots.forEach((dot, i) => {
    if (i < n) {
      dot.classList.add('filled');
      dot.setAttribute('aria-label', `Point ${i + 1} selected`);
    } else {
      dot.classList.remove('filled');
      dot.setAttribute('aria-label', `Point ${i + 1} not selected`);
    }
  });

  if (n === 0) {
    pointStatusMsg.textContent = 'Click 4 points in your original order.';
    pointStatusMsg.className = 'point-status-text';
    canvasWrapper.classList.remove('complete');
  } else if (n < MAX_POINTS) {
    pointStatusMsg.textContent = `${MAX_POINTS - n} more point${MAX_POINTS - n > 1 ? 's' : ''} needed.`;
    pointStatusMsg.className = 'point-status-text';
    canvasWrapper.classList.remove('complete');
  } else {
    pointStatusMsg.textContent = 'All 4 points entered! Ready to submit.';
    pointStatusMsg.className = 'point-status-text complete';
    canvasWrapper.classList.add('complete');
  }
}

// ── Submit Ready Check ───────────────────────────────────────────
function checkSubmitReady() {
  const usernameOk = usernameInput.value.trim().length >= 3;
  const imageOk    = selectedImageId !== null;
  const pointsOk   = clickedPoints.length === MAX_POINTS;
  const ready      = usernameOk && imageOk && pointsOk;

  submitBtn.disabled = !ready;
  submitBtn.setAttribute('aria-disabled', String(!ready));
}

// ── Canvas Click ─────────────────────────────────────────────────
canvasWrapper.addEventListener('click', e => {
  if (!selectedImageId) return;
  if (clickedPoints.length >= MAX_POINTS) return;

  const rect  = canvasWrapper.getBoundingClientRect();
  const px    = e.clientX - rect.left;
  const py    = e.clientY - rect.top;
  const W     = rect.width;
  const H     = rect.height;

  const gridX = Math.min(Math.floor((px / W) * GRID_SIZE), GRID_SIZE - 1);
  const gridY = Math.min(Math.floor((py / H) * GRID_SIZE), GRID_SIZE - 1);

  const isDuplicate = clickedPoints.some(p => p.gridX === gridX && p.gridY === gridY);
  if (isDuplicate) {
    showAlert('⚠ That area is already selected. Choose a different spot.', 'warning');
    return;
  }

  hideAlert();
  clickedPoints.push({ gridX, gridY });
  resizeCanvas();
  updatePointStatus();
  checkSubmitReady();
});

// ── Clear ────────────────────────────────────────────────────────
function clearPoints() {
  clickedPoints = [];
  if (ctx) ctx.clearRect(0, 0, pointCanvas.width, pointCanvas.height);
  canvasWrapper.classList.remove('complete');
  updatePointStatus();
  checkSubmitReady();
  hideAlert();
}

clearBtn.addEventListener('click', clearPoints);

// ── Username Validation ──────────────────────────────────────────
usernameInput.addEventListener('input', () => {
  checkSubmitReady();
});

// ── CSRF Token ───────────────────────────────────────────────────
let _csrfToken = null;

async function fetchCsrfToken() {
  if (_csrfToken) return _csrfToken;
  try {
    const res  = await fetch('/api/csrf-token', { credentials: 'same-origin' });
    const data = await res.json();
    _csrfToken = data.csrfToken || null;
  } catch (_) {
    _csrfToken = null;
  }
  return _csrfToken;
}

// Pre-fetch on page load
fetchCsrfToken();

// ── Form Submit ──────────────────────────────────────────────────
form.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert();

  const username = usernameInput.value.trim().toLowerCase();

  // Client-side guard
  if (username.length < 3) {
    showAlert('Please enter a valid username.', 'error');
    return;
  }
  if (!selectedImageId) {
    showAlert('Please select the image you used during registration.', 'error');
    return;
  }
  if (clickedPoints.length < MAX_POINTS) {
    showAlert('Please click all 4 points in the correct order.', 'error');
    return;
  }

  const payload = {
    username,
    imageId: selectedImageId,
    points:  clickedPoints.map(p => [p.gridX, p.gridY]),
  };

  // Show loading state
  submitBtn.classList.add('btn-loading');
  submitBtn.disabled = true;

  try {
    const csrfToken = await fetchCsrfToken();
    if (!csrfToken) {
      showAlert('Could not get a security token. Please refresh the page.', 'error');
      submitBtn.classList.remove('btn-loading');
      submitBtn.disabled = false;
      return;
    }

    const res = await fetch('/api/login', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token':  csrfToken,
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      // Server may return a fresh CSRF token after login (new session)
      if (data.csrfToken) _csrfToken = data.csrfToken;
      showAlert('✓ Login successful! Redirecting…', 'success');
      setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);
    } else if (res.status === 429) {
      // Rate limited
      rateLimitBox.classList.remove('hidden');
      submitBtn.disabled = true;
    } else {
      // Wrong credentials
      failedAttempts++;
      attemptBox.classList.remove('hidden');
      attemptCount.textContent = String(failedAttempts);
      showAlert(data.message || 'Incorrect graphical password. Please try again.', 'error');
      clearPoints();
      submitBtn.classList.remove('btn-loading');
      submitBtn.disabled = false;
    }
  } catch (err) {
    showAlert('Cannot reach the server. Is it running?', 'error');
    submitBtn.classList.remove('btn-loading');
    submitBtn.disabled = false;
  }
});

// ── Init ─────────────────────────────────────────────────────────
checkSubmitReady();
updatePointStatus();
