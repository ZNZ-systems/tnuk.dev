import { useOrganization, useOrganizationList } from "@clerk/clerk-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { popMenu } from "../motion.ts";

export function OrgSwitcher() {
  const { organization: activeOrg } = useOrganization();
  const { isLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!isLoaded) return null;

  const memberships = userMemberships.data ?? [];

  async function pick(orgId: string) {
    if (!setActive) return;
    await setActive({ organization: orgId });
    setOpen(false);
    window.location.reload();
  }

  if (memberships.length === 0) {
    return <span className="org-switcher org-switcher--empty">No team</span>;
  }

  const currentName = activeOrg?.name ?? memberships[0]?.organization.name ?? "Team";

  return (
    <div className="org-switcher" ref={rootRef}>
      <button
        type="button"
        className="org-switcher__trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="org-switcher__glyph" aria-hidden="true">
          {currentName.charAt(0).toUpperCase()}
        </span>
        <span className="org-switcher__name">{currentName}</span>
        <motion.span
          className="org-switcher__chevron"
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          ▾
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            className="menu-pop org-switcher__menu"
            role="listbox"
            variants={popMenu}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <li className="org-switcher__label" aria-hidden="true">
              Switch workspace
            </li>
            {memberships.map((m) => {
              const isActive = m.organization.id === activeOrg?.id;
              return (
                <li key={m.organization.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`org-switcher__option${isActive ? " org-switcher__option--active" : ""}`}
                    onClick={() => void pick(m.organization.id)}
                  >
                    <span className="org-switcher__glyph" aria-hidden="true">
                      {m.organization.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="org-switcher__name">{m.organization.name}</span>
                    {isActive && (
                      <span className="org-switcher__tick" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
