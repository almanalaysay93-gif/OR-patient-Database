import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  addDonorRelationshipType, getDonorRelationshipTypes, setDonorRelationshipTypeActive, type DonorRelationshipType,
} from "../../services/donorRelationships";
import type { DonorRelation } from "../../services/preopBaseline";

const GROUPS: { value: DonorRelation; label: string }[] = [
  { value: "RELATED", label: "Related donor" },
  { value: "NON_RELATED", label: "Non-related donor" },
];

export const DonorRelationshipPanel: React.FC = () => {
  const { db, can, notify } = useApp();
  const canManage = can("masterdata.manage");
  const [types, setTypes] = useState<DonorRelationshipType[]>([]);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<DonorRelation>("RELATED");

  const reload = async () => {
    if (!db) return;
    setTypes(await getDonorRelationshipTypes(db, false));
  };

  useEffect(() => {
    reload().catch((err) => notify((err as Error).message, "error"));
  }, [db]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await addDonorRelationshipType(db, name, group);
      setName("");
      await reload();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  const toggle = async (t: DonorRelationshipType) => {
    if (!db) return;
    try {
      await setDonorRelationshipTypeActive(db, t.relationship_type_id, !t.active);
      await reload();
    } catch (err) {
      notify((err as Error).message, "error");
    }
  };

  return (
    <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, borderBottom: "1px solid var(--border-glass)", paddingBottom: "10px" }}>
        Donor Types of Relation
      </h2>
      {GROUPS.map((g) => (
        <div key={g.value} style={{ fontSize: "13px" }}>
          <strong>{g.label}:</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
            {types.filter((t) => t.donor_relation === g.value).map((t) => (
              canManage ? (
                <button key={t.relationship_type_id} type="button" onClick={() => toggle(t)}
                  className={`badge ${t.active ? "badge-primary" : "badge-neutral"}`}
                  style={{ cursor: "pointer", textDecoration: t.active ? "none" : "line-through" }}
                  title={t.active ? "Click to hide from the dropdown" : "Click to show in the dropdown"}
                  aria-pressed={!!t.active}>
                  {t.name}
                </button>
              ) : (
                t.active ? <span key={t.relationship_type_id} className="badge badge-primary">{t.name}</span> : null
              )
            ))}
          </div>
        </div>
      ))}
      {canManage && (
        <form onSubmit={handleAdd} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input className="glass-input" aria-label="New type of relation" placeholder="New type, e.g. Step-sibling"
            value={name} onChange={(e) => setName(e.target.value)} />
          <select className="glass-input" aria-label="Donor group" value={group} onChange={(e) => setGroup(e.target.value as DonorRelation)}>
            {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <button type="submit" className="glass-btn glass-btn-secondary" disabled={!name.trim()} style={{ gap: "6px" }}>
            <Plus size={14} /><span>Add</span>
          </button>
        </form>
      )}
    </div>
  );
};
