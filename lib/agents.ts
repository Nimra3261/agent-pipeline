import type Groq from "groq-sdk";
import { MODEL } from "./groq";
import type { CriticReview, ResearchBrief } from "./types";

/**
 * Extracts the text content from a Groq chat completion, defensively - an
 * empty or missing choice shouldn't crash the pipeline, it should surface as
 * an empty string the caller can handle.
 */
function textFrom(completion: Groq.Chat.ChatCompletion): string {
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * Parses a JSON object from a model response, tolerating models that wrap
 * JSON in prose or markdown code fences despite being asked not to - this is
 * common enough with smaller/faster models that not handling it means
 * flaky failures unrelated to the actual pipeline logic.
 */
function parseJsonLoosely<T>(text: string, fallback: T): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return fallback;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}

export async function research(client: Groq, topic: string): Promise<ResearchBrief> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You are a research agent. Given a topic, produce 4-6 specific, " +
          "factual claims that a short technical brief on it would need. " +
          'Respond with only a JSON object: {"claims": ["claim 1", "claim 2", ...]}. ' +
          "No prose outside the JSON.",
      },
      { role: "user", content: topic },
    ],
  });

  const parsed = parseJsonLoosely<{ claims?: unknown }>(textFrom(completion), {});
  const claims = Array.isArray(parsed.claims)
    ? parsed.claims.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];

  return { claims };
}

export async function write(
  client: Groq,
  topic: string,
  brief: ResearchBrief,
  revisionNote?: string
): Promise<string> {
  const briefText = brief.claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const revisionInstruction = revisionNote
    ? `\n\nA previous draft was reviewed and needs revision: ${revisionNote}\nFix this specifically - don't introduce new unsupported claims.`
    : "";

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content:
          "You are a writer agent. Write a short (250-400 word) technical " +
          "explainer using ONLY the claims provided - do not introduce facts " +
          "that aren't in the brief. Plain prose, no markdown headers.",
      },
      {
        role: "user",
        content: `Topic: ${topic}\n\nResearch brief:\n${briefText}${revisionInstruction}`,
      },
    ],
  });

  return textFrom(completion);
}

export async function critique(
  client: Groq,
  brief: ResearchBrief,
  draft: string
): Promise<CriticReview> {
  const briefText = brief.claims.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a critic agent. Compare the draft against the research " +
          "brief. Identify any factual claim in the draft that does NOT " +
          "trace back to something in the brief - these are unsupported " +
          "claims, regardless of whether they sound true. Respond with only " +
          'a JSON object: {"approved": boolean, "unsupportedClaims": ' +
          '["..."], "feedback": "one sentence"}. approved is true only if ' +
          "unsupportedClaims is empty.",
      },
      {
        role: "user",
        content: `Research brief:\n${briefText}\n\nDraft:\n${draft}`,
      },
    ],
  });

  const parsed = parseJsonLoosely<Partial<CriticReview>>(textFrom(completion), {});
  const unsupportedClaims = Array.isArray(parsed.unsupportedClaims)
    ? parsed.unsupportedClaims.filter((c): c is string => typeof c === "string")
    : [];

  return {
    // Require an explicit approved:true, not just "not false" - a malformed
    // or unparseable response has no evidence of approval either way, and
    // treating that as a pass would silently let ungrounded content through.
    approved: unsupportedClaims.length === 0 && parsed.approved === true,
    unsupportedClaims,
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
  };
}
