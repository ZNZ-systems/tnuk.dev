import { requiredEvidenceDescriptors } from "./descriptors.js";
import type { AnyReviewToolResult, ReviewEvidenceKind } from "./tool-types.js";

interface ExecutionWithResult {
  result: AnyReviewToolResult;
}

const REQUIRED_EVIDENCE = requiredEvidenceDescriptors();
const REQUIRED_EVIDENCE_KINDS = new Set<ReviewEvidenceKind>(
  REQUIRED_EVIDENCE.map((evidence) => evidence.kind),
);
const EVIDENCE_LABELS = new Map<ReviewEvidenceKind, string>(
  REQUIRED_EVIDENCE.map((evidence) => [evidence.kind, evidence.label]),
);

function isRequiredEvidenceKind(kind: string): kind is ReviewEvidenceKind {
  return REQUIRED_EVIDENCE_KINDS.has(kind as ReviewEvidenceKind);
}

export class ReviewEvidenceTracker {
  private readonly seen = new Set<ReviewEvidenceKind>();

  record(execution: ExecutionWithResult): void {
    const result = execution.result;
    if (!result.ok) {
      return;
    }
    const kind = result.evidence?.kind;
    if (kind && isRequiredEvidenceKind(kind)) {
      this.seen.add(kind);
    }
  }

  isSatisfied(): boolean {
    return this.missing().length === 0;
  }

  missing(): ReviewEvidenceKind[] {
    return REQUIRED_EVIDENCE.map((evidence) => evidence.kind).filter((kind) => !this.seen.has(kind));
  }

  missingLabels(): string[] {
    return this.missing().map((kind) => EVIDENCE_LABELS.get(kind) ?? kind);
  }
}

export type { ReviewEvidenceKind } from "./tool-types.js";
