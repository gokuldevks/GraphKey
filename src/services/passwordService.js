'use strict';

/**
 * src/services/passwordService.js
 *
 * Handles the graphical password domain logic:
 *   1. Validating point arrays received from the client
 *   2. Serializing points into a canonical string for PBKDF2
 *
 * GRID SYSTEM (must match register.js and login.js on the frontend):
 *   The image is divided into a 10×10 invisible grid.
 *   Each cell is addressed by (gridX, gridY) where both are integers in [0, 9].
 *   A click at pixel (px, py) on an image of size (W, H) maps to:
 *     gridX = Math.floor((px / W) * 10)  →  0 to 9
 *     gridY = Math.floor((py / H) * 10)  →  0 to 9
 *
 * SERIALIZATION FORMAT:
 *   imageId:gX1,gY1:gX2,gY2:gX3,gY3:gX4,gY4
 *   Example: "img1:3,5:7,2:1,8:6,4"
 *   ORDER IS PRESERVED — same points in a different order → different string → different hash
 *
 * This serialized string is the "password" fed into PBKDF2.
 * It is never stored, logged, or transmitted after derivation.
 */

const GRID_SIZE      = 10;  // 10×10 grid (must match frontend constant)
const REQUIRED_POINTS = 4;  // exactly 4 points required

/**
 * validatePoints(points)
 * Returns { valid: true } or { valid: false, reason: '…' }
 *
 * Checks:
 *  - points is an array
 *  - has exactly 4 elements
 *  - each element is a 2-element array [x, y]
 *  - x and y are finite integers
 *  - x and y are within [0, GRID_SIZE - 1]
 *  - no two points share the same (x, y) cell
 *
 * @param {any} points
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePoints(points) {
  // Type check
  if (!Array.isArray(points)) {
    return { valid: false, reason: 'Points must be an array.' };
  }

  // Count check
  if (points.length !== REQUIRED_POINTS) {
    return {
      valid:  false,
      reason: `Exactly ${REQUIRED_POINTS} points are required. Received ${points.length}.`,
    };
  }

  // Per-point checks
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];

    if (!Array.isArray(pt) || pt.length !== 2) {
      return { valid: false, reason: `Point ${i + 1} must be a [x, y] pair.` };
    }

    const [x, y] = pt;

    // Must be finite numbers
    if (typeof x !== 'number' || typeof y !== 'number' ||
        !Number.isFinite(x) || !Number.isFinite(y)) {
      return { valid: false, reason: `Point ${i + 1} coordinates must be finite numbers.` };
    }

    // Must be integers (no 3.7 etc.)
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return { valid: false, reason: `Point ${i + 1} coordinates must be integers.` };
    }

    // Must be within the grid
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
      return {
        valid:  false,
        reason: `Point ${i + 1} is out of bounds. Coordinates must be 0–${GRID_SIZE - 1}.`,
      };
    }
  }

  // Uniqueness check — no two points in the same grid cell
  const seen = new Set();
  for (const [x, y] of points) {
    const key = `${x},${y}`;
    if (seen.has(key)) {
      return {
        valid:  false,
        reason: 'All four points must be in distinct grid cells.',
      };
    }
    seen.add(key);
  }

  return { valid: true };
}

/**
 * serializePoints(imageId, points)
 * Converts the image ID and ordered point array into a canonical string.
 * This string is the input to PBKDF2 — effectively the "raw password".
 *
 * Examples:
 *   serializePoints('img1', [[3,5],[7,2],[1,8],[6,4]])
 *   → "img1:3,5:7,2:1,8:6,4"
 *
 *   Same points, different order (wrong login):
 *   serializePoints('img1', [[7,2],[3,5],[1,8],[6,4]])
 *   → "img1:7,2:3,5:1,8:6,4"   ← different string → different hash → login fails
 *
 * @param {string}    imageId
 * @param {number[][]} points  — array of [gridX, gridY] pairs
 * @returns {string}
 */
function serializePoints(imageId, points) {
  const parts = points.map(([x, y]) => `${x},${y}`);
  return `${imageId}:${parts.join(':')}`;
}

module.exports = {
  validatePoints,
  serializePoints,
  GRID_SIZE,
  REQUIRED_POINTS,
};
