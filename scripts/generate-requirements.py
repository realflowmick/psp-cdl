# SPDX-License-Identifier: Apache-2.0
"""Reproducible, deliberately conservative RFC keyword/obligation register."""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEYWORDS = re.compile(r"\b(?:MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|RECOMMENDED|REQUIRED|MAY|OPTIONAL)\b")
SOURCES = [("psp", "3.2.0", "specs/psp/RFC-PSP-CORE-v3_2_0.md"),
           ("cdl", "1.5", "specs/cdl/RFC-CDL-v1_5.md")]


def audit(text, spec, version, path):
    lines = text.splitlines()
    headings, fence, entries = [], None, []
    for index, line in enumerate(lines):
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            if fence is None:
                fence = marker[1][0]
            elif marker[1][0] == fence:
                fence = None
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading and fence is None:
            level = len(heading[1])
            headings = [(depth, title) for depth, title in headings if depth < level]
            headings.append((level, heading[2]))
        matches = list(KEYWORDS.finditer(line))
        if not matches:
            continue
        # Include the rest of the paragraph/list/table under a lead-in obligation.
        end = index + 1
        while end < len(lines) and not re.match(r"^#{1,6}\s", lines[end]):
            if end > index + 1 and not lines[end].strip() and not lines[end-1].strip():
                break
            end += 1
        definition = 'key words "MUST"' in line
        for ordinal, match in enumerate(matches, 1):
            entries.append({
                "id": f"{spec.upper()}-{version}-L{index+1:05d}-{ordinal:02d}",
                "spec": spec, "version": version, "path": path,
                "line": index + 1, "column": match.start() + 1,
                "keyword": match[0], "heading": [title for _, title in headings],
                "quote": line, "contextEndLine": end,
                "disposition": "example" if fence else "keyword-definition" if definition else "obligation-candidate",
            })
    return entries


def classify(entry):
    spec, quote = entry["spec"], entry["quote"].lower()
    heading = " / ".join(entry["heading"])
    section = entry["heading"][-1] if entry["heading"] else "Preamble"
    component, profile, boundary = "core", "none; baseline-only", "host implementation"
    evidence, blockers = [], []
    if spec == "cdl":
        component, profile, boundary = "cdl", "CDL-DETERMINISTIC-1.0; PSP-TRUST-1.0", "host policy decision and complete mediation"
        if re.search(r"\b(?:3|6|7)\.", section):
            evidence = ["policy"]
    elif re.search(r"\b(?:6|7)\.", section):
        profile, boundary, evidence = "PSP-CODEC-1.0", "representation parser; no workflow validation", ["codec"]
        blockers = ["PSP-E007"]
    elif "17." in heading:
        profile, boundary, evidence = "PSP-SIGNATURE-2.0", "signature bytes, host key authority and clock", ["signature"]
    elif "22.5" in heading or "API" in entry["quote"]:
        component, boundary, blockers = "mcp-server", "authenticated service boundary", ["PSP-E006"]
    elif "24." in heading:
        component, boundary, blockers = "llmproxy", "host prompt refresh and expiry", ["PSP-E008", "PSP-E009"]
    elif any(word in quote for word in ["tool", "mcp", "affinity"]):
        component, boundary = "mcpproxy", "host discovery, dispatch and output gates"
    elif any(word in quote for word in ["session", "checkpoint", "persist"]):
        component, boundary = "api-server", "host-owned durable workflow state"
    elif any(word in quote for word in ["llm", "model", "attention", "inference"]):
        component, boundary = "llmproxy", "host/model boundary; engine guarantees unsupported"
    return {
        "id": entry["id"], "spec": spec, "version": entry["version"], "section": section,
        "title": entry["quote"], "source": {k: entry[k] for k in ("path", "line", "column", "heading", "keyword", "contextEndLine")},
        "component": component, "boundary": boundary, "profile": profile,
        "status": "blocked" if blockers else "unimplemented", "blockedBy": blockers,
        "relatedEvidence": evidence,
        "gap": "No clause-complete adapter/assertion mapping reviewed. Related profile evidence is partial and does not discharge this obligation.",
    }


def generate():
    seed = json.loads((ROOT / "conformance/vectors/requirements/seeds.json").read_text(encoding="utf-8"))
    evidence = json.loads((ROOT / "specs/reviews/evidence-0.1.json").read_text(encoding="utf-8"))
    entries, sources = [], []
    for spec, version, path in SOURCES:
        raw = (ROOT / path).read_bytes()
        found = audit(raw.decode("utf-8"), spec, version, path)
        entries.extend(found)
        sources.append({"path": path, "version": version, "sha256": hashlib.sha256(raw).hexdigest(),
                        "keywordCounts": dict(sorted(Counter(e["keyword"] for e in found).items()))})
    return {"schemaVersion": 2, "coverage": "complete-uppercase-keyword-audit; conservative-obligation-candidates; clause-conformance-unimplemented",
            "review": "specs/reviews/PSP-CDL-REVIEW-0.1.md", "sources": sources, "evidence": evidence,
            "requirements": seed + [classify(e) for e in entries if e["disposition"] == "obligation-candidate"],
            "keywordAudit": entries}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = ROOT / "conformance/requirements.json"
    data = generate()
    if args.check:
        if json.loads(target.read_text(encoding="utf-8")) != data:
            raise SystemExit("Requirement inventory is stale; regenerate and review the diff")
    else:
        target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Audited {len(data['keywordAudit'])} keyword occurrences; {len(data['requirements'])} conservative entries, including 31 legacy seeds. No conformance asserted.")
