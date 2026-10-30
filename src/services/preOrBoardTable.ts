/** Search, stage filter and paging for the Pre-OR board table. Pure functions, no database access. */

import type { CaseStatus } from "./patients";

export const BOARD_PAGE_SIZE = 25;

export interface BoardRow {
  case_id: string;
  patient_id: string;
  case_status: CaseStatus;
  patient_name: string;
  hrn: string | null;
  case_number: string;
  planned_procedure_summary: string | null;
  room_name: string | null;
  readiness_percentage: number;
}

export function filterBoardRows(rows: BoardRow[], query: string, stage: CaseStatus | null): BoardRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (stage && r.case_status !== stage) return false;
    if (terms.length === 0) return true;
    const haystack = [r.patient_name, r.hrn, r.case_number, r.planned_procedure_summary, r.room_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export interface BoardPage {
  rows: BoardRow[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

/** Clamps the page to the valid range, so a shorter result set never shows an empty page. */
export function pageBoardRows(rows: BoardRow[], page: number, size = BOARD_PAGE_SIZE): BoardPage {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
    total,
  };
}
