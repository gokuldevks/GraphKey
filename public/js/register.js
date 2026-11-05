/**
 * register.js — GraphKey Registration Page
 *
 * Responsibilities (Stage 2: UI only):
 *  - Handle image thumbnail selection
 *  - Capture up to 4 click points on the canvas-wrapper
 *  - Normalize coordinates to a 10×10 logical grid
 *  - Draw numbered point markers on the overlay canvas
 *  - Validate that all 4 points land in distinct grid cells
 *  - Enable/disable the submit button based on form completeness
 *  - Stub: API call will be wired in Stage 4
 *
 * GRID SYSTEM (important for understanding):
 *   The displayed image is divided into a 10×10 invisible grid.
 *   A click at pixel (px, py) inside an image of size (W, H) maps to:
 *     gridX = Math.floor((px / W) * 10)   (0–9)
 *     gridY = Math.floor((py / H) * 10)   (0–9)
 *   This means the password is screen-size independent.
 */

'use strict';

// ── Constants ───────────────────────────────────────────────────
const GRID_SIZE   = 10;   // 10×10 logical grid
const MAX_POINTS  = 4;    // exactly 4 clicks required
const POINT_RADIUS = 14;  // pixel radius of drawn markers

// Colours for each point marker (1–4)
const POINT_COLOURS = ['#06b6d4', '#2563eb', '#f59e0b', '#10b981'];

// ── DOM References ───────────────────────────────────────────────
const form          = document.getElementById('registerForm');
const usernameInput = document.getElementById('username');
const imageGrid     = document.getElementById('imageGrid');
const thumbs        = imageGrid.querySelectorAll('.image-thumb');
const canvasWrapper = document.getElementById('canvasWrapper');
const passwordImage = document.getElementById('passwordImage');
const pointCanvas   = document.getElementById('pointCanvas');
const clearBtn      = document.getElementById('clearPointsBtn');
const submitBtn     = document.getElementById('submitBtn');
const alertBox      = document.getElementById('alertBox');
const pointCountText = document.getElementById('pointCountText');
const pointStatusMsg = document.getElementById('pointStatusMsg');
const dots          = [
  document.getElementById('dot1'),
  document.getElementById('dot2'),
  document.getElementById('dot3'),
  document.getElementById('dot4'),
];
const stepIndicators = [
  document.getElementById('step-indicator-1'),
  document.getElementById('step-indicator-2'),
  document.getElementById('step-indicator-3'),
  document.getElementById('step-indicator-4'),
];

// ── State ────────────────────────────────────────────────────────
let selectedImageId = null;   // e.g. "img1"
let clickedPoints   = [];     // array of { gridX, gridY, px, py }
let ctx             = null;   // canvas 2D context

// ── Utility: Show Alert ──────────────────────────────────────────
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

// ── Utility: Update Step Indicators ─────────────────────────────
function updateSteps() {
  const usernameOk = usernameInput.value.trim().length >= 3;
  const imageOk    = selectedImageId !== null;
  const pointsOk   = clickedPoints.length === MAX_POINTS;

  // Step 1: Username
  if (usernameOk) {
    stepIndicators[0].classList.remove('active');
    stepIndicators[0].classList.add('done');
  } else {
    stepIndicators[0].classList.add('active');
    stepIndicators[0].classList.remove('done');
  }

  // Step 2: Image
  if (imageOk) {
    stepIndicators[1].classList.remove('active');
    stepIndicators[1].classList.add('done');
  } else if (usernameOk) {
    stepIndicators[1].classList.add('active');
    stepIndicators[1].classList.remove('done');
  } else {
    stepIndicators[1].classList.remove('active', 'done');
  }

  // Step 3: Points
  if (pointsOk) {
    stepIndicators[2].classList.remove('active');
    stepIndicators[2].classList.add('done');
    stepIndicators[3].classList.add('active');
  } else if (imageOk) {
    stepIndicators[2].classList.add('active');
    stepIndicators[2].classList.remove('done');
    stepIndicators[3].classList.remove('active', 'done');
  } else {
    stepIndicators[2].classList.remove('active', 'done');
    stepIndicators[3].classList.remove('active', 'done');
  }
}

// ── Utility: Check Submit Ready ──────────────────────────────────
function checkSubmitReady() {
  const usernameOk = usernameInput.value.trim().length >= 3 &&
                     /^[a-zA-Z0-9_]+$/.test(usernameInput.value.trim());
  const imageOk    = selectedImageId !== null;
  const pointsOk   = clickedPoints.length === MAX_POINTS;
  const ready      = usernameOk && imageOk && pointsOk;

  submitBtn.disabled = !ready;
  submitBtn.setAttribute('aria-disabled', String(!ready));
  updateSteps();
}

// ── Image Selection ──────────────────────────────────────────────
function selectImage(thumb) {
  // Deselect all
  thumbs.forEach(t => {
    t.classList.remove('selected');
    t.setAttribute('aria-checked', 'false');
  });

  // Select chosen
  thumb.classList.add('selected');
  thumb.setAttribute('aria-checked', 'true');
  selectedImageId = thumb.dataset.imageId;

  // Load image into canvas area
  const imgSrc = thumb.querySelector('img').src;
  passwordImage.src = imgSrc;
  passwordImage.alt = thumb.getAttribute('aria-label');

  // Mark canvas as ready after image loads
  passwordImage.onload = () => {
    canvasWrapper.classList.add('ready');
    resizeCanvas();
    redrawPoints();
  };

  // Clear any existing points when changing image
  clearPoints();
  hideAlert();
  checkSubmitReady();
}

// Image thumbnail click
thumbs.forEach(thumb => {
  thumb.addEventListener('click', () => selectImage(thumb));

  // Keyboard support (Enter / Space)
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
    // Convert stored grid coords back to pixel coords for this canvas size
    const px = (pt.gridX / GRID_SIZE + 0.5 / GRID_SIZE) * W;
    const py = (pt.gridY / GRID_SIZE + 0.5 / GRID_SIZE) * H;

    const colour = POINT_COLOURS[i];

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(px, py, POINT_RADIUS + 4, 0, Math.PI * 2);
    ctx.fillStyle = colour + '30'; // 18% opacity
    ctx.fill();

    // White ring
    ctx.beginPath();
    ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Filled circle
    ctx.beginPath();
    ctx.arc(px, py, POINT_RADIUS - 2, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    // Number label
    ctx.font = `bold ${POINT_RADIUS}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(i + 1), px, py + 1);

    // Connecting line to previous point
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

// ── Point Status UI ──────────────────────────────────────────────
function updatePointStatus() {
  const n = clickedPoints.length;
  pointCountText.textContent = `(${n} of ${MAX_POINTS} selected)`;

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
    pointStatusMsg.textContent = `Select ${MAX_POINTS} distinct points in order.`;
    pointStatusMsg.className = 'point-status-text';
    canvasWrapper.classList.remove('complete');
  } else if (n < MAX_POINTS) {
    pointStatusMsg.textContent = `${MAX_POINTS - n} more point${MAX_POINTS - n > 1 ? 's' : ''} needed.`;
    pointStatusMsg.className = 'point-status-text';
    canvasWrapper.classList.remove('complete');
  } else {
    pointStatusMsg.textContent = 'All 4 points selected! ✓';
    pointStatusMsg.className = 'point-status-text complete';
    canvasWrapper.classList.add('complete');
  }
}

// ── Canvas Click Handler ─────────────────────────────────────────
canvasWrapper.addEventListener('click', e => {
  if (!selectedImageId)  return;
  if (clickedPoints.length >= MAX_POINTS) return;

  // Get click position relative to the canvas wrapper
  const rect = canvasWrapper.getBoundingClientRect();
  const px   = e.clientX - rect.left;
  const py   = e.clientY - rect.top;
  const W    = rect.width;
  const H    = rect.height;

  // Map to 10×10 grid cell (0-indexed)
  const gridX = Math.min(Math.floor((px / W) * GRID_SIZE), GRID_SIZE - 1);
  const gridY = Math.min(Math.floor((py / H) * GRID_SIZE), GRID_SIZE - 1);

  // Reject duplicate grid cells
  const isDuplicate = clickedPoints.some(p => p.gridX === gridX && p.gridY === gridY);
  if (isDuplicate) {
    showAlert('⚠ That area is already selected. Choose a different part of the image.', 'warning');
    return;
  }

  hideAlert();
  clickedPoints.push({ gridX, gridY });
  resizeCanvas();
  updatePointStatus();
  checkSubmitReady();
});

// ── Clear Points ─────────────────────────────────────────────────
function clearPoints() {
  clickedPoints = [];
  if (ctx) ctx.clearRect(0, 0, pointCanvas.width, pointCanvas.height);
  canvasWrapper.classList.remove('complete');
  updatePointStatus();
  checkSubmitReady();
  hideAlert();
}

clearBtn.addEventListener('click', clearPoints);

// ── Username Input Live Validation ───────────────────────────────
usernameInput.addEventListener('input', () => {
  const val = usernameInput.value.trim();
  if (val.length > 0 && !/^[a-zA-Z0-9_]+$/.test(val)) {
    usernameInput.classList.add('error');
  } else {
    usernameInput.classList.remove('error');
  }
  checkSubmitReady();
});

// ── CSRF Token ───────────────────────────────────────────────────
// Fetched once from the server on page load, then included in
// every POST request as the X-CSRF-Token header.
// Without this token, the server rejects the request with 403.
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

// Pre-fetch on page load so it's ready by the time the user submits
fetchCsrfToken();

// ── Form Submit ──────────────────────────────────────────────────
form.addEventListener('submit', async e => {
  e.preventDefault();
  hideAlert();

  const username = usernameInput.value.trim().toLowerCase();

  // Client-side validation
  if (username.length < 3 || username.length > 32) {
    showAlert('Username must be 3–32 characters.', 'error');
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showAlert('Username may only contain letters, numbers, and underscores.', 'error');
    return;
  }
  if (!selectedImageId) {
    showAlert('Please select a password image.', 'error');
    return;
  }
  if (clickedPoints.length < MAX_POINTS) {
    showAlert(`Please select all ${MAX_POINTS} points on the image.`, 'error');
    return;
  }

  // Build payload
  const payload = {
    username,
    imageId: selectedImageId,
    // Points as array of [gridX, gridY] pairs
    points: clickedPoints.map(p => [p.gridX, p.gridY]),
  };

  // ── API call (wired fully in Stage 4) ───
  submitBtn.classList.add('btn-loading');
  submitBtn.disabled = true;

  try {
    const csrfToken = await fetchCsrfToken();
    if (!csrfToken) {
      showAlert('Could not get a security token. Please refresh the page and try again.', 'error');
      submitBtn.classList.remove('btn-loading');
      submitBtn.disabled = false;
      return;
    }

    const res = await fetch('/api/register', {
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
      showAlert('✓ Account created successfully! Redirecting to login…', 'success');
      setTimeout(() => { window.location.href = '/login.html'; }, 1800);
    } else {
      showAlert(data.message || 'Registration failed. Please try again.', 'error');
      submitBtn.classList.remove('btn-loading');
      submitBtn.disabled = false;
    }
  } catch (err) {
    showAlert('Cannot connect to the server. Is it running?', 'error');
    submitBtn.classList.remove('btn-loading');
    submitBtn.disabled = false;
  }
});

// ── Init ─────────────────────────────────────────────────────────
checkSubmitReady();
updatePointStatus();
