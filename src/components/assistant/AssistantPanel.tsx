import React, { useEffect, useRef, useState } from "react";
import { Bot, X, Send, RotateCcw, User, FileText, ShieldCheck } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { answerQuestion } from "../../services/assistant";
import type { EntityMap, EntityRef } from "../../services/assistantTools";

interface DisplayMessage {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
}

const SUGGESTIONS = [
  "Schedule today",
  "Which cases are not ready?",
  "Cancelled cases this month",
  "Complications this year",
  "Help",
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bold, inline code, and research IDs / case numbers known from earlier lookups. */
function inlinePattern(entities: EntityMap): RegExp {
  const tokens = [...entities.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const parts = ["\\*\\*([^*]+)\\*\\*", "`([^`]+)`"];
  if (tokens.length > 0) parts.push(`(${tokens.join("|")})`);
  return new RegExp(parts.join("|"), "g");
}

const EntityChip: React.FC<{ token: string; entity: EntityRef; onOpen: (e: EntityRef) => void }> = ({
  token,
  entity,
  onOpen,
}) => (
  <button
    onClick={() => onOpen(entity)}
    title={`Open ${entity.label}`}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "1px 7px",
      margin: "0 1px",
      borderRadius: "6px",
      border: "1px solid var(--border-glass)",
      background: "var(--primary-light)",
      color: "var(--primary)",
      fontSize: "12px",
      fontWeight: 600,
      cursor: "pointer",
      verticalAlign: "baseline",
    }}
  >
    {entity.kind === "patient" ? <User size={11} /> : <FileText size={11} />}
    <span>{entity.kind === "patient" ? `${token} · ${entity.label}` : token}</span>
  </button>
);

function renderInline(text: string, entities: EntityMap, onOpen: (e: EntityRef) => void): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = inlinePattern(entities);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${m.index}-${m[0]}`;
    if (m[1] != null) {
      out.push(<strong key={key}>{renderInline(m[1], entities, onOpen)}</strong>);
    } else if (m[2] != null) {
      out.push(
        <code key={key} style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>
          {m[2]}
        </code>
      );
    } else {
      const entity = entities.get(m[3]);
      out.push(entity ? <EntityChip key={key} token={m[3]} entity={entity} onOpen={onOpen} /> : m[3]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal renderer for the paragraphs and bullet lists the assistant writes. */
const MessageBody: React.FC<{ text: string; entities: EntityMap; onOpen: (e: EntityRef) => void }> = ({
  text,
  entities,
  onOpen,
}) => {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: "4px 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b, entities, onOpen)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(
      <p key={`p-${blocks.length}`} style={{ margin: "4px 0", fontWeight: heading ? 700 : undefined }}>
        {renderInline(heading ? heading[1] : line, entities, onOpen)}
      </p>
    );
  }
  flush();
  return <>{blocks}</>;
};

export const AssistantPanel: React.FC = () => {
  const {
    db,
    assistantOpen,
    setAssistantOpen,
    searchOpen,
    setSelectedPatientId,
    setSelectedCaseId,
    setView,
  } = useApp();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const entitiesRef = useRef<EntityMap>(new Map());
  const nextIdRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen(!assistantOpen);
      } else if (e.key === "Escape" && assistantOpen && !searchOpen) {
        setAssistantOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [assistantOpen, searchOpen, setAssistantOpen]);

  useEffect(() => {
    if (assistantOpen) inputRef.current?.focus();
  }, [assistantOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  if (!assistantOpen) return null;

  const addMessage = (role: DisplayMessage["role"], text: string) =>
    setMessages((prev) => [...prev, { id: nextIdRef.current++, role, text }]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!db || !question || busy) return;
    setInput("");
    addMessage("user", question);
    setBusy(true);
    try {
      addMessage("assistant", await answerQuestion(db, question, entitiesRef.current));
    } catch (err) {
      console.error("Assistant error:", err);
      addMessage("error", "Something went wrong while looking that up. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => {
    entitiesRef.current = new Map();
    setMessages([]);
  };

  const openEntity = (entity: EntityRef) => {
    setSelectedPatientId(entity.patientId);
    if (entity.kind === "case" && entity.caseId) {
      setSelectedCaseId(entity.caseId);
      setView("intraor");
    } else {
      setView("patients");
    }
  };

  const iconButton: React.CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    padding: "4px",
  };

  return (
    <aside
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "420px",
        maxWidth: "100vw",
        zIndex: 9000,
        background: "var(--bg-card)",
        borderLeft: "1px solid var(--border-glass)",
        boxShadow: "-12px 0 40px rgba(0, 0, 0, 0.18)",
        backdropFilter: "blur(16px)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-glass)", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "var(--primary-light)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Bot size={17} />
        </div>
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>Assistant</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Read-only &bull; Offline &bull; Local database</div>
        </div>
        <button onClick={newChat} title="New chat" style={iconButton}>
          <RotateCcw size={16} />
        </button>
        <button onClick={() => setAssistantOpen(false)} title="Close (Esc)" style={iconButton}>
          <X size={18} />
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "4px" }}>
              Ask about the schedule, a case number, a patient, readiness, delays or statistics.
            </div>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="glass-btn glass-btn-secondary"
                style={{ justifyContent: "flex-start", textAlign: "left", fontSize: "13px", padding: "9px 12px" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "92%",
              padding: "8px 12px",
              borderRadius: "12px",
              fontSize: "13px",
              lineHeight: 1.55,
              whiteSpace: m.role === "user" ? "pre-wrap" : undefined,
              wordBreak: "break-word",
              background: m.role === "user" ? "var(--primary)" : m.role === "error" ? "var(--danger-light)" : "var(--border-subtle)",
              color: m.role === "user" ? "white" : m.role === "error" ? "var(--danger)" : "var(--text-main)",
            }}
          >
            {m.role === "assistant" ? (
              <MessageBody text={m.text} entities={entitiesRef.current} onOpen={openEntity} />
            ) : (
              m.text
            )}
          </div>
        ))}

        {busy && (
          <div style={{ alignSelf: "flex-start", fontSize: "12px", color: "var(--text-muted)", padding: "4px 2px" }}>
            Looking up records…
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: "12px 16px 14px", borderTop: "1px solid var(--border-glass)" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            className="glass-input"
            rows={2}
            placeholder="Ask a question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            style={{ flex: 1, resize: "none", fontSize: "13px", fontFamily: "inherit" }}
          />
          <button
            onClick={() => send(input)}
            title="Send (Enter)"
            disabled={busy || !input.trim()}
            className="glass-btn glass-btn-primary"
            style={{ padding: "10px" }}
          >
            <Send size={15} />
          </button>
        </div>
        <div style={{ display: "flex", gap: "6px", marginTop: "8px", fontSize: "11px", lineHeight: 1.4, color: "var(--text-muted)" }}>
          <ShieldCheck size={13} style={{ flexShrink: 0, marginTop: "1px" }} />
          <span>
            Works offline with keyword rules. Nothing leaves this computer. Check the record before acting. Not
            clinical advice.
          </span>
        </div>
      </div>
    </aside>
  );
};
