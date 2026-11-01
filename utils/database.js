// utils/database.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// --- PASSWORD HASHING (Native node:crypto scrypt) ---
function hashPassword(password) {
  if (!password) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  try {
    if (stored.startsWith('scrypt:')) {
      const parts = stored.split(':');
      if (parts.length !== 3) return false;
      const [, salt, hash] = parts;
      const keyBuffer = Buffer.from(hash, 'hex');
      const derived = crypto.scryptSync(password, salt, keyBuffer.length);
      return crypto.timingSafeEqual(keyBuffer, derived);
    }
    // Backward compatibility for legacy plaintext passwords
    return password === stored;
  } catch {
    return false;
  }
}

const dbPath = process.env.PORTAL_DB_PATH || path.resolve(__dirname, '..', 'portal.db');
if (dbPath !== ':memory:') {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new Database(dbPath);

// --- 1. SCHEMA INITIALIZATION ---
db.exec(`
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    reference_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Sessions
  CREATE TABLE IF NOT EXISTS sessions (
    ip_address TEXT PRIMARY KEY,
    user_id INTEGER,
    authorized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  -- Admin (with default user)
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- DNS Logs
  CREATE TABLE IF NOT EXISTS dns_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_ip TEXT NOT NULL,
    domain TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Portal Settings
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// --- 2. DEFAULT ADMIN SETUP ---
const adminCount = db.prepare('SELECT COUNT(*) AS count FROM admin').get().count;
if (adminCount === 0) {
  const defaultAdminUser = process.env.DEFAULT_ADMIN_USER || 'admin';
  const defaultAdminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO admin (username, password, role) VALUES (?, ?, ?)')
    .run(defaultAdminUser, hashPassword(defaultAdminPass), 'admin');
  console.log(`[DB] Default admin created: ${defaultAdminUser} / [PROTECTED]`);
}

const { getLocalIpAddress } = require('../utils/network');

// --- 3. DEFAULT SETTINGS SETUP ---
const defaultSettings = [
  ['server_ip', getLocalIpAddress()],
  ['local_domain', 'myportal.sc'],
  ['session_hours', '24'],
  ['is_setup_done', 'false'],
  ['background_image', '/images/bg3.jpg'],
  ['enterprise_name', "Minami Captive Portal"],
  ['enterprise_tagline', "By Pratykash-ops on github.com"],
  ['enable_enterprise_branding', 'false']
];
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of defaultSettings) {
  insertSetting.run(k, v);
}

// --- 4. CRUD FUNCTIONS ---

// USERS CRUD
const users = {
  create(username, password, reference_number = '') {
    const hashedPassword = hashPassword(password);
    const stmt = db.prepare('INSERT INTO users (username, password, reference_number) VALUES (?, ?, ?)');
    const info = stmt.run(username.trim(), hashedPassword, reference_number ? String(reference_number).trim() : null);
    return this.getById(info.lastInsertRowid);
  },
  getById(id) {
    return db.prepare('SELECT id, username, reference_number, created_at FROM users WHERE id = ?').get(id) || null;
  },
  getByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
  },
  authenticate(username, password) {
    const row = db.prepare('SELECT id, username, password, reference_number FROM users WHERE username = ?').get(username.trim());
    if (!row) return null;
    if (verifyPassword(password, row.password)) {
      if (!row.password.startsWith('scrypt:')) {
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), row.id);
      }
      return { id: row.id, username: row.username, reference_number: row.reference_number };
    }
    return null;
  },
  getAll() {
    return db.prepare('SELECT id, username, reference_number, created_at FROM users ORDER BY id DESC').all();
  },
  update(id, data = {}) {
    const user = this.getById(id);
    if (!user) return null;
    const newUsername = data.username !== undefined ? data.username : user.username;
    let newPassword;
    if (data.password !== undefined && data.password !== '') {
      newPassword = hashPassword(data.password);
    } else {
      newPassword = db.prepare('SELECT password FROM users WHERE id = ?').get(id).password;
    }
    const newRef = data.reference_number !== undefined ? data.reference_number : user.reference_number;
    db.prepare('UPDATE users SET username = ?, password = ?, reference_number = ? WHERE id = ?')
      .run(newUsername, newPassword, newRef, id);
    return this.getById(id);
  },
  delete(id) {
    return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  },
  count() {
    return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  }
};

// SESSIONS CRUD
const sessions = {
  create(ip_address, user_id = null, hours = 24) {
    const cleanIp = ip_address.replace('::ffff:', '').trim();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO sessions (ip_address, user_id, authorized_at, expires_at)
      VALUES (?, ?, datetime('now', 'localtime'), datetime('now', 'localtime', '+' || ? || ' hours'))
    `);
    stmt.run(cleanIp, user_id, hours);
    return this.get(cleanIp);
  },
  get(ip_address) {
    const cleanIp = ip_address.replace('::ffff:', '').trim();
    return db.prepare(`
      SELECT s.*, u.username, u.reference_number 
      FROM sessions s 
      LEFT JOIN users u ON s.user_id = u.id 
      WHERE s.ip_address = ?
    `).get(cleanIp) || null;
  },
  isAuthorized(ip_address) {
    const cleanIp = ip_address.replace('::ffff:', '').trim();
    const row = db.prepare(`
      SELECT ip_address FROM sessions 
      WHERE ip_address = ? AND expires_at > datetime('now', 'localtime')
    `).get(cleanIp);
    return !!row;
  },
  getAll() {
    return db.prepare(`
      SELECT s.*, u.username, u.reference_number 
      FROM sessions s 
      LEFT JOIN users u ON s.user_id = u.id 
      ORDER BY s.authorized_at DESC
    `).all();
  },
  delete(ip_address) {
    const cleanIp = ip_address.replace('::ffff:', '').trim();
    return db.prepare('DELETE FROM sessions WHERE ip_address = ?').run(cleanIp).changes > 0;
  },
  countActive() {
    return db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE expires_at > datetime('now', 'localtime')").get().count;
  }
};

// ADMIN CRUD
const admin = {
  get(username) {
    return db.prepare('SELECT id, username, role, created_at FROM admin WHERE username = ?').get(username.trim()) || null;
  },
  authenticate(username, password) {
    const row = db.prepare('SELECT id, username, password, role FROM admin WHERE username = ?').get(username.trim());
    if (!row) return null;
    if (verifyPassword(password, row.password)) {
      if (!row.password.startsWith('scrypt:')) {
        db.prepare('UPDATE admin SET password = ? WHERE id = ?').run(hashPassword(password), row.id);
      }
      return { id: row.id, username: row.username, role: row.role };
    }
    return null;
  },
  create(username, password, role = 'admin') {
    const hashedPassword = hashPassword(password);
    const info = db.prepare('INSERT INTO admin (username, password, role) VALUES (?, ?, ?)').run(username.trim(), hashedPassword, role);
    return { id: info.lastInsertRowid, username, role };
  },
  updatePassword(username, newPassword) {
    const hashedPassword = hashPassword(newPassword);
    return db.prepare('UPDATE admin SET password = ? WHERE username = ?').run(hashedPassword, username.trim()).changes > 0;
  },
  getAll() {
    return db.prepare('SELECT id, username, role, created_at FROM admin').all();
  },
  count() {
    return db.prepare('SELECT COUNT(*) AS count FROM admin').get().count;
  }
};

// --- DNS ASYNC BATCH LOGGING & RATE LIMITING ---
const dnsLogBuffer = [];
const ipRateLimits = new Map(); // IP -> { count, resetAt }

function checkDnsRateLimit(ip, maxPerSec = 60) {
  const now = Date.now();
  let record = ipRateLimits.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + 1000 };
    ipRateLimits.set(ip, record);
    return true;
  }
  record.count++;
  return record.count <= maxPerSec;
}

const insertDnsBatch = db.transaction((entries) => {
  const stmt = db.prepare('INSERT INTO dns_logs (client_ip, domain, action) VALUES (?, ?, ?)');
  for (const entry of entries) {
    stmt.run(entry.client_ip, entry.domain, entry.action);
  }
});

function flushDnsLogs() {
  if (dnsLogBuffer.length === 0) return 0;
  const entries = dnsLogBuffer.splice(0, dnsLogBuffer.length);
  try {
    insertDnsBatch(entries);
    return entries.length;
  } catch (err) {
    console.error('[DB] Failed to flush DNS logs:', err.message);
    return 0;
  }
}

const flushTimer = setInterval(flushDnsLogs, 2000);
if (flushTimer.unref) flushTimer.unref();

// DNS LOGS CRUD (High-Throughput In-Memory Buffer with Batch Transactions)
const dnsLogs = {
  log(client_ip, domain, action) {
    const cleanIp = client_ip.replace('::ffff:', '').trim();

    // DoS Protection: Rate-limit queries per client IP
    if (!checkDnsRateLimit(cleanIp)) {
      action = 'rate_limited';
    }

    dnsLogBuffer.push({ client_ip: cleanIp, domain, action });

    // Flush immediately if buffer exceeds threshold
    if (dnsLogBuffer.length >= 100) {
      flushDnsLogs();
    }

    return { client_ip: cleanIp, domain, action };
  },
  flush() {
    return flushDnsLogs();
  },
  getAll(limit = 100) {
    flushDnsLogs();
    return db.prepare('SELECT * FROM dns_logs ORDER BY id DESC LIMIT ?').all(limit);
  },
  clear() {
    dnsLogBuffer.length = 0;
    return db.prepare('DELETE FROM dns_logs').run().changes;
  },
  count() {
    flushDnsLogs();
    return db.prepare('SELECT COUNT(*) AS count FROM dns_logs').get().count;
  },
  getStats() {
    flushDnsLogs();
    const total = db.prepare('SELECT COUNT(*) AS count FROM dns_logs').get().count;
    const hijacked = db.prepare("SELECT COUNT(*) AS count FROM dns_logs WHERE action = 'hijacked'").get().count;
    const resolved = db.prepare("SELECT COUNT(*) AS count FROM dns_logs WHERE action IN ('resolved', 'server_bypass')").get().count;
    const errors = db.prepare("SELECT COUNT(*) AS count FROM dns_logs WHERE action = 'error'").get().count;
    return { total, hijacked, resolved, errors };
  }
};

// SETTINGS CRUD
const settings = {
  get(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  getAll() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    for (const r of rows) {
      obj[r.key] = r.value;
    }
    return obj;
  },
  set(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  },
  isSetupDone() {
    return this.get('is_setup_done') === 'true';
  },
  markSetupDone() {
    this.set('is_setup_done', 'true');
  }
};

module.exports = {
  db,
  users,
  sessions,
  admin,
  dnsLogs,
  settings,
  hashPassword,
  verifyPassword
};
