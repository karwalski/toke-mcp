import { createRequire } from "node:module";
import { tokeCheck } from "./check.js";

const require = createRequire(import.meta.url);
const { invokeEndpoint } = require("../lib/sagemaker-client");
const { requireTier } = require("../lib/tier-gate");

/**
 * Build the prompt for the Toke code generation model.
 */
function buildPrompt(description, difficulty) {
  const difficultyHint = difficulty
    ? `\nDifficulty level: ${difficulty}.`
    : "";

  return `You are an expert in the Toke programming language. Toke is a statically-typed, compiled language with type sigils ($string, %int, @float, !bool), pattern matching, pipe operators, and a concise syntax.

Generate valid Toke source code for the following task:
${description}${difficultyHint}

Respond with ONLY the Toke source code, no explanation or markdown fences.`;
}

/**
 * toke_generate tool — uses SageMaker to generate Toke source code from a
 * natural-language description, then validates it with toke_check.
 *
 * @param {object} params
 * @param {string} params.description - What the code should do
 * @param {string} [params.difficulty] - Difficulty hint (e.g. "easy", "medium", "hard")
 * @param {number} [params.max_tokens] - Max tokens for generation
 * @param {object} [params.context] - Auth context with tier info
 * @returns {Promise<object>}
 */
export async function tokeGenerate({ description, difficulty, max_tokens, context }) {
  // Enforce pro tier
  requireTier(context, "pro");

  const prompt = buildPrompt(description, difficulty);

  const result = await invokeEndpoint(prompt, {
    max_new_tokens: max_tokens || 1024,
  });

  // Cold start — return early
  if (result.cold_start && !result.generated_text) {
    return {
      cold_start: true,
      estimated_wait: result.estimated_wait || 45,
      message: "Model is warming up...",
    };
  }

  // Error from SageMaker
  if (result.error && !result.generated_text) {
    return {
      source: null,
      diagnostics: [{ message: result.error }],
      compiled: false,
      tokens_used: 0,
      cold_start: result.cold_start || false,
    };
  }

  const source = (result.generated_text || "").trim();

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

  const compiled = checkResult.ok === true || (diagnostics.length === 0);

  return {
    source,
    diagnostics,
    compiled,
    tokens_used: result.tokens_used || 0,
    cold_start: result.cold_start || false,
  };
}
