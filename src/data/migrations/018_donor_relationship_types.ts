/**
 * Migration 018 - Donor relationship types.
 *
 * Reference table for the "type of relation" dropdown. Each type belongs to the
 * RELATED or NON_RELATED donor group, and the baseline stores the chosen type.
 */
const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

const SEED: [string, string, "RELATED" | "NON_RELATED"][] = [
  ["drt-mother", "Mother", "RELATED"],
  ["drt-father", "Father", "RELATED"],
  ["drt-son", "Son", "RELATED"],
  ["drt-daughter", "Daughter", "RELATED"],
  ["drt-brother", "Brother", "RELATED"],
  ["drt-sister", "Sister", "RELATED"],
  ["drt-grandparent", "Grandparent", "RELATED"],
  ["drt-grandchild", "Grandchild", "RELATED"],
  ["drt-aunt-uncle", "Aunt / Uncle", "RELATED"],
  ["drt-niece-nephew", "Niece / Nephew", "RELATED"],
  ["drt-cousin", "Cousin", "RELATED"],
  ["drt-other-relative", "Other relative", "RELATED"],
  ["drt-spouse", "Spouse / Partner", "NON_RELATED"],
  ["drt-in-law", "In-law", "NON_RELATED"],
  ["drt-friend", "Friend", "NON_RELATED"],
  ["drt-altruistic", "Altruistic (non-directed)", "NON_RELATED"],
  ["drt-other-non-related", "Other non-related", "NON_RELATED"],
];

export const M018_DONOR_RELATIONSHIP_TYPES = /* sql */ `
CREATE TABLE donor_relationship_types (
  relationship_type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  donor_relation TEXT NOT NULL CHECK (donor_relation IN ('RELATED','NON_RELATED')),
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
${SEED.map(([id, name, group], i) =>
  `INSERT INTO donor_relationship_types (relationship_type_id, name, donor_relation, active, display_order, created_at) VALUES ('${id}', '${name}', '${group}', 1, ${i + 1}, ${now});`,
).join("\n")}
ALTER TABLE case_preop_baseline ADD COLUMN donor_relationship_type_id TEXT REFERENCES donor_relationship_types(relationship_type_id);
`;
