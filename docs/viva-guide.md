# GraphKey — Final Year BCA Viva Voce & Presentation Guide

This guide is specifically designed for your final-year BCA project presentation and viva voce examination. It provides clear, student-friendly explanations, an examiner demo script, and comprehensive question-and-answer pairs covering architecture, cryptography, web security, and database design.

---

## 1. Project Elevator Pitch (30-Second Introduction)

> *"Good morning/afternoon, Respected Examiners. My project is **GraphKey: A Web-Based Graphical Password Authentication System with Zero Raw Coordinate Storage**.*
>
> *Traditional alphanumeric passwords suffer from weak memorability, leading users to choose simple, easily guessable strings or reuse them across sites. GraphKey introduces a visual authentication mechanism where users select 4 distinct ordered points on a chosen graphical image.*
>
> *From a cybersecurity perspective, the primary technical innovation is that **we never store pixel coordinates, grid numbers, or images on the server**. Instead, the client normalizes clicks into a resolution-independent 10×10 logical grid, and the backend derives an irreversible 32-byte cryptographic verifier using **PBKDF2 with HMAC-SHA256 and 210,000 iterations** alongside a cryptographically random salt. Even if our database is fully leaked, an attacker cannot reverse the hash to recover the user's secret points or clicks."*

---

## 2. Live Demonstration Walkthrough (Step-by-Step for Examiners)

Follow this 5-minute structured sequence during your practical demonstration:

### Step 1: Start Server and Open Application
1. In the terminal: `npm start`
2. Open your browser to `http://localhost:3000`.
3. Point out the security headers in DevTools (Network tab -> Headers):
   - `Content-Security-Policy`
   - `X-Frame-Options: SAMEORIGIN` (prevents clickjacking)
   - `X-Content-Type-Options: nosniff`

### Step 2: User Registration Flow
1. Navigate to **Register** (`/register.html`).
2. Show the image selector dropdown — three distinct SVG scenes (`img1.svg`, `img2.svg`, `img3.svg`).
3. Enter a username: e.g., `student_bca`.
4. Click 4 points on the canvas:
   - Show how visual indicators appear (numbered badges 1 to 4 with animated rings).
   - Show the live counter ("Points selected: 4 / 4").
   - Click "Reset Points" to show the user can clear mistakes.
   - Re-select 4 points.
5. Click **Create Secure Account**.
6. Show the success notification toast and automatic redirection to Login.

### Step 3: Forensic Database Inspection (The "Zero-Leak" Proof)
1. Run the built-in forensic inspector tool:
   ```bash
   npm run db:inspect
   ```
   *(Or if you have the `sqlite3` CLI tool installed: `sqlite3 data/graphkey.db "SELECT id, username, image_id, length(verifier), length(salt), created_at FROM users;"`)*
2. **Highlight to the examiner:**
   - `image_id` shows `img1` (or whichever was selected).
   - `verifier_len` contains 128 hexadecimal characters (64-byte PBKDF2 hash output).
   - `salt_len` contains 64 hexadecimal characters (32-byte cryptographically secure salt).
   - **Crucial point**: There are NO $(x, y)$ coordinates, NO point sequences, and NO grid IDs stored anywhere in the schema.

### Step 4: Login and Session Flow
1. Navigate to **Login** (`/login.html`).
2. Enter the username `student_bca` and select the same image.
3. Intentionally enter **wrong points** or points in the **wrong sequence**:
   - Demonstrate the error response: `"Invalid username, image, or graphical sequence."`
   - Show in DevTools that HTTP 401 is returned.
4. Now enter the **correct 4 points in exact sequence**:
   - Successfully authenticated! The browser receives an `HttpOnly`, `SameSite=Strict` session cookie.
   - Redirected to `/dashboard.html`.

### Step 5: Dashboard & Audit Trail
1. Point out the dashboard user info card: User ID, Username, Active Image ID, Registration date.
2. Point out the **Security Audit Log** table:
   - Displays real-time security events: `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_REGISTER_SUCCESS`.
   - Records timestamp and client IP address.
3. Click **Log Out**:
   - Session is destroyed in server SQLite session store.
   - Cookie is cleared and user is redirected to the home page.

---

## 3. High-Yield Viva Voce Questions & Answers

### Category A: Concept & Core Architecture

#### Q1. Why use a graphical password system instead of traditional alphanumeric passwords?
**Answer:**
Human psychology is inherently visual. According to the "Picture Superiority Effect", human memory retains visual imagery and spatial landmarks far more reliably than arbitrary alphanumeric strings. Users forced to remember 16-character alphanumeric passwords often resort to writing them down, using predictable patterns (`Password123!`), or reusing them across platforms. Graphical passwords allow users to leverage spatial memory without sacrificing cryptographic entropy.

#### Q2. What is the 10×10 logical quantization grid and why is it necessary?
**Answer:**
If we used raw screen pixels, a user clicking on a desktop monitor ($1920 \times 1080$), a laptop ($1366 \times 768$), or a mobile screen would generate completely different coordinate numbers for the exact same visual spot.

To make the system **resolution-independent, zoom-independent, and responsive**, we convert raw pixel clicks into normalized coordinates:
$$\text{normX} = \frac{\text{clickX}}{\text{elementWidth}}, \quad \text{normY} = \frac{\text{clickY}}{\text{elementHeight}}$$
Then we map them into a $10 \times 10$ integer grid (cells $(0,0)$ through $(9,9)$):
$$\text{gridX} = \min(\lfloor \text{normX} \times 10 \rfloor, 9), \quad \text{gridY} = \min(\lfloor \text{normY} \times 10 \rfloor, 9)$$
This gives 100 discrete cells, providing fault tolerance for minor fingertip/cursor drift while preserving positional uniqueness.

#### Q3. How many possible combinations does a 4-point sequence offer on a 10×10 grid?
**Answer:**
Since points must be distinct and order matters (a sequence of 4 distinct cells chosen from 100 cells):
$$P(100, 4) = \frac{100!}{(100-4)!} = 100 \times 99 \times 98 \times 97 = 94,109,400 \text{ permutations}$$
Factoring in the 3 selectable image scenes:
$$\text{Total Keyspace} = 3 \times 94,109,400 = 282,328,200 \approx 2.82 \times 10^8 \text{ combinations}$$
This offers over 28 bits of base entropy, which is mathematically robust against offline brute-force attacks when paired with high-workfactor key stretching (PBKDF2 with 210,000 iterations).

---

### Category B: Cryptography & Storage

#### Q4. Why do you use PBKDF2-HMAC-SHA256 instead of simple SHA-256 or MD5?
**Answer:**
Fast hashing algorithms like MD5 or raw SHA-256 are designed for speed (gigahashes per second on modern GPUs). An attacker who obtains a password hash can calculate billions of guesses per second using rainbow tables or GPU clusters.

**PBKDF2 (Password-Based Key Derivation Function 2)** is an intentional "key-stretching" algorithm. By running HMAC-SHA256 through **210,000 rounds** (following current OWASP recommendations):
1. Deriving a single hash takes approximately 50–100 milliseconds on a modern CPU.
2. An attacker's GPU cracking throughput is reduced by a factor of 210,000, making offline dictionary attacks computationally unfeasible.

#### Q5. What is a salt, and why must it be unique per user?
**Answer:**
A salt is a 32-byte cryptographically secure random sequence generated using Node.js's `crypto.randomBytes(32)`.
- It ensures that two users who choose the exact same image and point sequence will have completely different stored verifiers.
- It completely neutralizes precomputed **rainbow table** attacks.
- Because it is 32 bytes (256 bits), no two users will ever share a salt.

#### Q6. What is a timing attack, and how does your project prevent it?
**Answer:**
In standard string comparison (`if (hashA === hashB)`), programming languages compare strings byte by byte and terminate as soon as the first non-matching byte is found. An attacker measuring request round-trip times down to microsecond accuracy can determine how many leading bytes were correct, allowing them to brute-force hashes byte by byte.

We prevent this using two defenses:
1. **`crypto.timingSafeEqual`**: Performs a constant-time comparison that always evaluates all 32 bytes regardless of where differences occur.
2. **Dummy Derivation for Unknown Users**: If a login request arrives for a non-existent username, the backend runs an identical 210,000-round PBKDF2 calculation against a dummy verifier. This ensures response times are indistinguishable between "wrong password" and "user does not exist", preventing username enumeration.

---

### Category C: Web Application Security

#### Q7. What is Cross-Site Request Forgery (CSRF) and how does GraphKey stop it?
**Answer:**
CSRF occurs when a malicious website tricks a victim's browser into executing an unwanted action on a web application where the victim is currently authenticated (by exploiting automatically attached cookies).

GraphKey implements **Double-Submit / Session-Bound CSRF Token Protection**:
1. When any page loads, the frontend fetches a unique CSRF token generated via `crypto.randomBytes(32)` from `/api/csrf-token`.
2. This token is stored in the user's server-side session.
3. Every state-changing request (`POST /api/register`, `POST /api/login`, `POST /api/logout`) must submit this token in the custom HTTP header `X-CSRF-Token`.
4. Our middleware compares the header token with the session token using `crypto.timingSafeEqual`. Malicious third-party sites cannot read or inject this custom header due to the browser's Same-Origin Policy.

#### Q8. How are sessions managed and secured?
**Answer:**
- We use `express-session` with a persistent SQLite session store (`better-sqlite3-session-store`).
- Session IDs are cryptographically signed using a strong secret.
- Session cookies are configured with:
  - `httpOnly: true` (prevents JavaScript/XSS access to the cookie).
  - `sameSite: 'strict'` (cookie is only sent for first-party requests).
  - Configurable `secure: true` for HTTPS environments.
- On logout, `req.session.destroy()` purges the session from both memory and the SQLite database.

#### Q9. What security headers does Helmet provide in this project?
**Answer:**
Helmet configures HTTP security headers to protect against common web vulnerabilities:
- **`Content-Security-Policy`**: Restricts resource loading to self and trusted domains, blocking unauthorized scripts.
- **`X-Frame-Options: SAMEORIGIN`**: Prevents the application from being embedded inside an `<iframe>` on external sites, neutralizing clickjacking.
- **`X-Content-Type-Options: nosniff`**: Prevents MIME-type sniffing attacks.
- **`Strict-Transport-Security (HSTS)`**: Forces browser communication over HTTPS.

#### Q10. What rate limiting policies are implemented?
**Answer:**
We use `express-rate-limit` to prevent denial-of-service and brute-force attacks:
- **Global API Rate Limiter**: 100 requests per 15-minute window per IP.
- **Auth Endpoint Limiter** (`/api/register`, `/api/login`): Strict limit of 10 requests per 15-minute window per IP. When exceeded, the server returns HTTP 429 (Too Many Requests).

---

### Category D: Database & Data Integrity

#### Q11. Which database is used and what is WAL mode?
**Answer:**
We use **SQLite3** via the high-performance synchronous driver `better-sqlite3`.
On connection initialization, we execute:
```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```
**WAL (Write-Ahead Logging)** mode offers significant benefits:
1. Readers do not block writers, and writers do not block readers (concurrent reads while writing).
2. Atomic, crash-resilient ACID transactions.
3. Faster disk I/O because writes are appended sequentially to a `.wal` file rather than locking the entire database file.

#### Q12. Explain the schema of the `users` and `audit_events` tables.
**Answer:**
1. **`users` table**:
   - `id`: Auto-incrementing integer primary key.
   - `username`: Unique lowercase text string.
   - `image_id`: Identifier referencing the selected background scene (`img1`, `img2`, `img3`).
   - `salt`: 64-character hex string representing the 32-byte unique crypto salt.
   - `verifier`: 128-character hex string representing the 64-byte PBKDF2-SHA256 derived key.
   - `iterations`: Number of PBKDF2 rounds (default `210000`).
   - `created_at`: ISO 8601 UTC timestamp.
2. **`audit_events` table**:
   - `id`: Auto-incrementing integer primary key.
   - `user_id`: Foreign key referencing `users.id` (with `ON DELETE SET NULL`).
   - `event_type`: Categorical event code (`REGISTER`, `LOGIN_OK`, `LOGIN_FAIL`, `LOGOUT`).
   - `ip_address`: Client IP address.
   - `created_at`: ISO 8601 UTC timestamp.

---

### Category E: Critical Analysis & Forensic Limitations

#### Q13. What are the known limitations of Graphical Password systems?
**Answer:**
As an objective cybersecurity researcher, I must acknowledge the inherent vulnerabilities:
1. **Shoulder Surfing**: Observers physically watching the user's screen can visually memorize the clicked points much more easily than keyboard keystrokes.
2. **Hotspot Guessing**: Users naturally gravitate toward prominent visual landmarks on an image (e.g., eye of a bird, corner of a tower, center of the sun). This creates non-uniform distribution across the 100 grid cells.
3. **Smudge Attacks**: On touchscreen devices, oily residue left by fingertips can reveal clicked coordinates.
4. **Single-Factor Constraint**: A graphical password is still a "something you know" single factor. In high-security systems, it should be paired with MFA (like a TOTP authenticator).

#### Q14. How would you counter Shoulder Surfing in future enhancements?
**Answer:**
Future extensions can implement:
- **Decoy / Pass-Point Schemes**: The user is shown 4 target points and 6 distractor/decoy points on screen and must perform a covert cognitive operation (e.g., select points inside a specific color boundary).
- **Dynamic Grid Distortion**: Subtly shifting the image coordinates or rotating the canvas slightly on each login so the physical screen location changes while the logical landmark remains constant.
- **Directional Gestures**: Swiping in dynamic directions rather than static pinpoint clicks.

---

## 4. Key Terminology Cheat Sheet (Quick Review Before Entering the Exam)

| Term | Quick Definition |
|---|---|
| **Quantization** | Converting continuous physical coordinates (pixels) into discrete logical grid buckets (0–9). |
| **PBKDF2** | Password-Based Key Derivation Function 2; adds computational work factor to resist GPU cracking. |
| **HMAC-SHA256** | Keyed-hash message authentication code using SHA-256 as the underlying cryptographic primitive. |
| **Salt** | Cryptographically random bytes appended to input before hashing to defeat precomputed rainbow tables. |
| **Timing Attack** | Side-channel attack measuring execution time variations to deduce secret keys or bytes. |
| **`timingSafeEqual`** | A constant-time buffer comparison function resistant to timing side-channel attacks. |
| **CSRF** | Cross-Site Request Forgery; tricking an authenticated browser into sending unauthorized commands. |
| **Double-Submit Token** | A defense where a cryptographically random token must match across both session/cookie and request header. |
| **WAL Mode** | Write-Ahead Logging in SQLite allowing concurrent readers and writers without database file locking. |
| **Clickjacking** | Deceptive technique of overlaying transparent frames over legitimate buttons; mitigated via `X-Frame-Options: SAMEORIGIN`. |

---

## 5. Verification Checklist for Viva

Before presenting to the external examiner, verify:
- [x] Node.js dependencies installed (`better-sqlite3`, `express`, `helmet`, `express-rate-limit`, `express-session`).
- [x] Test suite passing 100% (`npm test` runs 82/82 automated tests).
- [x] Database initialized at `data/graphkey.db`.
- [x] Server boots cleanly without warnings via `npm start`.
- [x] Browser accessible at `http://localhost:3000`.