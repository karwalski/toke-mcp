import { submitFeedback } from "../lib/api-client.js";

/**
 * toke_feedback tool — submit feedback on generated toke code.
 *
 * @param {object} params
 * @param {string} params.source - The toke source code being reviewed
 * @param {string} params.prompt - The original prompt/description
 * @param {boolean} params.compiles - Whether the code compiles
 * @param {boolean} [params.runs] - Whether the code runs successfully
 * @param {boolean} [params.correct] - Whether the code produces correct results
 * @param {string} [params.comment] - Optional freeform comment
 * @returns {Promise<object>}
 */
export async function tokeFeedback({ source, prompt, compiles, runs, correct, comment }) {
  const result = await submitFeedback({
    source,
    prompt,
    compiles,
    runs,
    correct,
    comment,
  });

  if (result.error) {
    return { ok: false, error: result.error };
  }

  return { ok: true, message: "Feedback submitted successfully" };
}
