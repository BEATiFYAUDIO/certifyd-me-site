import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveUserRole } from './config.js';

const VALID_ROLES = new Set(['founder', 'editor', 'writer', 'marketing', 'developer', 'viewer']);

export class DashboardUserRepository {
  constructor(config) {
    this.config = config;
    this.db = openDatabase(config.databasePath);
    this.ensureSchema();
    this.bootstrapIfEmpty();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dashboard_users_email ON users(email);
    `);
  }

  bootstrapIfEmpty() {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count > 0) return;
    const candidates = [];
    for (const email of this.config.founderEmails) candidates.push({ email, role: 'founder' });
    for (const [role, emails] of Object.entries(this.config.bootstrapRoleEmails || {})) {
      for (const email of emails) candidates.push({ email, role });
    }
    const seen = new Set();
    for (const candidate of candidates) {
      const email = String(candidate.email || '').trim().toLowerCase();
      if (!email || seen.has(email) || !VALID_ROLES.has(candidate.role)) continue;
      seen.add(email);
      this.upsertUser({ email, displayName: email, role: candidate.role, enabled: true });
    }
  }

  resolveAuthenticatedUser(identity) {
    const email = String(identity?.email || '').trim().toLowerCase();
    if (!email) return null;
    const user = this.db.prepare('SELECT * FROM users WHERE lower(email) = ? AND enabled = 1').get(email);
    if (!user) return null;
    this.db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.display_name || user.email,
      role: user.role,
    };
  }

  upsertUser({ email, displayName = '', role, enabled = true }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('User email is required.');
    if (!VALID_ROLES.has(role)) throw new Error(`Invalid dashboard role: ${role}`);
    const id = this.findUserId(cleanEmail) || `user_${cryptoRandomId()}`;
    this.db.prepare(`
      INSERT INTO users (id, email, display_name, role, enabled)
      VALUES (@id, @email, @displayName, @role, @enabled)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        role = excluded.role,
        enabled = excluded.enabled
    `).run({ id, email: cleanEmail, displayName, role, enabled: enabled ? 1 : 0 });
    return id;
  }

  findUserId(email) {
    return this.db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(String(email).toLowerCase())?.id || null;
  }

  listUsers() {
    return this.db.prepare('SELECT id, email, display_name, role, enabled, created_at, last_login_at FROM users ORDER BY created_at ASC, email ASC').all();
  }

  bootstrapRoleFor(identity) {
    return resolveUserRole(identity, this.config);
  }
}

function openDatabase(databasePath) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  return new Database(databasePath);
}

function cryptoRandomId() {
  return crypto.randomUUID().replace(/-/g, '');
}
