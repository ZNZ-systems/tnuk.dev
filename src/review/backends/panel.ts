import { buildAmalgamationPrompt } from "../amalgamate.js";
import {
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
 * The panel is ATOMIC and fails closed: if the Claude leg fails (timeout, malformed
 * output, auth), the error propagates and run.ts blocks the push — it never silently
 * downgrades to a single-model review, which would change the advertised semantics and
 * could let through a push the full panel would not. The final verdict, ledger, and exit
 * code come from the ChatGPT (synthesizer) leg, so the panel slots into run.ts like any
 * single backend.
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
    // Atomic two-stage review. The Claude leg's errors propagate (fail closed): a gate
    // must not silently fall back to a weaker single-model review when adjudication was
    // requested. preflight() already verified both legs are ready.
    onProgress("panel stage 1/2 — Claude first-pass review…");
    const peer = await this.reviewer.run({
      scope,
      prompt,
      onProgress: prefixed(onProgress, "claude"),
    });

    onProgress("panel stage 2/2 — ChatGPT adjudicating the first-pass findings…");
    const finalOut = await this.synthesizer.run({
      scope,
      prompt: buildAmalgamationPrompt(prompt, peer.rawText),
      onProgress: prefixed(onProgress, "chatgpt"),
    });

    return { rawText: finalOut.rawText, runId: finalOut.runId, agentId: peer.runId };
  }
}
