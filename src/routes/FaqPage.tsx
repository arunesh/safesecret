import { Link } from "react-router";

export function FaqPage() {
  return (
    <div className="prose">
      <h1>How it works</h1>
      <p className="lede">
        The short version: your browser does the encryption, and we hold something we cannot read.
      </p>

      <h2>What happens when you create a link</h2>
      <ul>
        <li>Your browser generates a random 256-bit key and encrypts the secret with AES-256-GCM.</li>
        <li>Only the ciphertext is sent to us. The key is placed after the <code>#</code> in your link.</li>
        <li>
          Everything after <code>#</code> is a URL fragment, and browsers never send fragments in an HTTP request. We
          never receive the key, and neither does any proxy or log along the way.
        </li>
      </ul>

      <h2>What we store</h2>
      <ul>
        <li>The ciphertext, an initialisation vector, and an expiry timestamp.</li>
        <li>Nothing else — no IP address, no user agent, no referrer, no record of who viewed what.</li>
      </ul>

      <h2>Why the link only works once</h2>
      <p>
        Revealing a secret deletes it and returns it in a single atomic database statement. If two people open the link
        at the same moment, exactly one of them gets the secret and the other gets nothing.
      </p>
      <p>
        Merely loading the page does not consume the secret — that takes a deliberate click. This matters because chat
        apps and mail scanners routinely fetch links to build previews, and a naive design lets them burn your secret
        before the recipient ever sees it.
      </p>

      <h2>Passphrases</h2>
      <p>
        A passphrase is mixed into the encryption key with PBKDF2 (600,000 iterations). Both the link and the
        passphrase are then required. Send them through different channels — a passphrase in the same message as the
        link protects nobody.
      </p>

      <h2>What this does not protect against</h2>
      <p>
        We serve the JavaScript that does the encryption. Anyone who compromises this site could serve modified code
        that captures your secret as you type or reveal it. No browser-based encryption scheme escapes this, and any
        service claiming otherwise is overselling. We keep the attack surface small — a strict Content Security Policy,
        no third-party scripts, no analytics — but you should know the limit rather than trust a slogan.
      </p>
      <p>
        A lost link cannot be recovered. There is no reset, no support channel that can retrieve it, and no copy on our
        side that could be handed to anyone who asked. That is the point.
      </p>

      <p>
        <Link to="/">Share a secret</Link>
      </p>
    </div>
  );
}
