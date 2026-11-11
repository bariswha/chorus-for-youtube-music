# Security

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's **Report a vulnerability** button on the Security tab of this repository instead. You should get a reply within a few days.

## Threat model

Chorus sends all traffic through public MQTT relays that anyone can connect to. The design assumes the relays and everyone else on them are untrusted. It also assumes that scripts running on music.youtube.com are untrusted.

### What is protected

- **Confidentiality.** Every payload is encrypted with AES‑256‑GCM. Jam traffic uses a key derived from the invite secret. Presence uses a per‑user key shared only with friends. Direct messages and invites use a fresh ECDH key for each message.
- **Authenticity.** Every Jam message and direct message is signed with ECDSA P‑256. A user's ID is the SHA‑256 hash of their public keys, so a signature can only be produced by the real owner of that ID.
- **Host authority.** An invite code names the host it came from, and a new member accepts its first Jam state only from that host. After that, members accept a new state only if the current host signed it, or through a takeover that follows fixed rules after the host has been silent. The host enforces permissions for every action, so guests without **Control** can't play, pause, seek, skip or reorder.
- **Replay protection.** Direct messages carry a random nonce and a timestamp, and duplicates are dropped. Seen nonces survive service worker restarts. A key rotation is accepted only if it names the secret it replaces. Every Jam message also carries a random nonce, and seen nonces are kept across service worker restarts. Nonces are never evicted before they are old enough to fail the timestamp check; if the store fills up, new messages are rejected instead. Jam actions carry IDs that the host de‑duplicates, and Jam state is versioned.
- **Presence.** Presence updates, including the offline notice, are signed by their owner and tied to a connection session, so one friend can't fake another friend's status or name, or knock them offline.
- **Removal.** When someone is removed from a Jam, the host rotates the Jam secret and sends the new one only to the remaining members. When someone is removed as a friend, the presence key is rotated.
- **Friend codes.** A friend code is derived from a hash of its owner's public keys and a salt. A forged card published under someone else's code fails verification.
- **Input handling.** Everything received from the network goes through strict validation (`extension/clean.js`). A song must have an 11‑character video ID and the exact matching `https://music.youtube.com/watch?v=` URL. Other links must be `music.youtube.com` watch, playlist, browse or channel URLs with a fixed character set. Artwork is accepted only from `i.ytimg.com/vi/…` and `lh3`/`yt3.googleusercontent.com` with a strict character set. All text and attribute values are escaped before rendering, and control and bidi‑override characters are removed. The panel ignores synthetic (script‑generated) clicks and key presses.
- **Page isolation.** Keys, Jam secrets and messages live only in the service worker and the extension's isolated world. The Chorus panel and its notifications are rendered inside a closed shadow root created from that isolated world, so scripts on music.youtube.com can't read chats, codes or names from the page or rewrite the panel's buttons. The small script that drives YouTube Music's player talks to the extension over a private `MessageChannel` set up at page start. It captures the browser APIs it relies on before page scripts run, and everything it reports is treated as untrusted input.
- **Google account.** Chorus never reads your Google account name, picture or channel. Song details and suggestions come from YouTube Music's public `next` endpoint, called with `credentials: 'omit'` and only the client name, client version and language, so no cookies, visitor ID or auth headers are sent. Songs that YouTube Music marks as private or as your own uploads are never reported to peers, friends or stats.
- **Limits.** Inbound messages are rate‑limited per sender, and packets larger than 1 MB are rejected. A Jam holds at most 30 people and 300 queued songs. Pending friend requests expire after 14 days.
- **Separation.** This extension uses its own MQTT namespace and key-derivation salt, so it never exchanges messages with Chorus for SoundCloud.

### Known limitations

- The relays can see connection IP addresses, message sizes and timing, and which encrypted topics a client uses.
- Anyone who has a Jam's invite code can join it until the host locks the Jam or issues a new code. Treat invite codes like a link to a private room.
- Leaving a Jam doesn't rotate its key, so a former member who kept the code could still read the Jam until the host presses **New invite code**. Removing someone does rotate it.
- Scripts running on music.youtube.com can see the buttons Chorus adds to YouTube Music's own player bar and menus, and they can talk to the script that drives the player. They can't reach keys, messages or Jam secrets, and anything they trigger is still limited by your Jam permissions.
- Members of the same Jam learn each other's public keys and display names.
- Messages are delivered only while both sides are online. Nothing is stored on a server.
- A flood of junk messages to a known inbox topic can cost the recipient some CPU, even though the messages are rejected.
- Keys are stored in `chrome.storage.local`, which is protected by the browser profile and not by a passphrase.
- There is no forward secrecy. Jam keys stay the same until the host issues a new code, and direct messages are encrypted to each person's long-term key. If a key leaks, traffic recorded earlier could be decrypted.
- The project has been reviewed and tested but not audited by a professional security firm. Don't use it for sensitive information.
