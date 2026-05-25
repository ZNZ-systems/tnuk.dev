import { useOrganizationList } from "@clerk/clerk-react";
import { useState } from "react";

import { clerkErrorMessage } from "../auth/clerk-errors.ts";

export function CreateTeamForm() {
  const { isLoaded, createOrganization, setActive } = useOrganizationList();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  if (!isLoaded) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!createOrganization || !setActive) return;
    setError("");
    setWorking(true);
    try {
      const org = await createOrganization({ name: name.trim() });
      await setActive({ organization: org.id });
      window.location.reload();
    } catch (err) {
      setError(clerkErrorMessage(err, "Could not create team"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="form-field">
        <span className="form-field__label">Team name</span>
        <input
          className="form-field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Engineering"
          required
          minLength={2}
          autoFocus
        />
      </label>
      {error && <p className="form-message form-message--error">{error}</p>}
      <button type="submit" className="form-btn form-btn--primary" disabled={working || name.trim().length < 2}>
        {working ? "Creating…" : "Create team"}
      </button>
    </form>
  );
}
