import { tokeCheck } from "./check.js";
import { generate, submitFeedback } from "../lib/api-client.js";
import { record } from "../lib/telemetry.js";

/**
 * toke_generate tool — generates toke source code from a natural-language
 * description via the toke API, then validates it with toke_check.
 *
 * The API handles the system prompt, model inference, and token counting.
 * This tool adds local compilation checking on top.
 *
 * @param {object} params
 * @param {string} params.description - What the code should do
 * @param {string} [params.difficulty] - Difficulty hint (e.g. "easy", "medium", "hard")
 * @param {number} [params.max_tokens] - Max tokens for generation
 * @returns {Promise<object>}
 */
export async function tokeGenerate({ description, difficulty, max_tokens }) {
  const desc = difficulty
    ? `${description}\nDifficulty level: ${difficulty}.`
    : description;

  const result = await generate(desc, {
    max_tokens: max_tokens || 512,
  });

  if (result.error) {
    return {
      source: null,
      diagnostics: [{ message: result.error }],
      compiled: false,
      tokens_in: 0,
      tokens_out: 0,
      toke_bpe_out: 0,
    };
  }

  const source = (result.source || "").trim();

  // Run toke_check on the generated code
  const checkResult = await tokeCheck(source);

  const diagnostics = [];
  if (checkResult.diagnostics) {
    diagnostics.push(...checkResult.diagnostics);
  } else if (checkResult.raw && !checkResult.ok) {
    diagnostics.push({ message: checkResult.raw });
  } else if (checkResult.error) {
    diagnostics.push({ message: checkResult.error });
  }

  const compiled = checkResult.ok === true || diagnostics.length === 0;

  // Record generated code that compiles cleanly
  if (compiled) record(source, "toke_generate", 0);

  // Fire-and-forget: auto-submit compile feedback for tracking
  submitFeedback({
    source,
    prompt: description,
    compiles: compiled,
  }).catch(() => {}); // swallow errors — non-critical

  return {
    source,
    diagnostics,
    compiled,
    tokens_in: result.tokens_in || 0,
    tokens_out: result.tokens_out || 0,
    toke_bpe_out: result.toke_bpe_out || 0,
  };
}
