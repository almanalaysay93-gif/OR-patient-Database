/**
 * Migration 021 - passwords an administrator sets for a staff account (new account or reset)
 * can be kept so an administrator can look them up later. A row is removed as soon as the
 * staff member chooses their own password, so a password the user picked is never readable.
 */
export const M021_STAFF_SAVED_PASSWORDS = [
  `CREATE TABLE IF NOT EXISTS staff_saved_passwords (
     user_id TEXT PRIMARY KEY REFERENCES users(user_id),
     password TEXT NOT NULL,
     saved_by TEXT REFERENCES users(user_id),
     saved_at TEXT NOT NULL
   );`,
].join("\n");
