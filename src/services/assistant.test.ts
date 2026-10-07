import { describe, it, expect, beforeEach } from "vitest";
import { openMemoryDb } from "../data/sqljs-adapter";
import { runMigrations } from "../data/migrations";
import type { Db } from "../data/db";
import { createPatient, createAdmission, createSurgicalCase } from "./patients";
import { scheduleCase } from "./scheduling";
import { TOOL_DEFINITIONS, executeTool, type EntityMap } from "./assistantTools";
import {
  AssistantError,
  loadRedactionIndex,
  redactUserText,
  runAssistantTurn,
  saveAssistantConfig,
  getAssistantConfig,
  DEFAULT_MODEL,
} from "./assistant";

// Identifiers that must never appear in anything sent to the model.
const IDENTIFIERS = ["Juan", "Dela Cruz", "Reyes", "HRN-1001", "1990-01-01", "12 Mabini St", "09171234567", "ADM-"];

function expectDeidentified(value: unknown) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  for (const id of IDENTIFIERS) expect(json).not.toContain(id);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("AI assistant", () => {
  let db: Db;
  let entities: EntityMap;
  let patientId: string;
  let caseId: string;

  beforeEach(async () => {
    db = await openMemoryDb();
    await runMigrations(db);
    entities = new Map();

    await db.execute("INSERT INTO or_rooms (or_room_id, name, active, display_order) VALUES ('room-1', 'OR 1', 1, 1)");
    await db.execute("INSERT INTO specialties (specialty_id, name, active, display_order) VALUES ('spec-uro', 'Urology', 1, 1)");
    await db.execute("INSERT INTO staff (staff_id, full_name, professional_role, active, created_at, updated_at) VALUES ('staff-surg', 'Dr. Smith', 'Surgeon', 1, '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')");

    const p = await createPatient(db, {
      firstName: "Juan",
      middleName: "Reyes",
      lastName: "Dela Cruz",
      hrn: "HRN-1001",
      dateOfBirth: "1990-01-01",
      sex: "MALE",
      address: "12 Mabini St",
      contactNumber: "09171234567",
    });
    patientId = p.patient_id;
    const adm = await createAdmission(db, { patientId, admissionDate: "2026-10-06", ward: "Surgical Ward 3" });
    const c = await createSurgicalCase(db, {
      patientId,
      admissionId: adm.admission_id,
      caseNumber: "CASE-000101",
      caseType: "ELECTIVE",
      specialtyId: "spec-uro",
      plannedProcedureSummary: "Left Nephrectomy",
    });
    caseId = c.case_id;
    await scheduleCase(db, {
      caseId,
      roomId: "room-1",
      date: "2026-10-08",
      startTime: "08:00",
      estimatedDurationMinutes: 120,
      notes: "Call Juan Dela Cruz family before induction",
    });
    await db.execute(
      "INSERT INTO case_team (case_team_id, case_id, staff_id, role, created_at) VALUES ('ct-1', ?, 'staff-surg', 'team-1', '2026-10-07T00:00:00Z')",
      [caseId]
    );
  });

  describe("data tools", () => {
    it("returns the schedule without patient identifiers and records the local link", async () => {
      const result: any = await executeTool(db, "get_or_schedule", { date: "2026-10-08" }, entities);

      expect(result.case_count).toBe(1);
      expect(result.cases[0]).toMatchObject({
        case_number: "CASE-000101",
        room: "OR 1",
        procedure: "Left Nephrectomy",
        patient_research_id: "OR-000001",
        patient_age: 36,
        patient_sex: "MALE",
      });
      expect(result.cases[0].team).toEqual([{ role: expect.any(String), name: "Dr. Smith" }]);
      expectDeidentified(result);

      expect(entities.get("OR-000001")).toMatchObject({ kind: "patient", patientId, label: "Dela Cruz, Juan" });
      expect(entities.get("CASE-000101")).toMatchObject({ kind: "case", patientId, caseId });
    });

    it("keeps every tool de-identified", async () => {
      const calls: [string, Record<string, unknown>][] = [
        ["list_cases", {}],
        ["get_case", { case_number: "case-000101" }],
        ["find_patient", { query: "Dela Cruz, Juan" }],
        ["find_patient", { query: "HRN-1001" }],
        ["get_patient", { research_id: "OR-000001" }],
        ["get_preor_readiness", {}],
        ["get_analytics_summary", {}],
      ];
      for (const [name, args] of calls) {
        expectDeidentified(await executeTool(db, name, args, entities));
      }
      expect(TOOL_DEFINITIONS.map((t) => t.function.name).sort()).toEqual(
        [...new Set(calls.map(([name]) => name)), "get_or_schedule"].sort()
      );
    });

    it("finds a patient by name locally and returns only the research ID", async () => {
      const byName: any = await executeTool(db, "find_patient", { query: "juan dela cruz" }, entities);
      expect(byName.patients).toEqual([{ research_id: "OR-000001", age: 36, sex: "MALE", surgical_case_count: 1 }]);

      const none: any = await executeTool(db, "find_patient", { query: "Santos" }, entities);
      expect(none.match_count).toBe(0);
    });

    it("returns the full case record with readiness", async () => {
      const result: any = await executeTool(db, "get_case", { case_number: "CASE-000101" }, entities);
      expect(result.found).toBe(true);
      expect(result.patient.research_id).toBe("OR-000001");
      expect(result.admission.ward).toBe("Surgical Ward 3");
      expect(result.schedule[0]).toMatchObject({ scheduled_date: "2026-10-08", room: "OR 1" });
      expect(result.pre_or.checklist.length).toBeGreaterThanOrEqual(9);
      expect(result.pre_or.is_ready).toBe(false);

      const missing: any = await executeTool(db, "get_case", { case_number: "NOPE" }, entities);
      expect(missing.found).toBe(false);
    });

    it("filters and counts cases", async () => {
      const all: any = await executeTool(db, "list_cases", { specialty: "uro", scheduled_from: "2026-10-01" }, entities);
      expect(all.total_matching).toBe(1);
      const none: any = await executeTool(db, "list_cases", { status: "cancelled" }, entities);
      expect(none.total_matching).toBe(0);
      await expect(executeTool(db, "list_cases", { status: "BOGUS" }, entities)).rejects.toThrow(/status must be one of/);
      await expect(executeTool(db, "get_or_schedule", { date: "tomorrow" }, entities)).rejects.toThrow(/YYYY-MM-DD/);
    });

    it("groups ages above 89", async () => {
      await createPatient(db, { firstName: "Old", lastName: "Timer", dateOfBirth: "1930-01-01", sex: "FEMALE" });
      const result: any = await executeTool(db, "get_patient", { research_id: "or-2" }, entities);
      expect(result.age).toBe("90+");
    });
  });

  describe("redaction of typed identifiers", () => {
    it("replaces full names and HRNs with the research ID", async () => {
      const index = await loadRedactionIndex(db);
      expect(redactUserText("Is Juan Dela Cruz ready?", index, entities)).toBe("Is OR-000001 ready?");
      expect(redactUserText("status of DELA CRUZ, JUAN", index)).toBe("status of OR-000001");
      expect(redactUserText("juan reyes dela cruz today", index)).toBe("OR-000001 today");
      expect(redactUserText("look up hrn-1001 please", index)).toBe("look up OR-000001 please");
      expect(entities.get("OR-000001")?.patientId).toBe(patientId);
    });

    it("leaves ordinary text alone", async () => {
      const index = await loadRedactionIndex(db);
      const text = "How many nephrectomy cases this month?";
      expect(redactUserText(text, index)).toBe(text);
    });
  });

  describe("chat loop", () => {
    const config = { apiKey: "sk-or-test", model: DEFAULT_MODEL };

    it("runs tool calls and sends no identifiers to OpenRouter", async () => {
      const sent: any[] = [];
      const replies = [
        {
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "get_or_schedule", arguments: '{"date":"2026-10-08"}' } }],
            },
          }],
        },
        { choices: [{ message: { role: "assistant", content: "One case: CASE-000101 for OR-000001." } }] },
      ];
      const fetchImpl = async (url: string, init?: RequestInit) => {
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
        sent.push(JSON.parse(init?.body as string));
        return jsonResponse(replies[sent.length - 1]);
      };

      const result = await runAssistantTurn({
        db,
        config,
        history: [],
        userText: "What is scheduled on 2026-10-08 for Juan Dela Cruz (HRN-1001)?",
        entities,
        fetchImpl,
        now: new Date(2026, 9, 7, 9, 0),
      });

      expect(result.reply).toBe("One case: CASE-000101 for OR-000001.");
      expect(result.toolsUsed).toEqual(["get_or_schedule"]);
      expect(result.history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);

      expect(sent).toHaveLength(2);
      expect(sent[0].model).toBe(DEFAULT_MODEL);
      expect(sent[0].provider).toEqual({ data_collection: "deny" });
      expect(sent[0].messages[0].content).toContain("2026-10-07 (Wednesday)");
      expect(sent[0].messages[1].content).toBe("What is scheduled on 2026-10-08 for OR-000001 (OR-000001)?");
      expect(sent[1].messages[3].role).toBe("tool");
      for (const body of sent) expectDeidentified(body);

      const audit = await db.select<{ new_value: string; patient_id: string | null }>(
        "SELECT new_value, patient_id FROM audit_log WHERE action = 'ASSISTANT_QUERY'"
      );
      expect(audit).toHaveLength(1);
      expect(JSON.parse(audit[0].new_value)).toEqual({ model: DEFAULT_MODEL, tools: ["get_or_schedule"] });
    });

    it("reports tool failures back to the model instead of crashing", async () => {
      const sent: any[] = [];
      const fetchImpl = async (_url: string, init?: RequestInit) => {
        sent.push(JSON.parse(init?.body as string));
        return jsonResponse(
          sent.length === 1
            ? { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "drop_tables", arguments: "{}" } }] } }] }
            : { choices: [{ message: { content: "I cannot do that." } }] }
        );
      };
      const result = await runAssistantTurn({ db, config, history: [], userText: "delete everything", entities, fetchImpl });
      expect(result.reply).toBe("I cannot do that.");
      expect(sent[1].messages[3].content).toContain("Unknown tool");
    });

    it("explains a rejected key, a missing key and a network failure", async () => {
      const base = { db, history: [], userText: "hi", entities };
      await expect(
        runAssistantTurn({ ...base, config, fetchImpl: async () => jsonResponse({ error: { message: "No auth" } }, 401) })
      ).rejects.toThrow(/rejected the API key/);
      await expect(runAssistantTurn({ ...base, config: { apiKey: "", model: DEFAULT_MODEL } })).rejects.toThrow(AssistantError);
      await expect(
        runAssistantTurn({ ...base, config, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } })
      ).rejects.toThrow(/internet connection/);
    });

    it("retries a rate-limited request, then gives up with a clear message", async () => {
      let calls = 0;
      const limitedOnce = async () =>
        ++calls === 1
          ? jsonResponse({ error: { message: "Provider returned error", code: 429 } }, 429)
          : jsonResponse({ choices: [{ message: { content: "Done." } }] });
      const base = { db, config, history: [], userText: "hi", entities };
      const ok = await runAssistantTurn({ ...base, fetchImpl: limitedOnce, retryDelaysMs: [0] });
      expect(ok.reply).toBe("Done.");
      expect(calls).toBe(2);

      const always = async () => jsonResponse({ error: { message: "Provider returned error", code: 429 } });
      await expect(runAssistantTurn({ ...base, fetchImpl: always, retryDelaysMs: [0, 0] })).rejects.toThrow(/rate limited/);
    });

    it("stores the key and model in app settings", async () => {
      expect(await getAssistantConfig(db)).toEqual({ apiKey: "", model: DEFAULT_MODEL });
      await saveAssistantConfig(db, { apiKey: "  sk-or-abc  ", model: "openai/gpt-6-luna" });
      expect(await getAssistantConfig(db)).toEqual({ apiKey: "sk-or-abc", model: "openai/gpt-6-luna" });
    });
  });
});
