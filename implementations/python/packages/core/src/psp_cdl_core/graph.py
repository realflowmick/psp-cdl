# SPDX-License-Identifier: Apache-2.0
"""Scoped structural compilation. A compiled document is not execution authority."""
import re
from .json_codec import PspError, canonical_json, parse_json, validate_json
from .markup import document_from_object
from .signatures import canonical_version
from .transitions import TRANSITION_PROFILE, select_transition, _prepare_transition_definitions, _constraints

APPLICATION_GRAPH_PROFILE = "PSP-APPLICATION-GRAPH-0.1"
CONTAINERS = {"application", "composite", "loop"}
NODE_TYPES = CONTAINERS | {"prompt", "connector", "checkpoint", "reset"}
SINGLE = {"system", "transitions", "output-schema", "workflow-state", "output", "input", "settings",
          "threat-policy", "post-completion", "connector-config", "checkpoint-config", "loop-config", "reset-config"}
SECTION_TYPES = SINGLE | {"context", "user", "custom", "machine", "link", "checkpoint-input"}


def _fail(code):
    raise PspError(code)


def _id(value):
    return type(value) is str and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,127}", value) is not None


def _white(value):
    return not value.strip(" \t\r\n")


def _child_path(parent, child):
    return ("/" if parent == "/" else parent + "/") + child


def _inspect_block(section):
    kind = section["attributes"]["type"]
    if kind == "node":
        _fail("MISPLACED_GRAPH_NODE")
    if kind not in SECTION_TYPES:
        _fail("UNSUPPORTED_GRAPH_SECTION")
    if kind == "system":
        canonical_version(section["attributes"].get("version"))
    for child in section["children"]:
        if child["kind"] == "section":
            _inspect_block(child)


def _transition_body(section):
    if "content-type" in section["attributes"] and section["attributes"]["content-type"] != "json":
        _fail("UNSUPPORTED_GRAPH_SECTION")
    if any(c["kind"] != "text" for c in section["children"]):
        _fail("INVALID_GRAPH_TRANSITIONS")
    value = parse_json("".join(c["value"] for c in section["children"]))
    if type(value) is not list:
        _fail("INVALID_GRAPH_TRANSITIONS")
    if len(value) > 256:
        _fail("GRAPH_LIMIT_EXCEEDED")
    if any(type(edge) is not dict for edge in value):
        _fail("INVALID_GRAPH_TRANSITIONS")
    return value


class _CompiledApplication:
    def __init__(self, nodes, by_path):
        self._by_path = by_path
        self._description = {"profile": APPLICATION_GRAPH_PROFILE, "rootPath": "/", "entryPath": nodes[0]["entryPath"],
                             "executionSupported": False, "nodes": nodes}
        if len(canonical_json(self._description).encode("utf-8")) > 8_388_608:
            _fail("GRAPH_LIMIT_EXCEEDED")

    def describe(self):
        return validate_json(self._description)

    def select(self, path, completed, facts):
        node = self._by_path.get(path) if type(path) is str else None
        if not node or node["parentPath"] is None:
            _fail("INVALID_GRAPH_PATH")
        siblings = [self._by_path[p]["id"] for p in self._by_path[node["parentPath"]]["children"]]
        result = select_transition({"profile": TRANSITION_PROFILE, "nodeId": node["id"], "completed": completed,
                                    "siblings": siblings, "attributes": node["attributes"], "transitions": node["transitions"], "facts": facts})
        return {"profile": APPLICATION_GRAPH_PROFILE, "sourcePath": path,
                "targetPath": _child_path(node["parentPath"], result["targetNode"]),
                "transitionIndex": result["transitionIndex"], "usedFacts": result["usedFacts"]}


def compile_application(value):
    """Compile a detached document tree; no signatures, fetches or state writes."""
    value = validate_json(value)
    if (type(value) is not dict or value.get("profile") != APPLICATION_GRAPH_PROFILE or "document" not in value
            or not value.keys() <= {"profile", "document", "entries"}
            or ("entries" in value and type(value["entries"]) is not dict)):
        _fail("INVALID_GRAPH_REQUEST")
    if len(canonical_json(value).encode("utf-8")) > 4_194_304:
        _fail("GRAPH_LIMIT_EXCEEDED")
    document = document_from_object(value["document"])
    roots = [c for c in document["children"] if c["kind"] == "section"]
    if (len(roots) != 1 or any(c["kind"] == "text" and not _white(c["value"]) for c in document["children"])
            or roots[0]["attributes"]["type"] != "node" or roots[0]["attributes"].get("node-type") != "application"):
        _fail("INVALID_APPLICATION_ROOT")
    nodes, by_path, blocks = [], {}, {}

    def visit(section, parent, depth):
        if depth > 32 or len(nodes) >= 1024:
            _fail("GRAPH_LIMIT_EXCEEDED")
        attributes = section["attributes"]
        kind = attributes.get("node-type")
        if kind not in NODE_TYPES:
            _fail("UNSUPPORTED_NODE_TYPE")
        if (parent is not None and not _id(attributes.get("id"))) or ("id" in attributes and not _id(attributes["id"])):
            _fail("INVALID_GRAPH_NODE_ID")
        local_id = attributes.get("id")
        path = "/" if parent is None else _child_path(parent, local_id)
        if path in by_path:
            _fail("DUPLICATE_GRAPH_NODE")
        version = canonical_version(attributes.get("version"))
        if "load" in attributes and attributes["load"] not in ("eager", "lazy"):
            _fail("INVALID_GRAPH_ATTRIBUTE")
        if kind == "application":
            for key in ("name", "session-id"):
                text = attributes.get(key)
                if text is None or _white(text) or len(text.encode("utf-8")) > 256:
                    _fail("INVALID_APPLICATION_ATTRIBUTE")
            if "mode" in attributes and attributes["mode"] not in ("dev", "debug", "demo", "prod"):
                _fail("INVALID_APPLICATION_ATTRIBUTE")
            if "post-completion" in attributes and attributes["post-completion"] not in ("unmanaged", "lockdown", "scoped", "redirect"):
                _fail("INVALID_APPLICATION_ATTRIBUTE")
            if attributes.get("post-completion") == "redirect" and _white(attributes.get("post-completion-target", "")):
                _fail("INVALID_APPLICATION_ATTRIBUTE")
        _constraints(attributes)
        node = {"path": path, "parentPath": parent, "id": local_id, "nodeType": kind, "version": version,
                "attributes": attributes, "children": [], "entryPath": None, "text": [], "sections": [], "transitions": []}
        nodes.append(node)
        by_path[path] = node
        seen, children = set(), []
        for child in section["children"]:
            if child["kind"] == "text":
                node["text"].append(child["value"])
                continue
            child_kind = child["attributes"]["type"]
            if child_kind == "node":
                children.append(child)
                continue
            _inspect_block(child)
            if child_kind in SINGLE and child_kind in seen:
                _fail("DUPLICATE_GRAPH_SECTION")
            seen.add(child_kind)
            if child_kind == "post-completion":
                if kind != "application":
                    _fail("MISPLACED_GRAPH_SECTION")
                nested = [c for c in child["children"] if c["kind"] == "section"]
                if (any(c["kind"] == "text" and not _white(c["value"]) for c in child["children"])
                        or sum(c["attributes"]["type"] == "system" for c in nested) != 1
                        or sum(c["attributes"]["type"] == "threat-policy" for c in nested) > 1
                        or any(c["attributes"]["type"] not in ("system", "threat-policy") for c in nested)):
                    _fail("INVALID_POST_COMPLETION_SECTION")
            if child_kind == "transitions":
                blocks[path] = _transition_body(child)
            else:
                node["sections"].append(child)
        if attributes.get("post-completion") == "scoped" and "post-completion" not in seen:
            _fail("INVALID_POST_COMPLETION_SECTION")
        if (kind in CONTAINERS) != bool(children):
            _fail("INVALID_GRAPH_CHILDREN")
        for child in children:
            node["children"].append(visit(child, path, depth + 1)["path"])
        node["entryPath"] = node["children"][0] if node["children"] else None
        return node

    visit(roots[0], None, 1)
    for path, local_id in value.get("entries", {}).items():
        node = by_path.get(path)
        if not node or not _id(local_id) or _child_path(path, local_id) not in node["children"]:
            _fail("INVALID_GRAPH_ENTRY")
        node["entryPath"] = _child_path(path, local_id)
    for declaring in nodes:
        for edge in blocks.get(declaring["path"], []):
            if declaring["nodeType"] in CONTAINERS and "source_node" in edge:
                if not _id(edge["source_node"]):
                    _fail("INVALID_GRAPH_TRANSITIONS")
                path = _child_path(declaring["path"], edge["source_node"])
                if path not in declaring["children"]:
                    _fail("TRANSITION_SCOPE_VIOLATION")
                source = by_path[path]
            else:
                source = declaring
                if declaring["parentPath"] is None:
                    _fail("AMBIGUOUS_GRAPH_TRANSITION")
                if "source_node" in edge and edge["source_node"] != declaring["id"]:
                    _fail("TRANSITION_SCOPE_VIOLATION")
            source["transitions"].append({**edge, "source_node": source["id"]})
            if len(source["transitions"]) > 256:
                _fail("GRAPH_LIMIT_EXCEEDED")
    for node in nodes:
        if node["parentPath"] is not None:
            siblings = [by_path[p]["id"] for p in by_path[node["parentPath"]]["children"]]
            _prepare_transition_definitions(node["id"], siblings, node["transitions"])
    return _CompiledApplication(nodes, by_path)
