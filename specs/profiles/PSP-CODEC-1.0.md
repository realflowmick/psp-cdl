# PSP Codec Profile 1.0

Status: proposed standard, explicitly selected by the experimental reference libraries. Dedicated to the public domain under [CC0 1.0 Universal](../../LICENSES/CC0-1.0.txt).

This profile specifies a bounded, reversible representation of PSP markup and language objects. It complements [Signature Profile 2.0](PSP-SIGNATURE-2.0.md). It does not change archived RFC files or define workflow execution. Consumers MUST explicitly select this profile; legacy text MUST NOT be silently reinterpreted with its escape rules. The library entry points select this profile, and serialized document objects identify it as `PSP-CODEC-1.0`.

## Markup

A document contains ordered text and section nodes. A section starts with `${psp`, followed by attributes and `}`, and ends with `${/psp}`. `${psp ... /}` is an empty section. Nesting is structural, regardless of the section's type. Empty paired sections and self-closing sections have the same semantic tree.

Attributes are separated by one or more ASCII space, tab, carriage return or line feed characters. Names match `[A-Za-z_][A-Za-z0-9_.:-]*`. Each name is followed immediately by `=`, then a value. Values are JSON double-quoted strings or nonempty bare tokens matching `[A-Za-z0-9_.-]+`. Quotes and escapes inside quoted values follow JSON string syntax. Whitespace around `=` and single-quoted values are unsupported. Repeated attribute names MUST fail, including repeated security metadata. Attribute names are case sensitive. Every section requires `type`, matching `[a-z][a-z0-9-]*`.

Quoted attribute contents may contain braces or PSP markers without ending the header. Unknown syntactically valid section types and extension attributes MUST survive serialization. Preserving syntax does not authorize or implement those extensions. Signature conversion imposes its own stricter metadata requirements.

In text, `\\` decodes to one backslash. A backslash immediately before `${psp` or `${/psp` escapes the marker prefix as literal text. Other backslashes remain literal. An unescaped `${psp` starts markup only if followed by whitespace, `}`, `/`, or end of input; a header ending prematurely is an error. An unescaped `${/psp` prefix MUST be the exact closing marker and MUST close an open section. Text resembling `${pspx}` remains ordinary text. Markdown fences, HTML and JSON-looking text provide no implicit exemption from these rules.

The canonical emitter MUST quote every attribute value using JSON string syntax, sort attribute names in ASCII order, emit empty sections as `${psp ... /}`, double literal backslashes, and escape every literal PSP marker prefix in text. Text content, Unicode scalar values and whitespace MUST otherwise be preserved. The parser MUST reject unbalanced, truncated or malformed delimiters and lone Unicode surrogates; it MUST NOT repair them into trusted sections.

## Language objects and JSON

The [document schema](../../schemas/psp-document-1.0.schema.json) defines the wire shape. Documents contain `kind: "document"`, `profile: "PSP-CODEC-1.0"`, `children`, and optional `source`. Sections contain `kind: "section"`, string-valued `attributes`, and ordered `children`. Text nodes contain `kind: "text"` and `value`. Library builders accept an omitted profile and fill it with this profile; explicitly unknown profiles MUST fail. Other unknown node fields MUST fail. Adjacent text nodes are merged, and empty text nodes are removed.

The parser retains the complete original source. Preserve-mode serialization MUST return that exact source only after reparsing it and confirming that its normalized tree equals the current tree. A missing, stale or invalid source hint MUST cause canonical emission of the current tree. A source hint conveys no authority and MUST NOT override edited fields. Callers may deliberately omit it for smaller transports.

Unchanged `markup → object → JSON → object → markup` preserves the original Unicode string, including line endings, attribute order and quoting. `object → canonical markup → object` preserves the normalized semantic tree. Canonical serialization is not a promise to preserve the original JSON whitespace, number spelling, adjacent text segmentation, or optional-default omission. These distinctions MUST be exposed to callers.

JSON decoding MUST detect repeated decoded property names, invalid Unicode, nonfinite numbers, and integers outside ±9,007,199,254,740,991. Other numbers use IEEE 754 binary64. Exact decimals or larger integers MUST use strings. Canonical JSON follows RFC 8785. Library object inputs MUST contain ordinary JSON values; cycles, sparse arrays, accessors and non-JSON values MUST fail rather than invoke custom serialization.

## Signed conversions

For a leaf section, the envelope codec maps delimiter signature fields to the Signature Profile 2.0 envelope and preserves extension attributes. A JSON body is decoded only with explicit `content-type="json"`; text is never guessed to be JSON. Envelope-to-markup conversion MUST reject attribute names that cannot be represented by this grammar.

A section containing child sections MUST NOT be silently flattened into a text signature envelope. To sign an entire nested document, put its validated document object in a JSON envelope. The library `signDocument` / `sign_document` functions implement this transport. The complete cycle is document → signed JSON envelope → leaf PSP section containing escaped JSON text → markup → section → envelope → document. Retaining the source hint also retains original formatting through this cycle. Signature verification MUST precede trusting the restored document. Transport aliases and text normalization follow Signature Profile 2.0; compare protected signature input for equivalence, not arbitrary envelope source bytes.

Three fields remain signed: canonical protected content, timestamp, and canonical version. This codec does not add a fourth field or change the expiration rules. Trust level and authority-bearing attributes remain protected content. Key authority, scope, revocation and time MUST be checked against host-owned policy, separately from signature mathematics.

## Bounds and CDL integration

Reference admission limits are 4,194,304 UTF-8 bytes per serialized representation, 64 nested sections, 10,000 markup nodes, 256 attributes per section and 65,536 UTF-8 bytes per attribute value. JSON additionally limits depth to 256 and visited values to 100,000. Raw object admission budgets aggregate key/value string bytes. Encoded JSON and markup have their own output budgets; an expanded/escaped representation or retained source copy may exceed them and MUST fail explicitly with `LIMIT_EXCEEDED`, never truncate. Limits are resource controls, not a proof of denial-of-service resistance.

CDL JSON transport preserves the complete schema/object and its annotations. Declaration normalization separately follows [CDL Deterministic Profile 1.0](CDL-DETERMINISTIC-1.0.md). The reference policy path resolver supports object `properties` and homogeneous array `items` only. Reference resolution, schema composition, conditional/dependent applicators, tuple/pattern/unevaluated applicators, property-name/content schemas, and schema-valued additional properties are unsupported and MUST fail when encountered on a traversed path. It is not a general JSON Schema validator. Resolve every contributing data location and evaluate all originating restrictions; resolving only the root does not classify all descendants.

The codec performs no fetching, template evaluation, tool dispatch, secret lookup, decryption, session mutation or model attention masking. Host adapters supply authenticated key policies, grants, capabilities and check evidence. Public synthetic fixture checks establish scoped implementation behavior, not effectiveness against all prompt injection or full RFC conformance.
