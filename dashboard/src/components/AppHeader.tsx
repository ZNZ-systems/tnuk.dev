import { motion } from "motion/react";

import { easeOut } from "../motion.ts";
import { OrgSwitcher } from "./OrgSwitcher.tsx";
import { UserMenu } from "./UserMenu.tsx";

const NAV = [
  { href: "/billing", label: "Billing" },
  { href: "/activate", label: "Activate CLI" },
] as const;

export function AppHeader() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <motion.header
      className="app-header"
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: easeOut }}
    >
      <a className="app-header__logo" href="/">
        <span className="app-header__logo-mark" aria-hidden="true" />
        tnuk
      </a>
      <nav className="app-header__nav" aria-label="Primary">
        {NAV.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={path === item.href ? "is-active" : undefined}
            aria-current={path === item.href ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <span className="app-header__spacer" />
      <div className="app-header__actions">
        <OrgSwitcher />
        <UserMenu />
      </div>
    </motion.header>
  );
}
