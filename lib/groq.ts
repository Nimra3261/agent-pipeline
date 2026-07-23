import Groq from "groq-sdk";

let client: Groq | null = null;

export function getGroqClient(): Groq {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Get a free key at console.groq.com and add it to .env.local."
      );
    }
    client = new Groq({ apiKey });
  }
  return client;
}

// Configurable via env so a future model deprecation doesn't require a code
// change - check console.groq.com/docs/models for currently supported models.
export const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
