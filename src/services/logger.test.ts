import { afterEach, describe, expect, it, vi } from "vitest";
import { logCatch, logError, redact, toSafeError } from "./logger";

afterEach(() => vi.restoreAllMocks());

describe("logger redaction", () => {
  it("removes quoted values from a SQLite constraint message", () => {
    const out = redact("UNIQUE constraint failed: patients.hrn value 'HRN-778812' for 'DELA CRUZ, JUAN'");
    expect(out).not.toContain("778812");
    expect(out).not.toContain("DELA CRUZ");
    expect(out).toContain("UNIQUE constraint failed");
  });

  it("removes emails, dates, long numbers, data URLs, URLs and tokens", () => {
    const out = redact(
      "user juan@example.com born 1980-02-14 phone 09171234567 file data:image/png;base64,iVBORw0KGgoAAAANSUhEUg " +
        "sent to https://script.google.com/macros/s/AKfycbXYZ/exec token Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4"
    );
    for (const leak of ["juan@example.com", "1980-02-14", "09171234567", "iVBORw0K", "AKfycbXYZ", "Zm9vYmFy"]) {
      expect(out).not.toContain(leak);
    }
  });

  it("never prints a non-Error object such as a patient row", () => {
    const safe = toSafeError("PatientsView.save", { full_name: "DELA CRUZ, JUAN", hrn: "HRN-1" });
    expect(JSON.stringify(safe)).not.toContain("DELA CRUZ");
    expect(safe.message).toBe("[non-error value redacted]");
  });

  it("logError writes one redacted console line and never the raw error object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("NOT NULL constraint failed for 'SANTOS, MARIA' HRN 5566778");
    logError("IntraOrView.save", err);
    expect(spy).toHaveBeenCalledTimes(1);
    const args = spy.mock.calls[0];
    expect(args).toHaveLength(1);
    expect(typeof args[0]).toBe("string");
    expect(args[0]).toContain("[IntraOrView.save] Error: NOT NULL constraint failed");
    expect(args[0]).not.toContain("SANTOS");
    expect(args[0]).not.toContain("5566778");
  });

  it("logCatch returns a catch handler with a fixed label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logCatch("AppContext.theme")(new Error("disk 'full'"));
    expect(spy.mock.calls[0][0]).toContain("[AppContext.theme] Error: disk '[redacted]'");
  });
});
