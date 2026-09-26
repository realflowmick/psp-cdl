# SPDX-License-Identifier: Apache-2.0
"""Source-workspace inventory and explicit library profile execution."""
import json
import sys
from pathlib import Path


def main() -> int:
    if sys.argv[1:] == ["--profiles"]:
        from .profiles import profile_report
        root = next((p for p in Path(__file__).resolve().parents if (p / "project.json").is_file()), None)
        try:
            if root is None:
                raise ValueError("Missing workspace")
            def read(name):
                return json.loads((root / "conformance/vectors" / name).read_text(encoding="utf-8"))
            report = profile_report(read("policy/profile-1.0.json"), read("codec/profile-1.0.json"), read("signatures/profile-2.0.json"))
            print(json.dumps(report, ensure_ascii=True))
            return 1 if report["failed"] else 0
        except (ValueError, OSError):
            print(json.dumps({"mode": "profile-conformance", "status": "error", "executed": 0, "passed": 0, "reason": "Profile fixtures unavailable or invalid."}))
            return 2
    if sys.argv[1:] == ["--inventory"]:
        root = next((p for p in Path(__file__).resolve().parents if (p / "project.json").is_file()), None)
        if root is None:
            print(json.dumps({"status": "error", "reason": "Inventory requires the source workspace."}))
            return 2
        data = json.loads((root / "conformance/requirements.json").read_text(encoding="utf-8"))
        print(json.dumps({"mode": "inventory", "executed": 0, "requirements": data["requirements"]}, indent=2))
        return 0
    print(json.dumps({"mode": "conformance", "status": "not_implemented", "executed": 0, "passed": 0, "reason": "Whole-clause conformance is pending; run scripts/run-topology-matrix.py for scoped workflow fixtures."}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
