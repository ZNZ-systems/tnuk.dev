const DEFAULT_REDIRECT = "/billing";

/** Safe in-app redirect target from ?redirect_url= query param. */
export function readRedirectUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("redirect_url")?.trim();
  if (!target || !target.startsWith("/") || target.startsWith("//")) {
    return DEFAULT_REDIRECT;
  }
  return target;
}

export function authHref(path: "/sign-in" | "/sign-up", redirectUrl = DEFAULT_REDIRECT): string {
  return `${path}?redirect_url=${encodeURIComponent(redirectUrl)}`;
}
