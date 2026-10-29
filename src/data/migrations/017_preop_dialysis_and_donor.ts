/**
 * Migration 017 - Pre-op dialysis and donor assessment.
 *
 * Adds dialysis modality, dialysis access, years on dialysis and donor relation
 * to the preoperative baseline.
 */
export const M017_PREOP_DIALYSIS_AND_DONOR = /* sql */ `
ALTER TABLE case_preop_baseline ADD COLUMN dialysis_modality TEXT CHECK (dialysis_modality IS NULL OR dialysis_modality IN ('NONE','HEMODIALYSIS','PERITONEAL_DIALYSIS','UNKNOWN'));
ALTER TABLE case_preop_baseline ADD COLUMN dialysis_access TEXT CHECK (dialysis_access IS NULL OR dialysis_access IN ('AV_FISTULA','AV_GRAFT','TUNNELED_CATHETER','NON_TUNNELED_CATHETER','PD_CATHETER','OTHER'));
ALTER TABLE case_preop_baseline ADD COLUMN dialysis_years REAL CHECK (dialysis_years IS NULL OR (dialysis_years >= 0 AND dialysis_years <= 60));
ALTER TABLE case_preop_baseline ADD COLUMN donor_relation TEXT CHECK (donor_relation IS NULL OR donor_relation IN ('RELATED','NON_RELATED'));
`;
