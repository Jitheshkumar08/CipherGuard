# CipherGuard

CipherGuard is a full-stack web application for encrypting and decrypting image files with layered cryptography and per-user key protection. Users sign in to a private vault, upload an image, and receive a `.mlenc` file that can later be decrypted back to the original image.

The core encryption pipeline is:

`AES-256-CBC -> Triple-DES-CBC -> RSA-2048-OAEP`

## Overview

CipherGuard combines browser-based file handling, a Node/Express API, PostgreSQL-backed user storage, and password-protected key material.

At signup, the server generates:

- a password-derived KEK
- a random DEK
- an RSA-2048 key pair

The DEK and RSA private key are stored encrypted in PostgreSQL. When a user uploads or decrypts a file, the server verifies the login token, unlocks the user keys with the current password, and performs the file operation.

## Features

- User signup and login with JWT authentication
- Per-user encrypted key storage
- Image encryption to a binary `.mlenc` container
- Decryption of uploaded `.mlenc` files
- Stored encrypted file listing and deletion
- Password change flow that re-encrypts the DEK
- Optional split deployment with a Render backend and Vercel frontend

## Repository Layout

```
CipherGuard/
├── backend/
│   ├── server.js
│   ├── crypto/
│   │   ├── cryptoEngine.js
│   │   └── userKeyManager.js
│   ├── db/
│   │   ├── pool.js
│   │   └── schema.sql
│   ├── middleware/
│   │   ├── auth.js
│   │   └── requireKeys.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── decrypt.js
│   │   ├── encrypt.js
│   │   ├── files.js
│   │   └── user.js
│   ├── storage/
│   └── uploads/
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   ├── settings.html
│   ├── js/
│   │   ├── api.js
│   │   └── app.js
│   └── vercel.json
├── storage/
├── tests/
│   └── test.js
├── package.json
├── render.yaml
└── vercel.json
```

## How It Works

### Encryption flow

1. The uploaded image is read into memory.
2. The image is encrypted with AES-256-CBC using a random key and IV.
3. The AES ciphertext is encrypted again with Triple-DES-CBC using a random key and IV.
4. The AES and 3DES keys are wrapped with the user RSA public key using RSA-2048-OAEP.
5. The result is packed into a `.mlenc` file with a magic header and filename metadata.

### Decryption flow

1. The uploaded `.mlenc` file is validated by its magic header and file structure.
2. The wrapped key bundle is decrypted with the user RSA private key.
3. The ciphertext is decrypted with 3DES and then AES.
4. The original image is streamed back to the browser with the original filename preserved.

## Local Setup

### Prerequisites

- Node.js 20 or newer
- PostgreSQL database
- A `DATABASE_URL` connection string
- A `JWT_SECRET` value

### 1. Install dependencies

Install the project dependencies from the repository root:

```bash
npm install
```

If you run the backend package directly, install its dependencies as well:

```bash
cd backend
npm install
```

### 2. Configure environment variables

Create `backend/.env` and set the required values.

Minimum required variables:

- `DATABASE_URL`
- `JWT_SECRET`

Optional variables:

- `PORT` - defaults to `3000`
- `JWT_EXPIRES_IN` - defaults to `10h`
- `CORS_ORIGIN` - defaults to `*`
- `SERVE_FRONTEND` - set to `true` to serve the frontend from the backend server
- `STORAGE_DIR` - location for persisted `.mlenc` files

The backend exits immediately if `DATABASE_URL` or `JWT_SECRET` is missing.

### 3. Create the database schema

Run the SQL in `backend/db/schema.sql` against your PostgreSQL database before starting the app.

### 4. Start the app

From the repository root:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The server defaults to `http://localhost:3000`.

## Frontend Usage

The frontend includes three main authenticated views:

- Encrypt: upload an image and generate a `.mlenc` file
- Decrypt: upload a `.mlenc` file and recover the original image
- Files: list, download, decrypt, or delete stored encrypted files

The app also includes login, signup, and settings pages for account management.

## API Reference

### Auth

- `POST /api/auth/signup` - create a user account and generate encrypted keys
- `POST /api/auth/login` - authenticate with email or username
- `POST /api/auth/logout` - client-side logout helper

### User

- `GET /api/user/me` - return the current user profile
- `PUT /api/user/password` - change the password and re-encrypt the DEK
- `PUT /api/user/profile` - update username and email
- `GET /api/user/private-key` - retrieve the unlocked RSA private key for the current session
- `POST /api/user/validate` - check username or email availability

### Encryption

- `POST /api/encrypt` - encrypt an uploaded image and persist the `.mlenc` file

### Decryption

- `POST /api/decrypt` - decrypt an uploaded `.mlenc` file
- `GET /api/decrypt/:fileId` - decrypt a stored server-side file by ID
- `GET /api/decrypt/download/:fileId` - download the raw `.mlenc` file

### Files

- `GET /api/files` - list stored encrypted files for the authenticated user
- `DELETE /api/files/:fileId` - delete a stored encrypted file

### Health

- `GET /api/health` - health check

## File Limits and Formats

- Image uploads are limited to 20 MB
- `.mlenc` uploads are limited to 30 MB
- Supported image formats: JPG, JPEG, PNG, GIF, BMP, WEBP, TIFF

## Security Notes

- Passwords are hashed with bcrypt before storage
- The DEK is encrypted with a password-derived KEK
- The RSA private key is stored encrypted per user
- Original uploaded images are deleted after successful encryption
- Each encryption uses fresh random IVs, so the same image produces different output each time
- The `.mlenc` format includes a magic header for quick integrity checks before decryption

## Running Tests

Run the test suite with:

```bash
npm test
```

The tests cover key generation, end-to-end encrypt/decrypt behavior, tamper detection, and file handling scenarios.

## Deployment

### Render backend

1. Create a Render Blueprint service from this repository.
2. Use `render.yaml` at the repository root.
3. Provide the required secrets:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `CORS_ORIGIN`
4. Keep `SERVE_FRONTEND=false` for split deployment.
5. Keep `STORAGE_DIR=/var/data/cipherguard/storage` and attach the persistent disk defined in `render.yaml`.
6. Run `backend/db/schema.sql` on the PostgreSQL database before first use.

### Vercel frontend

1. Deploy the static frontend from the `frontend/` directory.
2. Update `frontend/vercel.json` with your Render backend URL.
3. Deploy the frontend so browser requests to `/api/*` rewrite to the backend service.

### Monolith mode

If you want the backend to serve the frontend directly, set `SERVE_FRONTEND=true` in the backend environment

## Notes

- The backend requires the current user password to unlock encryption keys for encryption and decryption operations.
- Password changes re-encrypt the DEK, so existing encrypted files remain readable after a successful password update.
- The encrypted file store is separate from the temporary upload directory.
