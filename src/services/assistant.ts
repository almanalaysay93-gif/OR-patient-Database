import { format } from "date-fns";
import type { Db } from "../data/db";
import { logAudit } from "./audit";
import { formatResearchId } from "./patients";
import { TOOL_DEFINITIONS, executeTool, type EntityMap } from "./assistantTools";

/**
 * Read-only AI assistant backed by OpenRouter.
 *
 * The model never gets database access. It can only call the de-identified tools in
 * assistantTools.ts, and full patient names and HRNs typed by the user are swapped
 * for research IDs before the question leaves the workstation.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const API_KEY_SETTING = "assistant_api_key";
const MODEL_SETTING = "assistant_model";
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_RESULT_CHARS = 60000;
const MAX_HISTORY_MESSAGES = 40;
/** Waits before retrying a rate-limited request. Free models share a pool that is often briefly full. */
const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 5000];

export const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

/** Tool-capable models offered as suggestions in Settings. Any OpenRouter model slug works. */
export const SUGGESTED_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it",
  "google/gemini-3.8-flash",
];

export interface AssistantConfig {
  apiKey: string;
  model: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ApiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export class AssistantError extends Error {}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function getAssistantConfig(db: Db): Promise<AssistantConfig> {
  const rows = await db.select<{ key: string; value: string }>(
    "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
    [API_KEY_SETTING, MODEL_SETTING]
  );
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    apiKey: byKey.get(API_KEY_SETTING) ?? "",
    model: byKey.get(MODEL_SETTING) || DEFAULT_MODEL,
  };
}

export async function saveAssistantConfig(db: Db, config: AssistantConfig): Promise<void> {
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [
    API_KEY_SETTING,
    config.apiKey.trim(),
  ]);
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [
    MODEL_SETTING,
    config.model.trim() || DEFAULT_MODEL,
  ]);
}

// ---------------------------------------------------------------------------
// Redaction of identifiers typed by the user
// ---------------------------------------------------------------------------

export interface RedactionEntry {
  patientId: string;
  researchId: string;
  firstName: string;
  lastName: string;
  hrn: string | null;
}

export async function loadRedactionIndex(db: Db): Promise<RedactionEntry[]> {
  const rows = await db.select<{
    patient_id: string;
    research_seq: number;
    first_name: string;
    last_name: string;
    hrn: string | null;
  }>("SELECT patient_id, research_seq, first_name, last_name, hrn FROM patients");
  return rows.map((r) => ({
    patientId: r.patient_id,
    researchId: formatResearchId(r.research_seq),
    firstName: (r.first_name ?? "").trim(),
    lastName: (r.last_name ?? "").trim(),
    hrn: r.hrn?.trim() || null,
  }));
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namePattern = (s: string) => s.split(/\s+/).map(escapeRegex).join("\\s+");
const bounded = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "giu");

/**
 * Replace full patient names ("First Last", "First M. Last", "Last, First") and HRNs with
 * the patient's research ID. A surname or first name on its own is not replaced: it cannot
 * be told apart from an ordinary word, so it would reach the model as typed.
 */
export function redactUserText(text: string, index: RedactionEntry[], entities?: EntityMap): string {
  let out = text;
  for (const e of index) {
    const patterns: string[] = [];
    if (e.firstName.length >= 2 && e.lastName.length >= 2 && out.toLowerCase().includes(e.lastName.toLowerCase())) {
      const first = namePattern(e.firstName);
      const last = namePattern(e.lastName);
      patterns.push(`${first}\\s+(?:[\\p{L}.]+\\s+)?${last}`, `${last}\\s*,?\\s+${first}`);
    }
    if (e.hrn && e.hrn.length >= 3) patterns.push(escapeRegex(e.hrn));
    if (patterns.length === 0) continue;

    const replaced = out.replace(bounded(patterns.join("|")), e.researchId);
    if (replaced !== out) {
      out = replaced;
      entities?.set(e.researchId, {
        kind: "patient",
        patientId: e.patientId,
        label: `${e.lastName}, ${e.firstName}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chat loop
// ---------------------------------------------------------------------------

export function buildSystemPrompt(now: Date): string {
  return [
    "You are the built-in assistant of an operating room patient management system used by hospital staff.",
    `Today is ${format(now, "yyyy-MM-dd (EEEE)")}; the local time is ${format(now, "HH:mm")}.`,
    "",
    "Answer questions about the OR schedule, surgical cases, pre-operative readiness, delays, cancellations, complications and statistics by calling the provided tools. The tools are your only source of facts. Never guess or invent records; if the tools return nothing, say so.",
    "",
    "Rules:",
    "- You are read-only. You cannot create, change, schedule or cancel anything. If asked to, say the user has to do it in the app.",
    "- Patients are de-identified. You see research IDs such as OR-000012, never names. The user may type a name; pass it to find_patient, which matches it on the workstation. Do not ask for names, record numbers or birth dates, and do not repeat a patient's name in your answer.",
    "- Always write research IDs and case numbers exactly as the tools return them. The app turns them into links that show the patient's name to the user.",
    "- Report what is recorded. Do not give diagnoses, treatment advice, risk predictions or any other clinical recommendation.",
    "- Count from the tool results. When list_cases returns fewer cases than total_matching, say the list is partial.",
    "- Be brief. Use short paragraphs and \"-\" bullet lists. Do not use tables or headings.",
  ].join("\n");
}

/** Drop the oldest turns once the history grows long, cutting only at a user message. */
function trimHistory(history: ApiMessage[]): ApiMessage[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  for (let i = history.length - MAX_HISTORY_MESSAGES; i < history.length; i++) {
    if (history[i].role === "user") return history.slice(i);
  }
  return history;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg = body?.error?.message;
    if (typeof msg === "string" && msg) return msg;
  } catch {
    // Body was not JSON; fall through to the status text.
  }
  return res.statusText || `HTTP ${res.status}`;
}

const RATE_LIMIT_MESSAGE = "The model is rate limited right now. Wait a moment and try again.";

async function failFromResponse(res: Response): Promise<never> {
  const detail = await readErrorMessage(res);
  switch (res.status) {
    case 401:
      throw new AssistantError("OpenRouter rejected the API key. Check it in Settings > AI Assistant.");
    case 402:
      throw new AssistantError("The OpenRouter account is out of credits.");
    case 429:
      throw new RateLimitedError(RATE_LIMIT_MESSAGE);
    default:
      throw new AssistantError(`OpenRouter error (${res.status}): ${detail}`);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

class RateLimitedError extends AssistantError {}

async function callOpenRouter(
  fetchImpl: FetchLike,
  config: AssistantConfig,
  messages: ApiMessage[],
  signal?: AbortSignal,
  retryDelays: number[] = RATE_LIMIT_RETRY_DELAYS_MS
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestCompletion(fetchImpl, config, messages, signal);
    } catch (err) {
      if (!(err instanceof RateLimitedError) || attempt >= retryDelays.length) throw err;
      await sleep(retryDelays[attempt], signal);
    }
  }
}

async function requestCompletion(
  fetchImpl: FetchLike,
  config: AssistantConfig,
  messages: ApiMessage[],
  signal?: AbortSignal
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  let res: Response;
  try {
    res = await fetchImpl(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "OR Patient Management",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: TOOL_DEFINITIONS,
        // Only route to providers that do not retain or train on prompts.
        provider: { data_collection: "deny" },
      }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new AssistantError("Could not reach OpenRouter. The assistant needs an internet connection.");
  }
  if (!res.ok) await failFromResponse(res);

  const body = await res.json();
  // OpenRouter can report an upstream rate limit inside a 200 response.
  if (body?.error?.code === 429) throw new RateLimitedError(RATE_LIMIT_MESSAGE);
  if (body?.error) throw new AssistantError(`OpenRouter error: ${body.error.message ?? "unknown error"}`);
  const message = body?.choices?.[0]?.message;
  if (!message) throw new AssistantError("OpenRouter returned an empty response.");
  return { content: message.content ?? null, tool_calls: message.tool_calls };
}

async function runToolCall(db: Db, call: ToolCall, entities: EntityMap): Promise<string> {
  try {
    const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    const result = await executeTool(db, call.function.name, args ?? {}, entities);
    const json = JSON.stringify(result);
    if (json.length > MAX_TOOL_RESULT_CHARS) {
      return JSON.stringify({ error: "Result too large. Narrow the filters or use a smaller limit." });
    }
    return json;
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

export interface AssistantTurnParams {
  db: Db;
  config: AssistantConfig;
  /** Earlier messages of this conversation, as returned by the previous turn. */
  history: ApiMessage[];
  userText: string;
  /** Filled with every patient and case the tools touch, so the UI can link them. */
  entities: EntityMap;
  userId?: string | null;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  now?: Date;
  /** Overrides the waits between rate-limit retries. */
  retryDelaysMs?: number[];
}

export interface AssistantTurnResult {
  reply: string;
  history: ApiMessage[];
  toolsUsed: string[];
}

export async function runAssistantTurn(params: AssistantTurnParams): Promise<AssistantTurnResult> {
  const { db, config, entities, signal } = params;
  if (!config.apiKey) throw new AssistantError("Add an OpenRouter API key in Settings > AI Assistant first.");
  const fetchImpl: FetchLike = params.fetchImpl ?? ((input, init) => fetch(input, init));

  const index = await loadRedactionIndex(db);
  const history: ApiMessage[] = [
    ...trimHistory(params.history),
    { role: "user", content: redactUserText(params.userText, index, entities) },
  ];
  const system: ApiMessage = { role: "system", content: buildSystemPrompt(params.now ?? new Date()) };
  const toolsUsed: string[] = [];

  let reply: string | null = null;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const message = await callOpenRouter(fetchImpl, config, [system, ...history], signal, params.retryDelaysMs);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      reply = message.content?.trim() || "I could not produce an answer. Try rephrasing the question.";
      history.push({ role: "assistant", content: reply });
      break;
    }
    history.push({ role: "assistant", content: message.content, tool_calls: calls });
    for (const call of calls) {
      toolsUsed.push(call.function.name);
      history.push({ role: "tool", tool_call_id: call.id, content: await runToolCall(db, call, entities) });
    }
  }
  if (reply == null) {
    throw new AssistantError("The assistant needed too many lookups for this question. Try a narrower question.");
  }

  // Record that records were queried through the assistant; the question text itself is not stored.
  await logAudit(db, {
    userId: params.userId ?? null,
    action: "ASSISTANT_QUERY",
    entityType: "ASSISTANT",
    newValue: JSON.stringify({ model: config.model, tools: toolsUsed }),
  }).catch((err) => console.error("Assistant audit entry failed:", err));

  return { reply, history, toolsUsed };
}

/** Check an API key against OpenRouter without sending any data. */
export async function testAssistantConnection(apiKey: string, fetchImpl?: FetchLike): Promise<void> {
  if (!apiKey.trim()) throw new AssistantError("Enter an API key first.");
  const doFetch: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  let res: Response;
  try {
    res = await doFetch(`${OPENROUTER_URL}/key`, { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
  } catch {
    throw new AssistantError("Could not reach OpenRouter. Check the internet connection.");
  }
  if (!res.ok) await failFromResponse(res);
}
