# In-context execution transport example

`application.psp` is a synthetic application with nested nodes, CDL metadata,
natural-language transitions and expression-like transitions. The model receives
all of it. `execution-boundary.txt` is a supplemental ownership preamble, not a
complete PSP/CDL interpreter. Example artifacts are Apache-2.0; generated shared
vectors are CC0-1.0.

A host composes its approved interpreter instructions, the preamble, the application
and relevant workflow context into the text it signs for `LoopHost.prompt`:

```ts
const text = [approvedInterpreterInstructions, executionBoundary, applicationMarkup].join('\n\n');
// In the existing host prompt callback:
return signEnvelope(text, {...hostSignatureMetadata, attributes: promptContext(binding)}, hostSigningKey);
```

```python
text = '\n\n'.join([approved_interpreter_instructions, execution_boundary, application_markup])
# In the existing host prompt callback:
return sign_envelope(text, {**host_signature_metadata, 'attributes': prompt_context(binding)}, host_signing_key)
```

Keys and authenticated bindings stay in the host. Use the existing loop's trusted
key/scope/time verification and policy callbacks. Do not treat this outer envelope
as proof of the application's nested signatures. Preserve the document's trust
boundaries and use verification services for those sections as required.

Run the synthetic transport regression after building the packages:

```powershell
npm run build
uv run --locked python scripts/check-context-parity.py
```

Both implementations verify the prompt and deliver the same complete context to
scripted providers. The proxy preserves either provider-selected path, while
signature failure and policy denials remain enforced. This is a regression for
execution ownership and transport, not a live-model demonstration or a claim
that the supplemental preamble implements the full protocol.
