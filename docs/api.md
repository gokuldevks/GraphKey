# GraphKey – REST API Documentation

Base URL: `http://localhost:3000`  
Protocol: `HTTP/1.1` (Supports HTTPS in production)  
Data Format: `application/json`

---

## 1. General Request & Response Standards

### Common Headers
- `Content-Type: application/json` (Required on all requests with JSON body)
- `X-CSRF-Token: <token>` (Required on all `POST`, `PUT`, `DELETE` requests)
- `Cookie: gk_sid=<signed_session_id>` (Passed automatically by browsers on session-based endpoints)

### Common Security Response Headers
Every API response includes:
```http
Cache-Control: no-store, no-cache, must-revalidate, private
Pragma: no-cache
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: default-src 'self'; ...
```

---

## 2. API Endpoints

### 2.1 Server Health Check
Returns runtime status and database connectivity. Useful for monitoring and Postman checks.

- **Method**: `GET`
- **Path**: `/api/health`
- **Authentication**: None required
- **CSRF Token**: None required

#### Success Response (`200 OK`):
```json
{
  "status": "ok",
  "timestamp": "2026-11-05T07:00:00.000Z",
  "uptime_s": 42,
  "node_version": "v24.18.1",
  "environment": "development",
  "database": "connected"
}
```

---

### 2.2 Available Images Catalog
Returns the list of predefined graphical images available for password creation.

- **Method**: `GET`
- **Path**: `/api/images`
- **Authentication**: None required
- **CSRF Token**: None required

#### Success Response (`200 OK`):
```json
{
  "images": [
    {
      "id": "img1",
      "name": "Cybercity",
      "description": "A dark city skyline at night with neon lights and skyscrapers.",
      "src": "/images/img1.svg"
    },
    {
      "id": "img2",
      "name": "Cosmos",
      "description": "A space scene featuring a ringed planet, moon, and satellite.",
      "src": "/images/img2.svg"
    },
    {
      "id": "img3",
      "name": "Circuit",
      "description": "A green circuit board with labelled chips and electronic traces.",
      "src": "/images/img3.svg"
    }
  ]
}
```

---

### 2.3 Retrieve CSRF Token
Generates a random 32-byte cryptographic token, stores it in the SQLite session, and delivers it to the client.

- **Method**: `GET`
- **Path**: `/api/csrf-token`
- **Authentication**: None required
- **Response Headers**: Sets `Set-Cookie: gk_sid=...; HttpOnly; SameSite=Strict`

#### Success Response (`200 OK`):
```json
{
  "csrfToken": "57b5a930b91eb6c348a72240f6ebcf0c707287e8f8e80529d03ba4bc5e3ceb1f"
}
```

---

### 2.4 User Registration
Registers a new account using an ordered 4-point graphical sequence on a chosen image.

- **Method**: `POST`
- **Path**: `/api/register`
- **Headers Required**:
  - `Content-Type: application/json`
  - `X-CSRF-Token: <token>`
- **Authentication**: None required

#### Request Body:
```json
{
  "username": "alice_cyber",
  "imageId": "img2",
  "points": [
    [3, 1],
    [7, 3],
    [1, 6],
    [8, 8]
  ]
}
```

#### Validation Rules:
- `username`: String, 3–32 characters, regex `^[a-zA-Z0-9_]+$`.
- `imageId`: Must match one of `['img1', 'img2', 'img3']`.
- `points`: Exactly 4 elements; each element must be a 2-item array `[gridX, gridY]`.
- Coordinates must be integers $\in [0, 9]$.
- All 4 points must occupy **distinct** cells.

#### Success Response (`201 Created`):
```json
{
  "message": "Account created successfully. You can now log in.",
  "username": "alice_cyber"
}
```

#### Error Responses:
- `400 Bad Request`: Validation failure (e.g., duplicate points, out of bounds, short username).
- `403 Forbidden`: Missing or invalid CSRF token.
- `409 Conflict`: Username is already registered.

---

### 2.5 User Login
Authenticates an existing user by verifying their graphical password sequence.

- **Method**: `POST`
- **Path**: `/api/login`
- **Rate Limit**: **10 requests per 15 minutes per IP**.
- **Headers Required**:
  - `Content-Type: application/json`
  - `X-CSRF-Token: <token>`

#### Request Body:
```json
{
  "username": "alice_cyber",
  "imageId": "img2",
  "points": [
    [3, 1],
    [7, 3],
    [1, 6],
    [8, 8]
  ]
}
```

#### Success Response (`200 OK`):
*(Also issues a new session cookie and post-login CSRF token)*
```json
{
  "message": "Login successful.",
  "username": "alice_cyber",
  "csrfToken": "b0f231e8a91f6eeab5b5e7cd448acb066091018d59d10a9933bce09ea523852d"
}
```

#### Error Responses:
- `400 Bad Request`: Malformed payload or coordinate validation error.
- `401 Unauthorized`: `"Incorrect username or graphical password."` (Generic message prevents username enumeration).
- `403 Forbidden`: CSRF token mismatch.
- `429 Too Many Requests`: Triggered when 10 login attempts are exceeded in 15 minutes.

---

### 2.6 Current User Profile (Dashboard)
Retrieves account metadata for the currently authenticated session.

- **Method**: `GET`
- **Path**: `/api/me`
- **Authentication**: **Session Cookie Required** (`gk_sid`)
- **CSRF Token**: None required (Safe method)

#### Success Response (`200 OK`):
```json
{
  "user": {
    "id": 1,
    "username": "alice_cyber",
    "image_id": "img2",
    "iterations": 210000,
    "created_at": "2026-11-05 07:01:08"
  }
}
```
*Note: Cryptographic hashes, salts, and coordinate sequences are never exposed in profile responses.*

#### Error Response:
- `401 Unauthorized`: No active session exists or session has expired.

---

### 2.7 User Logout
Destroys the server-side session in SQLite and clears the client session cookie.

- **Method**: `POST`
- **Path**: `/api/logout`
- **Authentication**: **Session Cookie Required**
- **Headers Required**: `X-CSRF-Token: <token>`

#### Success Response (`200 OK`):
```json
{
  "message": "Logged out successfully."
}
```
*Response Header: `Set-Cookie: gk_sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`*
