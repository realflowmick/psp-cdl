# SPDX-License-Identifier: Apache-2.0
"""Versioned proposal map; verifies exact frozen headings and draft route coverage."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PSP = "specs/psp/RFC-PSP-CORE-v3_2_0.md"
CDL = "specs/cdl/RFC-CDL-v1_5.md"


def generate():
    lines = (ROOT / PSP).read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line == "#### 22.5.2 Required MCP Tools")
    end = next(i for i in range(start+1, len(lines)) if lines[i].startswith("#### "))
    tools = re.findall(r"\| `(realflow\.[^`]+)`", "\n".join(lines[start:end]))
    assert len(tools) == 11 and len(set(tools)) == 11
    mapping = []
    for name in tools:
        missing = name.endswith((".list", ".decrypt", ".scan", ".process"))
        item = {"name": name, "status": "missing-interface" if missing else "draft-counterpart-not-rfc-conformance"}
        if missing:
            item["issue"] = 37 if name.endswith(".list") else 38
        else:
            item["contract"] = "schemas/api/" + ("security" if name.endswith(".verify") else "workflow") + "-0.1.openapi.json"
            item["path"] = "/v1/" + "/".join(name.split(".")[1:])
            contract = json.loads((ROOT / item["contract"]).read_text(encoding="utf-8"))
            assert "post" in contract["paths"][item["path"]], item
        mapping.append(item)
    edits, references = [], []
    for path in (PSP, CDL, "specs/psp/RFC-PSP-CORE-v3_1_1.md"):
        source = (ROOT / path).read_text(encoding="utf-8").splitlines()
        rbac = False
        for number, line in enumerate(source, 1):
            if "RFC-PSP-API" in line:
                references.append({"path": path, "line": number, "quote": line, "status": "absent-document", "target": "historical" if "3_1_1" in path else "current"})
            if path == PSP and line.startswith(("#### 21.5.4 ", "#### 21.5.5 ")):
                edits.append({"path": path, "line": number, "old": line, "proposed": line.replace("21.5.", "22.5.", 1)})
            if path == CDL:
                if line.startswith("## "):
                    rbac = line.startswith("## 11.")
                if rbac and re.match(r"### 12\.(?:[2-9]|10)\s", line):
                    edits.append({"path": path, "line": number, "old": line, "proposed": line.replace("12.", "11.", 1)})
    assert len(edits) == 11
    return {"schemaVersion": 1, "status": "draft-proposal", "accepted": False,
            "review": {"start": None, "end": None, "maintainerDisposition": None},
            "references": references, "requiredTools": mapping, "editorialCorrections": edits}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = ROOT / "specs/errata/api-editorial-0.1.json"
    data = generate()
    if args.check:
        assert json.loads(target.read_text(encoding="utf-8")) == data, "Stale API review map"
    else:
        target.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("Eleven required tools, eleven proposed heading corrections and missing API references checked; adoption pending.")
