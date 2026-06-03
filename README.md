# The ePlane Co. — Clay Studio Dashboard (Full-Stack)

A production-ready full-stack inventory & project management dashboard.
Built with Node.js + Express + SQLite + Vanilla JS. No React, no build step.

---

## 📁 Project Structure

```
eplane-fullstack/
├── server.js           ← Express server + all API routes
├── package.json        ← Dependencies & scripts
├── db/
│   ├── init.js         ← Schema creation + seed data
│   └── studio.db       ← SQLite database (auto-created on first run)
└── public/
    ├── index.html      ← App shell + all UI markup
    ├── styles.css      ← All styles (responsive)
    └── app.js          ← Client logic (fetch API, no localStorage)
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure admin emails *(important — do this before first run)*

Open `server.js` and find this block near the top:

```js
const ADMIN_EMAILS = [
  'rahul.sp@eplane.ai',   // ← Change to your real admin email    
  'rajan.sunjay@eplane.ai',   // ← Change to your real admin email
];
```

Also update the matching block in `db/init.js` (the seed section):

```js
const ADMIN_EMAILS = [
  { email: 'rahul.sp@eplane.ai', name: 'Admin One' },
  { email: 'rajan.sunjay@eplane.ai', name: 'Admin Two' },
];
```

### 3. Start the server
```bash
npm start
```

The database is created and seeded automatically on first run.

### 4. Open the app
```
http://localhost:3000
```

---

## 🔐 Authentication & Access Rules

| Rule | Detail |
|------|--------|
| **Domain restriction** | Only `@eplane.ai` email addresses can register. All others are rejected with a clear error message. |
| **Admin accounts** | The two emails in `ADMIN_EMAILS` are automatically given `role=admin` and `status=approved` on first signup. |
| **New users** | All other `@eplane.ai` signups default to `status=pending`. They cannot log in until an admin approves them. |
| **Pending login** | A pending user who tries to log in sees: *"Your account is pending admin approval."* |
| **Admin panel** | Admins see a **User Management** tab in the sidebar. They can approve ✓ or reject ✕ any pending user. |
| **JWT cookies** | Auth tokens are stored in `httpOnly` cookies — never in `localStorage`. They expire after 7 days. |
| **Protected routes** | Every `/api/inventory`, `/api/projects`, and `/api/tasks` endpoint requires a valid session + `approved` status. |

---

## 🗄️ Database Schema

```sql
users      (id, email, name, password, role, status, created_at)
inventory  (id, name, cat, unit, price, total, used, threshold, project_id, mr_number, created_at, updated_at)
projects   (id, name, desc, budget, progress, status, deadline, created_at, updated_at)
tasks      (id, name, due, priority, status, assign, created_at, updated_at)
```

**Role values:** `admin` | `user`
**Status values:** `pending` | `approved` | `rejected`

---

## 🌐 API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/signup` | Register (must be `@eplane.ai`) |
| `POST` | `/api/auth/login` | Login → sets httpOnly JWT cookie |
| `POST` | `/api/auth/logout` | Clears cookie |
| `GET`  | `/api/auth/me` | Check current session |

### Data (requires auth + approved status)
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/inventory` | Get all items |
| `POST`   | `/api/inventory` | Add item |
| `PUT`    | `/api/inventory/:id` | Update item |
| `DELETE` | `/api/inventory/:id` | Delete item |
| `GET`    | `/api/projects` | Get all projects |
| `POST`   | `/api/projects` | Add project |
| `PUT`    | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET`    | `/api/tasks` | Get all tasks |
| `POST`   | `/api/tasks` | Add task |
| `PUT`    | `/api/tasks/:id` | Update task |
| `DELETE` | `/api/tasks/:id` | Delete task |

### Admin (requires auth + admin role)
| Method | Path | Description |
|--------|------|-------------|
| `GET`   | `/api/admin/users` | List all users |
| `PATCH` | `/api/admin/users/:id` | Approve or reject a user |

---

## ⚙️ Environment Variables

For production, set these via your host's environment panel:

```bash
PORT=3000
JWT_SECRET=your-long-random-secret-string-here
```

If `JWT_SECRET` is not set, a default is used (fine for local dev, **change for production**).

---

## 🔄 Re-seeding the Database

To wipe the database and start fresh:

```bash
# Delete the existing database
rm db/studio.db

# Restart the server (auto-seeds on missing db)
npm start
```

Or run the init script directly:
```bash
node db/init.js
```

---

## 🚢 Deployment (e.g. Railway, Render, Fly.io)

1. Push the project to GitHub
2. Connect your repo to Railway/Render
3. Set environment variables: `JWT_SECRET`, optionally `PORT`
4. The start command is: `node server.js`
5. SQLite writes to `db/studio.db` — make sure your host supports persistent disk storage, or upgrade to PostgreSQL (see below)

### Upgrading to PostgreSQL

The SQL queries in `server.js` and `db/init.js` are standard SQL.
To switch from SQLite to PostgreSQL:

1. `npm install pg` and remove `better-sqlite3`
2. Replace `new Database(DB_PATH)` with a `pg.Pool` connection
3. Change `db.prepare('...').run(...)` → `await pool.query('...', [...])`
4. Change `db.prepare('...').get(...)` → `(await pool.query('...')).rows[0]`
5. Change `db.prepare('...').all()` → `(await pool.query('...')).rows`

---

## 🧑‍💻 Development Mode (auto-restart on file changes)

Requires Node.js 18+:

```bash
npm run dev
```

---

## 🔑 Default Admin Password

Seed admin accounts are created with password: **`Admin@123`**

**Change this immediately after first login** (or update the hash in `db/init.js` before first run).

---

## 📋 Core Logic Reference

```js
// Auto-Calc Engine — app.js → updateUsed()
const remaining = Math.max(0, item.total - newUsed);
// DOM updates instantly, then debounced PUT to /api/inventory/:id after 600ms

// Domain restriction — server.js → POST /api/auth/signup
if (!cleanEmail.endsWith('@eplane.ai'))
  return res.status(400).json({ error: 'Only @eplane.ai addresses are allowed.' });

// Status gate — server.js → requireAuth middleware
if (user.status === 'pending')
  return res.status(403).json({ error: 'Your account is pending admin approval.', pending: true });
```

---

© The ePlane Co. — Clay Studio Inventory System
