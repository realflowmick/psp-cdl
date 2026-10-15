# @psp-cdl/studio-web

Browser app for PSP Studio. A collapsible left navigation leads to grids of runs,
PSP applications, scenarios, collections, workspace files and secrets; each row
opens its own editor or detail route. PSP application files open in a diagram
editor: node types on the left, nodes and transitions in the middle, and a tabbed
property editor on the right. It is built on [React Flow](https://reactflow.dev) (`@xyflow/react`, MIT).
An AI assistant on the same page writes or changes applications from a prompt
with attachments, through the studio server, and shows each proposal as a
summary, a source diff and a jsondiffpatch delta before you accept it. Files can
be imported and exported as `.psp` or as `.pspx`, which puts the interpreter
system prompt ahead of the application.
Run events stream live over the studio server's socket with replay from the
journal on reconnect. See [docs/studio.md](../../docs/studio.md).

```sh
node apps/studio-server/dist/main.js            # backend on 127.0.0.1:4810
npm run dev --workspace @psp-cdl/studio-web     # Vite dev server on 127.0.0.1:4811, proxied to the backend
npm run build --workspace @psp-cdl/studio-web   # static bundle in apps/studio-web/dist
node apps/studio-server/dist/main.js --web apps/studio-web/dist   # serve the bundle from the backend
```

Tests run under vitest with jsdom and Testing Library and make no network
calls: `npm test --workspace @psp-cdl/studio-web`.

Development tooling only: no security claim, no production readiness, not one
of the seven reference components. Apache-2.0; see the repository [LICENSE](../../LICENSE).
