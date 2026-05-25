import { useClerk, useUser } from "@clerk/clerk-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { popMenu } from "../motion.ts";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
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

  if (!user) return null;

  const label = user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "Account";
  const email = user.primaryEmailAddress?.emailAddress ?? "";

  return (
    <div className="user-menu" ref={rootRef}>
      <motion.button
        type="button"
        className="user-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.94 }}
      >
        {user.imageUrl ? (
          <img className="user-menu__avatar" src={user.imageUrl} alt="" />
        ) : (
          <span className="user-menu__avatar user-menu__avatar--initials">{initials(label)}</span>
        )}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu-pop user-menu__panel"
            role="menu"
            variants={popMenu}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div className="user-menu__head">
              {user.imageUrl ? (
                <img className="user-menu__avatar" src={user.imageUrl} alt="" />
              ) : (
                <span className="user-menu__avatar user-menu__avatar--initials">
                  {initials(label)}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <p className="user-menu__name">{label}</p>
                {email && <p className="user-menu__email">{email}</p>}
              </div>
            </div>
            <a className="user-menu__link" href="/billing" role="menuitem">
              Billing
            </a>
            <a className="user-menu__link" href="/activate" role="menuitem">
              Activate CLI
            </a>
            <button
              type="button"
              className="user-menu__signout"
              role="menuitem"
              onClick={() => void signOut({ redirectUrl: "/" })}
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
