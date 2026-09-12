# NEResq authentication backend

This Node.js API replaces the former browser-only demo login. Passwords are hashed with bcrypt, signed JWTs expire after eight hours, login attempts are rate-limited, and the API exposes authenticated profile access.

## 1. Configure and run locally

In this folder, copy `.env.example` to `.env`. Set a unique `JWT_SECRET`, then set a real email and strong (12+ character) password for the initial operator account. Do not use the example password in a real environment.

```powershell
npm install
npm start
```

The API will be available at `http://localhost:3000` and `http://localhost:3000/health` will confirm it is running.

The server makes a `data/users.json` file for accounts. It is deliberately ignored by Git. For a production deployment, use a managed database or durable disk; a host with ephemeral storage will remove this file on redeploy.

## 2. Connect CodePen

In the CodePen JavaScript panel, replace the value at the start of the script:

```js
const API_URL = 'https://your-deployed-api.example.com';
```

CodePen is served on HTTPS, so your production API must also use HTTPS. `http://localhost:3000` is only suitable when you are running the frontend locally, not from an HTTPS CodePen preview.

Set `ALLOWED_ORIGIN` in your API `.env` to the exact CodePen origin(s) you use. While testing, `*` is accepted; change it to your actual origin before production.

## 3. Deploy

Deploy this folder to any Node.js host that supplies an HTTPS URL. Add the environment variables from `.env` in that host's dashboard; never upload your `.env` file. Set the host's start command to `npm start`. Then paste the HTTPS URL into `API_URL` in CodePen.

## API endpoints

- `POST /api/auth/register` — invited operator registration; JSON: `name`, `email`, `password`.
- `POST /api/auth/login` — JSON: `email`, `password`; returns `token` and public user info.
- `GET /api/auth/me` — requires `Authorization: Bearer <token>`.
- `GET /health` — service status.

## Important production note

This is a compact custom authentication API for a prototype. Before handling genuine emergency operations or personal data, use a managed identity provider or add a production database, HTTPS-only cookies with CSRF protection, password reset and email verification, audit logging, monitoring, backups, and an appropriate security review.
