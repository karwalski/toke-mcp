/**
 * SageMaker client — redirects to API Gateway.
 * Backward compatibility shim for tools that import invokeEndpoint.
 */
import { generate } from "./api-client.js";

export async function invokeEndpoint(prompt, options = {}) {
  let description = prompt;
  const marker = "Write toke source for:";
  const idx = prompt.indexOf(marker);
  if (idx >= 0) {
    description = prompt.substring(idx + marker.length).trim();
    const endIdx = description.indexOf("Output toke source only");
    if (endIdx >= 0) description = description.substring(0, endIdx).trim();
  }

  const result = await generate(description, {
    max_tokens: options.max_new_tokens || options.max_tokens || 512,
  });

  if (result.error) return { error: result.error, generated_text: null };
  return { generated_text: result.source || "", tokens_used: result.tokens_out || 0 };
}
