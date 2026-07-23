import type Groq from "groq-sdk";
import { critique, research, write } from "./agents";
import type { PipelineEvent } from "./types";

const MAX_REVISIONS = 1;

/**
 * Runs the researcher -> writer -> critic pipeline, yielding an event after
 * each step. An async generator rather than a single return value because
 * the whole point of the UI is showing the handoff between agents live, not
 * just a final answer - the caller (the SSE route) streams each yielded
 * event to the client as it happens.
 */
export async function* runPipeline(client: Groq, topic: string): AsyncGenerator<PipelineEvent> {
  try {
    yield { type: "agent_start", agent: "researcher" };
    const brief = await research(client, topic);
    yield { type: "agent_done", agent: "researcher", output: brief };

    if (brief.claims.length === 0) {
      yield { type: "error", message: "Researcher produced no usable claims - try a more specific topic." };
      return;
    }

    yield { type: "agent_start", agent: "writer" };
    let draft = await write(client, topic, brief);
    yield { type: "agent_done", agent: "writer", output: draft };

    yield { type: "agent_start", agent: "critic" };
    let review = await critique(client, brief, draft);
    yield { type: "agent_done", agent: "critic", output: review };

    let revised = false;
    let revisions = 0;
    while (!review.approved && revisions < MAX_REVISIONS) {
      revisions++;
      yield { type: "revision_requested", reason: review.feedback || "unsupported claims found" };

      yield { type: "agent_start", agent: "writer" };
      draft = await write(client, topic, brief, review.feedback);
      yield { type: "agent_done", agent: "writer", output: draft };
      revised = true;

      yield { type: "agent_start", agent: "critic" };
      review = await critique(client, brief, draft);
      yield { type: "agent_done", agent: "critic", output: review };
    }

    yield { type: "final", result: { topic, brief, draft, review, revised } };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : "Pipeline failed" };
  }
}
