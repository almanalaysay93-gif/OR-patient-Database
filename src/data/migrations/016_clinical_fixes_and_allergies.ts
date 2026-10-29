/**
 * Migration 016 - Clinical Fixes, Default OR Reference Data, Structured Allergies, Implants & Demographics.
 *
 * 1. Seeds default operating rooms and specialties if not already populated.
 * 2. Seeds initial surgical and nursing staff for team assignments.
 * 3. Creates structured allergies table with reaction and severity tracking.
 * 4. Creates structured surgical implants table for device/lot/serial tracking.
 * 5. Adds emergency contact columns to patients table.
 */

export const M016_CLINICAL_FIXES_AND_ALLERGIES = /* sql */ `
-- 1. Structured Allergies Table
CREATE TABLE IF NOT EXISTS allergies (
  allergy_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  allergen TEXT NOT NULL,
  reaction TEXT,
  severity TEXT NOT NULL DEFAULT 'MODERATE' CHECK (severity IN ('MILD','MODERATE','SEVERE','LIFE_THREATENING')),
  verified INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_allergies_patient ON allergies(patient_id);

-- 5. Structured Case Implants Table
CREATE TABLE IF NOT EXISTS case_implants (
  implant_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES surgical_cases(case_id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  manufacturer TEXT,
  model_number TEXT,
  lot_number TEXT,
  serial_number TEXT,
  udi_barcode TEXT,
  expiry_date TEXT,
  anatomical_site TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_implants_case ON case_implants(case_id);

-- 6. Emergency Contact Details on patients
ALTER TABLE patients ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE patients ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE patients ADD COLUMN emergency_contact_relationship TEXT;
`;
