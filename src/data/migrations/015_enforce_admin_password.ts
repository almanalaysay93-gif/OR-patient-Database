/**
 * Migration 015 - guarantees the master administrator password is transplant@123
 * across all existing installations, matching both username 'admin' and user_id 'usr-admin'.
 * Sets must_change_password to 0 for immediate workstation access.
 */
import { TRANSPLANT_ADMIN_HASH } from "./013_set_admin_password";

const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const M015_ENFORCE_ADMIN_PASSWORD = [
  `UPDATE users SET password_hash = '${TRANSPLANT_ADMIN_HASH}', must_change_password = 0, active = 1, updated_at = ${now}
   WHERE username = 'admin' OR user_id = 'usr-admin';`,
].join("\n");
