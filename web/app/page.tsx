import Link from "next/link";

export default function HomePage(): React.ReactNode {
  return (
    <section className="hero">
      <h1>Pre-push code quality gate</h1>
      <p>
        tnuk runs a thermo-nuclear maintainability review before every{" "}
        <code>git push</code>. Block spaghetti, 1k-line files, and structural regressions
        — without supplying your own Cursor API key.
      </p>
      <div className="code-block">
        npm install -g tnuk
        <br />
        tnuk login
        <br />
        tnuk hook install --global-hooks-path
        <br />
        git push
      </div>
      <p className="muted" style={{ marginTop: "1.5rem" }}>
        $40/mo · 7-day free trial · Node 20+ and git only
      </p>
      <p style={{ marginTop: "1rem" }}>
        <Link href="/pricing">View pricing →</Link>
      </p>
    </section>
  );
}
