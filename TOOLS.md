# toke-mcp Tool Reference

All tools are available over both MCP stdio and HTTP/SSE transport.

---

## Stability: STABLE

The following tools have frozen API schemas. Their input and output shapes **must not change** without a version bump. Downstream projects (including loke) depend on these contracts.

### toke_compress

Compress text using toke compression (`tkc --compress`).

**Input schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | `string` | yes | Text to compress |
| `preserve_atoms` | `string[]` | no | Regex patterns for tokens to preserve unchanged (e.g. `$[A-Z][A-Z0-9_]+[0-9]+`) |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `compressed` | `string` | Compressed output text |
| `original_tokens` | `number` | Token count of the input |
| `compressed_tokens` | `number` | Token count of the compressed output |
| `reduction_pct` | `number` | Percentage token reduction (0–100) |

**API version:** v1 — Frozen. Covers loke F7.4.

---

### toke_decompress

Decompress toke-compressed text (`tkc --decompress`).

**Input schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | `string` | yes | Compressed text to decompress |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `decompressed` | `string` | Restored original text |

**API version:** v1 — Frozen. Covers loke F7.4.

---

## Stability: STABLE (schema may gain optional fields in minor versions)

### toke_analyse

Pre-flight token budget estimation. Analyses text and reports raw and estimated compressed token counts **without modifying the input**. Use this to decide whether compression is worthwhile before calling `toke_compress`.

**Input schema**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `input` | `string` | yes | — | Text to analyse |
| `tokenizer` | `"cl100k_base" \| "o200k_base" \| "toke-bpe"` | no | `cl100k_base` | Tokenizer used for counting |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `raw_tokens` | `number` | Token count of the raw input |
| `est_compressed_tokens` | `number` | Estimated token count after compression |
| `reduction_pct` | `number` | Estimated percentage reduction (0–100) |
| `tokenizer` | `string` | Tokenizer that was used |
| `schema_detected` | `"json" \| "csv" \| "prose"` | Detected input schema type |

---

## Stability: STABLE

### toke_render

Render a parameterised template by substituting `{{varname}}` slots with values from `vars`. Placeholder atoms (`$PERSON_1`, `$LOCATION_2`, etc.) are passed through unchanged. This tool performs pure JS string substitution — it does not call `tkc`.

**Input schema**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | `string` | yes | Template string containing `{{varname}}` slots |
| `vars` | `object` | no | Map of slot names → string values |

**Output**

| Field | Type | Description |
|-------|------|-------------|
| `rendered` | `string` | Template with all known slots substituted |
| `unresolved_slots` | `string[]` | Names of slots found in the template but absent from `vars` |

---

## Other tools

The following tools are registered in the server but do not have frozen API guarantees in this version. See source in `tools/` for details.

| Tool | Description |
|------|-------------|
| `toke_check` | Check Toke source code for errors |
| `toke_compile` | Compile Toke source to LLVM IR |
| `toke_explain_error` | Look up error code explanations |
| `toke_spec_lookup` | Search the language specification |
| `toke_stdlib_ref` | Look up standard library module/function docs |
| `toke_generate` | Generate Toke code from natural-language description |
| `toke_bench` | Benchmark Toke code against known tasks |
| `toke_companion` | Generate/verify/diff `.tkc.md` companion files |
| `toke_format` | Auto-format toke source code |
| `toke_migrate` | Migrate legacy 80-char syntax to 55-char default syntax |
