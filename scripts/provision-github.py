# SPDX-License-Identifier: Apache-2.0
"""Idempotent provisioning for this repository. Requires gh auth login."""
import argparse
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SETTINGS = json.loads((ROOT / ".github/repository-settings.json").read_text(encoding="utf-8"))

def command(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=True, **kwargs).stdout.strip()

def api(endpoint, method="GET", data=None):
    args = ["gh", "api", endpoint, "--method", method]
    if data is not None:
        args += ["--input", "-"]
    output = command(args, input=json.dumps(data) if data is not None else None)
    return json.loads(output) if output else None

def optional_api(endpoint):
    result = subprocess.run(["gh", "api", endpoint], cwd=ROOT, capture_output=True, text=True)
    if result.returncode == 0:
        return json.loads(result.stdout) if result.stdout else None
    if "HTTP 404" in result.stderr:
        return None
    raise RuntimeError(result.stderr)

def pages(endpoint):
    return json.loads(command(["gh", "api", "--paginate", "--slurp", endpoint]))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", help="Create configured public repo if absent and push main.")
    parser.add_argument("--seed-issues", action="store_true", help="Create missing roadmap issues; never invite users.")
    parser.add_argument("--required-approvals", type=int, choices=range(0, 7), default=None)
    args = parser.parse_args()
    repo = SETTINGS["owner"] + "/" + SETTINGS["name"]
    user = api("user")
    existing = optional_api("repos/" + repo)
    if existing is None:
        if not args.create:
            raise SystemExit("Repository absent; rerun with --create.")
        command(["gh", "repo", "create", repo, "--public", "--source", str(ROOT), "--remote", "origin", "--description", SETTINGS["description"]])
        existing = api("repos/" + repo)
    if existing["private"]:
        raise SystemExit("Refusing to change an existing private repository's visibility.")
    if not existing.get("permissions", {}).get("admin"):
        raise SystemExit("Repository admin permission required.")
    origin = command(["git", "remote", "get-url", "origin"])
    allowed = ("https://github.com/" + repo + ".git", "https://github.com/" + repo, "git@github.com:" + repo + ".git")
    if origin not in allowed:
        raise SystemExit("Local origin does not match configured repository.")
    if args.create:
        command(["git", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "-u", "origin", "main"])
    api("repos/" + repo, "PATCH", {
        "description": SETTINGS["description"], "default_branch": "main",
        "has_issues": True, "has_wiki": False, "has_projects": True, "has_discussions": True,
        "allow_squash_merge": True, "allow_merge_commit": False, "allow_rebase_merge": False,
        "allow_auto_merge": True, "delete_branch_on_merge": True, "web_commit_signoff_required": True,
    })
    api("repos/" + repo + "/topics", "PUT", {"names": SETTINGS["topics"]})
    api("repos/" + repo + "/vulnerability-alerts", "PUT")
    api("repos/" + repo + "/automated-security-fixes", "PUT")
    api("repos/" + repo + "/private-vulnerability-reporting", "PUT")
    api("repos/" + repo, "PATCH", {"security_and_analysis":{
        "secret_scanning":{"status":"enabled"}, "secret_scanning_push_protection":{"status":"enabled"},
    }})
    api("repos/" + repo + "/actions/permissions/workflow", "PUT", {
        "default_workflow_permissions":"read", "can_approve_pull_request_reviews":False,
    })
    protection = optional_api("repos/" + repo + "/branches/main/protection")
    current = (protection or {}).get("required_pull_request_reviews",{}).get("required_approving_review_count",0)
    approvals = max(current, SETTINGS["bootstrapRequiredApprovals"]) if args.required_approvals is None else args.required_approvals
    if approvals < current:
        raise SystemExit("Refusing to lower an existing approval requirement.")
    api("repos/" + repo + "/branches/main/protection", "PUT", {
        "required_status_checks":{"strict":True,"checks":[{"context":SETTINGS["requiredCheck"],"app_id":15368}]},
        "enforce_admins":True,
        "required_pull_request_reviews":{"dismiss_stale_reviews":True,"require_code_owner_reviews":approvals>0,"required_approving_review_count":approvals},
        "restrictions":None, "required_linear_history":True, "allow_force_pushes":False,
        "allow_deletions":False, "required_conversation_resolution":True,
    })
    if args.seed_issues:
        seed = json.loads((ROOT / ".github/bootstrap-issues.json").read_text(encoding="utf-8"))
        for label in seed["labels"]:
            command(["gh","label","create",label["name"],"--repo",repo,"--color",label["color"],"--description",label["description"],"--force"])
        milestones = {m["title"]:m["number"] for page in pages("repos/"+repo+"/milestones?state=all&per_page=100") for m in page}
        for milestone in seed["milestones"]:
            if milestone["title"] not in milestones:
                item = api("repos/"+repo+"/milestones","POST",milestone)
                milestones[item["title"]] = item["number"]
        titles = {i["title"] for page in pages("repos/"+repo+"/issues?state=all&per_page=100") for i in page if "pull_request" not in i}
        for issue in seed["issues"]:
            if issue["title"] not in titles:
                item = dict(issue)
                item["milestone"] = milestones[item["milestone"]]
                created = api("repos/"+repo+"/issues","POST",item)
                print(created["html_url"])
    report = {
        "repository":api("repos/"+repo)["html_url"], "visibility":"public","authenticatedLogin":user["login"],
        "branchProtection":api("repos/"+repo+"/branches/main/protection"),
        "privateReporting":api("repos/"+repo+"/private-vulnerability-reporting"),
        "workflowPermissions":api("repos/"+repo+"/actions/permissions/workflow"),
        "security":api("repos/"+repo).get("security_and_analysis",{}),
        "note":"No teams created or additional users granted access.",
    }
    artifact = ROOT / ".artifacts/github-provisioning.json"
    artifact.parent.mkdir(parents=True,exist_ok=True)
    artifact.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print("Verified public repository: "+report["repository"])
    print("Required check: "+SETTINGS["requiredCheck"]+"; approvals: "+str(approvals))
    print("Detailed settings verification: "+str(artifact))

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.stderr or str(error))
