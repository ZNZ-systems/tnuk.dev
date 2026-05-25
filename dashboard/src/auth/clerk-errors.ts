import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";

/** First human-readable Clerk API error message, or a fallback. */
export function clerkErrorMessage(err: unknown, fallback: string): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
