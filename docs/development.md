# Development

Run commands from the repository root. Recommended runtimes: Node.js 24 and Python 3.12; CI covers Node.js 22/24 and Python 3.12/3.13. The repository uses npm workspaces and a uv Python workspace. Package names remain private/provisional until a reviewed release.

```sh
npm ci
npm run check
uv sync --locked --all-packages
uv run --locked python -m unittest discover -s implementations/python/tests -v
uv run --locked python scripts/check-parity.py
```

Each TypeScript package has a `src` directory, strict TypeScript configuration and `tests` directory; `npm run build` (in dependency order) generates ignored `dist` directories. Python packages use `src` layouts and typed-package markers; the root test suite discovers all registered packages. The scaffold's `require_implementation` / `requireImplementation` guard intentionally throws. Replace it only as real, tested entry points are introduced, while reporting remaining unsupported features.

The harness inventory is available through `npm run conformance:inventory` or `uv run python -m psp_cdl_test_harness --inventory`. The explicit `--profiles` mode executes 511 shared cases against the library APIs and returns 0 only when all pass. Default mode still returns an unimplemented report and exits 2 for full workflow conformance. CI checks both languages, exact report parity, two-way interchange and isolated package consumers.

For restricted environments, place uv and npm caches inside `.cache/` rather than changing global settings. Use `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, and `npm_config_cache` only in the current shell. Never commit `.cache`, `.tools`, `.venv`, credentials, generated results containing private data, or production keys.

Before adding an SDK, pin the MCP protocol revision and supported transports in the implementation profile. The candidate baseline is [MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25); SDK selection is a later reviewed change. Runtime support follows the [Node.js release schedule](https://nodejs.org/en/about/previous-releases).

The signature profile fixture suite runs with npm run test:signatures and with the Python unittest suite. Both are included in CI. The JCS/crypto packages are pinned runtime dependencies of the reusable core; the fixture oracle also uses them. Core and CDL are experimental libraries, not production certification.

Policy artifact checks run with `npm run test:policy` and the Python unittest suite, also included in CI. They audit the profile tables and shared expectations; the small Node matrix algebra audit is test-only and omits all authenticated context handling. Do not import it into services. The independent core/CDL libraries now execute all shared policy vectors through `--profiles`. Keep artifact audits, library execution and future service integration checks distinct.

See the [library guide](library-api.md) for public APIs. Run `uv run --locked python scripts/check-packages.py` to build local tarballs/wheels and verify isolated consumers. This check uses dependency caches populated by `npm ci` and `uv sync`, writes only under `.artifacts`, and never publishes packages.

Artifact installation may download declared dependencies from the configured npm/Python package indexes. The seeded codec corpus is reproducible with `python scripts/generate-codec-vectors.py --check`; omit `--check` only when intentionally regenerating the proposed fixture file.

Service checks are part of both language suites and `scripts/check-parity.py`. To isolate them, run `python scripts/check-service-parity.py` after building TypeScript and syncing the Python workspace. This test opens temporary loopback servers and subprocess stdio peers and closes them afterward. Run `python scripts/generate-service-contracts.py --check` to verify generated draft schemas and packaged discovery metadata.

Workflow checks are also part of both language suites and the parity script. `python scripts/check-workflow-parity.py` runs 41 shared scenarios and actual workflow mutations over loopback HTTP and MCP stdio in both language directions. Run `python scripts/generate-workflow-contracts.py --check` and `python scripts/generate-workflow-vectors.py --check` to verify the draft artifacts. The [workflow examples](../examples/workflow/README.md) exercise the same reusable adapters. Use Node 24 (or supported Node 22.13+) rather than an older system Node on PATH.

Buffered loop checks run in both language suites and `scripts/check-parity.py`. Run `python scripts/check-llm-parity.py` for the 69 shared mock-provider cases, and `python scripts/generate-llm-vectors.py --check` to verify draft expectations. Isolated package checks now execute a model/tool loop from installed tarballs and wheels.
