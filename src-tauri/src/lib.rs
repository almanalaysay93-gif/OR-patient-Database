use rusqlite::{types::ValueRef, Connection};
use serde::Serialize;
use serde_json::{Map, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};

struct DbState(Mutex<Connection>);

#[derive(Serialize, Clone)]
struct AppPaths {
    data_dir: String,
    db_path: String,
    backup_dir: String,
    export_dir: String,
    log_dir: String,
}

struct PathsState(AppPaths);

#[derive(Serialize)]
struct ExecResult {
    changes: usize,
}

/// Map rusqlite errors to messages that do not leak SQL internals as the primary text.
fn friendly(err: rusqlite::Error) -> String {
    let raw = err.to_string();
    if raw.contains("FOREIGN KEY") {
        return format!("This record is linked to other records and cannot be changed this way. Archive it instead. [{raw}]");
    }
    if raw.contains("UNIQUE") {
        return format!("A record with the same identifier already exists. [{raw}]");
    }
    if raw.contains("CHECK") {
        return format!("A value is outside the allowed range or order (for example an end time before a start time). [{raw}]");
    }
    raw
}

fn to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                V::Integer(i)
            } else {
                V::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => V::Text(s.clone()),
        other => V::Text(other.to_string()),
    }
}

#[tauri::command]
fn db_select(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&sql).map_err(friendly)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bound: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(bound.iter())).map_err(friendly)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(friendly)? {
        let mut m = Map::new();
        for (i, name) in names.iter().enumerate() {
            let v = match row.get_ref(i).map_err(friendly)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(f) => Value::from(f),
                ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
                ValueRef::Blob(_) => Value::Null,
            };
            m.insert(name.clone(), v);
        }
        out.push(m);
    }
    Ok(out)
}

#[tauri::command]
fn db_execute(state: State<DbState>, sql: String, params: Vec<Value>) -> Result<ExecResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let bound: Vec<rusqlite::types::Value> = params.iter().map(to_sql).collect();
    let changes = conn
        .execute(&sql, rusqlite::params_from_iter(bound.iter()))
        .map_err(friendly)?;
    Ok(ExecResult { changes })
}

#[tauri::command]
fn app_paths(paths: State<PathsState>) -> AppPaths {
    paths.0.clone()
}

fn ensure(dir: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // %APPDATA%\<identifier> - never beside the executable.
            let data_dir = app.path().app_data_dir()?;
            let db_dir = data_dir.join("Database");
            let backup_dir = data_dir.join("Backups");
            let export_dir = data_dir.join("Exports");
            let log_dir = data_dir.join("Logs");
            for d in [&db_dir, &backup_dir, &export_dir, &log_dir] {
                ensure(d)?;
            }
            let db_path = db_dir.join("or-patient-management.db");
            let conn = Connection::open(&db_path)?;
            conn.execute_batch(
                "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
            )?;
            app.manage(DbState(Mutex::new(conn)));
            app.manage(PathsState(AppPaths {
                data_dir: data_dir.display().to_string(),
                db_path: db_path.display().to_string(),
                backup_dir: backup_dir.display().to_string(),
                export_dir: export_dir.display().to_string(),
                log_dir: log_dir.display().to_string(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_select, db_execute, app_paths])
        .run(tauri::generate_context!())
        .expect("error while running OR Patient Management");
}
