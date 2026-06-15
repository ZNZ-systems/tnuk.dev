import type { ReviewScope } from "../../types.js";
import { runGitBuffer } from "./git.js";

export function readBlobAtReviewHead(scope: ReviewScope, path: string): Buffer | undefined {
  try {
    return runGitBuffer(scope.repoRoot, ["show", `${scope.toSha}:${path}`]);
  } catch {
    return undefined;
  }
}
