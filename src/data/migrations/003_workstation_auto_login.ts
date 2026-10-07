/**
 * Migration 003 - Workstation auto-login and zero-prompt setup.
 * Ensures an active default workstation user exists and marks initial setup complete
 * so single-workstation users are never prompted with account setup or passwords.
 */
const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const M003_AUTO_LOGIN = [
  `INSERT OR IGNORE INTO users (user_id, username, full_name, password_hash, role_id, active, must_change_password, created_at, updated_at)
   VALUES ('usr-admin', 'admin', 'Clinical Administrator', '', 'role-admin', 1, 0, ${now}, ${now});`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('setup_complete', '1');`,
  `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_login', '1');`,
].join("\n");
