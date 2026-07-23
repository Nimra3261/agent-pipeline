# Multi-Agent Pipeline

[![CI](https://github.com/Nimra3261/agent-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/Nimra3261/agent-pipeline/actions/workflows/ci.yml)

Three specialized agents hand off work in sequence — a researcher gathers claims, a
writer drafts from them, and a critic checks every claim in the draft actually
traces back to the research brief before approving it. Watch the handoff live, not
just a final answer.

**[Try it live](#)** · Next.js · TypeScript · Groq

---

## Why this is a different pattern than a typical "AI agent demo"

Most agent demos are one model with tools, looping until it's done — [groundtruth](https://github.com/Nimra3261/groundtruth)
is that pattern. This is a different one: **multiple specialized agents that never
talk to the model directly about each other's work** — the researcher doesn't know
a critic exists, the critic only ever sees the brief and the draft. The only shared
state between them is what's explicitly passed forward, which is what makes the
critic's check meaningful: it's verifying the writer's actual output against the
actual brief, not just trusting a self-report.

The critic isn't decorative. In testing, it genuinely catches the writer adding
plausible-sounding elaboration that isn't in the brief — the exact failure mode this
architecture exists to catch — and triggers a real revision, not a scripted one.

## How it works

```
topic
  │
  ▼
Researcher   →  4-6 factual claims (JSON), nothing else
  │
  ▼
Writer       →  250-400 word draft, using ONLY the brief's claims
  │
  ▼
Critic       →  checks every claim in the draft against the brief
  │               approved?  ──────────────────────────► done
  │               not approved (found unsupported claims)
  ▼
Writer (revision, told exactly what was unsupported)
  │
  ▼
Critic (re-check)  →  done (max 1 revision round, doesn't loop forever)
```

Each step streams to the browser via **Server-Sent Events** as it happens — the UI
shows agent status (idle → active → done) live, the same way ChatGPT/Claude's own
interface streams a response, rather than waiting for the whole pipeline and
showing a final blob.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS** — new to this
  portfolio; everything else uses plain React, Laravel, or Streamlit
- **API routes as the backend** — no separate server, one deployable unit
- **[Groq](https://console.groq.com)** for inference (`llama-3.3-70b-versatile` by
  default) — a free tier with no credit card required, chosen specifically so this
  project has zero ongoing cost to run or demo
- **Vitest** for tests

## Run locally

```bash
npm install
cp .env.example .env.local   # add your free Groq API key
npm run dev
```

## Tests

```bash
npm test
```

15 tests against a mocked Groq client — claim parsing (including malformed/fenced
JSON responses), the revision loop (triggers once, caps at one revision rather than
looping forever if the critic keeps rejecting), and a real bug this test suite
caught before it shipped: a malformed critic response was defaulting to
`approved: true` (`undefined !== false` evaluates `true`) — fixed to require an
explicit `approved === true`, so an unparseable review can't silently pass as an
approval.

## Design notes

**Why Groq instead of a bigger-name API.** This is a genuine, common choice in
production AI apps, not a downgrade — Groq's free tier runs fast open-weight
models with no card required, which matters for a project meant to be freely
demoable rather than something a visitor's usage could put a bill on.

**Why cap revisions at one.** An agent loop that can retry indefinitely is a
liveness risk, not just a cost one — if the critic and writer disagree in a way
that never resolves, the pipeline should finalize with its best attempt rather
than hang. One revision round catches the common case (an over-eager writer
elaborating past the brief) without needing an escape hatch for the uncommon one.

**Why the critic's `approved` field doesn't trust the model's own claim.** The
critic's response can say `approved: true` while still listing unsupported
claims (a genuine failure mode observed in testing, not hypothetical) —
`approved` is computed from whether `unsupportedClaims` is actually empty, not
from whatever the model separately asserts about itself.

## Limitations

- The researcher's claims come from the model's training knowledge, not a live
  web search — this project is about the multi-agent handoff and verification
  pattern, not about retrieval (that's what [dociq](https://github.com/Nimra3261/dociq)
  and [groundtruth](https://github.com/Nimra3261/groundtruth) already cover).
- No persistence — each run is stateless; refreshing loses the result.
- Known transitive dependency advisories in Next.js's bundled `sharp`/`postcss`
  (image optimization and CSS pipeline) — no stable patched release exists yet as
  of this writing, and `npm audit fix --force`'s suggested fix is a downgrade to
  Next 9 (pre-App-Router), which isn't a real fix. Low practical exploitability
  here (no image uploads, no user-controlled CSS), tracked rather than ignored.

## License

MIT
