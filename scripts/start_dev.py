"""Start the app in development mode with live reload. Double-click to run.

Usage: start_dev.py [--browser]   (--browser runs the web preview without the desktop shell)
"""

import sys

from _common import ROOT, main_wrapper, require, run, step


def main() -> None:
    require("npm")
    if not (ROOT / "node_modules").exists():
        step("Installing dependencies")
        run("npm install --no-audit --no-fund")
    if "--browser" in sys.argv[1:]:
        step("Starting the browser preview (Ctrl+C to stop)")
        run("npm run dev", check=False)
    else:
        require("cargo")
        step("Starting the desktop app (Ctrl+C to stop)")
        run("npm run tauri dev", check=False)


if __name__ == "__main__":
    main_wrapper(main)
