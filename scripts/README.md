# Automation scripts

Double-click a script in File Explorer (Python 3.10+ required), or run `python scripts\<name>.py`.

| Script | What it does |
| --- | --- |
| `update_app.py` | Backs up the local database, pulls the latest code, installs dependencies if they changed, builds the Windows installer and opens it. `--no-build` only pulls; `--no-open` skips opening the installer. |
| `publish_changes.py` | Runs the type check and tests, scans for API keys, then commits and pushes all local changes. Optional argument: the commit message. |
| `start_dev.py` | Starts the desktop app in development mode. `--browser` starts the web preview instead. |

`update_app.py` needs Git, Node.js and Rust (cargo) on the computer. Patient data lives in
`%APPDATA%\ph.local.orpatientmanagement` and is not touched by an update; a copy is saved under
`Backups\pre-update-<time>` first.
