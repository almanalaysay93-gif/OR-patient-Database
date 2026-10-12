#!/usr/bin/env python3
"""
Full Automation Script for Patient Laboratory Results and Clinical File Attachments.
OR Patient Management System.

Features:
- Automated lab result ingestion with clinical flags (NORMAL, HIGH, LOW, CRITICAL).
- Automated file & image uploading with base64 data URI encoding.
- Preset clinical panels: Complete Blood Count (CBC), Comprehensive Metabolic (CMP), Coagulation, Blood Bank, Arterial Blood Gas (ABG), Urinalysis.
- Batch ingestion from JSON and CSV files.
- Hot-folder daemon watcher for automated lab machine integrations.
- Auto-seeding realistic patient lab data and synthetic lab slip graphics for testing.
"""

import argparse
import base64
import csv
import json
import mimetypes
import os
import pathlib
import shutil
import sqlite3
import sys
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any

# Common clinical lab presets
PRESET_PANELS = {
    "cbc": [
        {"test_name": "White Blood Cell (WBC)", "category": "HEMATOLOGY", "result_value": "7.5", "unit": "x10^9/L", "reference_range": "4.5 - 11.0", "flag": "NORMAL"},
        {"test_name": "Red Blood Cell (RBC)", "category": "HEMATOLOGY", "result_value": "4.8", "unit": "x10^12/L", "reference_range": "4.3 - 5.9", "flag": "NORMAL"},
        {"test_name": "Hemoglobin (Hgb)", "category": "HEMATOLOGY", "result_value": "13.8", "unit": "g/dL", "reference_range": "13.5 - 17.5", "flag": "NORMAL"},
        {"test_name": "Hematocrit (Hct)", "category": "HEMATOLOGY", "result_value": "41.5", "unit": "%", "reference_range": "41.0 - 50.0", "flag": "NORMAL"},
        {"test_name": "Platelet Count", "category": "HEMATOLOGY", "result_value": "245", "unit": "x10^9/L", "reference_range": "150 - 450", "flag": "NORMAL"},
    ],
    "cmp": [
        {"test_name": "Serum Creatinine", "category": "CHEMISTRY", "result_value": "0.95", "unit": "mg/dL", "reference_range": "0.74 - 1.35", "flag": "NORMAL"},
        {"test_name": "Blood Urea Nitrogen (BUN)", "category": "CHEMISTRY", "result_value": "15.0", "unit": "mg/dL", "reference_range": "7.0 - 20.0", "flag": "NORMAL"},
        {"test_name": "Fasting Blood Glucose", "category": "CHEMISTRY", "result_value": "98", "unit": "mg/dL", "reference_range": "70 - 99", "flag": "NORMAL"},
        {"test_name": "Serum Sodium (Na)", "category": "CHEMISTRY", "result_value": "140", "unit": "mEq/L", "reference_range": "136 - 145", "flag": "NORMAL"},
        {"test_name": "Serum Potassium (K)", "category": "CHEMISTRY", "result_value": "4.2", "unit": "mEq/L", "reference_range": "3.5 - 5.1", "flag": "NORMAL"},
        {"test_name": "Serum Chloride (Cl)", "category": "CHEMISTRY", "result_value": "102", "unit": "mEq/L", "reference_range": "96 - 106", "flag": "NORMAL"},
        {"test_name": "Alanine Aminotransferase (ALT)", "category": "CHEMISTRY", "result_value": "24", "unit": "U/L", "reference_range": "7 - 56", "flag": "NORMAL"},
        {"test_name": "Aspartate Aminotransferase (AST)", "category": "CHEMISTRY", "result_value": "22", "unit": "U/L", "reference_range": "10 - 40", "flag": "NORMAL"},
    ],
    "coag": [
        {"test_name": "Prothrombin Time (PT)", "category": "COAGULATION", "result_value": "12.2", "unit": "sec", "reference_range": "11.0 - 13.5", "flag": "NORMAL"},
        {"test_name": "International Normalized Ratio (INR)", "category": "COAGULATION", "result_value": "1.05", "unit": "", "reference_range": "0.8 - 1.2", "flag": "NORMAL"},
        {"test_name": "Activated Partial Thromboplastin Time (aPTT)", "category": "COAGULATION", "result_value": "31.4", "unit": "sec", "reference_range": "25.0 - 35.0", "flag": "NORMAL"},
    ],
    "blood_bank": [
        {"test_name": "ABO & Rh Blood Typing", "category": "BLOOD_BANK", "result_value": "O Positive", "unit": "", "reference_range": "Patient Phenotype", "flag": "NORMAL"},
        {"test_name": "Crossmatch (Packed Red Blood Cells)", "category": "BLOOD_BANK", "result_value": "Compatible (2 Units Reserved)", "unit": "", "reference_range": "Compatible", "flag": "NORMAL"},
        {"test_name": "Antibody Screen", "category": "BLOOD_BANK", "result_value": "Negative", "unit": "", "reference_range": "Negative", "flag": "NORMAL"},
    ],
    "abg": [
        {"test_name": "pH", "category": "ARTERIAL_BLOOD_GAS", "result_value": "7.39", "unit": "", "reference_range": "7.35 - 7.45", "flag": "NORMAL"},
        {"test_name": "pCO2", "category": "ARTERIAL_BLOOD_GAS", "result_value": "40.0", "unit": "mmHg", "reference_range": "35.0 - 45.0", "flag": "NORMAL"},
        {"test_name": "pO2", "category": "ARTERIAL_BLOOD_GAS", "result_value": "95.0", "unit": "mmHg", "reference_range": "80.0 - 100.0", "flag": "NORMAL"},
        {"test_name": "HCO3", "category": "ARTERIAL_BLOOD_GAS", "result_value": "24.2", "unit": "mEq/L", "reference_range": "22.0 - 26.0", "flag": "NORMAL"},
        {"test_name": "O2 Saturation (SaO2)", "category": "ARTERIAL_BLOOD_GAS", "result_value": "98.5", "unit": "%", "reference_range": "95.0 - 100.0", "flag": "NORMAL"},
    ],
}

def generate_svg_lab_slip(patient_name: str, hrn: str, test_title: str, results: List[Dict[str, str]]) -> str:
    """Generate a realistic clinical laboratory report image as an SVG data URI."""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rows_svg = []
    y_pos = 180
    for r in results:
        flag_color = "#10b981" if r.get("flag") == "NORMAL" else "#ef4444"
        flag_text = r.get("flag", "NORMAL")
        rows_svg.append(f"""
        <g transform="translate(30, {y_pos})">
            <text x="10" y="20" font-family="monospace" font-size="13" font-weight="bold" fill="#1e293b">{r.get('test_name', '')[:35]}</text>
            <text x="320" y="20" font-family="monospace" font-size="13" font-weight="bold" fill="#0f172a">{r.get('result_value', '')} {r.get('unit', '')}</text>
            <text x="480" y="20" font-family="monospace" font-size="12" fill="#64748b">{r.get('reference_range', '')}</text>
            <rect x="630" y="6" width="75" height="20" rx="4" fill="{flag_color}" fill-opacity="0.15"/>
            <text x="667" y="20" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="{flag_color}">{flag_text}</text>
        </g>
        <line x1="30" y1="{y_pos+32}" x2="720" y2="{y_pos+32}" stroke="#e2e8f0" stroke-width="1"/>
        """)
        y_pos += 38

    height = max(380, y_pos + 60)
    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" width="750" height="{height}" viewBox="0 0 750 {height}">
    <rect width="100%" height="100%" fill="#ffffff" rx="10" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="0" y="0" width="750" height="90" fill="#0284c7" rx="8"/>
    <text x="30" y="40" font-family="sans-serif" font-size="20" font-weight="bold" fill="#ffffff">HOSPITAL SURGICAL PATHOLOGY &amp; LABORATORY</text>
    <text x="30" y="68" font-family="sans-serif" font-size="13" fill="#e0f2fe">CLINICAL DIAGNOSTIC DIVISION • ACCREDITED TRANSPLANT CENTER</text>
    <g transform="translate(30, 110)">
        <text x="0" y="16" font-family="sans-serif" font-size="13" font-weight="bold" fill="#334155">Patient: <tspan fill="#0f172a">{patient_name}</tspan></text>
        <text x="300" y="16" font-family="sans-serif" font-size="13" font-weight="bold" fill="#334155">HRN: <tspan fill="#0284c7">{hrn}</tspan></text>
        <text x="510" y="16" font-family="sans-serif" font-size="12" fill="#64748b">Reported: {now_str}</text>
        <text x="0" y="40" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0369a1">Panel: {test_title}</text>
    </g>
    <rect x="30" y="155" width="690" height="24" fill="#f1f5f9" rx="4"/>
    <text x="40" y="172" font-family="sans-serif" font-size="11" font-weight="bold" fill="#475569">ANALYSIS / TEST</text>
    <text x="350" y="172" font-family="sans-serif" font-size="11" font-weight="bold" fill="#475569">RESULT</text>
    <text x="510" y="172" font-family="sans-serif" font-size="11" font-weight="bold" fill="#475569">REFERENCE INTERVAL</text>
    <text x="667" y="172" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#475569">FLAG</text>
    {''.join(rows_svg)}
    <text x="30" y="{height - 20}" font-family="sans-serif" font-size="10" fill="#94a3b8">Electronic Clinical Verification: Dr. System Automation (Automated Ingest v1.0)</text>
</svg>"""
    b64_svg = base64.b64encode(svg_content.encode("utf-8")).decode("utf-8")
    return f"data:image/svg+xml;base64,{b64_svg}"

def locate_database(db_arg: Optional[str]) -> str:
    """Find the SQLite database file or provide default path."""
    if db_arg:
        return os.path.abspath(db_arg)

    # 1. Local workspace directory
    candidates = [
        os.path.abspath("or_patient_management.db"),
        os.path.abspath("or-patient-management/or_patient_management.db"),
        os.path.abspath("test.db"),
    ]

    # 2. Windows AppData directory
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(os.path.join(appdata, "ph.local.orpatientmanagement", "Database", "or-patient-management.db"))
        candidates.append(os.path.join(appdata, "or-patient-management", "Database", "or-patient-management.db"))

    for c in candidates:
        if os.path.isfile(c):
            return c

    # Return local default
    return os.path.abspath("or_patient_management.db")

def init_schema_if_needed(conn: sqlite3.Connection) -> None:
    """Ensure required tables exist in SQLite database."""
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS patients (
        patient_id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        middle_name TEXT,
        hrn TEXT UNIQUE,
        date_of_birth TEXT,
        sex TEXT CHECK(sex IN ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN') OR sex IS NULL),
        blood_type TEXT,
        contact_number TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        archived_by TEXT,
        archive_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS surgical_cases (
        case_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(patient_id),
        admission_id TEXT,
        case_number TEXT NOT NULL UNIQUE,
        case_type TEXT NOT NULL,
        case_status TEXT NOT NULL DEFAULT 'DRAFT',
        planned_procedure_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS patient_lab_results (
        lab_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        case_id TEXT REFERENCES surgical_cases(case_id) ON DELETE SET NULL,
        test_name TEXT NOT NULL,
        category TEXT NOT NULL,
        result_value TEXT NOT NULL,
        unit TEXT,
        reference_range TEXT,
        flag TEXT NOT NULL DEFAULT 'NORMAL' CHECK(flag IN ('NORMAL', 'HIGH', 'LOW', 'CRITICAL', 'ABNORMAL')),
        result_date TEXT NOT NULL,
        ordered_by TEXT,
        verified_by TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS clinical_attachments (
        attachment_id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
        lab_id TEXT REFERENCES patient_lab_results(lab_id) ON DELETE SET NULL,
        case_id TEXT REFERENCES surgical_cases(case_id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_data TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'LAB_REPORT',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_patient_labs_patient ON patient_lab_results(patient_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_patient_labs_case ON patient_lab_results(case_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_patient_labs_category ON patient_lab_results(category)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_patient_labs_date ON patient_lab_results(result_date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_clinical_att_patient ON clinical_attachments(patient_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_clinical_att_lab ON clinical_attachments(lab_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_clinical_att_case ON clinical_attachments(case_id)")
    conn.commit()

def file_to_data_uri(file_path: str) -> Tuple[str, str, int]:
    """Read a local file and convert to data URI format."""
    p = pathlib.Path(file_path)
    if not p.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")

    mime, _ = mimetypes.guess_type(file_path)
    if not mime:
        mime = "application/octet-stream"

    size = p.stat().st_size
    with open(file_path, "rb") as f:
        data_b64 = base64.b64encode(f.read()).decode("utf-8")

    data_uri = f"data:{mime};base64,{data_b64}"
    return data_uri, mime, size

def get_or_create_patient(conn: sqlite3.Connection, patient_id_or_hrn: Optional[str] = None) -> Tuple[str, str, str]:
    """Resolve patient ID, full name, and HRN. If none provided, find first or create one."""
    cur = conn.cursor()
    if patient_id_or_hrn:
        cur.execute(
            "SELECT patient_id, first_name, last_name, hrn FROM patients WHERE patient_id = ? OR hrn = ?",
            (patient_id_or_hrn, patient_id_or_hrn)
        )
        row = cur.fetchone()
        if row:
            full_name = f"{row[1]} {row[2]}".strip()
            return row[0], full_name, row[3] or "UNKNOWN"

    cur.execute("SELECT patient_id, first_name, last_name, hrn FROM patients WHERE is_archived = 0 ORDER BY created_at DESC LIMIT 1")
    row = cur.fetchone()
    if row:
        full_name = f"{row[1]} {row[2]}".strip()
        return row[0], full_name, row[3] or "UNKNOWN"

    # Create a default patient
    new_id = str(uuid.uuid4())
    hrn = f"HRN-{int(time.time()) % 1000000:06d}"
    now = datetime.now().isoformat()
    cur.execute(
        """INSERT INTO patients (patient_id, first_name, last_name, hrn, sex, blood_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (new_id, "Maria", "Santos", hrn, "FEMALE", "O_POS", now, now)
    )
    conn.commit()
    return new_id, "Maria Santos", hrn

def add_lab_result(
    conn: sqlite3.Connection,
    patient_id: str,
    test_name: str,
    category: str,
    result_value: str,
    unit: str = "",
    reference_range: str = "",
    flag: str = "NORMAL",
    result_date: Optional[str] = None,
    ordered_by: Optional[str] = "Automated Lab Ingest",
    verified_by: Optional[str] = "Clinical Staff",
    notes: Optional[str] = None,
    case_id: Optional[str] = None
) -> str:
    """Insert a single lab result record."""
    lab_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    date_val = result_date or datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cur = conn.cursor()
    cur.execute(
        """INSERT INTO patient_lab_results (
            lab_id, patient_id, case_id, test_name, category, result_value,
            unit, reference_range, flag, result_date, ordered_by, verified_by,
            notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            lab_id, patient_id, case_id, test_name, category, result_value,
            unit, reference_range, flag, date_val, ordered_by, verified_by,
            notes, now, now
        )
    )
    conn.commit()
    return lab_id

def add_attachment(
    conn: sqlite3.Connection,
    patient_id: str,
    file_name: str,
    file_type: str,
    file_size: int,
    file_data: str,
    category: str = "LAB_REPORT",
    notes: Optional[str] = None,
    lab_id: Optional[str] = None,
    case_id: Optional[str] = None
) -> str:
    """Insert a clinical attachment record with base64 data URI."""
    attachment_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    cur = conn.cursor()
    cur.execute(
        """INSERT INTO clinical_attachments (
            attachment_id, patient_id, lab_id, case_id, file_name,
            file_type, file_size, file_data, category, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            attachment_id, patient_id, lab_id, case_id, file_name,
            file_type, file_size, file_data, category, notes, now
        )
    )
    conn.commit()
    return attachment_id

def auto_seed_demo_labs(conn: sqlite3.Connection, target_patient_id: Optional[str] = None) -> None:
    """Generate comprehensive laboratory profiles with synthetic lab report images."""
    cur = conn.cursor()
    if target_patient_id:
        cur.execute("SELECT patient_id, first_name, last_name, hrn FROM patients WHERE patient_id = ?", (target_patient_id,))
    else:
        cur.execute("SELECT patient_id, first_name, last_name, hrn FROM patients WHERE is_archived = 0")

    patients = cur.fetchall()
    if not patients:
        p_id, p_name, hrn = get_or_create_patient(conn)
        patients = [(p_id, "Maria", "Santos", hrn)]

    print(f"[+] Seeding realistic lab panels for {len(patients)} patient(s)...")

    for p_id, first, last, hrn in patients:
        full_name = f"{first} {last}".strip()
        print(f"  -> Ingesting clinical panels for {full_name} (HRN: {hrn or 'N/A'})...")

        for panel_key, tests in PRESET_PANELS.items():
            panel_name = panel_key.upper().replace("_", " ")
            lab_ids = []
            for t in tests:
                lid = add_lab_result(
                    conn=conn,
                    patient_id=p_id,
                    test_name=t["test_name"],
                    category=t["category"],
                    result_value=t["result_value"],
                    unit=t["unit"],
                    reference_range=t["reference_range"],
                    flag=t["flag"],
                    notes=f"Automated pre-operative testing panel ({panel_name})"
                )
                lab_ids.append(lid)

            # Generate and attach diagnostic report slip image
            svg_data_uri = generate_svg_lab_slip(full_name, hrn or "HRN-000000", panel_name, tests)
            file_name = f"Lab_Report_{panel_name.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}.svg"
            add_attachment(
                conn=conn,
                patient_id=p_id,
                file_name=file_name,
                file_type="image/svg+xml",
                file_size=len(svg_data_uri),
                file_data=svg_data_uri,
                category="LAB_REPORT",
                notes=f"Automated digital slip for {panel_name} panel",
                lab_id=lab_ids[0] if lab_ids else None
            )

    print("[OK] Auto-seeding completed successfully.")

def import_from_json(conn: sqlite3.Connection, json_path: str, default_patient_id: Optional[str] = None) -> int:
    """Ingest lab results and attachments from structured JSON file."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data if isinstance(data, list) else [data]
    count = 0

    for item in items:
        p_id = item.get("patient_id") or item.get("patientId") or default_patient_id
        hrn = item.get("hrn")
        resolved_pid, _, _ = get_or_create_patient(conn, p_id or hrn)

        # Ingest lab result
        test_name = item.get("test_name") or item.get("testName")
        if test_name:
            lab_id = add_lab_result(
                conn=conn,
                patient_id=resolved_pid,
                test_name=test_name,
                category=item.get("category", "OTHER"),
                result_value=str(item.get("result_value") or item.get("value") or ""),
                unit=item.get("unit", ""),
                reference_range=item.get("reference_range") or item.get("referenceRange", ""),
                flag=item.get("flag", "NORMAL"),
                result_date=item.get("result_date") or item.get("date"),
                notes=item.get("notes")
            )
            count += 1
        else:
            lab_id = None

        # Ingest file attachment if specified
        file_path = item.get("file_path") or item.get("filePath")
        if file_path and os.path.isfile(file_path):
            uri, mime, size = file_to_data_uri(file_path)
            add_attachment(
                conn=conn,
                patient_id=resolved_pid,
                file_name=os.path.basename(file_path),
                file_type=mime,
                file_size=size,
                file_data=uri,
                category=item.get("file_category", "LAB_REPORT"),
                notes=item.get("file_notes", f"Imported via {os.path.basename(json_path)}"),
                lab_id=lab_id
            )

    conn.commit()
    return count

def import_from_csv(conn: sqlite3.Connection, csv_path: str, default_patient_id: Optional[str] = None) -> int:
    """Ingest lab results from CSV file."""
    count = 0
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = row.get("patient_id") or row.get("hrn") or default_patient_id
            resolved_pid, _, _ = get_or_create_patient(conn, pid)
            test_name = row.get("test_name") or row.get("Test")
            if not test_name:
                continue

            add_lab_result(
                conn=conn,
                patient_id=resolved_pid,
                test_name=test_name,
                category=row.get("category") or row.get("Category", "OTHER"),
                result_value=row.get("result_value") or row.get("Value", ""),
                unit=row.get("unit") or row.get("Unit", ""),
                reference_range=row.get("reference_range") or row.get("ReferenceRange", ""),
                flag=row.get("flag") or row.get("Flag", "NORMAL"),
                result_date=row.get("result_date") or row.get("Date"),
                notes=row.get("notes") or row.get("Notes")
            )
            count += 1

    conn.commit()
    return count

def run_watch_loop(conn: sqlite3.Connection, watch_dir: str, poll_interval: float = 3.0) -> None:
    """Hot-folder automation daemon watching for incoming lab reports."""
    watch_path = pathlib.Path(watch_dir).resolve()
    processed_path = watch_path / "processed"
    failed_path = watch_path / "failed"

    watch_path.mkdir(parents=True, exist_ok=True)
    processed_path.mkdir(parents=True, exist_ok=True)
    failed_path.mkdir(parents=True, exist_ok=True)

    print(f"[*] Starting Lab Hot-Folder Automation Watcher on: {watch_path}")
    print(f"[*] Waiting for files... (Press Ctrl+C to stop)")

    try:
        while True:
            for item in watch_path.iterdir():
                if item.is_dir() or item.name.startswith("."):
                    continue

                print(f"[+] Detected incoming file: {item.name}")
                try:
                    ext = item.suffix.lower()
                    if ext == ".json":
                        n = import_from_json(conn, str(item))
                        print(f"  -> Ingested {n} lab results from JSON")
                    elif ext == ".csv":
                        n = import_from_csv(conn, str(item))
                        print(f"  -> Ingested {n} lab results from CSV")
                    elif ext in [".png", ".jpg", ".jpeg", ".pdf", ".svg", ".webp"]:
                        # Extract HRN or patient ID from filename (e.g. HRN-123456_CBC.png)
                        parts = item.stem.split("_")
                        candidate_id = parts[0] if parts else None
                        resolved_pid, p_name, _ = get_or_create_patient(conn, candidate_id)
                        uri, mime, size = file_to_data_uri(str(item))
                        add_attachment(
                            conn=conn,
                            patient_id=resolved_pid,
                            file_name=item.name,
                            file_type=mime,
                            file_size=size,
                            file_data=uri,
                            category="LAB_REPORT",
                            notes=f"Auto-ingested from hot-folder for {p_name}"
                        )
                        print(f"  -> Attached clinical image/file to {p_name} ({size} bytes)")
                    else:
                        print(f"  [!] Unknown file format, skipping: {item.name}")
                        continue

                    # Move to processed
                    dest = processed_path / f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{item.name}"
                    shutil.move(str(item), str(dest))
                    print(f"  -> Archived to: {dest.name}")
                except Exception as ex:
                    print(f"  [X] Failed processing {item.name}: {ex}")
                    dest = failed_path / f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{item.name}"
                    shutil.move(str(item), str(dest))

            time.sleep(poll_interval)
    except KeyboardInterrupt:
        print("\n[*] Hot-folder watcher stopped.")

def print_summary_report(conn: sqlite3.Connection) -> None:
    """Print ASCII report of all patient labs and attachments."""
    cur = conn.cursor()
    cur.execute("""
        SELECT p.patient_id, p.first_name, p.last_name, p.hrn,
               COUNT(DISTINCT l.lab_id) as lab_count,
               COUNT(DISTINCT a.attachment_id) as att_count
        FROM patients p
        LEFT JOIN patient_lab_results l ON p.patient_id = l.patient_id
        LEFT JOIN clinical_attachments a ON p.patient_id = a.patient_id
        WHERE p.is_archived = 0
        GROUP BY p.patient_id
    """)
    rows = cur.fetchall()

    print("\n" + "=" * 80)
    print("OR PATIENT MANAGEMENT - CLINICAL LABS & ATTACHMENTS REGISTRY")
    print("=" * 80)
    print(f"{'HRN':<14} {'PATIENT NAME':<25} {'LAB RESULTS':<14} {'ATTACHMENTS':<14}")
    print("-" * 80)
    for r in rows:
        hrn = r[3] or "None"
        name = f"{r[1]} {r[2]}"
        print(f"{hrn:<14} {name:<25} {r[4]:<14} {r[5]:<14}")
    print("=" * 80 + "\n")

def main():
    parser = argparse.ArgumentParser(
        description="Clinical Laboratory Results & File Attachments Automation Engine"
    )
    parser.add_argument("--db", type=str, help="Path to SQLite database file")
    parser.add_argument("--sample", "--demo", action="store_true", help="Auto-seed realistic clinical lab panels & slip images")
    parser.add_argument("--patient-id", "--hrn", type=str, dest="patient_id", help="Target patient ID or HRN")
    parser.add_argument("--panel", type=str, choices=list(PRESET_PANELS.keys()), help="Add complete preset panel (cbc, cmp, coag, blood_bank, abg)")
    parser.add_argument("--add-lab", action="store_true", help="Add a single lab result")
    parser.add_argument("--test-name", type=str, help="Lab test name")
    parser.add_argument("--category", type=str, default="HEMATOLOGY", help="Category (HEMATOLOGY, CHEMISTRY, COAGULATION, BLOOD_BANK, ARTERIAL_BLOOD_GAS, URINALYSIS, MICROBIOLOGY, OTHER)")
    parser.add_argument("--value", type=str, help="Lab result value")
    parser.add_argument("--unit", type=str, default="", help="Unit of measure")
    parser.add_argument("--ref-range", type=str, default="", help="Reference range")
    parser.add_argument("--flag", type=str, default="NORMAL", choices=["NORMAL", "HIGH", "LOW", "CRITICAL", "ABNORMAL"], help="Clinical flag")
    parser.add_argument("--attach-file", type=str, help="Local file path to encode & attach")
    parser.add_argument("--file-category", type=str, default="LAB_REPORT", choices=["LAB_REPORT", "IMAGING", "CONSENT_FORM", "PATHOLOGY", "OPERATIVE_PHOTO", "OTHER"], help="Attachment category")
    parser.add_argument("--file-notes", type=str, help="Notes for the file attachment")
    parser.add_argument("--import-json", type=str, help="Import lab results from JSON file")
    parser.add_argument("--import-csv", type=str, help="Import lab results from CSV file")
    parser.add_argument("--watch", type=str, help="Start hot-folder automation daemon monitoring given folder")
    parser.add_argument("--report", "--list", action="store_true", help="Print registry summary report")

    args = parser.parse_args()

    db_path = locate_database(args.db)
    print(f"[*] Database target: {db_path}")

    # Connect and init schema
    conn = sqlite3.connect(db_path)
    init_schema_if_needed(conn)

    # Dispatch commands
    if args.sample:
        auto_seed_demo_labs(conn, args.patient_id)
        print_summary_report(conn)
    elif args.panel:
        p_id, p_name, hrn = get_or_create_patient(conn, args.patient_id)
        tests = PRESET_PANELS[args.panel]
        print(f"[+] Adding {args.panel.upper()} panel ({len(tests)} tests) to {p_name} ({hrn})...")
        for t in tests:
            add_lab_result(
                conn=conn,
                patient_id=p_id,
                test_name=t["test_name"],
                category=t["category"],
                result_value=t["result_value"],
                unit=t["unit"],
                reference_range=t["reference_range"],
                flag=t["flag"]
            )
        # Generate slip
        svg_uri = generate_svg_lab_slip(p_name, hrn, args.panel.upper(), tests)
        add_attachment(
            conn=conn,
            patient_id=p_id,
            file_name=f"{args.panel.upper()}_Slip.svg",
            file_type="image/svg+xml",
            file_size=len(svg_uri),
            file_data=svg_uri,
            category="LAB_REPORT",
            notes=f"Automated slip for {args.panel.upper()} panel"
        )
        print("[OK] Panel and diagnostic slip added successfully.")
    elif args.add_lab:
        if not args.test_name or not args.value:
            print("[X] Error: --test-name and --value are required for --add-lab.")
            sys.exit(1)
        p_id, p_name, hrn = get_or_create_patient(conn, args.patient_id)
        lid = add_lab_result(
            conn=conn,
            patient_id=p_id,
            test_name=args.test_name,
            category=args.category,
            result_value=args.value,
            unit=args.unit,
            reference_range=args.ref_range,
            flag=args.flag
        )
        print(f"[OK] Added lab result '{args.test_name}' for {p_name} (ID: {lid})")
    elif args.attach_file:
        p_id, p_name, hrn = get_or_create_patient(conn, args.patient_id)
        data_uri, mime, size = file_to_data_uri(args.attach_file)
        aid = add_attachment(
            conn=conn,
            patient_id=p_id,
            file_name=os.path.basename(args.attach_file),
            file_type=mime,
            file_size=size,
            file_data=data_uri,
            category=args.file_category,
            notes=args.file_notes or f"Attached from {args.attach_file}"
        )
        print(f"[OK] Uploaded and attached {os.path.basename(args.attach_file)} to {p_name} (ID: {aid}, {size} bytes)")
    elif args.import_json:
        n = import_from_json(conn, args.import_json, args.patient_id)
        print(f"[OK] Imported {n} lab results from {args.import_json}")
    elif args.import_csv:
        n = import_from_csv(conn, args.import_csv, args.patient_id)
        print(f"[✓] Imported {n} lab results from {args.import_csv}")
    elif args.watch:
        run_watch_loop(conn, args.watch)
    else:
        # Default action: show report and auto-seed if database is empty
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM patient_lab_results")
        count = cur.fetchone()[0]
        if count == 0:
            print("[*] No lab results found. Running auto-seed demo...")
            auto_seed_demo_labs(conn)
        print_summary_report(conn)

    conn.close()

if __name__ == "__main__":
    main()
