/**
 * toke API client — calls the API Gateway for code generation.
 */

const API_URL = process.env.TOKE_API_URL || "https://t9bmpklgve.execute-api.us-east-1.amazonaws.com";
const API_KEY = process.env.TOKE_API_KEY || "";

export async function generate(description, options = {}) {
  if (!API_KEY) {
    return { error: "TOKE_API_KEY not set. Get one at console.tokelang.dev" };
  }

  const resp = await fetch(`${API_URL}/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify({
      description,
      max_tokens: options.max_tokens || 512,
      temperature: options.temperature || 0.2,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) return { error: data.error || `API returned ${resp.status}` };
  return data;
}

export async function submitFeedback(feedback) {
  if (!API_KEY) {
    return { error: "TOKE_API_KEY not set. Get one at console.tokelang.dev" };
  }

  const resp = await fetch(`${API_URL}/v1/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify({
      source: feedback.source || "",
      prompt: feedback.prompt || "",
      compiles: feedback.compiles,
      runs: feedback.runs,
      correct: feedback.correct,
      comment: feedback.comment,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) return { error: data.error || `API returned ${resp.status}` };
  return data;
}

export async function health() {
  try {
    const resp = await fetch(`${API_URL}/health`);
    return await resp.json();
  } catch (e) {
    return { status: "error", error: e.message };
  }
}

export { API_URL };
