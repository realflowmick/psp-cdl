# @psp-cdl/studio-core

Shared, dependency-light models for PSP Studio: the normalized run event
envelope, scenario and collection definitions, the PSP graph view-model used by
the editor, and result normalizers for the evaluation engines. It is consumed by
the studio server (Node) and the studio web app (browser) and must stay free of
Node-only imports.

This package is development tooling. It asserts no security property and is not
one of the seven reference components in `project.json`. Licensed under
Apache-2.0; see the repository [LICENSE](../../LICENSE).
