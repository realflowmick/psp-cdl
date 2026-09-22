# SPDX-License-Identifier: Apache-2.0
from .json_codec import PspError
from .signatures import integer


def authorize_trust_level(level: int, allowed_levels: list[int]) -> int:
    """Call after verification; allowed levels come from the host authority store."""
    if not integer(level, 0, 5) or type(allowed_levels) is not list or any(not integer(v, 0, 5) for v in allowed_levels):
        raise PspError("INVALID_TRUST_LEVEL")
    if level not in allowed_levels:
        raise PspError("UNAUTHORIZED_TRUST")
    return level


def source_trust_level(source: str) -> int:
    if source not in ("user", "external"):
        raise PspError("INVALID_CONTEXT")
    return 4 if source == "user" else 5


def require_engine_isolation() -> None:
    raise PspError("ENGINE_ISOLATION_UNSUPPORTED")
