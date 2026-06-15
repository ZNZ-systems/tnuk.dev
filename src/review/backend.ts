import type { ProviderId, ReviewScope } from "../types.js";

export type { ProviderId };

/** stderr progress sink (run.ts passes its logProgress). */
export type ProgressFn = (message: string) => void;

export interface BackendRunInput {
  scope: ReviewScope;
  /** Already built by buildReviewPrompt(skillContent, scope). */
  prompt: string;
  onProgress: ProgressFn;
}

export interface BackendRunOutput {
  /** Fed verbatim to parseVerdict. */
  rawText: string;
  runId: string | undefined;
  agentId: string | undefined;
}

/**
 * Recoverable backend failure. run.ts maps "config" -> exit 1 and "agent" -> exit 2.
 * Anything else thrown by a backend bubbles up as an unexpected crash.
 */
export class BackendError extends Error {
  readonly kind: "config" | "agent";

  constructor(message: string, kind: "config" | "agent") {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
  }
}

/**
 * A review backend drives an agent that explores the repo and returns its final
 * raw text. Skill loading, prompt building, verdict parsing, output formatting,
 * and exit codes all stay in run.ts so the backends only differ in how they talk
 * to their SDK.
 */
export interface ReviewBackend {
  readonly id: ProviderId;
  /** Cheap precondition (key present / logged in). Throws BackendError("config") if not ready. */
  preflight(): Promise<void>;
  run(input: BackendRunInput): Promise<BackendRunOutput>;
}
