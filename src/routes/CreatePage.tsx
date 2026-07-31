import { useId, useState, type FormEvent } from "react";
import { DEFAULT_TTL_SECONDS, MAX_PLAINTEXT_BYTES, TTL_OPTIONS, type CreateSecretResponse } from "../../shared/types.js";
import { LinkResult } from "../components/LinkResult.js";
import { WarningIcon } from "../components/icons.js";
import { createSecret } from "../lib/api.js";
import { sealSecret } from "../lib/crypto.js";
import { byteLength, formatSize } from "../lib/format.js";

export function CreatePage() {
  const ids = { secret: useId(), ttl: useId(), passphrase: useId(), usePassphrase: useId() };

  const [text, setText] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState<number>(DEFAULT_TTL_SECONDS);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: CreateSecretResponse; linkKey: string } | null>(null);

  const size = byteLength(text);
  const tooLarge = size > MAX_PLAINTEXT_BYTES;
  const canSubmit = text.length > 0 && !tooLarge && !busy && (!usePassphrase || passphrase.length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      // Encryption happens here, in the browser. Everything below this line only
      // ever sees ciphertext.
      const { envelope, linkKey } = await sealSecret(text, usePassphrase ? passphrase : undefined);
      const created = await createSecret({ ...envelope, hasPassphrase: usePassphrase, ttlSeconds });

      setResult({ created, linkKey });
      setText("");
      setPassphrase("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <LinkResult created={result.created} linkKey={result.linkKey} onStartOver={() => setResult(null)} />;
  }

  return (
    <>
      <h1>Share a secret, once</h1>
      <p className="lede">
        Paste a password, key or private note. You get a link that works a single time, then destroys itself.
      </p>

      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor={ids.secret}>
            Secret
            <span className={tooLarge ? "char-count over" : "char-count"}>
              {formatSize(size)} / {MAX_PLAINTEXT_BYTES / 1024} KiB
            </span>
          </label>
          <textarea
            id={ids.secret}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="hunter2"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <div className="field field-row">
          <div>
            <label htmlFor={ids.ttl}>Expires after</label>
            <select id={ids.ttl} value={ttlSeconds} onChange={(event) => setTtlSeconds(Number(event.target.value))}>
              {TTL_OPTIONS.map((option) => (
                <option key={option.seconds} value={option.seconds}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="hint">Destroyed then, even if nobody opens it.</p>
          </div>

          <div>
            <span className="field-label">Passphrase</span>
            <div className="checkbox-row">
              <input
                id={ids.usePassphrase}
                type="checkbox"
                checked={usePassphrase}
                onChange={(event) => setUsePassphrase(event.target.checked)}
              />
              <label htmlFor={ids.usePassphrase}>Also require a passphrase</label>
            </div>
            {usePassphrase && (
              <>
                <label htmlFor={ids.passphrase} className="visually-hidden">
                  Passphrase
                </label>
                <input
                  id={ids.passphrase}
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Shared out of band"
                  required
                />
                <p className="hint">Send this separately &mdash; never in the same message as the link.</p>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="callout error" role="alert">
            <WarningIcon />
            <p>{error}</p>
          </div>
        )}

        <div className="actions">
          <button type="submit" className="button large" disabled={!canSubmit}>
            {busy ? <span className="spinner" /> : null}
            {busy ? "Encrypting…" : "Create link"}
          </button>
        </div>
      </form>
    </>
  );
}
