"use client";

import { useRef, useState } from "react";
import type { AgentRole, CriticReview, PipelineEvent, ResearchBrief } from "@/lib/types";

type AgentStatus = "idle" | "active" | "done";

interface AgentState {
  status: AgentStatus;
  output: ResearchBrief | string | CriticReview | null;
}

const AGENTS: { role: AgentRole; label: string; description: string }[] = [
  { role: "researcher", label: "Researcher", description: "Gathers the claims a brief needs" },
  { role: "writer", label: "Writer", description: "Drafts from the brief only" },
  { role: "critic", label: "Critic", description: "Checks every claim traces to the brief" },
];

function initialAgents(): Record<AgentRole, AgentState> {
  return {
    researcher: { status: "idle", output: null },
    writer: { status: "idle", output: null },
    critic: { status: "idle", output: null },
  };
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [running, setRunning] = useState(false);
  const [agents, setAgents] = useState<Record<AgentRole, AgentState>>(initialAgents());
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finalDraft, setFinalDraft] = useState<string | null>(null);
  const [revised, setRevised] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || running) return;

    setRunning(true);
    setAgents(initialAgents());
    setLog([]);
    setError(null);
    setFinalDraft(null);
    setRevised(false);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError(await res.text());
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.replace(/^data: /, "").trim();
          if (!line) continue;
          handleEvent(JSON.parse(line) as PipelineEvent);
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(event: PipelineEvent) {
    switch (event.type) {
      case "agent_start":
        setAgents((prev) => ({ ...prev, [event.agent]: { status: "active", output: null } }));
        setLog((prev) => [...prev, `${event.agent} started`]);
        break;
      case "agent_done":
        setAgents((prev) => ({
          ...prev,
          [event.agent]: { status: "done", output: event.output },
        }));
        break;
      case "revision_requested":
        setRevised(true);
        setLog((prev) => [...prev, `revision requested: ${event.reason}`]);
        break;
      case "final":
        setFinalDraft(event.result.draft);
        setRevised(event.result.revised);
        break;
      case "error":
        setError(event.message);
        break;
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Multi-Agent Pipeline</h1>
        <p className="mt-2 text-neutral-400">
          Three agents hand off work in sequence: a researcher gathers claims, a writer drafts
          from them only, and a critic checks every claim in the draft actually traces back to
          the brief — flagging anything invented. Watch the handoff live.
        </p>

        <form onSubmit={runPipeline} className="mt-8 flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. how does DNS resolution work"
            disabled={running}
            maxLength={300}
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={running || !topic.trim()}
            className="rounded-md bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-40"
          >
            {running ? "Running…" : "Run"}
          </button>
        </form>

        {error && (
          <div className="mt-6 rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {AGENTS.map(({ role, label, description }) => (
            <AgentCard key={role} label={label} description={description} state={agents[role]} />
          ))}
        </div>

        {revised && (
          <p className="mt-6 text-sm text-amber-400">
            ↻ The critic flagged an unsupported claim — the writer revised once before this
            result.
          </p>
        )}

        {finalDraft && (
          <div className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-sm font-medium text-neutral-400">Final draft</h2>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-100">
              {finalDraft}
            </p>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-6 rounded-md border border-neutral-800 bg-black/40 p-3 font-mono text-xs text-neutral-500">
            {log.map((line, i) => (
              <div key={i}>› {line}</div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AgentCard({
  label,
  description,
  state,
}: {
  label: string;
  description: string;
  state: AgentState;
}) {
  const dotColor =
    state.status === "active"
      ? "bg-amber-400 animate-pulse"
      : state.status === "done"
        ? "bg-emerald-400"
        : "bg-neutral-700";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{description}</p>

      {state.status === "done" && state.output && (
        <div className="mt-3 text-xs text-neutral-400">
          <AgentOutput label={label} output={state.output} />
        </div>
      )}
    </div>
  );
}

function AgentOutput({
  label,
  output,
}: {
  label: string;
  output: ResearchBrief | string | CriticReview;
}) {
  if (label === "Researcher" && typeof output === "object" && "claims" in output) {
    return (
      <ul className="list-inside list-disc space-y-1">
        {output.claims.map((c, i) => (
          <li key={i} className="line-clamp-2">
            {c}
          </li>
        ))}
      </ul>
    );
  }
  if (label === "Critic" && typeof output === "object" && "approved" in output) {
    return output.approved ? (
      <span className="text-emerald-400">✓ approved, no unsupported claims</span>
    ) : (
      <span className="text-amber-400">
        ✗ {output.unsupportedClaims.length} unsupported claim(s)
      </span>
    );
  }
  if (typeof output === "string") {
    return <p className="line-clamp-3">{output}</p>;
  }
  return null;
}
