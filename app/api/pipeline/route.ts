import { getGroqClient } from "@/lib/groq";
import { runPipeline } from "@/lib/pipeline";
import type { PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseLine(event: PipelineEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  let topic: string;
  try {
    const body = await req.json();
    topic = typeof body.topic === "string" ? body.topic.trim() : "";
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  if (!topic) {
    return new Response("A non-empty 'topic' is required", { status: 400 });
  }
  if (topic.length > 300) {
    return new Response("Topic is too long (max 300 characters)", { status: 400 });
  }

  let client;
  try {
    client = getGroqClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server misconfigured";
    return new Response(message, { status: 500 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of runPipeline(client, topic)) {
          controller.enqueue(encoder.encode(sseLine(event)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pipeline crashed";
        controller.enqueue(encoder.encode(sseLine({ type: "error", message })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
