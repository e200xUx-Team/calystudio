/**
 * db/init.js — Database initialization & seed
 * Run once with: node db/init.js
 * (server.js also calls this automatically on first start)
 */

'use strict';

const { createDatabase } = require('./sqlite-shim');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'studio.db');

async function initDB() {
  const isNew = !fs.existsSync(DB_PATH);
  const db = await createDatabase(DB_PATH);

  db.pragma('journal_mode = WAL');   // Better concurrent read performance
  db.pragma('foreign_keys = ON');

  /* ══════════════════════════════════════
     SCHEMA
     ══════════════════════════════════════ */

  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      name       TEXT    NOT NULL,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'user'  CHECK(role   IN ('admin','user')),
      status     TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Inventory table
    CREATE TABLE IF NOT EXISTS inventory (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      cat        TEXT    NOT NULL DEFAULT 'Other',
      unit       TEXT    NOT NULL DEFAULT 'units',
      price      REAL    NOT NULL DEFAULT 0,
      total      REAL    NOT NULL DEFAULT 0,
      used       REAL    NOT NULL DEFAULT 0,
      threshold  REAL    NOT NULL DEFAULT 1,
      project_id TEXT    DEFAULT '',
      mr_number  TEXT    DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      desc       TEXT    DEFAULT '',
      budget     REAL    NOT NULL DEFAULT 0,
      progress   INTEGER NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','on-hold')),
      deadline   TEXT    DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Tasks table
    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      due        TEXT    DEFAULT '',
      priority   TEXT    NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
      status     TEXT    NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','overdue','done')),
      assign     TEXT    DEFAULT 'Studio',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  /* ══════════════════════════════════════
     SEED (only on first run)
     ══════════════════════════════════════ */

  if (isNew) {
    console.log('🌱 Seeding database with default data…');

    // ── Admin accounts ─────────────────────────────────
    // CHANGE THESE EMAILS to your actual admin addresses
    const ADMIN_EMAILS = [
      { email: 'rahul.sp@eplane.ai', name: 'Rahul Sakthevel', password: 'Rahul@150178' },
      { email: 'rajan.sunjay@eplane.ai', name: 'Rajan Sunjay', password: 'Pdux@2026' },
    ];

    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (email, name, password, role, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const admin of ADMIN_EMAILS) {
      const hash = bcrypt.hashSync(admin.password, 10);
      insertUser.run(admin.email, admin.name, hash, 'admin',);
      console.log(`  ✓ Admin: ${admin.email}`);
    }

    // ── Inventory ──────────────────────────────────────
    const insertInv = db.prepare(`
      INSERT INTO inventory (name, cat, unit, price, total, used, threshold, project_id, mr_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedInventory = [
      ['Polymer Clay – White', 'Clay & Armature', 'kg', 18, 10, 3, 2, '', 'MR-001'],
      ['Aluminum Wire 1.5mm', 'Clay & Armature', 'kg', 12, 5, 4.5, 1, 'p1', 'MR-002'],
      ['Acrylic Paint Set', 'Paints & Finishes', 'packs', 35, 4, 1, 1, '', 'MR-003'],
      ['Silicone Mold Rubber', 'Mold Materials', 'liters', 55, 3, 2.8, 0.5, 'p2', 'MR-004'],
      ['Sculpting Loop Tools', 'Sculpting Tools', 'units', 8, 12, 2, 3, '', 'MR-005'],
      ['Epoxy Primer Coat', 'Paints & Finishes', 'liters', 28, 6, 1.5, 1, 'p1', 'MR-006'],
    ];

    for (const row of seedInventory) insertInv.run(...row);
    console.log(`  ✓ ${seedInventory.length} inventory items`);

    // ── Projects ───────────────────────────────────────
    const insertProj = db.prepare(`
      INSERT INTO projects (id, name, desc, budget, progress, status, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const seedProjects = [
      ['p1', 'Dragon Scale Series', 'Fantasy dragon commission', 450, 65, 'active', '2025-08-30'],
      ['p2', 'Portrait Commission', 'Client: Mr. Ashoka', 280, 30, 'active', '2025-07-15'],
      ['p3', 'Studio Display Set', 'Internal display models', 180, 90, 'active', '2025-06-01'],
    ];

    for (const row of seedProjects) insertProj.run(...row);
    console.log(`  ✓ ${seedProjects.length} projects`);

    // ── Tasks ──────────────────────────────────────────
    const insertTask = db.prepare(`
      INSERT INTO tasks (name, due, priority, status, assign)
      VALUES (?, ?, ?, ?, ?)
    `);

    const seedTasks = [
      ['Clean kiln & check heating elements', '2025-05-10', 'high', 'overdue', 'Studio'],
      ['Restock polymer clay supply', '2025-05-28', 'high', 'upcoming', 'Jane'],
      ['Tool sterilization & storage', '2025-05-01', 'medium', 'done', 'Studio'],
      ['Update ventilation filter', '2025-06-05', 'medium', 'upcoming', 'Studio'],
      ['Check armature wire stock', '2025-05-20', 'low', 'upcoming', 'Jane'],
    ];

    for (const row of seedTasks) insertTask.run(...row);
    console.log(`  ✓ ${seedTasks.length} tasks`);

    console.log('✅ Database ready at', DB_PATH);
  }

  return db;
}

module.exports = { initDB };

// Allow running directly: node db/init.js
if (require.main === module) {
  initDB().then(() => {
    console.log('Done.');
  }).catch(err => {
    console.error(err);
  });
}
