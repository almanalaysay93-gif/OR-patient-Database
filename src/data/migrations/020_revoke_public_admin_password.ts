/**
 * Migration 020 - the password hashes shipped in migrations 010 and 013 belong to
 * passwords that are public in this repository. Any account that still uses one of
 * them must replace it at the next sign-in. A password that was already changed is left alone.
 */
import { ADMIN_HASH } from "./010_master_admin_login";
import { TRANSPLANT_ADMIN_HASH } from "./013_set_admin_password";

const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const M020_REVOKE_PUBLIC_ADMIN_PASSWORD = [
  `UPDATE users SET must_change_password = 1, updated_at = ${now}
   WHERE password_hash IN ('${TRANSPLANT_ADMIN_HASH}', '${ADMIN_HASH}');`,
].join("\n");
