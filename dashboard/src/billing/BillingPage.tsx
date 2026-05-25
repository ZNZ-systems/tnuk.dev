import { useOrganization } from "@clerk/clerk-react";
import { motion } from "motion/react";

import { AuthLoading } from "../components/AuthLoading.tsx";
import { fadeUp, staggerContainer } from "../motion.ts";
import { CreateTeamForm } from "./CreateTeamForm.tsx";
import { MembersPanel } from "./MembersPanel.tsx";
import { PlanSection } from "./PlanSection.tsx";

export function BillingPage() {
  const { isLoaded, organization } = useOrganization();

  if (!isLoaded) {
    return <AuthLoading label="Loading workspace" />;
  }

  if (!organization) {
    return (
      <motion.main
        className="app-main app-main--narrow"
        variants={staggerContainer(0.09)}
        initial="hidden"
        animate="show"
      >
        <motion.span className="app-eyebrow" variants={fadeUp}>
          Workspace setup
        </motion.span>
        <motion.div className="state-icon" variants={fadeUp} aria-hidden="true">
          <TeamIcon />
        </motion.div>
        <motion.h1 variants={fadeUp}>Create your team</motion.h1>
        <motion.p variants={fadeUp}>
          tnuk bills per organization. Create a team workspace first, then subscribe to the Team plan
          and invite developers.
        </motion.p>
        <motion.div className="panel" variants={fadeUp}>
          <CreateTeamForm />
        </motion.div>
      </motion.main>
    );
  }

  return (
    <main className="app-main">
      <motion.div
        className="page-intro"
        variants={staggerContainer(0.08)}
        initial="hidden"
        animate="show"
      >
        <motion.span className="app-eyebrow" variants={fadeUp}>
          Workspace
        </motion.span>
        <motion.h1 variants={fadeUp}>{organization.name}</motion.h1>
        <motion.p variants={fadeUp}>
          Manage your Team plan ($40 per seat / month), invite developers, and assign seats. Each dev
          runs <code>tnuk login</code> once to activate their machine.
        </motion.p>
      </motion.div>
      <PlanSection />
      <MembersPanel />
    </main>
  );
}

function TeamIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 19a6 6 0 0 1 12 0M17 8a2.5 2.5 0 1 0 0-5M16 13a5 5 0 0 1 5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
