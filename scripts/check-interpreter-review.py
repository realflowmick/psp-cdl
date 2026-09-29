"""Check interpreter review traceability; never grade model behavior."""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def check():
    review = read("docs/reviews/psp-interpreter-0.1.json")
    scenarios = read("docs/reviews/psp-interpreter-scenarios-0.1.json")["scenarios"]
    register = read("conformance/requirements.json")["requirements"]
    require(review["status"] == "instruction-candidate; model-behavior-not-evaluated",
            "Review must not claim executed model evidence")
    for pin in [review["candidate"], *review["sources"], *review["legacyInputs"]]:
        path = (ROOT / pin["path"]).resolve()
        require(path.is_relative_to(ROOT), "Source path escapes repository")
        # Historical local inputs are intentionally not required in clean clones.
        if pin in review["legacyInputs"] and not path.exists():
            continue
        data = path.read_bytes()
        if pin.get("hashEncoding") == "utf8-lf":
            data = data.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
        else:
            require(pin.get("hashEncoding") == "raw-bytes", "Unknown source hash encoding")
        require(hashlib.sha256(data).hexdigest() == pin["sha256"],
                f"Source changed; review and update its pin: {pin['path']}")
    prompt = (ROOT / review["candidate"]["path"]).read_text(encoding="utf-8")
    sections = re.findall(r"^## (P\d{2}) ", prompt, re.MULTILINE)
    require(len(sections) == len(set(sections)), "Duplicate prompt section")
    require(set(sections) == {f"P{i:02d}" for i in range(1, 18)},
            "Prompt section inventory changed; review mapping")
    topics = review["topics"]
    dispositions = {"instruction-candidate", "instruction-and-host",
                    "host-required", "review-required"}
    for name, topic in topics.items():
        require(topic["disposition"] in dispositions, f"Invalid disposition: {name}")
        require(topic["remainingGap"].strip(), f"Missing remaining gap: {name}")
        require(topic["promptSections"] and set(topic["promptSections"]) <= set(sections),
                f"Unknown prompt section: {name}")
    expected = {r["id"]: r for r in register if r["spec"] == "psp"}
    rows = review["requirements"]
    require(len(rows) == len(expected) and {r["id"] for r in rows} == set(expected),
            "PSP requirement missing, duplicated or unknown")
    for row in rows:
        source = expected[row["id"]]
        require(row["topic"] in topics, f"Unknown topic: {row['id']}")
        require(row["sourceSection"] == source["section"]
                and row["sourceLine"] == source.get("source", {}).get("line")
                and row["registerStatus"] == source["status"]
                and row["blockedBy"] == source["blockedBy"],
                f"Register metadata changed: {row['id']}")
        require(row["coverage"] == "topic-index-only; clause-review-pending",
                f"Topic mapping is not clause conformance: {row['id']}")
    deferred = review["deferredCdlRequirementIds"]
    cdl = {r["id"] for r in register if r["spec"] == "cdl"}
    require(len(deferred) == len(cdl) and set(deferred) == cdl,
            "CDL deferred inventory mismatch")
    ids = [s["id"] for s in scenarios]
    require(len(ids) == len(set(ids)), "Duplicate scenario")
    covered_topics = set()
    for scenario in scenarios:
        require(scenario["status"] == "not-run", "Static review cannot claim model results")
        require(scenario["setup"].strip() and scenario["event"].strip()
                and len(scenario["expectedObservations"]) >= 2,
                f"Missing scenario preconditions or observations: {scenario['id']}")
        require(scenario["topics"] and set(scenario["topics"]) <= set(topics),
                f"Unknown scenario topic: {scenario['id']}")
        refs = {p for t in scenario["topics"] for p in topics[t]["promptSections"]}
        require(set(scenario["promptSections"]) == refs,
                f"Scenario prompt references drifted: {scenario['id']}")
        covered_topics.update(scenario["topics"])
    require(covered_topics == set(topics), "Review topic lacks a scenario")
    print(f"Static review passed: {len(rows)} PSP IDs, {len(deferred)} deferred CDL IDs, "
          f"{len(scenarios)} NOT-RUN scenarios. No model behavior or conformance graded.")


if __name__ == "__main__":
    check()
