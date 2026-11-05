# GraphKey – Graphical Password Authentication System

> **A Secure, Web-Based Graphical Password Authentication System**  
> *Final-Year BCA Cybersecurity Project*

---

## 📌 1. Project Overview

**GraphKey** is a modern cybersecurity web application that replaces traditional alphanumeric text passwords with an ordered graphical authentication mechanism.

Instead of typing letters, numbers, and symbols:
1. Users register by selecting **four distinct points** in a specific sequence on a predefined image.
2. During login, users authenticate by selecting the **same four points in the identical order** on the same image.
3. The server validates the graphical selection using a **10 × 10 logical quantization grid**, hashes the sequence using **PBKDF2-SHA256** with **210,000 iterations** and a **unique 32-byte cryptographic salt**, and stores **zero plaintext coordinates**.

---

## 🚀 2. Key Features

- **Ordered Graphical Authentication**: Access is granted only when both the spatial coordinates and the selection order match.
- **Resolution-Independent Quantization (10 × 10 Grid)**: User click coordinates are normalized against image dimensions and mapped to discrete cells $[0, 9] \times [0, 9]$, ensuring consistent login across different screen sizes and browser zoom levels.
- **Zero-Knowledge Credential Storage**: Raw coordinates and point sequences are never saved in SQLite. Only a derived 512-bit PBKDF2 hash is stored.
- **Timing-Attack Resistance**: Authentication verifiers are compared using Node.js `crypto.timingSafeEqual`. Failed login attempts for non-existent usernames execute a dummy PBKDF2 derivation to prevent timing-based username enumeration.
- **Double-Submit CSRF Protection**: All state-changing endpoints (`POST /api/register`, `POST /api/login`, `POST /api/logout`) require a valid session-bound CSRF token via the `X-CSRF-Token` header.
- **Brute-Force Rate Limiting**: The login endpoint is protected by `express-rate-limit` (10 attempts per IP per 15-minute window), locking out brute-force attacks with HTTP 429.
- **Persistent SQLite Session Store**: Express sessions are backed by SQLite (`better-sqlite3-session-store`) with `HttpOnly`, `SameSite: Strict`, and sliding expiration.
- **Security Headers & No-Cache API**: Configured with `helmet` and strict `Cache-Control: no-store` on all API routes.
- **Cybersecurity Dark Theme UI**: A clean, responsive interface built with HTML5, CSS3, and vanilla JavaScript featuring interactive canvas markers.

---

## 🛠️ 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | Responsive client, canvas point marking, grid quantization |
| **Backend** | Node.js (v24+), Express.js (v5) | RESTful API server, session management, middleware pipeline |
| **Database** | SQLite, `better-sqlite3` | High-performance, embedded, zero-config relational database |
| **Session Store**| `better-sqlite3-session-store` | Persistent SQLite session table (replaces MemoryStore) |
| **Cryptography** | PBKDF2-SHA256, `crypto.timingSafeEqual` | Password derivation (210,000 rounds) and timing-safe checks |
| **Security Headers**| `helmet` | Content-Security-Policy, X-Frame-Options, X-Content-Type-Options |
| **Rate Limiter**| `express-rate-limit` | Brute-force protection on authentication endpoints |

---

## 📂 4. Project Structure

```
GraphKey/
├── data/
│   └── graphkey.db            # SQLite database file (auto-created on startup)
├── docs/                      # Comprehensive technical documentation
│   ├── architecture.md        # System design, grid model, crypto flow
│   ├── database.md            # Schema, data dictionary, forensic analysis
│   ├── api.md                 # Complete REST API endpoint documentation
│   ├── security.md            # Threat model, defenses, and known limitations
│   ├── testing.md             # Formal test cases & execution report
│   └── viva-guide.md          # College viva presentation guide & Q&A
├── public/                    # Frontend client files
│   ├── index.html             # Landing page
│   ├── register.html          # Graphical password registration
│   ├── login.html             # Graphical password login
│   ├── dashboard.html         # Authenticated user dashboard
│   ├── css/
│   │   └── style.css          # Cybersecurity dark-navy theme
│   ├── images/                # Predefined graphical password scenes
│   │   ├── img1.svg           # Cybercity night skyline
│   │   ├── img2.svg           # Cosmos & planetary scene
│   │   └── img3.svg           # Electronic circuit board
│   └── js/
│       ├── register.js        # Registration UI & canvas point capture
│       ├── login.js           # Login UI, attempt counter & rate-limit feedback
│       └── dashboard.js       # Session check, profile loader & logout
├── src/                       # Backend server source code
│   ├── database/
│   │   ├── db.js              # SQLite connection, WAL mode & schema setup
│   │   └── sessionStore.js    # Persistent SQLite session store configuration
│   ├── middleware/
│   │   ├── csrfProtection.js  # Double-submit CSRF token validation
│   │   └── requireAuth.js     # Session authentication guard
│   ├── routes/
│   │   ├── auth.js            # /api/register, /api/login, /api/me, /api/logout
│   │   ├── health.js          # /api/health endpoint
│   │   └── images.js          # /api/images endpoint
│   └── services/
│       ├── crypto.js          # PBKDF2, salt generation, timingSafeEqual
│       └── passwordService.js # Coordinate validation & string serialization
├── tests/                     # Automated test suites (82 tests total)
│   ├── auth.test.js           # Unit & cryptography verification (39 tests)
│   ├── integration.test.js    # Full end-to-end user lifecycle (24 tests)
│   └── security.test.js       # Injection, rate limit & forensic tests (19 tests)
├── .env                       # Environment secrets (git-ignored)
├── .env.example               # Environment template
├── .gitignore                 # Git ignore rules
├── package.json               # Project manifest & npm scripts
└── server.js                  # Express application entry point
```

---

## ⚡ 5. Setup & Running Instructions

### Prerequisites
- **Node.js**: v18.0.0 or higher (Developed and verified on Node.js v24.18.1)
- **npm**: v9.0.0 or higher (Verified on npm v11.16.0)

### 1. Clone or Open Project
```bash
cd D:\Internship\project\GraphKey
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` (already configured for development):
```bash
copy .env.example .env
```
Ensure `.env` contains:
```ini
PORT=3000
NODE_ENV=development
SESSION_SECRET=53fd67d1a534acdb3ff15de5c51cc0063258f119a54856a07520d8596cabb83a2bd5cc0d90205c09d2e226bf75d2652e
PBKDF2_ITERATIONS=210000
```

### 3. Start the Server
```bash
npm start
```
The application will start on **`http://localhost:3000`**.

### 4. Run Automated Tests
```bash
npm test
```
Runs all 82 tests across unit, integration, and security suites:
- `npm run test:unit` (39 tests)
- `npm run test:integration` (24 tests)
- `npm run test:security` (19 tests)

---

## 🖥️ 6. How to Demonstrate the Project

1. **Open Browser**: Navigate to `http://localhost:3000`.
2. **Registration Demonstration**:
   - Click **Create Account** to open `register.html`.
   - Enter a username (e.g. `alice_cyber`).
   - Select an image (e.g. **Cosmos**).
   - Click 4 distinct spots in sequence (e.g., Moon, Planet center, Satellite, Top-right star).
   - Watch the numbered indicators update (1 → 2 → 3 → 4).
   - Click **Create Account**. A success alert appears and navigates to `login.html`.
3. **Negative Authentication Tests (Demonstrating Security)**:
   - **Wrong Image**: Select *Cybercity* instead of *Cosmos* and click any 4 points → Login fails.
   - **Wrong Order**: Select *Cosmos* and click the exact same 4 points in *reverse order* → Login fails.
   - **Wrong Coordinates**: Click 4 random points → Login fails.
4. **Successful Login Demonstration**:
   - Enter `alice_cyber`, select *Cosmos*, and click the original 4 points in the original order.
   - Click **Sign In**. The system authenticates and redirects to `dashboard.html`.
5. **Dashboard Inspection**:
   - View account details (ID, creation timestamp, iterations, image name).
   - Review active security features and documented limitations.
6. **Sign Out**:
   - Click **Sign Out**. The session is destroyed in SQLite and user is redirected to `login.html`.
   - Pressing browser **Back** redirects back to `login.html` because the session is invalidated.
7. **Forensic Database Inspection**:
   - Run `npm run db:inspect` in your terminal to prove to examiners that the database contains zero raw coordinates, zero passwords, and zero grid IDs.

---

## 📖 7. Documentation Index

For in-depth explanations and viva preparation:
- 🏛️ [System Architecture & Grid Model](docs/architecture.md)
- 🗄️ [Database Schema & Forensic Analysis](docs/database.md)
- 🔌 [REST API Endpoint Documentation](docs/api.md)
- 🛡️ [Security Analysis & Threat Model](docs/security.md)
- 🧪 [Testing & Verification Report](docs/testing.md)
- 🎓 [Viva Voce & Presentation Guide](docs/viva-guide.md)

---

## 📄 License
This project was developed for educational and academic evaluation purposes as a BCA Cybersecurity Internship Project.
