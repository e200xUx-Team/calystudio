/**
 * server.js — The ePlane Co. Clay Studio Full-Stack Server
 *
 * Architecture:
 *  - Express + SQLite (better-sqlite3)
 *  - JWT in httpOnly cookies (no localStorage tokens)
 *  - @eplane.ai domain restriction on signup
 *  - Admin approval flow (pending → approved)
 *  - Hardcoded admin emails (search ADMIN_EMAILS to change)
 *  - All data routes protected: must be logged in + approved
 */
// Force Vercel to bundle the sql.js WebAssembly file
try {
  const fs = require('fs');
  const path = require('path');
  fs.readFileSync(path.join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'));
} catch (e) {}
'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initDB } = require('./db/init');

/* ════════════════════════════════════════════
   CONFIG  — change these before deploying
   ════════════════════════════════════════════ */

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'eplane-studio-secret-change-in-production';
const JWT_EXPIRY = '7d';

// ── CHANGE THESE to your real admin emails ──────────────────
const ADMIN_EMAILS = [
  'rahul.sp@eplane.ai',
  'rajan.sunjay@eplane.ai',
];
// ────────────────────────────────────────────────────────────

const ALLOWED_DOMAIN = '@eplane.ai';

/* ════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════ */

const app = express();
let db;

// CORS middleware to support local frontend development (e.g. Live Server on port 5500)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = ['http://localhost:5500', 'http://127.0.0.1:5500'];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ════════════════════════════════════════════
   MIDDLEWARE
   ════════════════════════════════════════════ */

/** Verify JWT cookie and attach user to req */
function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Re-fetch from DB to get latest status/role
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    if (user.status === 'rejected') return res.status(403).json({ error: 'Your account has been rejected.' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Your account is pending admin approval.', pending: true });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

/** Must be admin */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

/* ════════════════════════════════════════════
   AUTH ROUTES
   ════════════════════════════════════════════ */

/** POST /api/auth/signup */
app.post('/api/auth/signup', (req, res) => {
  const { email, name, password } = req.body;

  // Validation
  if (!email || !name || !password)
    return res.status(400).json({ error: 'Email, name, and password are required.' });

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  if (!cleanEmail.endsWith(ALLOWED_DOMAIN))
    return res.status(400).json({
      error: `Only ${ALLOWED_DOMAIN} email addresses are allowed to register.`,
    });

  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  // Check if already exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  // Determine role & status
  const isAdmin = ADMIN_EMAILS.includes(cleanEmail);
  const role = isAdmin ? 'admin' : 'user';
  const status = isAdmin ? 'approved' : 'pending';

  const hash = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO users (email, name, password, role, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleanEmail, cleanName, hash, role, status);

  if (isAdmin) {
    // Admin: auto-login
    const token = jwt.sign({ id: result.lastInsertRowid, role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.cookie('token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ ok: true, name: cleanName, role, status: 'approved' });
  }

  // Regular user: account created but pending
  return res.status(202).json({
    ok: true,
    pending: true,
    message: 'Account created. Waiting for admin approval before you can log in.',
  });
});

/** POST /api/auth/login */
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password.' });

  if (user.status === 'rejected')
    return res.status(403).json({ error: 'Your account has been rejected. Contact an admin.' });

  if (user.status === 'pending')
    return res.status(403).json({
      error: 'Your account is pending admin approval. You will be notified once approved.',
      pending: true,
    });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.cookie('token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 7 * 24 * 3600 * 1000 });

  return res.json({ ok: true, name: user.name, role: user.role, email: user.email });
});

/** POST /api/auth/forgot-password — logs a reset request for admin to action */
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail.endsWith('@eplane.ai'))
    return res.status(400).json({ error: 'Only @eplane.ai accounts are permitted.' });

  const user = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(cleanEmail);
  // Always return success (don't reveal if account exists)
  // In production, send an email here. For now, log it for admin awareness.
  if (user) {
    console.log(`[Password Reset Request] User: ${user.name} <${user.email}> at ${new Date().toISOString()}`);
  }
  return res.json({ ok: true, message: 'Reset request received.' });
});

/** POST /api/auth/logout */
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

/** GET /api/auth/me — check current session */
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.json({ loggedIn: false });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(payload.id);
    if (!user || user.status !== 'approved') return res.json({ loggedIn: false });
    return res.json({ loggedIn: true, name: user.name, role: user.role, email: user.email });
  } catch (e) {
    return res.json({ loggedIn: false });
  }
});

/* ════════════════════════════════════════════
   INVENTORY ROUTES  (auth required)
   ════════════════════════════════════════════ */

app.get('/api/inventory', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM inventory ORDER BY id').all();
  res.json(rows.map(dbRowToInvItem));
});

app.post('/api/inventory', requireAuth, (req, res) => {
  const { name, cat, unit, price, total, used, threshold, project_id, mr_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });

  const usedClamped = Math.min(parseFloat(used) || 0, parseFloat(total) || 0);

  const r = db.prepare(`
    INSERT INTO inventory (name, cat, unit, price, total, used, threshold, project_id, mr_number, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    name,
    cat || 'Other',
    unit || 'units',
    parseFloat(price) || 0,
    parseFloat(total) || 0,
    usedClamped,
    parseFloat(threshold) || 1,
    project_id || '',
    mr_number || '',
  );

  const row = db.prepare('SELECT * FROM inventory WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(dbRowToInvItem(row));
});

app.put('/api/inventory/:id', requireAuth, (req, res) => {
  const { name, cat, unit, price, total, used, threshold, project_id, mr_number } = req.body;
  const id = parseInt(req.params.id);

  const existing = db.prepare('SELECT id FROM inventory WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  const usedClamped = Math.min(parseFloat(used) || 0, parseFloat(total) || 0);

  db.prepare(`
    UPDATE inventory SET
      name = ?, cat = ?, unit = ?, price = ?, total = ?,
      used = ?, threshold = ?, project_id = ?, mr_number = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, cat, unit,
    parseFloat(price) || 0,
    parseFloat(total) || 0,
    usedClamped,
    parseFloat(threshold) || 1,
    project_id || '', mr_number || '', id,
  );

  const row = db.prepare('SELECT * FROM inventory WHERE id = ?').get(id);
  res.json(dbRowToInvItem(row));
});

app.delete('/api/inventory/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM inventory WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   PROJECTS ROUTES  (auth required)
   ════════════════════════════════════════════ */

app.get('/api/projects', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at').all();
  res.json(rows.map(dbRowToProject));
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, desc, budget, progress, status, deadline } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required.' });

  const id = 'p' + Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, desc, budget, progress, status, deadline, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, name, desc || '', parseFloat(budget) || 0,
    Math.min(100, Math.max(0, parseInt(progress) || 0)),
    status || 'active', deadline || '',
  );

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.status(201).json(dbRowToProject(row));
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const { name, desc, budget, progress, status, deadline } = req.body;
  const id = req.params.id;

  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });

  db.prepare(`
    UPDATE projects SET
      name = ?, desc = ?, budget = ?, progress = ?,
      status = ?, deadline = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, desc || '', parseFloat(budget) || 0,
    Math.min(100, Math.max(0, parseInt(progress) || 0)),
    status || 'active', deadline || '', id,
  );

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  res.json(dbRowToProject(row));
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  // Unlink inventory items from this project
  db.prepare("UPDATE inventory SET project_id = '' WHERE project_id = ?").run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   TASKS ROUTES  (auth required)
   ════════════════════════════════════════════ */

app.get('/api/tasks', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all();
  res.json(rows.map(dbRowToTask));
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const { name, due, priority, status, assign } = req.body;
  if (!name) return res.status(400).json({ error: 'Task name is required.' });

  const r = db.prepare(`
    INSERT INTO tasks (name, due, priority, status, assign, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(name, due || '', priority || 'medium', status || 'upcoming', assign || 'Studio');

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(dbRowToTask(row));
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const { name, due, priority, status, assign } = req.body;
  const id = parseInt(req.params.id);

  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Task not found.' });

  db.prepare(`
    UPDATE tasks SET
      name = ?, due = ?, priority = ?, status = ?,
      assign = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, due || '', priority || 'medium', status || 'upcoming', assign || 'Studio', id);

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.json(dbRowToTask(row));
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   ADMIN ROUTES  (auth + admin role required)
   ════════════════════════════════════════════ */

/** GET /api/admin/users — list all users */
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, name, role, status, created_at FROM users ORDER BY created_at DESC
  `).all();
  res.json(users);
});

/** PATCH /api/admin/users/:id — approve or reject */
app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body;
  const id = parseInt(req.params.id);

  if (!['approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Status must be approved or rejected.' });

  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // Prevent demoting admins
  if (user.role === 'admin')
    return res.status(400).json({ error: 'Cannot change admin account status.' });

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  res.json({ ok: true });
});

/* ════════════════════════════════════════════
   DATA SHAPE HELPERS
   ════════════════════════════════════════════ */

function dbRowToInvItem(row) {
  return {
    id: row.id,
    name: row.name,
    cat: row.cat,
    unit: row.unit,
    price: row.price,
    total: row.total,
    used: row.used,
    threshold: row.threshold,
    project: row.project_id || '',
    mrNumber: row.mr_number || '',
  };
}

function dbRowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    desc: row.desc || '',
    budget: row.budget,
    progress: row.progress,
    status: row.status,
    deadline: row.deadline || '',
  };
}

function dbRowToTask(row) {
  return {
    id: row.id,
    name: row.name,
    due: row.due || '',
    priority: row.priority,
    status: row.status,
    assign: row.assign || 'Studio',
  };
}

/* ════════════════════════════════════════════
   CATCH-ALL — serve index.html for SPA routing
   ════════════════════════════════════════════ */

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ════════════════════════════════════════════
   START
   ════════════════════════════════════════════ */

initDB().then(database => {
  db = database;
  app.listen(PORT, () => {
    console.log(`\n🎨 The ePlane Co. Clay Studio`);
    console.log(`   Running at: http://localhost:${PORT}`);
    console.log(`   Domain restriction: *${ALLOWED_DOMAIN} only`);
    console.log(`   Admins: ${ADMIN_EMAILS.join(', ')}\n`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
