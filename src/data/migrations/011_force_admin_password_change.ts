/**
 * Migration 011 - the built-in administrator password shipped in migration 010 is public.
 * While that password is still in place, the account is flagged so the first
 * sign-in must replace it. An administrator password that was already changed is left alone.
 */
import { ADMIN_HASH } from "./010_master_admin_login";

export const M011_FORCE_ADMIN_PASSWORD_CHANGE = [
  `UPDATE users SET must_change_password = 1 WHERE user_id = 'usr-admin' AND password_hash = '${ADMIN_HASH}';`,
].join("\n");
