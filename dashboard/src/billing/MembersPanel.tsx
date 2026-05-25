import { useOrganization } from "@clerk/clerk-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { clerkErrorMessage } from "../auth/clerk-errors.ts";
import { collapseItem, rowIn, staggerContainer } from "../motion.ts";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function MembersPanel() {
  const { isLoaded, organization, membership, memberships, invitations } = useOrganization({
    memberships: { pageSize: 50 },
    invitations: { pageSize: 50 },
  });
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const isAdmin = membership?.role === "org:admin";

  if (!isLoaded || !organization) return null;

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!organization) return;
    setError("");
    setMessage("");
    setWorking(true);
    try {
      await organization.inviteMember({
        emailAddress: inviteEmail.trim(),
        role: "org:member",
      });
      setInviteEmail("");
      setMessage(`Invitation sent to ${inviteEmail.trim()}.`);
      await invitations?.revalidate?.();
    } catch (err) {
      setError(clerkErrorMessage(err, "Could not send invitation"));
    } finally {
      setWorking(false);
    }
  }

  async function revokeInvite(invitationId: string) {
    setError("");
    try {
      const invite = invitations?.data?.find((i) => i.id === invitationId);
      if (invite) await invite.revoke();
      await invitations?.revalidate?.();
    } catch (err) {
      setError(clerkErrorMessage(err, "Could not revoke invitation"));
    }
  }

  const memberRows = memberships?.data ?? [];
  const pendingInvites = invitations?.data?.filter((i) => i.status === "pending") ?? [];

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Members</h2>
        <span className="section__count">{memberRows.length}</span>
      </div>

      <motion.div
        className="members"
        variants={staggerContainer(0.06)}
        initial="hidden"
        animate="show"
      >
        {memberRows.map((m) => {
          const user = m.publicUserData;
          const name =
            [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
            user?.identifier ||
            "Unknown";
          const role = m.role.replace("org:", "");
          return (
            <motion.div className="members__row" key={m.id} variants={rowIn}>
              <div className="member">
                <span className="member__avatar" aria-hidden="true">
                  {initials(name)}
                </span>
                <div className="member__meta">
                  <div className="member__name">{name}</div>
                  <div className="member__email">{user?.identifier ?? "—"}</div>
                </div>
              </div>
              <span className={`role-badge${role === "admin" ? " role-badge--admin" : ""}`}>
                {role}
              </span>
            </motion.div>
          );
        })}
      </motion.div>

      {pendingInvites.length > 0 && (
        <>
          <h3 className="section__sub">Pending invitations</h3>
          <ul className="invites">
            <AnimatePresence initial={false}>
              {pendingInvites.map((inv) => (
                <motion.li
                  className="invites__item"
                  key={inv.id}
                  variants={collapseItem}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  layout
                >
                  <span className="invites__email">
                    <span className="invites__pending">pending</span>
                    {inv.emailAddress}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="form-btn form-btn--ghost"
                      onClick={() => void revokeInvite(inv.id)}
                    >
                      Revoke
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}

      {isAdmin && (
        <form className="invite-form" onSubmit={sendInvite}>
          <label className="form-field">
            <span className="form-field__label">Invite developer</span>
            <input
              className="form-field__input"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="dev@company.com"
              required
            />
          </label>
          <button type="submit" className="form-btn form-btn--primary" disabled={working}>
            {working ? "Sending…" : "Send invite"}
          </button>
        </form>
      )}

      <AnimatePresence>
        {message && (
          <motion.p
            className="form-message form-message--success"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {message}
          </motion.p>
        )}
        {error && (
          <motion.p
            className="form-message form-message--error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}
