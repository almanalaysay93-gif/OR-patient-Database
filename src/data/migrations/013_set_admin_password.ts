/**
 * Migration 013 - sets the master administrator password to the station default
 * and resets must_change_password to 0 for immediate station access.
 * An administrator password that was already changed by the user is preserved.
 */
import { ADMIN_HASH } from "./010_master_admin_login";

const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
export const TRANSPLANT_ADMIN_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$ROfsntY5FoQ7+goKcrS8JQ$8u++sKJg+kQt8VfTiYNqjW7yKzOh4rjgtCBS2/iiwis";

export const M013_SET_ADMIN_PASSWORD = [
  `UPDATE users SET password_hash = '${TRANSPLANT_ADMIN_HASH}', must_change_password = 0, updated_at = ${now}
   WHERE user_id = 'usr-admin' AND (password_hash = '' OR password_hash = '${ADMIN_HASH}' OR password_hash = '${TRANSPLANT_ADMIN_HASH}');`,
].join("\n");
