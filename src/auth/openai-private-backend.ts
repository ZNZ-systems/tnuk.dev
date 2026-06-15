// Experimental ChatGPT/Codex compatibility layer.
//
// This is deliberately narrow: only the ChatGPT auth transport uses these
// undocumented backend details and Codex-shaped headers. The official API path
// uses OPENAI_API_KEY and never imports this module outside the OpenAI
// backend/OAuth flow.

export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export const CODEX_ORIGINATOR = "codex_cli_rs";

export function chatGptBackendHeaders(accountId: string): Record<string, string> {
  return {
    "ChatGPT-Account-Id": accountId,
    originator: CODEX_ORIGINATOR,
    "User-Agent": `codex_cli_rs/0.0.0 (${process.platform}; ${process.arch})`,
  };
}
