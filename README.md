# 🔐 MLEFPS — Multi-Level Encryption File Protection System

A full-stack web application that encrypts images through a **3-layer pipeline**:
**AES-256-CBC → Triple-DES-CBC → RSA-2048-OAEP**

---

## 📁 Project Structure

```
mlefps/
├── backend/
│   ├── server.js              ← Express entry point
│   ├── crypto/
│   │   └── cryptoEngine.js    ← AES + 3DES + RSA pipeline
│   ├── storage/
│   │   └── keyStore.js        ← RSA key generation & storage
│   ├── routes/
│   │   ├── encrypt.js         ← POST /api/encrypt
│   │   ├── decrypt.js         ← POST /api/decrypt, GET /api/decrypt/:id
│   │   └── files.js           ← GET /api/files, DELETE /api/files/:id
│   ├── keys/                  ← RSA key pair (auto-generated on first run)
│   ├── uploads/               ← Temporary upload staging (auto-cleaned)
│   └── encrypted/             ← Stored .mlenc files
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── tests/
│   └── test.js                ← Full test suite
└── package.json
```

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm start
```

Or in development mode (auto-restarts on file changes):

```bash
npm run dev
```

### 3. Open the app

Visit **http://localhost:3000** in your browser.

> On first startup, an RSA-2048 key pair is auto-generated and saved to `backend/keys/`. This takes 2–5 seconds.

---

## 🔐 Encryption Pipeline

### Encrypting an image

```
Image bytes
    │
    ▼ AES-256-CBC (random 32-byte key + 16-byte IV)
    │
    ▼ Triple-DES-CBC (random 24-byte key + 8-byte IV)
    │
    ▼ RSA-2048-OAEP encrypts {aesKey, aesIV, desKey, desIV}
    │
    ▼ .mlenc file:
       [MLENC001 magic][RSA key len][RSA-encrypted keys][filename len][filename][ciphertext]
```

### Decrypting a .mlenc file

```
.mlenc file
    │
    ▼ Validate magic header
    │
    ▼ RSA-2048 private key decrypts key bundle
    │
    ▼ 3DES decrypts ciphertext
    │
    ▼ AES-256 decrypts to original image
```

---

## 🧪 Running Tests

```bash
npm test
```

The test suite covers:
- RSA key pair generation
- Full 3-layer encrypt → decrypt round-trip
- Tamper detection (corrupt ciphertext + bad magic header)
- IV randomness (same input → different ciphertext each time)
- Multiple file sizes (1 byte to 100 KB)
- Filename preservation (including special characters)

---

## 🌐 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/encrypt` | Upload image, returns `{ fileId, filename, ... }` |
| `POST` | `/api/decrypt` | Upload `.mlenc` file, streams back original image |
| `GET`  | `/api/decrypt/:fileId` | Decrypt a server-stored file by ID |
| `GET`  | `/api/files` | List all stored encrypted files |
| `DELETE` | `/api/files/:fileId` | Delete a stored encrypted file |
| `GET`  | `/api/health` | Health check |

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port |

Set via environment: `PORT=8080 npm start`

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `express` | Web server framework |
| `multer` | Multipart file upload handling |
| `node-forge` | RSA-2048 key generation & OAEP encryption |
| `uuid` | Unique file IDs |
| `cors` | Cross-origin support |

---

## 🔒 Security Notes

- The RSA private key is stored in `backend/keys/private.pem` with `chmod 600` permissions
- Original uploaded images are deleted immediately after encryption
- Each encryption uses fresh random IVs — same image produces different ciphertext every time
- The `.mlenc` format includes an 8-byte magic header for integrity pre-check before decryption
- File uploads are size-limited (20 MB images, 25 MB `.mlenc` files)

---

## 📌 Supported Image Formats

JPG, JPEG, PNG, GIF, BMP, WEBP, TIFF

---

*Built for the MLEFPS academic project demonstrating defense-in-depth cryptography.*

---

## Deploy (Render + Vercel)

### Backend on Render

1. Create a new Render Blueprint service from this repository.
2. Ensure it uses `render.yaml` at the repo root.
3. Set required secrets in Render:
    - `DATABASE_URL`
    - `JWT_SECRET`
    - `CORS_ORIGIN` (set to your Vercel URL, or comma-separated list)
4. Keep `SERVE_FRONTEND=false` for split deployment.
5. Keep `STORAGE_DIR=/var/data/cipherguard/storage` and attach the persistent disk from `render.yaml`.
6. Run `backend/db/schema.sql` on your PostgreSQL database before first use.

### Frontend on Vercel

1. Create a Vercel project pointing to `frontend/` as the root directory.
2. In `frontend/vercel.json`, replace `YOUR-RENDER-BACKEND-URL` with your real Render backend domain.
3. Deploy. All `/api/*` browser calls will be rewritten to the Render backend.

### Local environment template

Copy `backend/.env.example` to `backend/.env` and fill values for local development.
