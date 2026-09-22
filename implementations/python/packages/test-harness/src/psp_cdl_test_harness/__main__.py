# SPDX-License-Identifier: Apache-2.0
"""Source-workspace harness inventory. No tests are claimed as executed."""
import json
import sys
from pathlib import Path


def main() -> int:
    if sys.argv[1:] == ["--inventory"]:
        root = next((p for p in Path(__file__).resolve().parents if (p / "project.json").is_file()), None)
        if root is None:
            print(json.dumps({"status": "error", "reason": "Inventory requires the source workspace."}))
            return 2
        data = json.loads((root / "conformance/requirements.json").read_text(encoding="utf-8"))
        print(json.dumps({"mode": "inventory", "executed": 0, "requirements": data["requirements"]}, indent=2))
        return 0
    print(json.dumps({"mode": "conformance", "status": "not_implemented", "executed": 0, "passed": 0, "reason": "No implementation adapter is registered."}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
