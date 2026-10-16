# SPDX-License-Identifier: Apache-2.0
"""Development/telemetry hook. Emission never raises, never blocks and never changes an outcome."""
from copy import deepcopy
from psp_cdl_core import canonical_json

OBSERVE_PROFILE = "PSP-OBSERVE-0.1"
LEVELS = ("digest", "inspect")


def byte_length(value):
    """UTF-8 length of the canonical JSON encoding: a size signal, never a digest."""
    return len(canonical_json(value).encode("utf-8"))


def text_bytes(value):
    return len(value.encode("utf-8"))


def scope_of(fields):
    """Keep only well-typed scope fields; host bindings are never copied wholesale."""
    scope = {}
    for key in ("sessionId", "requestId"):
        if type(fields.get(key)) is str: scope[key] = fields[key]
    for key in ("step", "round"):
        if type(fields.get(key)) is int and -9007199254740991 <= fields[key] <= 9007199254740991: scope[key] = fields[key]
    return scope


def _noop(*_args, **_kwargs): return None


def make_emitter(source, options, fail):
    """Validate the option shape as strictly as other configuration, then isolate the observer."""
    if options is None: return _noop
    if type(options) is not dict or any(k not in ("observer", "level") for k in options) or not callable(options.get("observer")) or ("level" in options and options["level"] not in LEVELS):
        fail("INVALID_CONFIGURATION")
    observer, inspect = options["observer"], options.get("level") == "inspect"
    def emit(type_, scope, data, payload=None):
        try:
            event = {"profile":OBSERVE_PROFILE, "source":source, "type":type_, "scope":dict(scope),
                     "data":{**data, "payload":payload()} if inspect and payload else dict(data)}
            observer(deepcopy(event))
        except Exception: pass
    return emit
