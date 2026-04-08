/**
 * yaml_mini.js — Minimal YAML parser for toke-eval benchmark task files.
 *
 * Only handles the subset of YAML used by task-a-NNNN.yaml files:
 *   - Top-level scalar fields (key: value)
 *   - Quoted strings
 *   - test_inputs array of objects with input/expected (not parsed fully —
 *     we only need id, description, category, input_type, output_type)
 *
 * For a full YAML parser, use the `yaml` npm package.
 */

export function parse(text) {
  const result = {};
  const lines = text.split("\n");

  for (const line of lines) {
    // Skip blank lines, comments, array items
    if (!line.trim() || line.trim().startsWith("#") || line.trim().startsWith("-")) continue;

    // Top-level key: value (not indented, or first-level)
    const match = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (match) {
      const key = match[1];
      let val = match[2].trim();

      // Stop parsing at test_inputs (we don't need test data)
      if (key === "test_inputs") break;

      // Remove surrounding quotes
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }

      result[key] = val;
    }
  }

  return result;
}
