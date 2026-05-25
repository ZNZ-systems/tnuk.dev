import { SignedIn, SignedOut } from "@clerk/clerk-react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
} from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { authHref } from "./auth/redirect.ts";
import { UserMenu } from "./components/UserMenu.tsx";
import { easeOut } from "./motion.ts";
import "./landing.css";

const INSTALL_CMD = "npm i -g tnuk.dev";

/**
 * Reveal-on-scroll, fail-open. Defaults to visible if IntersectionObserver is
 * unavailable, and uses a plain effect (re-attaches cleanly under StrictMode)
 * rather than motion's `whileInView`, which can strand content hidden in dev.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const { ref, inView } = useReveal<HTMLDivElement>();
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.6, ease: easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Soft amber glow that trails the cursor — purely ambient, behind content. */
function CursorGlow() {
  const x = useMotionValue(50);
  const y = useMotionValue(12);
  const sx = useSpring(x, { stiffness: 40, damping: 18, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 40, damping: 18, mass: 0.6 });
  const background = useMotionTemplate`radial-gradient(480px circle at ${sx}% ${sy}%, rgba(232, 165, 75, 0.1), transparent 62%)`;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      x.set((e.clientX / window.innerWidth) * 100);
      y.set((e.clientY / window.innerHeight) * 100);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [x, y]);

  return <motion.div className="landing__cursor-glow" aria-hidden="true" style={{ background }} />;
}

function CheckIcon() {
  return (
    <svg
      className="landing__check"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 7.25 5.5 10.25 11.5 3.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PRICING_INCLUDES = [
  "Unlimited reviews on every push",
  "One seat per developer on your team",
  "Invite and manage members from the dashboard",
  "Each dev activates once with tnuk login",
] as const;

const PILLARS = [
  {
    title: "Structural, not cosmetic",
    body: "Maintainability regressions — the kind that slow teams down after the PR merges. Not formatting, not import order.",
  },
  {
    title: "Built for agentic workflows",
    body: "When it blocks, the agent that pushed already has the feedback. Fix, retry, ship.",
  },
  {
    title: "Fail-closed",
    body: "Every review ends PASS or BLOCK. No soft warnings, no “consider refactoring”.",
  },
] as const;

const STEPS = [
  {
    num: "01",
    title: "Wire up your team",
    body: "One command on each machine. Each developer authenticates with tnuk login.",
  },
  {
    num: "02",
    title: "Push triggers review",
    body: "When you git push, tnuk reviews the diff you're about to ship — scoped to your branch, not the whole repo.",
  },
  {
    num: "03",
    title: "PASS or BLOCK",
    body: "PASS ships. BLOCK stops the push — and the agent that ran it gets the review in context, ready to fix.",
  },
] as const;

const TRUST = [
  "One-command setup",
  "Feedback in agent context",
  "Fail-closed verdicts",
] as const;

function LandingBillingLink({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <a className={className} href="/billing">
      {children}
    </a>
  );
}

function LandingSignUpCta({
  className,
  signedInLabel,
  children,
}: {
  className: string;
  signedInLabel?: string;
  children: ReactNode;
}) {
  return (
    <>
      <SignedOut>
        <a className={className} href={authHref("/sign-up", "/billing")}>
          {children}
        </a>
      </SignedOut>
      <SignedIn>
        <LandingBillingLink className={className}>{signedInLabel ?? children}</LandingBillingLink>
      </SignedIn>
    </>
  );
}

export function LandingPage() {
  const [navScrolled, setNavScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const [copied, setCopied] = useState(false);

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  const pricing = useReveal<HTMLDivElement>();
  const closing = useReveal<HTMLElement>();

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = ["how", "why", "pricing"]
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: "-40% 0px -45% 0px", threshold: [0, 0.25, 0.5] },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const copyInstall = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  return (
    <div className="landing">
      <a className="landing__skip" href="#main-content">
        Skip to content
      </a>
      <motion.div className="landing__progress" style={{ scaleX: progress }} aria-hidden="true" />
      <div className="landing__spotlight" aria-hidden="true" />
      <CursorGlow />
      <div className="landing__grain" aria-hidden="true" />

      <header className={`landing__nav${navScrolled ? " landing__nav--scrolled" : ""}`}>
        <a className="landing__logo" href="/">
          <span className="landing__logo-mark" aria-hidden="true" />
          tnuk
        </a>
        <nav className="landing__nav-links" aria-label="Primary">
          <a
            href="#how"
            className={activeSection === "how" ? "is-active" : undefined}
            aria-current={activeSection === "how" ? "location" : undefined}
          >
            How it works
          </a>
          <a
            href="#why"
            className={activeSection === "why" ? "is-active" : undefined}
            aria-current={activeSection === "why" ? "location" : undefined}
          >
            Why tnuk
          </a>
          <a
            href="#pricing"
            className={activeSection === "pricing" ? "is-active" : undefined}
            aria-current={activeSection === "pricing" ? "location" : undefined}
          >
            Pricing
          </a>
        </nav>
        <div className="landing__nav-actions">
          <SignedOut>
            <a className="landing__btn landing__btn--text" href={authHref("/sign-in", "/billing")}>
              Sign in
            </a>
            <a className="landing__btn landing__btn--solid" href={authHref("/sign-up", "/billing")}>
              Get team plan
            </a>
          </SignedOut>
          <SignedIn>
            <LandingBillingLink className="landing__btn landing__btn--text">Dashboard</LandingBillingLink>
            <span className="landing__user-btn">
              <UserMenu />
            </span>
          </SignedIn>
        </div>
      </header>

      <main id="main-content">
        <section className="landing__hero">
          <p className="landing__badge">
            <span className="landing__badge-dot" aria-hidden="true" />
            Pre-push review gate
          </p>
          <h1 className="landing__title">
            Give your agent
            <span className="landing__title-accent"> the feedback it needs</span>
          </h1>
          <p className="landing__lede">
            The best way to close the loop when AI writes your code. Before anything leaves your
            machine, tnuk runs a thermo-nuclear maintainability review — and when it blocks, the
            agent that pushed gets structured feedback in context.
          </p>
          <div className="landing__cta-row">
            <LandingSignUpCta
              className="landing__btn landing__btn--solid landing__btn--lg"
              signedInLabel="Go to dashboard"
            >
              Start with your team
            </LandingSignUpCta>
            <a className="landing__btn landing__btn--outline landing__btn--lg" href="#how">
              See how it works
            </a>
          </div>
          <p className="landing__micro">Runs on every push · Automatic agent feedback · No ambiguity</p>

          <div className="landing__install">
            <span className="landing__install-prompt" aria-hidden="true">
              $
            </span>
            <code>{INSTALL_CMD}</code>
            <button
              type="button"
              className={`landing__install-copy${copied ? " landing__install-copy--copied" : ""}`}
              aria-label={copied ? "Install command copied" : "Copy install command"}
              onClick={() => void copyInstall()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <span className="landing__sr-only" aria-live="polite">
              {copied ? "Install command copied to clipboard" : ""}
            </span>
          </div>

          <ul className="landing__trust" aria-label="Highlights">
            {TRUST.map((item) => (
              <li key={item}>
                <CheckIcon />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="landing__demo" aria-label="Example pre-push review output">
          <div className="landing__terminal">
            <div className="landing__terminal-bar">
              <span className="landing__terminal-dot landing__terminal-dot--red" />
              <span className="landing__terminal-dot landing__terminal-dot--yellow" />
              <span className="landing__terminal-dot landing__terminal-dot--green" />
              <span className="landing__terminal-title">pre-push — feature/auth-refactor</span>
            </div>
            <div className="landing__terminal-body">
              <div className="landing__line landing__line--1">
                <span className="landing__prompt">$</span> git push origin feature/auth-refactor
              </div>
              <div className="landing__line landing__line--2">[tnuk] Running thermo-nuclear review…</div>
              <div className="landing__line landing__line--3">Reviewing 4 commits · 12 files changed</div>
              <div className="landing__line landing__line--4">
                <span className="landing__verdict landing__verdict--block">VERDICT: BLOCK</span>
              </div>
              <div className="landing__line landing__line--5">
                SUMMARY: maintainability blockers in changed files
              </div>
              <div className="landing__line landing__line--6">
                Push blocked. Review injected into agent context.
              </div>
              <blockquote className="landing__line landing__line--7">
                → this change makes the module harder to reason about. can we simplify before merge?
              </blockquote>
            </div>
          </div>
        </section>

        <section className="landing__section" id="how">
          <Reveal className="landing__section-head">
            <p className="landing__eyebrow">How it works</p>
            <h2 className="landing__section-title">Review before you ship. Feedback before you retry.</h2>
            <p className="landing__section-lede">
              No dashboards to babysit. tnuk sits on the path out — every push gets a verdict, and
              every block lands in the agent's context so it can fix and retry.
            </p>
          </Reveal>
          <Reveal className="landing__steps" delay={0.1}>
            {STEPS.map((step) => (
              <article key={step.num} className="landing__step">
                <span className="landing__step-num">{step.num}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </Reveal>
        </section>

        <section className="landing__section landing__section--why" id="why">
          <Reveal className="landing__section-head">
            <p className="landing__eyebrow">Why tnuk</p>
            <h2 className="landing__section-title">Not a linter. A maintainability gate.</h2>
            <p className="landing__section-lede">
              Linters catch style. Tests catch regressions. tnuk catches the structural debt that
              agents love to introduce — before it lands on main.
            </p>
          </Reveal>
          <Reveal className="landing__pillars" delay={0.1}>
            {PILLARS.map((item) => (
              <article key={item.title} className="landing__pillar">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </Reveal>
        </section>

        <section className="landing__section" id="pricing">
          <Reveal className="landing__section-head landing__section-head--center">
            <p className="landing__eyebrow">Pricing</p>
            <h2 className="landing__section-title">One plan. Every developer on the team.</h2>
            <p className="landing__section-lede landing__section-lede--center">
              No tiers, no usage caps. Pay per seat — everyone gets unlimited pre-push reviews.
            </p>
          </Reveal>
          <motion.div
            ref={pricing.ref}
            className="landing__pricing"
            initial={{ opacity: 0, y: 24 }}
            animate={pricing.inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
            transition={{ duration: 0.6, ease: easeOut }}
            whileHover={{ y: -4, transition: { type: "spring", stiffness: 300, damping: 22 } }}
          >
            <div className="landing__pricing-top">
              <div className="landing__pricing-main">
                <p className="landing__pricing-label">Team</p>
                <div className="landing__price">
                  $40
                  <span>per seat / month</span>
                </div>
                <p className="landing__pricing-desc">
                  Create your team, add seats, invite developers. Each person runs{" "}
                  <code>tnuk login</code> once — then every push is gated.
                </p>
              </div>
              <ul className="landing__pricing-list">
                {PRICING_INCLUDES.map((item) => (
                  <li key={item}>
                    <CheckIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="landing__pricing-foot">
              <LandingSignUpCta
                className="landing__btn landing__btn--solid landing__btn--block"
                signedInLabel="Manage billing"
              >
                Start with your team
              </LandingSignUpCta>
            </div>
          </motion.div>
        </section>

        <motion.section
          ref={closing.ref}
          className="landing__closing"
          initial={{ opacity: 0, y: 24 }}
          animate={closing.inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.6, ease: easeOut }}
        >
          <h2 className="landing__closing-title">Ship code that survives the next refactor.</h2>
          <LandingSignUpCta
            className="landing__btn landing__btn--solid landing__btn--lg"
            signedInLabel="Go to dashboard"
          >
            Get started
          </LandingSignUpCta>
        </motion.section>
      </main>

      <footer className="landing__footer">
        <a className="landing__footer-logo" href="/">
          tnuk
        </a>
        <p className="landing__footer-meta">Thermo-nuclear team code review · tnuk.dev</p>
      </footer>
    </div>
  );
}
