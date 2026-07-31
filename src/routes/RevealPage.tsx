import { useCallback, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router";
import type { Envelope, SecretMetaResponse } from "../../shared/types.js";
import { CopyButton } from "../components/CopyButton.js";
import { LockIcon, WarningIcon } from "../components/icons.js";
import { ApiRequestError, fetchSecretMeta, revealSecret } from "../lib/api.js";
import { openSecret } from "../lib/crypto.js";

type Phase = "loading" | "ready" | "revealing" | "revealed" | "failed" | "gone" | "incomplete";

export function RevealPage() {
  const { id = "" } = useParams();
  const passphraseId = useId();

  // The fragment never reaches the server; this is the only place the key exists.
  const [linkKey] = useState(() => window.location.hash.slice(1));

  const [phase, setPhase] = useState<Phase>("loading");
  const [meta, setMeta] = useState<SecretMetaResponse | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Retained after burning so a mistyped passphrase can be retried locally. The
  // server copy is already gone by then — re-requesting it would 404 and the
  // secret would be lost to a typo.
  const [envelope, setEnvelope] = useState<Envelope | null>(null);

  useEffect(() => {
    if (!linkKey) {
      setPhase("incomplete");
      return;
    }
    let cancelled = false;

    // A GET, deliberately: this tells us whether the secret exists and whether a
    // passphrase is needed without consuming it. Scanners and prefetchers that
    // load this page do no damage.
    fetchSecretMeta(id)
      .then((value) => {
        if (cancelled) return;
        setMeta(value);
        setPhase("ready");
      })
      .catch(() => {
        if (!cancelled) setPhase("gone");
      });

    return () => {
      cancelled = true;
    };
  }, [id, linkKey]);

  const reveal = useCallback(async () => {
    setPhase("revealing");
    setError(null);
    try {
      const sealed = envelope ?? (await revealSecret(id));
      setEnvelope(sealed);
      setPlaintext(await openSecret(sealed, linkKey, meta?.hasPassphrase ? passphrase : undefined));
      setPhase("revealed");
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        setPhase("gone");
        return;
      }
      setError(
        meta?.hasPassphrase
          ? "That passphrase didn't work. Check it and try again."
          : "This link is damaged — the secret could not be decrypted.",
      );
      setPhase("failed");
    }
  }, [envelope, id, linkKey, meta, passphrase]);

  if (phase === "loading") {
    return (
      <div className="card reveal-card">
        <p className="muted">
          <span className="spinner" /> Checking…
        </p>
      </div>
    );
  }

  if (phase === "gone" || phase === "incomplete") {
    return (
      <div className="card reveal-card">
        <h1>Nothing here</h1>
        <p className="lede">
          {phase === "incomplete"
            ? "This link is incomplete — the part after the # is missing, and without it the secret cannot be decrypted."
            : "This secret has already been viewed, has expired, or never existed."}
        </p>
        <Link to="/" className="button">
          Share a secret of your own
        </Link>
      </div>
    );
  }

  if (phase === "revealed") {
    return (
      <>
        <h1>Here it is</h1>
        <p className="lede">Copy it now. It is gone from the server, and this page will not show it again.</p>

        <div className="card">
          <div className="readout">
            <pre className="readout-value">{plaintext}</pre>
            <CopyButton value={plaintext} label="Copy" className="button" />
          </div>
          <div className="callout">
            <WarningIcon />
            <p>
              <strong>Destroyed.</strong> Reloading this page will show nothing. If you need it again, ask the sender
              for a new link.
            </p>
          </div>
        </div>
      </>
    );
  }

  const revealing = phase === "revealing";
  const needsPassphrase = meta?.hasPassphrase === true;

  return (
    <div className="card reveal-card">
      <p className="muted">
        <LockIcon size={28} />
      </p>
      <h1>Someone shared a secret with you</h1>
      <p className="lede">
        It is encrypted, and can be read exactly once. Opening it destroys the server&rsquo;s copy immediately.
      </p>

      {needsPassphrase && (
        <div className="field">
          <label htmlFor={passphraseId}>Passphrase</label>
          <input
            id={passphraseId}
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="off"
            placeholder="The sender shared this separately"
          />
        </div>
      )}

      {error && (
        <div className="callout error" role="alert">
          <WarningIcon />
          <p>{error}</p>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="button large block"
          onClick={reveal}
          disabled={revealing || (needsPassphrase && passphrase.length === 0)}
        >
          {revealing ? <span className="spinner" /> : null}
          {revealing ? "Decrypting…" : "Reveal secret"}
        </button>
      </div>
    </div>
  );
}
