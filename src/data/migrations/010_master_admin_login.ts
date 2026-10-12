/**
 * Migration 010 - password sign-in replaces workstation auto-login.
 * Gives the built-in administrator a real Argon2id password hash and turns
 * auto-login off. An administrator password that was already set is kept.
 */
const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
export const ADMIN_HASH = "$argon2id$v=19$m=65536,t=3,p=1$UAg2haPNSdIA4C8wZ3Fihg$fohSS6Dc0QvSjKv0ZiZ4dOclyVzI/80NF1MK8RdPM/Q";

export const M010_MASTER_ADMIN_LOGIN = [
  `INSERT OR IGNORE INTO users (user_id, username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
   VALUES ('usr-admin', 'admin', 'Clinical Administrator', '', 'role-admin', 1, 0, ${now}, ${now});`,
  `UPDATE users SET password_hash = '${ADMIN_HASH}', role_id = 'role-admin', active = 1, updated_at = ${now}
   WHERE username = 'admin' AND password_hash = '';`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_login', '0');`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('setup_complete', '1');`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('idle_lock_minutes', '60');`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_backup_enabled', '1');`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_backup_interval_hours', '24');`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_backup_keep', '14');`,
].join("\n");
