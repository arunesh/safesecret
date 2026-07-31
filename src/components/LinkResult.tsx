import { useState } from "react";
import type { CreateSecretResponse } from "../../shared/types.js";
import { burnSecret } from "../lib/api.js";
import { formatExpiry } from "../lib/format.js";
import { CopyButton } from "./CopyButton.js";
import { WarningIcon } from "./icons.js";

interface Props {
  created: CreateSecretResponse;
  linkKey: string;
  onStartOver: () => void;
}

export function LinkResult({ created, linkKey, onStartOver }: Props) {
  const [burned, setBurned] = useState(false);
  const [burning, setBurning] = useState(false);

  // The key goes in the fragment, which browsers never put on the wire.
  const link = `${window.location.origin}/s/${created.id}#${linkKey}`;

  async function burn() {
    setBurning(true);
    try {
      await burnSecret(created.id, created.burnToken);
      setBurned(true);
    } catch {
      // Already gone is the outcome we wanted anyway.
      setBurned(true);
    } finally {
      setBurning(false);
    }
  }

  if (burned) {
    return (
      <div className="card reveal-card">
        <h1>Destroyed</h1>
        <p className="lede">That link no longer works. Nothing of it remains on the server.</p>
        <button type="button" className="button" onClick={onStartOver}>
          Share another secret
        </button>
      </div>
    );
  }

  return (
    <>
      <h1>Your link is ready</h1>
      <p className="lede">Send it to one person, through one channel. Then forget it.</p>

      <div className="card">
        <div className="readout">
          <p className="readout-value">{link}</p>
          <CopyButton value={link} label="Copy link" className="button" />
        </div>

        <div className="callout">
          <WarningIcon />
          <p>
            <strong>This link works exactly once.</strong> Opening it destroys the secret &mdash; so don&rsquo;t click
            it to test. It expires on its own {formatExpiry(created.expiresAt)}.
          </p>
        </div>

        <div className="actions">
          <button type="button" className="button secondary" onClick={onStartOver}>
            Share another
          </button>
          <button type="button" className="button danger" onClick={burn} disabled={burning}>
            {burning ? "Destroying…" : "Destroy it now"}
          </button>
        </div>
      </div>

      <p className="hint">
        Destroying it now revokes the link immediately &mdash; useful if you sent it to the wrong person.
      </p>
    </>
  );
}
