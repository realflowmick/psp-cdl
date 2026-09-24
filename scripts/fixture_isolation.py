# SPDX-License-Identifier: Apache-2.0
"""Prevent accidental networking/children in trusted fixture code, not hostile Python."""
import socket
import subprocess
import sys


def isolate():
    def audit(event, _args):
        if event.startswith("socket.") or event in {"subprocess.Popen", "os.system", "os.posix_spawn", "os.fork", "os.exec"}:
            raise RuntimeError("FIXTURE_IO_DENIED")
    sys.addaudithook(audit)
    blocked = 0
    for probe in (lambda: socket.socket(), lambda: subprocess.Popen(["fixture-must-not-run"])):
        try:
            probe()
        except RuntimeError as error:
            if str(error) != "FIXTURE_IO_DENIED": raise
            blocked += 1
    if blocked != 2: raise RuntimeError("FIXTURE_ISOLATION_FAILED")
