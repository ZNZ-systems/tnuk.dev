// Experimental ChatGPT/Codex compatibility layer.
//
// This is deliberately narrow: only explicit `openaiAuth: "chatgpt"` runs use
// these undocumented backend details and Codex-shaped headers. The stable
// OpenAI path uses the official API with OPENAI_API_KEY and never imports this
// module outside the OpenAI backend/OAuth flow.

export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export const CODEX_ORIGINATOR = "codex_cli_rs";

export function chatGptBackendHeaders(accountId: string): Record<string, string> {
  return {
    "ChatGPT-Account-Id": accountId,
    originator: CODEX_ORIGINATOR,
    "User-Agent": `codex_cli_rs/0.0.0 (${process.platform}; ${process.arch})`,
  };
}
