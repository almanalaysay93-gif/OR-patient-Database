"""Update the OR Patient Management app to the latest version. Double-click to run.

Steps: back up the local database, download the latest code from GitHub, install
dependencies when they changed, build the Windows installer and open it.

Options:
  --no-build   only download the code and dependencies
  --no-open    build the installer but do not open it
"""

import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

from _common import ROOT, ask_yes, capture, main_wrapper, require, run, step

APP_DATA = Path(os.environ.get("APPDATA", "")) / "ph.local.orpatientmanagement"
DB_NAME = "or-patient-management.db"


def backup_database() -> None:
    step("Backing up the local database")
    db = APP_DATA / "Database" / DB_NAME
    if not db.exists():
        print("No installed database found on this computer. Nothing to back up.")
        return
    target = APP_DATA / "Backups" / f"pre-update-{datetime.now():%Y%m%d-%H%M%S}"
    target.mkdir(parents=True, exist_ok=True)
    # The -wal and -shm files hold recent changes, so they are copied with the main file.
    for suffix in ("", "-wal", "-shm"):
        src = db.with_name(db.name + suffix)
        if src.exists():
            shutil.copy2(src, target / src.name)
    print(f"Backup saved to {target}")


def pull_latest() -> bool:
    """Download the latest code. Returns True when anything changed."""
    step("Downloading the latest version")
    if capture("git status --porcelain --untracked-files=no"):
        print("This folder has local changes that are not on GitHub:")
        run("git status --short --untracked-files=no", check=False)
        if not ask_yes("Set them aside (git stash) and continue?"):
            raise SystemExit("Update stopped. Nothing was changed.")
        run('git stash push -m "before update_app.py"')
        print("Local changes saved. Restore them later with: git stash pop")
    before = capture("git rev-parse HEAD")
    run("git pull --ff-only")
    after = capture("git rev-parse HEAD")
    if before == after:
        print("Already up to date.")
        return False
    run(f"git log --oneline {before}..{after}", check=False)
    return True


def install_dependencies() -> None:
    step("Checking dependencies")
    marker = ROOT / "node_modules" / ".package-lock.json"
    lock = ROOT / "package-lock.json"
    if marker.exists() and marker.stat().st_mtime >= lock.stat().st_mtime:
        print("Dependencies are current.")
        return
    run("npm install --no-audit --no-fund")


def newest_installer() -> Path | None:
    bundle = ROOT / "src-tauri" / "target" / "release" / "bundle" / "nsis"
    installers = sorted(bundle.glob("*.exe"), key=lambda p: p.stat().st_mtime)
    return installers[-1] if installers else None


def main() -> None:
    args = set(sys.argv[1:])
    require("git", "npm")
    backup_database()
    changed = pull_latest()
    install_dependencies()

    if "--no-build" in args:
        return
    installer = newest_installer()
    if not changed and installer and not ask_yes("No new version. Rebuild the installer anyway?"):
        print(f"Existing installer: {installer}")
        return

    require("cargo")
    step("Building the installer (the first build can take several minutes)")
    run("npm run tauri build")
    installer = newest_installer()
    if not installer:
        raise SystemExit("Build finished but no installer was found.")
    print(f"\nInstaller ready: {installer}")
    if "--no-open" not in args:
        step("Opening the installer")
        print("Close the app if it is running, then follow the installer. Patient data is kept.")
        os.startfile(installer)


if __name__ == "__main__":
    main_wrapper(main)
