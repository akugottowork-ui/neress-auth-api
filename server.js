require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET;
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
const inviteEmails = (process.env.OPERATOR_INVITE_EMAILS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('Set JWT_SECRET in .env to a unique value of at least 32 characters.');
}

// Demo storage only: users disappear when the server restarts.
// Replace this Map with PostgreSQL, Supabase, Auth0, or another managed identity store before production.
const users = new Map();
const dataDirectory = path.join(__dirname, 'data');
const userFile = path.join(dataDirectory, 'users.json');
const attempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function loadUsers() {
  if (!fs.existsSync(userFile)) return;
  const savedUsers = JSON.parse(fs.readFileSync(userFile, 'utf8'));
  savedUsers.forEach(user => users.set(user.email, user));
}

function saveUsers() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(userFile, JSON.stringify([...users.values()], null, 2), { mode: 0o600 });
}

async function seedInitialOperator() {
  const email = String(process.env.INITIAL_OPERATOR_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.INITIAL_OPERATOR_PASSWORD || '');
  if (!email || password.length < 12 || users.has(email)) return;
  const user = {
    id: crypto.randomUUID(), email,
    name: String(process.env.INITIAL_OPERATOR_NAME || 'NEResq Operator').slice(0, 80),
    role: 'operator', passwordHash: await bcrypt.hash(password, 12)
  };
  users.set(email, user);
  saveUsers();
  console.log(`Initial NEResq operator account loaded for ${email}`);
}

app.use(helmet());
app.use(cors({ origin: allowedOrigin === '*' ? '*' : allowedOrigin.split(',').map(item => item.trim()) }));
app.use(express.json({ limit: '10kb' }));

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '8h', issuer: 'neresq-api' });
}

function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const record = attempts.get(key) || { count: 0, start: now };
  if (now - record.start > ATTEMPT_WINDOW_MS) { record.count = 0; record.start = now; }
  if (record.count >= MAX_ATTEMPTS) return res.status(429).json({ message: 'Too many login attempts. Try again in 15 minutes.' });
  req.loginAttempt = record;
  next();
}

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try { req.auth = jwt.verify(token, jwtSecret, { issuer: 'neresq-api' }); next(); }
  catch { return res.status(401).json({ message: 'Your session has expired. Please sign in again.' }); }
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'NEResq Authentication API' }));

app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim() || 'NEResq Operator';
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (password.length < 12) return res.status(400).json({ message: 'Use a password with at least 12 characters.' });
  if (inviteEmails.length && !inviteEmails.includes(email)) return res.status(403).json({ message: 'This email is not authorised for operator registration.' });
  if (users.has(email)) return res.status(409).json({ message: 'An account already exists for this email.' });
  const user = { id: crypto.randomUUID(), email, name: name.slice(0, 80), role: 'operator', passwordHash: await bcrypt.hash(password, 12) };
  users.set(email, user);
  saveUsers();
  return res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = users.get(email);
  const accepted = user && await bcrypt.compare(password, user.passwordHash);
  if (!accepted) {
    req.loginAttempt.count += 1; attempts.set(req.ip, req.loginAttempt);
    return res.status(401).json({ message: 'Email or password is incorrect.' });
  }
  attempts.delete(req.ip);
  return res.json({ token: issueToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const user = [...users.values()].find(item => item.id === req.auth.sub);
  if (!user) return res.status(404).json({ message: 'Account not found.' });
  res.json({ user: publicUser(user) });
});

loadUsers();
seedInitialOperator().then(() => app.listen(port, () => console.log(`NEResq auth API is running on port ${port}`)));
