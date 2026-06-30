import { buildAmalgamationPrompt } from "../amalgamate.js";
import {
  BackendError,
  type BackendRunInput,
  type BackendRunOutput,
  type ProgressFn,
  type ReviewBackend,
} from "../backend.js";
import { ClaudeBackend } from "./claude.js";
import { OpenAIBackend } from "./openai.js";

function prefixed(onProgress: ProgressFn, tag: string): ProgressFn {
  return (message) => onProgress(`${tag}: ${message}`);
}

/**
 * Panel backend: an amalgamation of two different models. Claude (via claude -p)
 * produces a first-pass review, then ChatGPT independently ADJUDICATES Claude's
 * findings — confirming, refuting, or refining each, adding what was missed — into a
 * single verdict. Using two distinct model families and an adversarial second stage is
 * the point: same-family consensus just amplifies shared blind spots, so the value is
 * in disagreement, not agreement (see amalgamate.ts for the anti-rubber-stamping design).
 *
 * The final verdict, ledger, and exit code all come from the ChatGPT (synthesizer) leg,
 * so the panel slots into run.ts exactly like any single backend.
 */
export class PanelBackend implements ReviewBackend {
  readonly id = "panel" as const;
  readonly capabilities = {
    canInspectRepository: true,
    inspection: "composite",
    tools: ["claude:read-only-repo-tools", "openai:sandboxed-repo-tools"],
  } as const;

  private readonly reviewer = new ClaudeBackend();
  private readonly synthesizer = new OpenAIBackend();

  /** Both legs must be ready before a push relies on the panel. */
  async preflight(): Promise<void> {
    await this.reviewer.preflight();
    await this.synthesizer.preflight();
  }

  async run({ scope, prompt, onProgress }: BackendRunInput): Promise<BackendRunOutput> {
    onProgress("panel stage 1/2 — Claude first-pass review…");

    let peerReview = "";
    let peerRunId: string | undefined;
    try {
      const peer = await this.reviewer.run({
        scope,
        prompt,
        onProgress: prefixed(onProgress, "claude"),
      });
      peerReview = peer.rawText;
      peerRunId = peer.runId;
    } catch (err) {
      // A setup problem (Claude missing / not signed in) is the user's to fix — surface it.
      // A transient agent failure must not block the push: degrade to a ChatGPT-only review
      // rather than failing the gate, and say so loudly.
      if (err instanceof BackendError && err.kind === "config") {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      onProgress(`panel: Claude leg failed (${message}); falling back to ChatGPT-only review`);
    }

    const stage2 = peerReview
      ? "panel stage 2/2 — ChatGPT adjudicating the first-pass findings…"
      : "panel stage 2/2 — ChatGPT review (single model; Claude leg unavailable)…";
    onProgress(stage2);

    const finalPrompt = peerReview ? buildAmalgamationPrompt(prompt, peerReview) : prompt;
    const finalOut = await this.synthesizer.run({
      scope,
      prompt: finalPrompt,
      onProgress: prefixed(onProgress, "chatgpt"),
    });

    return {
      rawText: finalOut.rawText,
      runId: finalOut.runId,
      // Surface the first-pass run id when the panel actually ran both legs.
      agentId: peerRunId ?? finalOut.agentId,
    };
  }
}
