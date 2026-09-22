# Development

Run commands from the repository root. Recommended runtimes: Node.js 24 and Python 3.12; CI covers Node.js 22/24 and Python 3.12/3.13. The repository uses npm workspaces and a uv Python workspace. Package names remain private/provisional until a reviewed release.

```sh
npm ci
npm run check
uv sync --locked --all-packages
uv run --locked python -m unittest discover -s implementations/python/tests -v
uv run --locked python scripts/check-parity.py
```

Each TypeScript package has a `src` directory, strict TypeScript configuration and `tests` directory; `npm run build --workspaces` generates ignored `dist` directories. Python packages use `src` layouts and typed-package markers; the root test suite discovers all registered packages. The scaffold's `require_implementation` / `requireImplementation` guard intentionally throws. Replace it only as real, tested entry points are introduced, while reporting remaining unsupported features.

The harness inventory is available through `npm run conformance:inventory` or `uv run python -m psp_cdl_test_harness --inventory`. Without inventory mode both commands return an unimplemented report and exit 2. CI checks repository and package integrity; conformance execution is a later gate.

For restricted environments, place uv and npm caches inside `.cache/` rather than changing global settings. Use `UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`, and `npm_config_cache` only in the current shell. Never commit `.cache`, `.tools`, `.venv`, credentials, generated results containing private data, or production keys.

Before adding an SDK, pin the MCP protocol revision and supported transports in the implementation profile. The candidate baseline is [MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25); SDK selection is a later reviewed change. Runtime support follows the [Node.js release schedule](https://nodejs.org/en/about/previous-releases).

The signature profile fixture suite runs with npm run test:signatures and with the Python unittest suite. Both are included in CI. The pinned JCS/crypto packages are development dependencies; no scaffold component has been promoted to a production verifier.

Policy artifact checks run with `npm run test:policy` and the Python unittest suite, also included in CI. They audit the profile tables and shared expectations; the small Node matrix algebra audit is test-only and omits all authenticated context handling. Do not import it into services. Implement independent production adapters in M2 and report actual policy-vector execution separately from artifact validation.
