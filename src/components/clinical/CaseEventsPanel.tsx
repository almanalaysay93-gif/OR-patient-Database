import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  CASE_EVENT_TYPES, getCaseEvents, getRoomTurnover, minutesBetween, saveCaseEvent,
  type CaseEvent, type CaseEventType,
} from "../../services/caseEvents";

function localInputValue(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function CaseEventsPanel({ caseId }: { caseId: string }) {
  const { db, session, notify } = useApp();
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [turnover, setTurnover] = useState<number | null>(null);
  const [eventType, setEventType] = useState<CaseEventType>("ROOM_IN");
  const [occurredAt, setOccurredAt] = useState("");
  const [reason, setReason] = useState("");

  const reload = async () => {
    if (!db) return;
    const [rows, minutes] = await Promise.all([getCaseEvents(db, caseId), getRoomTurnover(db, caseId)]);
    setEvents(rows);
    setTurnover(minutes);
  };

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [db, caseId]);

  useEffect(() => {
    const existing = events.find((event) => event.event_type === eventType);
    setOccurredAt(existing ? localInputValue(existing.occurred_at) : "");
    setReason("");
  }, [events, eventType]);

  const save = async () => {
    if (!db || !occurredAt) return;
    try {
      await saveCaseEvent(db, {
        caseId, eventType, occurredAt: new Date(occurredAt).toISOString(),
        correctionReason: reason || null, userId: session?.userId,
      });
      await reload();
      notify("Case event saved.", "success");
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const eventTime = (type: CaseEventType) => events.find((event) => event.event_type === type)?.occurred_at;
  const procedureMinutes = minutesBetween(eventTime("INCISION"), eventTime("CLOSURE"));
  const pacuMinutes = minutesBetween(eventTime("PACU_IN"), eventTime("PACU_OUT"));

  return (
    <section className="glass-card" style={{ padding: 20, display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 17, margin: 0 }}>Dated OR events</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>Event
          <select className="glass-input" value={eventType} onChange={(e) => setEventType(e.target.value as CaseEventType)}>
            {CASE_EVENT_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label>Date and time
          <input className="glass-input" type="datetime-local" value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)} />
        </label>
      </div>
      {events.some((event) => event.event_type === eventType) && (
        <label>Reason for correction
          <input className="glass-input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <button type="button" className="glass-btn glass-btn-primary" disabled={!occurredAt} onClick={save}>Save event</button>
      <div style={{ display: "grid", gap: 4 }}>
        {events.map((event) => (
          <div key={event.event_id}>{event.event_type.replace(/_/g, " ")}: {new Date(event.occurred_at).toLocaleString()}</div>
        ))}
      </div>
      <small>Procedure: {procedureMinutes ?? "Unknown"} min. PACU: {pacuMinutes ?? "Unknown"} min. Room turnover: {turnover ?? "Unknown"} min.</small>
    </section>
  );
}
