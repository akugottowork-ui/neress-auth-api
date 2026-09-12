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
const inviteEmails = (process.env.OPERATOR_INVITE_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
if (!jwtSecret || jwtSecret.length < 32) throw new Error('Set JWT_SECRET in .env to a unique value of at least 32 characters.');

const users = new Map();
const dataDirectory = path.join(__dirname, 'data');
const userFile = path.join(dataDirectory, 'users.json');
const attempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const operationalData = {
  map: { updatedAt: 'Live', coverage: '124 sensor nodes online', zones: [
    { district: 'Dima Hasao, Assam', risk: 'High', score: 92, soilMoisture: '84%', rainfall: '48 mm/hr', status: 'Evacuation advised' },
    { district: 'Tirap, Arunachal Pradesh', risk: 'High', score: 88, soilMoisture: '78%', rainfall: '34 mm/hr', status: 'Field verification active' },
    { district: 'Phek, Nagaland', risk: 'Moderate', score: 64, soilMoisture: '68%', rainfall: '22 mm/hr', status: 'Patrol deployed' },
    { district: 'Mamit, Mizoram', risk: 'Moderate', score: 61, soilMoisture: '72%', rainfall: '26 mm/hr', status: 'Road-clearance team en route' }
  ] },
  predictions: [
    { district: 'Dima Hasao, Assam', probability: 92, window: 'Next 6 hours', driver: '48 mm/hr rainfall and 84% soil saturation', action: 'Stage 2 evacuation advised' },
    { district: 'Tirap, Arunachal Pradesh', probability: 88, window: 'Next 12 hours', driver: 'Slope movement above normal baseline', action: 'Activate community warning system' },
    { district: 'Phek, Nagaland', probability: 64, window: 'Next 24 hours', driver: 'Satellite coherence shift and rainfall', action: 'Restrict NH-29 traffic' }
  ],
  alerts: [
    { id: 'ALT-105', level: 'High', location: 'Dima Hasao, Assam', message: 'Landslide risk rising due to continuous heavy rainfall.', time: '11:42 AM', status: 'Escalated' },
    { id: 'ALT-104', level: 'High', location: 'Phek, Nagaland', message: 'Slope instability detected by satellite and sensor telemetry.', time: '10:28 AM', status: 'Field team assigned' },
    { id: 'ALT-103', level: 'Moderate', location: 'Tirap, Arunachal Pradesh', message: 'Soil moisture saturation has exceeded 78%.', time: '09:15 AM', status: 'Monitoring' },
    { id: 'ALT-102', level: 'Moderate', location: 'Mamit, Mizoram', message: 'Road blockage reported by field responders.', time: '08:03 AM', status: 'Clearance dispatched' }
  ],
  teams: [
    { name: 'NDRF Team Alpha', district: 'Dima Hasao, Assam', responders: 8, status: 'En route', eta: '24 min', equipment: 'Life detector, hydraulic cutters, satellite phone' },
    { name: 'SDRF Nagaland Unit 2', district: 'Phek, Nagaland', responders: 6, status: 'On site', eta: 'On site', equipment: 'Earth auger, chainsaws, trauma kit' },
    { name: 'Community Volunteers', district: 'Tirap, Arunachal Pradesh', responders: 12, status: 'Standby', eta: '42 min', equipment: 'VHF radios, first-aid kits, stretchers' },
    { name: 'Road Clearance Crew', district: 'Mamit, Mizoram', responders: 5, status: 'On site', eta: 'On site', equipment: 'Excavator, dozer, rock-breaker drill' }
  ],
  analytics: { sensorHealth: 98.7, onlineSensors: 124, monitoredDistricts: 27, rainfall24h: 186, trend: [42, 58, 70, 96, 88, 112, 186] },
  reports: [
    { id: 'RPT-008', title: 'Rockfall on NH-54 Highway', district: 'Mamit, Mizoram', priority: 'Severe', status: 'Dispatched', createdAt: '12 Aug 2026, 08:02 AM' },
    { id: 'RPT-007', title: 'Debris flow near Jatinga railway spur', district: 'Dima Hasao, Assam', priority: 'Critical', status: 'Investigating', createdAt: '12 Aug 2026, 11:35 AM' }
  ],
  settings: { rainfallAlertThreshold: 120, soilSaturationThreshold: 78, notificationsEnabled: true, rainfallAnimationEnabled: true }
};

function loadUsers() { if (fs.existsSync(userFile)) JSON.parse(fs.readFileSync(userFile, 'utf8')).forEach(user => users.set(user.email, user)); }
function saveUsers() { fs.mkdirSync(dataDirectory, { recursive: true }); fs.writeFileSync(userFile, JSON.stringify([...users.values()], null, 2), { mode: 0o600 }); }
function publicUser(user) { return { id: user.id, email: user.email, name: user.name, role: user.role }; }
function issueToken(user) { return jwt.sign({ sub: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '8h', issuer: 'neresq-api' }); }
async function seedInitialOperator() {
  const email = String(process.env.INITIAL_OPERATOR_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.INITIAL_OPERATOR_PASSWORD || '');
  if (!email || password.length < 12 || users.has(email)) return;
  const user = { id: crypto.randomUUID(), email, name: String(process.env.INITIAL_OPERATOR_NAME || 'NEResq Operator').slice(0, 80), role: 'operator', passwordHash: await bcrypt.hash(password, 12) };
  users.set(email, user); saveUsers(); console.log(`Initial NEResq operator account loaded for ${email}`);
}
function loginRateLimit(req, res, next) {
  const key = req.ip, now = Date.now(), record = attempts.get(key) || { count: 0, start: now };
  if (now - record.start > ATTEMPT_WINDOW_MS) { record.count = 0; record.start = now; }
  if (record.count >= MAX_ATTEMPTS) return res.status(429).json({ message: 'Too many login attempts. Try again in 15 minutes.' });
  req.loginAttempt = record; next();
}
function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try { req.auth = jwt.verify(token, jwtSecret, { issuer: 'neresq-api' }); next(); }
  catch { return res.status(401).json({ message: 'Your session has expired. Please sign in again.' }); }
}
function operatorRequired(req, res, next) {
  if (req.auth?.role !== 'operator') return res.status(403).json({ message: 'Guest accounts have view-only access.' });
  next();
}

app.use(helmet());
app.use(cors({ origin: allowedOrigin === '*' ? '*' : allowedOrigin.split(',').map(item => item.trim()) }));
app.use(express.json({ limit: '10kb' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'NEResq Authentication API' }));
app.post('/api/auth/register', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || ''), name = String(req.body.name || '').trim() || 'NEResq Operator';
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (password.length < 12) return res.status(400).json({ message: 'Use a password with at least 12 characters.' });
  if (inviteEmails.length && !inviteEmails.includes(email)) return res.status(403).json({ message: 'This email is not authorised for operator registration.' });
  if (users.has(email)) return res.status(409).json({ message: 'An account already exists for this email.' });
  const user = { id: crypto.randomUUID(), email, name: name.slice(0, 80), role: 'operator', passwordHash: await bcrypt.hash(password, 12) };
  users.set(email, user); saveUsers(); res.status(201).json({ token: issueToken(user), user: publicUser(user) });
});
app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || ''), user = users.get(email);
  const accepted = user && await bcrypt.compare(password, user.passwordHash);
  if (!accepted) { req.loginAttempt.count += 1; attempts.set(req.ip, req.loginAttempt); return res.status(401).json({ message: 'Email or password is incorrect.' }); }
  attempts.delete(req.ip); res.json({ token: issueToken(user), user: publicUser(user) });
});
app.post('/api/auth/guest', loginRateLimit, (req, res) => {
  const guest = { id: crypto.randomUUID(), email: 'guest@neresq.local', name: 'Guest Viewer', role: 'guest' };
  const token = jwt.sign({ sub: guest.id, email: guest.email, role: guest.role }, jwtSecret, { expiresIn: '2h', issuer: 'neresq-api' });
  res.json({ token, user: publicUser(guest) });
});
app.get('/api/auth/me', authRequired, (req, res) => { const user = [...users.values()].find(item => item.id === req.auth.sub); if (!user) return res.status(404).json({ message: 'Account not found.' }); res.json({ user: publicUser(user) }); });

app.get('/api/map', authRequired, (_req, res) => res.json(operationalData.map));
app.get('/api/risk-predictions', authRequired, (_req, res) => res.json({ predictions: operationalData.predictions }));
app.get('/api/alerts', authRequired, (_req, res) => res.json({ alerts: operationalData.alerts }));
app.get('/api/rescue-teams', authRequired, (_req, res) => res.json({ teams: operationalData.teams }));
app.get('/api/analytics', authRequired, (_req, res) => res.json(operationalData.analytics));
app.get('/api/reports', authRequired, (_req, res) => res.json({ reports: operationalData.reports }));
app.get('/api/settings', authRequired, (_req, res) => res.json(operationalData.settings));
app.post('/api/reports', authRequired, operatorRequired, (req, res) => {
  const title = String(req.body.title || '').trim(), district = String(req.body.district || '').trim(), details = String(req.body.details || '').trim();
  if (!title || !district || !details) return res.status(400).json({ message: 'Title, district, and incident details are required.' });
  const report = { id: `RPT-${String(operationalData.reports.length + 9).padStart(3, '0')}`, title: title.slice(0, 100), district: district.slice(0, 100), details: details.slice(0, 500), priority: 'New', status: 'Received', createdAt: new Date().toLocaleString('en-IN') };
  operationalData.reports.unshift(report); res.status(201).json({ report });
});
app.patch('/api/settings', authRequired, operatorRequired, (req, res) => { ['rainfallAlertThreshold', 'soilSaturationThreshold', 'notificationsEnabled', 'rainfallAnimationEnabled'].forEach(field => { if (field in req.body) operationalData.settings[field] = req.body[field]; }); res.json(operationalData.settings); });

loadUsers();
seedInitialOperator().then(() => app.listen(port, () => console.log(`NEResq API is running on port ${port}`)));

