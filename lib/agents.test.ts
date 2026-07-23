import { describe, expect, it, vi } from "vitest";
import type Groq from "groq-sdk";
import { critique, research, write } from "./agents";

function mockClient(responseText: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: responseText } }],
        }),
      },
    },
  } as unknown as Groq;
}

describe("research", () => {
  it("parses claims from a clean JSON response", async () => {
    const client = mockClient('{"claims": ["claim one", "claim two"]}');
    const brief = await research(client, "quantum computing");
    expect(brief.claims).toEqual(["claim one", "claim two"]);
  });

  it("parses claims wrapped in a markdown code fence", async () => {
    const client = mockClient('Here you go:\n```json\n{"claims": ["a", "b"]}\n```');
    const brief = await research(client, "topic");
    expect(brief.claims).toEqual(["a", "b"]);
  });

  it("returns empty claims rather than throwing on malformed JSON", async () => {
    const client = mockClient("I couldn't find anything about that.");
    const brief = await research(client, "topic");
    expect(brief.claims).toEqual([]);
  });

  it("drops non-string entries and blank strings from claims", async () => {
    const client = mockClient('{"claims": ["real claim", "", 42, null]}');
    const brief = await research(client, "topic");
    expect(brief.claims).toEqual(["real claim"]);
  });
});

describe("write", () => {
  it("includes the brief claims in the prompt sent to the model", async () => {
    const client = mockClient("A short draft.");
    await write(client, "topic", { claims: ["claim A", "claim B"] });

    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user").content;
    expect(userMessage).toContain("claim A");
    expect(userMessage).toContain("claim B");
  });

  it("includes the revision note when one is passed", async () => {
    const client = mockClient("Revised draft.");
    await write(client, "topic", { claims: ["x"] }, "cut the unsupported claim about Y");

    const call = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = call.messages.find((m: { role: string }) => m.role === "user").content;
    expect(userMessage).toContain("cut the unsupported claim about Y");
  });

  it("returns the draft text from the completion", async () => {
    const client = mockClient("The final draft text.");
    const draft = await write(client, "topic", { claims: ["x"] });
    expect(draft).toBe("The final draft text.");
  });
});

describe("critique", () => {
  it("approves when unsupportedClaims is empty", async () => {
    const client = mockClient('{"approved": true, "unsupportedClaims": [], "feedback": "looks good"}');
    const review = await critique(client, { claims: ["a"] }, "draft text");
    expect(review.approved).toBe(true);
    expect(review.unsupportedClaims).toEqual([]);
  });

  it("is not approved when unsupportedClaims is non-empty, even if approved:true was claimed", async () => {
    // Guards against a model saying "approved: true" while still listing
    // problems - the presence of unsupported claims is the source of truth,
    // not whatever the model separately asserts.
    const client = mockClient(
      '{"approved": true, "unsupportedClaims": ["claim X is not in the brief"], "feedback": "one issue"}'
    );
    const review = await critique(client, { claims: ["a"] }, "draft text");
    expect(review.approved).toBe(false);
    expect(review.unsupportedClaims).toEqual(["claim X is not in the brief"]);
  });

  it("does not crash on malformed JSON, and treats it as not approved", async () => {
    const client = mockClient("not json at all");
    const review = await critique(client, { claims: ["a"] }, "draft text");
    expect(review.unsupportedClaims).toEqual([]);
    // Malformed response gives no evidence of approval, so default to false
    // rather than silently letting an unparseable review count as a pass.
    expect(review.approved).toBe(false);
  });
});
