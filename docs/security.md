# GraphKey – Security Analysis & Threat Model

## 1. Security Architecture & Threat Model

GraphKey is evaluated against standard threat classifications, focusing on web application vulnerabilities (OWASP Top 10) and authentication-specific threat vectors.

```
┌─────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ Attack Vector           │ Threat Description           │ GraphKey Defense             │
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Credential Harvesting   │ Direct compromise of SQLite  │ PBKDF2-SHA256 (210,000 rds)  │
│ via Database Dump       │ database file                │ + 32-byte unique salt        │
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Online Brute-Force      │ Rapid automated guessing of  │ express-rate-limit           │
│ & Dictionary Attacks    │ graphical coordinates        │ (10 attempts / 15 min / IP)  │
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Side-Channel Timing     │ Measuring response times to  │ crypto.timingSafeEqual +     │
│ Attacks                 │ extract verifier bytes/users │ Dummy PBKDF2 for unknown user│
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Cross-Site Request      │ Malicious sites submitting   │ Double-Submit CSRF token in  │
│ Forgery (CSRF)          │ unauthorized state changes   │ X-CSRF-Token header + Strict │
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Session Fixation        │ Attacker forcing victim onto │ req.session.regenerate()     │
│                         │ known pre-auth session ID    │ on successful login          │
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ SQL Injection           │ Tainted input manipulating   │ better-sqlite3 prepared      │
│                         │ SQLite queries               │ parameterized statements     │
├─────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Cross-Site Scripting    │ Script injection into DOM    │ Helmet Content-Security-     │
│ (XSS)                   │ or stealing session cookies  │ Policy + HttpOnly cookies    │
└─────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

---

## 2. In-Depth Defense Mechanisms

### 2.1 Cryptographic Storage (PBKDF2-SHA256)
- **Algorithm**: Password-Based Key Derivation Function 2 with HMAC-SHA256 (NIST SP 800-132 compliant).
- **Salt**: 32 cryptographically secure random bytes generated via `crypto.randomBytes(32)` (256-bit entropy).
- **Iterations**: Configurable via `.env` with a default of **210,000 rounds** (matching current NIST guidance for SHA-256).
- **Key Length**: 64 bytes (512-bit derived output).
- **Zero Raw Data Stored**: The serialized coordinate string `imageId:x1,y1:x2,y2:x3,y3:x4,y4` exists only in transient memory during derivation and is never committed to SQLite tables or audit logs.

### 2.2 Timing-Safe Equality & Username Enumeration Mitigation
1. **Constant-Time Verification**:
   ```javascript
   // Timing-safe buffer comparison avoids short-circuit leaks
   crypto.timingSafeEqual(candidateBuf, storedBuf);
   ```
   Standard string equality (`===`) aborts execution upon encountering the first mismatched character, creating subtle nanosecond response discrepancies. `timingSafeEqual` inspects all bytes unconditionally.
2. **Dummy PBKDF2 Execution**:
   When an unknown username is submitted on `/api/login`, the server does not return immediately. Instead, it derives a dummy verifier using 210,000 iterations before returning HTTP 401. This ensures that the response duration for invalid usernames is identical to that of valid usernames with incorrect passwords, eliminating timing-based username enumeration.

### 2.3 Session Hardening & Cookie Security
- `HttpOnly`: Disallows JavaScript access to `document.cookie`, neutralizing cookie theft via XSS.
- `SameSite: Strict`: Blocks the browser from attaching session cookies on cross-origin requests, providing defense against CSRF.
- `Secure`: Dynamically set to `true` when `NODE_ENV === 'production'` to ensure cookies are only transmitted over TLS/HTTPS.
- `Persistent Storage`: Backed by SQLite (`better-sqlite3-session-store`), eliminating RAM exhaustion attacks and maintaining login persistence across server restarts.

---

## 3. Inherent Limitations of Graphical Passwords

While graphical passwords solve text password memorability challenges, academic research and practical cybersecurity analysis identify distinct limitations:

### 3.1 Shoulder Surfing (Visual Eavesdropping)
- **Vulnerability**: In public or shared environments (libraries, offices, cafes), an onlooker or camera can observe the user clicking four spatial locations on a brightly colored scene much more easily than observing a masked text password hidden behind `••••••` asterisks.
- **Mitigation Strategies in Production**:
  - Implement randomized decoy grids or dual-screen validation.
  - Omit lingering visual marker dots during live entry.
  - Introduce mouse-free gaze tracking or touch-pressure biometric gating.

### 3.2 Hotspot & Visual Salience Guessing
- **Vulnerability**: Human psychology does not select points uniformly at random. Users naturally gravitate toward visually salient focal points—such as the center of the ringed planet, the peak of a skyscraper, or a brightly lit electronic chip.
- **Attack Vector**: An attacker knowing the image catalog can construct a **spatial dictionary attack** testing the top 10 most salient visual features of each image first, reducing the effective search space.
- **Mitigation Strategies in Production**:
  - Use algorithmically generated abstract or noisy backgrounds lacking clear focal points.
  - Require periodic image rotation.
  - Enforce minimum spatial dispersion between selected points.

### 3.3 Grid Granularity vs. Usability Trade-off
- **Coarse Grid (e.g. 5 × 5 = 25 cells)**: High input tolerance, but total 4-point search space is small: $\frac{25!}{(25-4)!} = 303,600$ permutations.
- **Fine Grid (e.g. 50 × 50 = 2500 cells)**: Large search space, but slight mouse drift, high DPI mice, or touchscreen taps cause frequent false rejects.
- **GraphKey's Balance**: A 10 × 10 grid yields $94,109,400$ permutations per image ($282,328,200$ across all 3 images). Combined with login rate limiting, online brute-force guessing is rendered infeasible.

### 3.4 Single-Factor Constraint
Graphical passwords remain a single-factor authentication (SFA) mechanism ("something you know"). In enterprise or high-security deployments, graphical authentication should always be paired with Multi-Factor Authentication (MFA), such as TOTP authenticator apps or FIDO2/WebAuthn hardware tokens.
