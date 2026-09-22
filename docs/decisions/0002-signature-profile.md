# ADR 0002: Three-field signatures with complete protected content

Status: accepted author-directed specification correction; proposed-standard profile, not implementation certification.

The originating author selected content, timestamp and version as the three signed fields and delegated expiration/canonicalization details. Keep trust level, authority/key binding, priority and expiration within the protected content rather than append additional fields. Define that first field precisely as JCS of normalized data and complete protected metadata.

Authority comes from the trusted key registry and independently authenticated execution context; signed claims do not authorize themselves. Expiration is required, authenticated, exclusive, and never extended by execution grace. Refresh lead time occurs before expiration. Use JCS without Unicode normalization, canonical base64url and explicit signature profile 2.0.

Publish PSP Core 3.2.0 and preserve 3.1.1 byte-for-byte. This changes protected bytes, so existing raw-body and five-field signatures require re-signing by a trusted authority. Do not implement heuristic fallback. Content version and signature-format version are separate.

This correction proceeds at the author's explicit direction rather than waiting for a new confirmation. Public feedback continues through the proposed-standard process. The test suite verifies the profile's shared fixtures with independent Node/Python JCS and cryptographic libraries; it does not certify the scaffold proxies or a commercial implementation.
