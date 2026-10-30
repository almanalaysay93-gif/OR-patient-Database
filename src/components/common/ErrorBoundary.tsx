import React from "react";
import { logError } from "../../services/logger";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Fixed label for the log line, such as "App". Never a patient value. */
  context?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render errors so the station shows a recovery screen instead of a blank window.
 * The fallback shows no error text, because the message can hold patient data.
 * The error is logged through the redacting logger only.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // componentStack is not logged: it names components only, but adds no value over the stack frames.
    logError(`ErrorBoundary.${this.props.context ?? "App"}`, error);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      >
        <div className="glass-card" style={{ maxWidth: 440, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ marginBottom: 8 }}>The screen stopped because of an unexpected error.</p>
          <p style={{ marginBottom: 24 }}>
            Select Reload to open the station again. Changes that were not saved can be lost.
          </p>
          <button type="button" className="glass-btn glass-btn-primary" onClick={this.handleReload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
