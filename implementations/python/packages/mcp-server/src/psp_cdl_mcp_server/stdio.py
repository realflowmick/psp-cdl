# SPDX-License-Identifier: Apache-2.0
import sys
from psp_cdl_core import canonical_json
from psp_cdl_api_server import MAX_REQUEST_BYTES

def serve_stdio(server,input_stream=None,output_stream=None):
    """Bounded binary newline framing; no protocol output for notifications."""
    source=input_stream if input_stream is not None else sys.stdin.buffer
    target=output_stream if output_stream is not None else sys.stdout.buffer
    while True:
        frame=source.readline(MAX_REQUEST_BYTES+2)
        if not frame:
            return
        if len(frame.rstrip(b"\n"))>MAX_REQUEST_BYTES:
            raise ValueError("FRAME_TOO_LARGE")
        if not frame.endswith(b"\n"):
            raise ValueError("TRUNCATED_FRAME")
        reply=server.handle(frame[:-1].decode("utf-8",errors="strict"))
        if reply is not None:
            wire=canonical_json(reply).encode("utf-8")
            if len(wire)>MAX_REQUEST_BYTES:
                raise ValueError("FRAME_TOO_LARGE")
            target.write(wire+b"\n")
            target.flush()
