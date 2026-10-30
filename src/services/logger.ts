/**
 * Local error logger.
 *
 * Errors in this app can carry patient data: SQLite messages quote row values,
 * and thrown objects can hold whole records. This logger never prints the
 * error object itself. It prints a short context label, the error name, a
 * scrubbed message, and a scrubbed stack. Nothing leaves the machine: there is
 * no remote error service and no log file (plan decision Q4).
 */

const MAX_MESSAGE = 300;
const MAX_STACK_LINES = 8;

/** Patterns that can hold patient values or secrets inside an error message. */
const REDACTIONS: Array<[RegExp, string]> = [
  // Quoted literals, e.g. SQLite "UNIQUE constraint failed ... 'HRN-123'" or JSON strings.
  [/'(?:[^'\\]|\\.)*'/g, "'[redacted]'"],
  [/"(?:[^"\\]|\\.)*"/g, '"[redacted]"'],
  [/`(?:[^`\\]|\\.)*`/g, "`[redacted]`"],
  // Data URLs (lab attachments).
  [/data:[a-z0-9.+/-]+;base64,[a-z0-9+/=]+/gi, "data:[redacted]"],
  // Email addresses.
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]"],
  // URLs with a query string or token path (Apps Script /exec links).
  [/https?:\/\/[^\s)]+/gi, "[url]"],
  // Long hex or base64 runs (tokens, keys, hashes).
  [/[A-Za-z0-9+/_=-]{24,}/g, "[secret]"],
  // Dates and any run of 4 or more digits (birth dates, HRN, case and phone numbers).
  [/\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g, "[date]"],
  [/\d{4,}/g, "[number]"],
];

/** Remove patient values and secrets from free text. Exported for tests. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}...` : out;
}

/** The safe shape that reaches the console. Exported for tests. */
export interface SafeError {
  context: string;
  name: string;
  message: string;
  stack?: string;
}

/** Keep only stack frame lines (function and file:line), never the message line. */
function scrubStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .filter((line) => /^\s*at\s|@/.test(line))
    .slice(0, MAX_STACK_LINES)
    // Frames hold code paths, not patient data. Drop query strings and quoted text only, so file:line stays readable.
    .map((line) =>
      line
        .trim()
        .replace(/\?[^\s:)]*/g, "")
        .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "[redacted]")
        .slice(0, MAX_MESSAGE)
    );
  return frames.length ? frames.join("\n") : undefined;
}

/** Turn any thrown value into a SafeError. Never reads fields other than name, message and stack. */
export function toSafeError(context: string, err: unknown): SafeError {
  const label = redact(context || "error");
  if (err instanceof Error) {
    return {
      context: label,
      name: redact(err.name || "Error"),
      message: redact(err.message || ""),
      stack: scrubStack(err.stack),
    };
  }
  if (typeof err === "string") return { context: label, name: "Error", message: redact(err) };
  // Objects, rows and other values are never printed.
  return { context: label, name: typeof err, message: "[non-error value redacted]" };
}

/**
 * Log an error. `context` is a fixed label written by the developer, such as
 * "PatientsView.save". Do not put patient values in the label.
 */
export function logError(context: string, err: unknown): void {
  const safe = toSafeError(context, err);
  console.error(`[${safe.context}] ${safe.name}: ${safe.message}${safe.stack ? `\n${safe.stack}` : ""}`);
}

/** Log a warning with no error object. The message is redacted. */
export function logWarn(context: string, message: string): void {
  console.warn(`[${redact(context)}] ${redact(message)}`);
}

/**
 * Promise catch handler with a fixed label, for `promise.catch(logCatch("AppContext.theme"))`.
 * It replaces `.catch(console.error)`.
 */
export function logCatch(context: string): (err: unknown) => void {
  return (err) => logError(context, err);
}
