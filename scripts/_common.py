"""Shared helpers for the click-to-run automation scripts."""

import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def step(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def run(cmd: str, check: bool = True) -> int:
    """Run a command in the project folder, showing its output live."""
    print(f"> {cmd}", flush=True)
    code = subprocess.call(cmd, cwd=ROOT, shell=True)
    if check and code != 0:
        raise SystemExit(f"\nFAILED: {cmd} (exit code {code})")
    return code


def capture(cmd: str) -> str:
    """Run a command and return its output, or an empty string if it fails."""
    result = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def require(*tools: str) -> None:
    missing = [t for t in tools if shutil.which(t) is None]
    if missing:
        raise SystemExit(f"Missing required program(s): {', '.join(missing)}. Install them and run this again.")


def ask_yes(question: str) -> bool:
    return input(f"{question} [y/N] ").strip().lower() in ("y", "yes")


def main_wrapper(main) -> None:
    """Run main() and keep the window open afterwards so a double-click user can read the result."""
    code = 0
    try:
        main()
        print("\nDONE.")
    except SystemExit as exc:
        if exc.code not in (None, 0):
            print(exc.code if isinstance(exc.code, str) else f"\nStopped (exit code {exc.code}).")
            code = 1
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        code = 1
    except Exception:
        traceback.print_exc()
        code = 1
    if sys.stdin.isatty() and not os.environ.get("NO_PAUSE"):
        input("\nPress Enter to close this window...")
    sys.exit(code)
