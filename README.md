<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Chorus logo">
</p>

<h1 align="center">Chorus for YouTube Music</h1>

<p align="center">
  Listen to YouTube Music together, in sync.<br>
  Shared queue · host controls · end-to-end encrypted chat · synced lyrics · your yearly recap
</p>

<p align="center">
  <a href="README.tr.md">Türkçe</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="PRIVACY.md">Privacy</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<p align="center">
  <img src="docs/jam.png" width="260" alt="Jam with a shared queue">
  <img src="docs/chat.png" width="260" alt="Jam chat">
  <img src="docs/friends.png" width="260" alt="Friends">
</p>

## Features

**Listen together**
- **Jams.** Start a Jam, share the invite code, and everyone hears the same song at the same moment. Clock sync and gentle speed correction keep everyone within a few tens of milliseconds.
- **Shared queue.** Add songs, albums or playlists from any `⋮` menu in YouTube Music, or right-click a song. Drag to reorder. When the queue runs low, suggestions from YouTube Music's own radio keep the music going.
- **Host controls.** The host decides what everyone else can do. By default, guests can add songs and only the host controls playback. The host can grant **Queue** or **Control** to each person, remove people, hand over the host role, lock the Jam, or issue a new invite code.
- **Works with ads.** On the free tier, an ad only pauses you, not the Jam. When it ends, Chorus puts you back at the right spot.
- **Reactions.** Send ❤️ 🔥 😂 🥹 🎉 to the song that's playing.

**Friends and chat**
- **Friend codes.** Everyone has a short code like `K7QM-2XPA-9RTV`. You can add friends with their code or straight from a Jam, on any network.
- **Presence.** See which friends are online, what they're listening to, and who's in a Jam. Join with one click or invite them into yours.
- **Messages.** Chat with everyone in the Jam, or message friends directly. Everything is end-to-end encrypted.

**For you, even outside a Jam**
- **Synced lyrics.** Lyrics scroll line by line with the song. Click a line to jump to it. Lyrics come from [LRCLIB](https://lrclib.net).
- **Stats.** See your top songs and artists, total minutes, and when you listen, for the last 30 days, this year or all time. Stats are stored only on your device. You can let friends see a summary.
- **Yearly recap.** Once the year is over, your recap of minutes, top artist and top songs is ready to open and share.
- **Sleep timer.** Stop the music after 15, 30 or 60 minutes, or at the end of the current song.
- **English and Turkish.** Chorus follows your browser language, and you can switch it in Settings.

No Google sign-in is needed. Chorus never reads your Google account. You pick a display name in Settings.

## Install

Chorus works in Chrome, Edge, Brave, Opera and other Chromium browsers (version 116 or newer).

1. Download the latest `chorus-ytm-*.zip` from [Releases](../../releases) and unzip it. You can also clone this repository.
2. Open `chrome://extensions` (in Edge, `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Open or reload [music.youtube.com](https://music.youtube.com). The Chorus and lyrics buttons appear in the player bar, and a **Jam** button appears in the top bar.

Everyone who wants to listen together needs to install Chorus. This version only talks to other Chorus for YouTube Music users. It doesn't mix with [Chorus for SoundCloud](https://github.com/bariswha/chorus-for-soundcloud).

## How it works

Chorus has no server of its own. Peers exchange small encrypted messages through public MQTT relays (`broker.emqx.io`, with `broker.hivemq.com` and `test.mosquitto.org` as fallbacks) over TLS WebSockets.

| Piece | How it's protected |
| --- | --- |
| Identity | Each install creates a P‑256 signing key and a P‑256 key‑agreement key. Your ID is a hash of both public keys, so nobody else can claim it. |
| Jam traffic | AES‑256‑GCM with a key derived from the invite code. Every message is also signed, so members can't impersonate each other or the host. |
| Direct messages, invites, friend requests | Encrypted to the recipient with an ephemeral ECDH key and signed by the sender. Each message carries a nonce and timestamp to block replays. |
| Presence | Encrypted with a per‑user key that only your friends hold, and signed by its owner. Removing a friend rotates the key. |
| Friend codes | A code is a hash of the owner's public keys, so a code can't be redirected to someone else. |
| Removing someone from a Jam | The host rotates the Jam key, and the old invite code stops working. |

The relays see only encrypted data, random‑looking topic names and connection IPs. See [SECURITY.md](SECURITY.md) for the full threat model.

In the page, Chorus drives YouTube Music's own player: it opens the Jam's song through YouTube Music's normal navigation, seeks and pauses it, and nudges the playback speed by a few percent to stay in sync. Ads play as usual. While an ad runs, Chorus waits and then resyncs. Song details and suggestions come from YouTube Music's public `next` endpoint, called without cookies.

### Project layout

```
extension/
  manifest.json      Manifest V3
  sw.js              Service worker: identity, networking, Jams, friends, chat
  net.js             Minimal MQTT 3.1.1 client and WebCrypto helpers
  clean.js           Input validation for everything received from the network
  stats.js           Local listening stats and yearly recaps
  lyrics.js          LRCLIB lookup
  page.js            Runs in the page and drives YouTube Music's player
  bridge.js          Private MessageChannel between page.js and the extension
  content.js         Sync engine, ad handling and permission-aware actions
  ui.js, i18n.js     Panel UI, menu items and English/Turkish strings
  chorus.css         Styles
```

There's no build step. Edit a file, click reload on `chrome://extensions`, and refresh YouTube Music.

## Compatibility

Chorus hooks into YouTube Music's web player, which can change without notice. It never skips or blocks ads. If something breaks after a YouTube Music update, please open an issue.

## Support

Chorus is free and will stay free, with no ads of its own and no tracking. If it's useful to you, you can support my work on [GitHub Sponsors](https://github.com/sponsors/bariswha). It helps cover my living costs so I can keep building and maintaining more free extensions.

## Contributing

Issues and pull requests are welcome. Keep the extension dependency‑free, validate everything that comes from the network, and escape everything you render.

## Good to know

- **Not for sensitive information.** Messages are end-to-end encrypted, but Chorus is made for listening to music together, not for private conversations. Don't share passwords, personal documents or anything sensitive through it.
- **Invite codes are keys.** Anyone who has a Jam's invite code can join it and read its chat. Share codes only with people you trust, and use **New invite code** if one leaks.
- **No professional audit.** The code has been reviewed and tested, but it hasn't been audited by a security firm. There is no forward secrecy: if a key leaks later, previously recorded traffic could be decrypted. See [SECURITY.md](SECURITY.md).
- **No audio is shared.** Chorus doesn't download, record or redistribute audio. Each listener plays tracks in their own YouTube Music tab, and using YouTube Music remains subject to YouTube's own terms.
- **Provided as is.** Chorus is a free hobby project with no warranty of any kind. See [LICENSE](LICENSE).

## Disclaimer

Chorus is an independent open-source project. It isn't affiliated with, endorsed by or sponsored by YouTube or Google. YouTube Music is a trademark of Google LLC.

## License

[MIT](LICENSE)
