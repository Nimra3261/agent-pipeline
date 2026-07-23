import { describe, expect, it, vi } from "vitest";
import type Groq from "groq-sdk";
import { runPipeline } from "./pipeline";
import type { PipelineEvent } from "./types";

function mockClientWithResponses(responses: string[]) {
  let call = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const text = responses[Math.min(call, responses.length - 1)];
          call++;
          return Promise.resolve({ choices: [{ message: { content: text } }] });
        }),
      },
    },
  } as unknown as Groq;
}

async function collect(gen: AsyncGenerator<PipelineEvent>): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("runPipeline", () => {
  it("runs researcher -> writer -> critic in order and ends with final when approved first try", async () => {
    const client = mockClientWithResponses([
      '{"claims": ["claim 1", "claim 2"]}', // researcher
      "A well-grounded draft.", // writer
      '{"approved": true, "unsupportedClaims": [], "feedback": "good"}', // critic
    ]);

    const events = await collect(runPipeline(client, "topic"));
    const types = events.map((e) => e.type);

    expect(types).toEqual([
      "agent_start", // researcher
      "agent_done",
      "agent_start", // writer
      "agent_done",
      "agent_start", // critic
      "agent_done",
      "final",
    ]);

    const final = events.find((e) => e.type === "final");
    expect(final?.type === "final" && final.result.revised).toBe(false);
  });

  it("exits early with an error when the researcher produces no claims", async () => {
    const client = mockClientWithResponses(["not valid json"]);
    const events = await collect(runPipeline(client, "topic"));

    expect(events.at(-1)).toEqual({
      type: "error",
      message: "Researcher produced no usable claims - try a more specific topic.",
    });
    // Should not have gone on to call the writer or critic.
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("requests one revision when the critic rejects, then accepts the revised draft", async () => {
    const client = mockClientWithResponses([
      '{"claims": ["claim 1"]}', // researcher
      "First draft with an extra claim.", // writer
      '{"approved": false, "unsupportedClaims": ["extra claim"], "feedback": "cut the extra claim"}', // critic (reject)
      "Revised draft, grounded.", // writer (revision)
      '{"approved": true, "unsupportedClaims": [], "feedback": "good now"}', // critic (accept)
    ]);

    const events = await collect(runPipeline(client, "topic"));
    const types = events.map((e) => e.type);

    expect(types).toContain("revision_requested");
    const final = events.find((e) => e.type === "final");
    expect(final?.type === "final" && final.result.revised).toBe(true);
    expect(final?.type === "final" && final.result.draft).toBe("Revised draft, grounded.");
  });

  it("stops after MAX_REVISIONS even if the critic keeps rejecting, rather than looping forever", async () => {
    const client = mockClientWithResponses([
      '{"claims": ["claim 1"]}', // researcher
      "Draft v1.", // writer
      '{"approved": false, "unsupportedClaims": ["x"], "feedback": "still bad"}', // critic reject
      "Draft v2.", // writer revision
      '{"approved": false, "unsupportedClaims": ["x"], "feedback": "still bad"}', // critic reject again
    ]);

    const events = await collect(runPipeline(client, "topic"));
    const revisionRequests = events.filter((e) => e.type === "revision_requested");

    // MAX_REVISIONS is 1, so exactly one revision attempt, then it stops
    // (finalizes with the unapproved draft) instead of looping indefinitely.
    expect(revisionRequests.length).toBe(1);
    expect(events.at(-1)?.type).toBe("final");
  });

  it("yields an error event instead of throwing when the client rejects", async () => {
    const client = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error("rate limited")) } },
    } as unknown as Groq;

    const events = await collect(runPipeline(client, "topic"));
    expect(events).toEqual([
      { type: "agent_start", agent: "researcher" },
      { type: "error", message: "rate limited" },
    ]);
  });
});
