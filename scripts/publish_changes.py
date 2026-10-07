"""Check, commit and push local changes to GitHub. Double-click to run.

Steps: type check, run the tests, show what changed, ask for a short description,
commit everything and push. Nothing is pushed when a check fails.

Usage: publish_changes.py ["commit message"]
"""

import re
import sys
from datetime import datetime

from _common import ask_yes, capture, main_wrapper, require, run, step

# Never publish credentials: OpenRouter keys and similar tokens.
SECRET_PATTERN = re.compile(r"sk-or-v1-[0-9a-f]{20,}|sk-ant-[\w-]{20,}|ghp_[0-9A-Za-z]{30,}")


def main() -> None:
    require("git", "npm")

    step("Changes to publish")
    if not capture("git status --porcelain"):
        print("No local changes.")
        if capture("git log @{u}..HEAD --oneline"):
            step("Pushing commits that are not on GitHub yet")
            run("git push")
        return
    run("git status --short")

    step("Type check")
    run("npm run typecheck")
    step("Tests")
    run("npm test")

    run("git add -A")
    step("Checking for secrets")
    added = [line for line in capture("git diff --cached --unified=0").splitlines() if line.startswith("+")]
    if any(SECRET_PATTERN.search(line) for line in added):
        run("git reset", check=False)
        raise SystemExit("An API key or token is in the changes. Remove it from the files, then run this again.")
    print("None found.")

    message = " ".join(sys.argv[1:]).strip() or input("\nShort description of this update: ").strip()
    if not message:
        message = f"Update {datetime.now():%Y-%m-%d %H:%M}"
    message = message.replace('"', "'")

    branch = capture("git branch --show-current")
    if not ask_yes(f'Commit as "{message}" and push to {branch}?'):
        run("git reset", check=False)
        raise SystemExit("Nothing was committed.")

    step("Commit and push")
    run(f'git commit -m "{message}"')
    run("git push")


if __name__ == "__main__":
    main_wrapper(main)
