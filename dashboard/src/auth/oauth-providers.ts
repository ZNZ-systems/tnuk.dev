import type { OAuthStrategy } from "@clerk/types";

type SocialSettings = Record<string, { enabled?: boolean; required?: boolean }>;

interface ClerkEnvironment {
  userSettings?: {
    social?: SocialSettings;
  };
}

/** Enabled OAuth strategies from the loaded Clerk environment. */
export function oauthStrategiesFromClerk(clerk: {
  loaded: boolean;
  __unstable_environment?: ClerkEnvironment;
}): OAuthStrategy[] {
  if (!clerk.loaded) return [];
  const social = clerk.__unstable_environment?.userSettings?.social;
  if (!social) return [];

  return Object.entries(social)
    .filter(([, settings]) => settings.enabled !== false)
    .map(([provider]) => `oauth_${provider}` as OAuthStrategy);
}

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
  facebook: "Facebook",
  discord: "Discord",
  linkedin: "LinkedIn",
  twitter: "X",
  twitch: "Twitch",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  hubspot: "HubSpot",
  slack: "Slack",
  linear: "Linear",
  notion: "Notion",
};

/** Human label for an oauth_* strategy slug. */
export function oauthProviderLabel(strategy: OAuthStrategy): string {
  const slug = strategy.replace(/^oauth_/, "");
  return PROVIDER_LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}
