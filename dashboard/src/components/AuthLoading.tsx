/**
 * Reactor loader — the brand's "thermo-nuclear" identity rendered as a calm,
 * glowing core with orbiting rings. Pure CSS so it animates instantly, before
 * any JS-driven motion context exists.
 */
export function AuthLoading({ label = "Authenticating" }: { label?: string }) {
  return (
    <div className="app-loading">
      <div className="app__spotlight" aria-hidden="true" />
      <div className="app__aurora" aria-hidden="true" />
      <div className="app-loading__inner">
        <div className="reactor" role="status" aria-label={label}>
          <span className="reactor__ring reactor__ring--2" aria-hidden="true" />
          <span className="reactor__ring reactor__ring--1" aria-hidden="true" />
          <span className="reactor__orbit" aria-hidden="true" />
          <span className="reactor__core" aria-hidden="true" />
        </div>
        <span className="app-loading__label">
          {label}
          <span className="app-loading__caret" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
