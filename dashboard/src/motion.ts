/**
 * Shared motion primitives for the authenticated app.
 *
 * Variants are intentionally restrained — orchestrated entrances and spring
 * micro-interactions, never gratuitous. `<MotionConfig reducedMotion="user">`
 * (set in main.tsx) makes the `motion` library drop transform animations for
 * users who prefer reduced motion; CSS-only effects are guarded separately.
 */
import type { Transition, Variants } from "motion/react";

export const easeOut: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Soft, quick spring used for pop-overs and tactile controls. */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

/** Fade + rise — the workhorse entrance. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: easeOut } },
};

/** Quieter rise for list rows. */
export const rowIn: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
};

/** Container that staggers its children's entrances. */
export function staggerContainer(staggerChildren = 0.07, delayChildren = 0): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren, delayChildren } },
  };
}

/** Dropdown / pop-over: springs down from its trigger, collapses on exit. */
export const popMenu: Variants = {
  hidden: { opacity: 0, y: -8, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: springSoft },
  exit: { opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.14, ease: easeOut } },
};

/** Pending-invite chips: collapse height on revoke. */
export const collapseItem: Variants = {
  hidden: { opacity: 0, y: -6, height: 0, marginBottom: 0 },
  show: {
    opacity: 1,
    y: 0,
    height: "auto",
    marginBottom: "0.5rem",
    transition: { duration: 0.32, ease: easeOut },
  },
  exit: {
    opacity: 0,
    height: 0,
    marginBottom: 0,
    transition: { duration: 0.24, ease: easeOut },
  },
};
