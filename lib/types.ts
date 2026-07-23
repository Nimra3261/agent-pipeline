export type AgentRole = "researcher" | "writer" | "critic";

export interface ResearchBrief {
  claims: string[];
}

export interface CriticReview {
  approved: boolean;
  /** Claims present in the draft that don't trace back to anything in the brief. */
  unsupportedClaims: string[];
  feedback: string;
}

export interface PipelineResult {
  topic: string;
  brief: ResearchBrief;
  draft: string;
  review: CriticReview;
  revised: boolean;
}

export type PipelineEvent =
  | { type: "agent_start"; agent: AgentRole }
  | { type: "agent_done"; agent: AgentRole; output: ResearchBrief | string | CriticReview }
  | { type: "revision_requested"; reason: string }
  | { type: "final"; result: PipelineResult }
  | { type: "error"; message: string };
