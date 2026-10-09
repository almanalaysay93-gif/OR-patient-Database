import type { Db } from "../data/db";
import { calculateAge } from "./patients";

export interface AnalyticsSummary {
  uniquePatients: number;
  totalAdmissions: number;
  totalCases: number;
  uncodedCases: number;
  completedCases: number;
  inProgressCases: number;
  scheduledCases: number;
  cancelledCases: number;
  delayedCases: number;
  // Demographics
  sexDistribution: {
    male: number;
    malePct: number;
    female: number;
    femalePct: number;
    other: number;
    otherPct: number;
    missing: number;
    missingPct: number;
    total: number;
  };
  ageStats: {
    mean: number;
    median: number;
    min: number;
    max: number;
    missingCount: number;
    totalCount: number;
    distribution: { group: string; count: number; pct: number }[];
  };
  // Case priority
  caseTypes: { type: string; count: number; pct: number }[];
  // Statuses
  caseStatuses: { status: string; label: string; count: number; pct: number }[];
  // Specialties
  specialtyBreakdown: { specialty: string; count: number; pct: number }[];
  // Procedures
  topProcedures: { name: string; count: number; pct: number }[];
  // Post-Op destinations
  destinations: { destination: string; count: number; pct: number }[];
  // Complications
  complicationsSummary: {
    totalComplications: number;
    casesWithComplications: number;
    complicationRatePct: number;
    byCategory: { category: string; count: number }[];
  };
  followup30: {
    eligible: number;
    assessed: number;
    unreachable: number;
    pending: number;
    readmissions: number;
    reoperations: number;
    deaths: number;
    infections: number;
  };
}

export async function getAnalyticsSummary(
  db: Db,
  filter?: { startDate?: string; endDate?: string; specialtyId?: string }
): Promise<AnalyticsSummary> {
  let caseWhere = "WHERE 1=1";
  const caseParams: any[] = [];

  if (filter?.startDate) {
    caseWhere += " AND DATE(c.created_at) >= DATE(?)";
    caseParams.push(filter.startDate);
  }
  if (filter?.endDate) {
    caseWhere += " AND DATE(c.created_at) <= DATE(?)";
    caseParams.push(filter.endDate);
  }
  if (filter?.specialtyId) {
    caseWhere += " AND c.specialty_id = ?";
    caseParams.push(filter.specialtyId);
  }

  // 1. Core volume counts
  const cases = await db.select<any>(
    `SELECT c.case_id, c.patient_id, c.admission_id, c.case_type, c.case_status,
            c.planned_procedure_summary, s.name as specialty_name,
            p.date_of_birth, p.sex,
            sch.scheduled_date, sch.delay_minutes, incision.occurred_at as surgery_date
     FROM surgical_cases c
     JOIN patients p ON c.patient_id = p.patient_id
     LEFT JOIN specialties s ON c.specialty_id = s.specialty_id
     LEFT JOIN or_schedule sch ON sch.schedule_id =
       (SELECT s2.schedule_id FROM or_schedule s2 WHERE s2.case_id = c.case_id ORDER BY s2.created_at DESC LIMIT 1)
     LEFT JOIN case_events incision ON incision.case_id = c.case_id AND incision.event_type = 'INCISION'
     ${caseWhere}`,
    caseParams
  );

  const totalCases = cases.length;
  const uniquePatientIds = new Set(cases.map((c) => c.patient_id));
  const uniquePatients = uniquePatientIds.size;
  const uniqueAdmissionIds = new Set(cases.map((c) => c.admission_id));
  const totalAdmissions = uniqueAdmissionIds.size;

  let completedCases = 0;
  let inProgressCases = 0;
  let scheduledCases = 0;
  let cancelledCases = 0;
  let delayedCases = 0;

  for (const c of cases) {
    if (c.case_status === "COMPLETED") completedCases++;
    if (c.case_status === "IN_OR" || c.case_status === "PACU") inProgressCases++;
    if (c.case_status === "SCHEDULED") scheduledCases++;
    if (c.case_status === "CANCELLED") cancelledCases++;
    if (c.delay_minutes && c.delay_minutes > 0) delayedCases++;
  }

  // 2. Demographics (Patient-grain based on unique patients)
  let male = 0;
  let female = 0;
  let other = 0;
  let missingSex = 0;

  // Track unique patient demographics
  const patientSeen = new Map<string, { sex: string | null; dob: string | null; surgeryDate: string | null }>();
  for (const c of cases) {
    if (!patientSeen.has(c.patient_id)) {
      patientSeen.set(c.patient_id, { sex: c.sex, dob: c.date_of_birth, surgeryDate: c.surgery_date });
    } else if (!patientSeen.get(c.patient_id)?.surgeryDate && c.surgery_date) {
      patientSeen.get(c.patient_id)!.surgeryDate = c.surgery_date;
    }
  }

  const patientAges: number[] = [];
  let missingAgeCount = 0;

  for (const [, p] of patientSeen) {
    if (p.sex === "MALE") male++;
    else if (p.sex === "FEMALE") female++;
    else if (p.sex === "OTHER") other++;
    else missingSex++;

    const age = p.surgeryDate ? calculateAge(p.dob, p.surgeryDate) : null;
    if (age != null) patientAges.push(age);
    else missingAgeCount++;
  }

  const denom = uniquePatients || 1;
  const sexDistribution = {
    male,
    malePct: Math.round((male / denom) * 100),
    female,
    femalePct: Math.round((female / denom) * 100),
    other,
    otherPct: Math.round((other / denom) * 100),
    missing: missingSex,
    missingPct: Math.round((missingSex / denom) * 100),
    total: uniquePatients,
  };

  // Age statistics
  patientAges.sort((a, b) => a - b);
  const ageSum = patientAges.reduce((acc, v) => acc + v, 0);
  const meanAge = patientAges.length > 0 ? Math.round((ageSum / patientAges.length) * 10) / 10 : 0;
  const medianAge =
    patientAges.length > 0
      ? patientAges.length % 2 === 0
        ? (patientAges[patientAges.length / 2 - 1] + patientAges[patientAges.length / 2]) / 2
        : patientAges[Math.floor(patientAges.length / 2)]
      : 0;

  const ageGroups: Record<string, number> = {
    "0-17": 0,
    "18-35": 0,
    "36-50": 0,
    "51-65": 0,
    "66+": 0,
  };

  for (const a of patientAges) {
    if (a < 18) ageGroups["0-17"]++;
    else if (a <= 35) ageGroups["18-35"]++;
    else if (a <= 50) ageGroups["36-50"]++;
    else if (a <= 65) ageGroups["51-65"]++;
    else ageGroups["66+"]++;
  }

  const ageDistribution = Object.entries(ageGroups).map(([group, count]) => ({
    group,
    count,
    pct: Math.round((count / denom) * 100),
  }));

  const ageStats = {
    mean: meanAge,
    median: medianAge,
    min: patientAges.length > 0 ? patientAges[0] : 0,
    max: patientAges.length > 0 ? patientAges[patientAges.length - 1] : 0,
    missingCount: missingAgeCount,
    totalCount: uniquePatients,
    distribution: ageDistribution,
  };

  // 3. Case types
  const typeMap = new Map<string, number>();
  for (const c of cases) {
    typeMap.set(c.case_type, (typeMap.get(c.case_type) || 0) + 1);
  }
  const caseDenom = totalCases || 1;
  const caseTypes = Array.from(typeMap.entries()).map(([type, count]) => ({
    type,
    count,
    pct: Math.round((count / caseDenom) * 100),
  }));

  // 4. Case statuses
  const statusMap = new Map<string, number>();
  for (const c of cases) {
    statusMap.set(c.case_status, (statusMap.get(c.case_status) || 0) + 1);
  }
  const caseStatuses = Array.from(statusMap.entries()).map(([status, count]) => ({
    status,
    label: status.replace(/_/g, " "),
    count,
    pct: Math.round((count / caseDenom) * 100),
  }));

  // 5. Specialty breakdown
  const specMap = new Map<string, number>();
  for (const c of cases) {
    const s = c.specialty_name || "Unassigned";
    specMap.set(s, (specMap.get(s) || 0) + 1);
  }
  const specialtyBreakdown = Array.from(specMap.entries())
    .map(([specialty, count]) => ({
      specialty,
      count,
      pct: Math.round((count / caseDenom) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // 6. Procedures
  const caseIds = new Set(cases.map((c) => c.case_id));
  const codedRows = await db.select<{
    case_id: string; procedure_id: string; name: string; code: string | null; code_system: string | null;
  }>(
    `SELECT cp.case_id, p.procedure_id, p.procedure_name AS name,
            p.procedure_code AS code, p.code_system
     FROM case_procedures cp JOIN procedures p ON p.procedure_id = cp.procedure_id`);
  // Group by catalog identity, not by name: two terms can share a name.
  const procMap = new Map<string, { name: string; code: string | null; codeSystem: string | null; count: number }>();
  const codedCaseIds = new Set<string>();
  for (const row of codedRows) {
    if (!caseIds.has(row.case_id)) continue;
    codedCaseIds.add(row.case_id);
    const entry = procMap.get(row.procedure_id);
    if (entry) entry.count++;
    else procMap.set(row.procedure_id, { name: row.name, code: row.code, codeSystem: row.code_system, count: 1 });
  }
  const uncodedCases = totalCases - codedCaseIds.size;
  const nameUses = new Map<string, number>();
  for (const p of procMap.values()) nameUses.set(p.name, (nameUses.get(p.name) || 0) + 1);
  const topProcedures = Array.from(procMap.values())
    .map((p) => {
      const code = [p.codeSystem, p.code].filter(Boolean).join(" ");
      return {
        name: (nameUses.get(p.name) || 0) > 1 && code ? `${p.name} (${code})` : p.name,
        count: p.count,
        pct: Math.round((p.count / caseDenom) * 100),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // 7. Post-Op Destinations
  const destRows = await db.select<any>(
    `SELECT d.name as destination, COUNT(*) as count
     FROM post_or_records r
     JOIN post_op_destinations d ON r.post_op_destination_id = d.destination_id
     JOIN surgical_cases c ON r.case_id = c.case_id
     ${caseWhere}
     GROUP BY d.name
     ORDER BY count DESC`,
    caseParams
  );
  const destinations = destRows.map((d: any) => ({
    destination: d.destination,
    count: d.count,
    pct: Math.round((d.count / caseDenom) * 100),
  }));

  // 8. Complications
  const compRows = await db.select<any>(
    `SELECT ct.category, COUNT(*) as count
     FROM complications cp
     JOIN complication_types ct ON cp.complication_type_id = ct.complication_type_id
     JOIN surgical_cases c ON cp.case_id = c.case_id
     ${caseWhere}
     GROUP BY ct.category
     ORDER BY count DESC`,
    caseParams
  );
  const totalComplications = compRows.reduce((acc: number, r: any) => acc + r.count, 0);

  const casesWithCompRows = await db.select<any>(
    `SELECT COUNT(DISTINCT cp.case_id) as count
     FROM complications cp
     JOIN surgical_cases c ON cp.case_id = c.case_id
     ${caseWhere}`,
    caseParams
  );
  const casesWithComp = casesWithCompRows[0]?.count ?? 0;

  const complicationsSummary = {
    totalComplications,
    casesWithComplications: casesWithComp,
    complicationRatePct: Math.round((casesWithComp / caseDenom) * 100),
    byCategory: compRows.map((r: any) => ({ category: r.category, count: r.count })),
  };

  const followupRows = await db.select<{
    case_id: string; status: string | null; event_type: string | null;
  }>(
    `SELECT c.case_id, f.status, o.event_type
     FROM surgical_cases c
     LEFT JOIN case_followup_assessments f ON f.case_id = c.case_id AND f.target_day = 30
     LEFT JOIN postoperative_outcomes o ON o.case_id = c.case_id
     ${caseWhere} AND c.case_status = 'COMPLETED'`,
    caseParams,
  );
  const followupByCase = new Map<string, { status: string | null; events: Set<string> }>();
  for (const row of followupRows) {
    if (!followupByCase.has(row.case_id)) followupByCase.set(row.case_id, { status: row.status, events: new Set() });
    if (row.event_type) followupByCase.get(row.case_id)!.events.add(row.event_type);
  }
  const followup30 = {
    eligible: followupByCase.size,
    assessed: 0, unreachable: 0, pending: 0,
    readmissions: 0, reoperations: 0, deaths: 0, infections: 0,
  };
  for (const item of followupByCase.values()) {
    if (item.status === "ASSESSED") followup30.assessed++;
    else if (item.status === "UNREACHABLE") followup30.unreachable++;
    else followup30.pending++;
    if (item.events.has("READMISSION")) followup30.readmissions++;
    if (item.events.has("UNPLANNED_REOPERATION")) followup30.reoperations++;
    if (item.events.has("DEATH")) followup30.deaths++;
    if (item.events.has("SURGICAL_SITE_INFECTION")) followup30.infections++;
  }

  return {
    uniquePatients,
    totalAdmissions,
    totalCases,
    uncodedCases,
    completedCases,
    inProgressCases,
    scheduledCases,
    cancelledCases,
    delayedCases,
    sexDistribution,
    ageStats,
    caseTypes,
    caseStatuses,
    specialtyBreakdown,
    topProcedures,
    destinations,
    complicationsSummary,
    followup30,
  };
}
