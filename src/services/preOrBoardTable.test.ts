import { describe, expect, it } from "vitest";
import { BOARD_PAGE_SIZE, filterBoardRows, pageBoardRows, type BoardRow } from "./preOrBoardTable";

function row(i: number, overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    case_id: `case-${i}`,
    patient_id: `pat-${i}`,
    case_status: "PRE_OR",
    patient_name: `Patient ${i}`,
    hrn: `HRN-${String(i).padStart(3, "0")}`,
    case_number: `CASE-${460000 + i}`,
    planned_procedure_summary: "Open appendectomy",
    room_name: null,
    readiness_percentage: 0,
    ...overrides,
  };
}

describe("Pre-OR board search", () => {
  const rows: BoardRow[] = [
    row(1, { patient_name: "Julio Reyes", hrn: "007", planned_procedure_summary: "Total knee arthroplasty" }),
    row(2, { patient_name: "Imelda Cruz", case_status: "READY", room_name: "Demo OR 3", hrn: "1205" }),
    row(3, { patient_name: "Tomas Lee", case_status: "NOT_READY", case_number: "CASE-461021" }),
  ];

  it("matches patient name, HRN, case number, procedure and room, ignoring case", () => {
    expect(filterBoardRows(rows, "julio", null).map((r) => r.case_id)).toEqual(["case-1"]);
    expect(filterBoardRows(rows, "1205", null).map((r) => r.case_id)).toEqual(["case-2"]);
    expect(filterBoardRows(rows, "461021", null).map((r) => r.case_id)).toEqual(["case-3"]);
    expect(filterBoardRows(rows, "KNEE", null).map((r) => r.case_id)).toEqual(["case-1"]);
    expect(filterBoardRows(rows, "demo or 3", null).map((r) => r.case_id)).toEqual(["case-2"]);
  });

  it("requires every typed word to match, in any field", () => {
    expect(filterBoardRows(rows, "imelda demo", null).map((r) => r.case_id)).toEqual(["case-2"]);
    expect(filterBoardRows(rows, "imelda knee", null)).toEqual([]);
  });

  it("filters by stage and combines with the search", () => {
    expect(filterBoardRows(rows, "", "READY").map((r) => r.case_id)).toEqual(["case-2"]);
    expect(filterBoardRows(rows, "tomas", "READY")).toEqual([]);
    expect(filterBoardRows(rows, "   ", null)).toHaveLength(3);
  });
});

describe("Pre-OR board paging", () => {
  const many = Array.from({ length: 60 }, (_, i) => row(i + 1));

  it("shows one page of at most BOARD_PAGE_SIZE rows with a range label", () => {
    const p1 = pageBoardRows(many, 1);
    expect(BOARD_PAGE_SIZE).toBe(25);
    expect(p1.rows).toHaveLength(25);
    expect(p1).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 25, total: 60 });
    const p3 = pageBoardRows(many, 3);
    expect(p3.rows).toHaveLength(10);
    expect(p3).toMatchObject({ page: 3, from: 51, to: 60 });
  });

  it("clamps out-of-range pages so the table never shows an empty page", () => {
    expect(pageBoardRows(many, 99).page).toBe(3);
    expect(pageBoardRows(many, 0).page).toBe(1);
  });

  it("handles an empty result", () => {
    expect(pageBoardRows([], 1)).toMatchObject({ rows: [], page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
  });
});
