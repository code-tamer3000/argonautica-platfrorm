#!/usr/bin/env python3
"""Argonautica agent dispatcher.

Label state machine:
    backlog -> queued -> in-progress -> in-review -> merged/closed
                 ^           |
                 +- failed --+   (auto-requeue up to MAX_RETRIES, then needs-human)

Responsibilities per run (cron, every 30 min):
  1. Requeue `failed` issues (typically quota-window failures) -> `queued`;
     after MAX_RETRIES failures -> `needs-human`.
  2. Count `in-progress`; if below MAX_CONCURRENT, launch the oldest `queued`
     issues whose blockers ("Blocked by #N" in body) are all closed,
     via workflow_dispatch on agent-implement.yml.

Humans and the planner NEVER launch work directly: they label `queued`.
The `ready` label remains as a manual override lane for humans only.
"""

import os
import re
import sys

import requests

REPO = os.environ["GITHUB_REPOSITORY"]
TOKEN = os.environ["GITHUB_TOKEN"]
API = f"https://api.github.com/repos/{REPO}"
HDRS = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"}

MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "2"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "3"))
IMPLEMENT_WORKFLOW = os.environ.get("IMPLEMENT_WORKFLOW", "agent-implement.yml")
DISPATCH_REF = os.environ.get("DISPATCH_REF", "develop")
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

FAILURE_MARKER = "Agent run failed"  # must match the comment agent-implement.yml posts


def get(url, **params):
    r = requests.get(url, headers=HDRS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def issues_with(label):
    """Open issues (not PRs) carrying `label`, oldest first."""
    data = get(f"{API}/issues", labels=label, state="open",
               sort="created", direction="asc", per_page=100)
    return [i for i in data if "pull_request" not in i]


def blockers_open(issue):
    nums = re.findall(r"[Bb]locked by #(\d+)", issue.get("body") or "")
    for n in nums:
        if get(f"{API}/issues/{n}")["state"] == "open":
            return int(n)
    return None


def failure_count(issue):
    comments = get(issue["comments_url"], per_page=100)
    return sum(1 for c in comments if FAILURE_MARKER in (c.get("body") or ""))


def relabel(issue, add, remove):
    n = issue["number"]
    if DRY_RUN:
        print(f"  DRY_RUN: #{n} -{remove} +{add}")
        return
    for lbl in remove:
        requests.delete(f"{API}/issues/{n}/labels/{lbl}", headers=HDRS, timeout=30)
        # 404 (label absent) is fine — labels are idempotent state, not events
    r = requests.post(f"{API}/issues/{n}/labels", headers=HDRS,
                      json={"labels": add}, timeout=30)
    r.raise_for_status()


def launch(issue):
    n = issue["number"]
    if DRY_RUN:
        print(f"  DRY_RUN: would dispatch {IMPLEMENT_WORKFLOW} for #{n}")
        return
    r = requests.post(
        f"{API}/actions/workflows/{IMPLEMENT_WORKFLOW}/dispatches",
        headers=HDRS, timeout=30,
        json={"ref": DISPATCH_REF, "inputs": {"issue_number": str(n)}},
    )
    r.raise_for_status()
    print(f"  dispatched #{n}: {issue['title']!r}")


def main():
    # 1. Failed -> queued (retry) or needs-human (retries exhausted)
    for issue in issues_with("failed"):
        n = issue["number"]
        fails = failure_count(issue)
        if fails >= MAX_RETRIES:
            print(f"#{n}: {fails} failures >= {MAX_RETRIES} -> needs-human")
            relabel(issue, add=["needs-human"], remove=["failed"])
        else:
            print(f"#{n}: failure {fails}/{MAX_RETRIES} -> requeue")
            relabel(issue, add=["queued"], remove=["failed"])

    # 2. Fill free slots from the queue
    running = issues_with("in-progress")
    slots = MAX_CONCURRENT - len(running)
    print(f"running={len(running)} max={MAX_CONCURRENT} slots={slots}")
    if slots <= 0:
        return

    launched = 0
    for issue in issues_with("queued"):
        if launched >= slots:
            break
        blocker = blockers_open(issue)
        if blocker:
            print(f"#{issue['number']}: blocked by open #{blocker}, skip")
            continue
        launch(issue)
        relabel(issue, add=["in-progress"], remove=["queued"])
        launched += 1

    print(f"launched={launched}")


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"GitHub API error: {e} — body: {e.response.text[:500]}", file=sys.stderr)
        sys.exit(1)