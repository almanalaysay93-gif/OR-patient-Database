import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("switches to the fallback state when a child throws", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });

  it("renders a Reload fallback with no error text", () => {
    const boundary = new ErrorBoundary({ children: React.createElement("p", null, "child") });
    boundary.state = { hasError: true };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reload");
    expect(html).not.toContain("child");
  });

  it("renders children when no error happened", () => {
    const boundary = new ErrorBoundary({ children: React.createElement("p", null, "child") });
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);
    expect(html).toBe("<p>child</p>");
  });

  it("logs the caught error through the redacting logger", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null, context: "App" });
    boundary.componentDidCatch(new Error("bad row 'REYES, ANA'"));
    expect(spy.mock.calls[0][0]).toContain("[ErrorBoundary.App] Error: bad row");
    expect(spy.mock.calls[0][0]).not.toContain("REYES");
  });
});
