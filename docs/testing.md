# GraphKey – Testing & Verification Report

## 1. Testing Strategy Overview

GraphKey employs a three-tier automated verification hierarchy:

1. **Unit & Cryptographic Verification (`tests/auth.test.js`)**: Tests isolated mathematical functions, coordinate bounds, PBKDF2 hash derivation, and timing-safe equality.
2. **Full-Stack Integration Verification (`tests/integration.test.js`)**: Simulates browser client interactions against the active Express pipeline, testing static assets, CSRF handshake, registration, login, dashboard rendering, and session invalidation.
3. **Security & Forensic Verification (`tests/security.test.js`)**: Focuses on malicious payloads, SQL injection, XSS attempts, rate limiter lockouts, and direct SQLite forensic inspection.

---

## 2. Test Matrix & Results Summary

| Suite Name | Scope | Tests Run | Passed | Failed |
|---|---|---|---|---|
| **Unit & Cryptography** | `tests/auth.test.js` | 39 | 39 | 0 |
| **Full Integration** | `tests/integration.test.js` | 24 | 24 | 0 |
| **Security & Forensics** | `tests/security.test.js` | 19 | 19 | 0 |
| **Total Test Coverage** | **All automated test files** | **82** | **82** | **0** |

---

## 3. Detailed Test Case Catalog

### Suite 1: Unit & Cryptography (`tests/auth.test.js` — 39 Tests)
- `validatePoints`: Accepts valid array of 4 distinct integer coordinate pairs.
- `validatePoints`: Rejects non-array input (strings, objects, null, undefined).
- `validatePoints`: Rejects fewer than 4 points.
- `validatePoints`: Rejects more than 4 points.
- `validatePoints`: Rejects coordinates $\ge 10$ (upper boundary).
- `validatePoints`: Rejects negative coordinates $< 0$ (lower boundary).
- `validatePoints`: Rejects floating-point non-integer numbers (e.g., `3.7`).
- `validatePoints`: Rejects duplicate selections on the same logical grid cell.
- `validatePoints`: Rejects malformed sub-elements (single integers instead of coordinate pairs).
- `serializePoints`: Formats canonical string `imageId:x1,y1:x2,y2:x3,y3:x4,y4`.
- `serializePoints`: Reordering points produces different serialized string.
- `serializePoints`: Changing image ID produces different serialized string.
- `generateSalt`: Returns 64-character lowercase hexadecimal string (32 bytes).
- `generateSalt`: Produces cryptographically unique salts on consecutive invocations.
- `deriveVerifier`: Derives 128-character hexadecimal verifier via PBKDF2-SHA256.
- `deriveVerifier`: Deterministic: same point string + same salt = identical verifier.
- `deriveVerifier`: Different salts yield completely different verifiers.
- `deriveVerifier`: Different point sequences yield completely different verifiers.
- `verifyPassword`: Returns `true` for matching point sequences.
- `verifyPassword`: Returns `false` for reversed or reordered point sequences.
- `verifyPassword`: Returns `false` for incorrect image ID.
- `verifyPassword`: Returns `false` for completely mismatched points.
- Database: Inserts user credential and returns positive auto-incremented row ID.
- Database: Confirms stored record contains zero raw coordinate or password columns.
- Database: Confirms stored verifier does not contain image ID in plaintext.
- Database: Enforces `UNIQUE` constraint on duplicate usernames.
- Database: `verifyPassword` succeeds against retrieved database verifier.
- Database: `verifyPassword` fails for incorrect point sequence against database verifier.
- Database: `verifyPassword` fails for incorrect image ID against database verifier.
- Database: Writes `REGISTER` audit event row.
- Database: Confirms audit log row contains no passwords, salts, or coordinate columns.
- Security: Two users with identical point selections receive distinct salts and verifiers.
- Edge Case: `validatePoints` safely handles `null`, `[]`, `Infinity`, `NaN`, strings, `(0,0)`, and `(9,9)`.

### Suite 2: Full Integration (`tests/integration.test.js` — 24 Tests)
- Static Asset: `GET /` serves `index.html`.
- Static Asset: `GET /register.html` serves registration page.
- Static Asset: `GET /login.html` serves login page.
- Static Asset: `GET /dashboard.html` serves dashboard page.
- Static Asset: `GET /css/style.css` serves cybersecurity stylesheet.
- Static Asset: `GET /images/img1.svg`, `img2.svg`, `img3.svg` deliver valid vector XML.
- Static Asset: `GET /js/register.js`, `login.js`, `dashboard.js` deliver client scripts.
- Security Headers: Helmet injects `nosniff`, `SAMEORIGIN`, and CSP.
- API Caching: `Cache-Control: no-store` strictly present on API endpoints.
- API: `GET /api/health` reports status `ok` and database `connected`.
- API: `GET /api/images` delivers 3 predefined image metadata items.
- CSRF Protection: `POST /api/register` without CSRF token returns `403 Forbidden`.
- CSRF Protection: `POST /api/register` with invalid CSRF token returns `403 Forbidden`.
- User Journey Step 1: `GET /api/csrf-token` delivers 64-char token and `gk_sid` cookie.
- User Journey Step 2: `POST /api/register` creates user account (`201 Created`).
- User Journey Step 3: `POST /api/register` rejects duplicate username (`409 Conflict`).
- User Journey Step 4: `GET /api/me` without session returns `401 Unauthorized`.
- User Journey Step 5: `POST /api/login` rejects wrong coordinates (`401 Unauthorized`).
- User Journey Step 6: `POST /api/login` rejects reversed point order (`401 Unauthorized`).
- User Journey Step 7: `POST /api/login` rejects wrong image selection (`401 Unauthorized`).
- User Journey Step 8: `POST /api/login` succeeds with valid sequence (`200 OK`).
- User Journey Step 9: `GET /api/me` delivers user profile without leaking hashes/salts.
- User Journey Step 10: `POST /api/logout` destroys session in SQLite and clears cookie.
- User Journey Step 11: `GET /api/me` after logout returns `401 Unauthorized`.

### Suite 3: Security & Forensics (`tests/security.test.js` — 19 Tests)
- Injection: Rejects SQL Injection `' OR '1'='1' --` in username.
- Injection: Rejects XSS script tags `<script>alert(1)</script>` in username.
- Validation: Rejects usernames exceeding 32 characters.
- Validation: Rejects usernames shorter than 3 characters.
- Validation: Rejects invalid image IDs.
- Validation: Rejects non-array point representations.
- Validation: Rejects point arrays with 3 elements.
- Validation: Rejects point arrays with 5 elements.
- Validation: Rejects duplicate point selections.
- Validation: Rejects coordinates outside logical grid boundary.
- Validation: Rejects float coordinates.
- Routing: Non-existent `/api/*` endpoints return JSON `404 Not Found`.
- Rate Limiting: Blocks IP with `HTTP 429 Too Many Requests` after 10 failed login attempts.
- Forensics: Registers dedicated test user and queries SQLite row data.
- Forensics: Proves `users` table contains zero coordinate columns and no plaintext numbers.
- Forensics: Proves `audit_events` contains zero password hashes or coordinates.
- Cryptography: `crypto.timingSafeEqual` rejects mismatched buffers with constant time.
- Cryptography: Safely handles length mismatches without uncaught exceptions.
- Cookie Flags: Confirms `HttpOnly`, `SameSite=Strict`, and `Path=/` are set on session cookies.

---

## 4. How to Reproduce All Test Results

Run from project root (`D:\Internship\project\GraphKey`):

```bash
npm test
```

Expected final line:
```
All security and edge-case tests passed successfully. ✓
```
Exit code: `0`.
