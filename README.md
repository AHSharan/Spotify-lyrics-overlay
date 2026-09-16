# Spotify Lyrics Overlay

A compact always-on-top desktop overlay showing what Spotify is playing, with
lyrics that follow along. Tap any line to correct the timing.

## Screenshots

<img width="420" height="630" alt="image" src="https://github.com/user-attachments/assets/0020c40d-a996-4347-98ab-5e833b6bdb9f" />
<img width="2549" height="1532" alt="image" src="https://github.com/user-attachments/assets/2bd2af7c-3820-498e-91bb-e46eda4698f8" />

## Install

1. Download the installer from [Releases](https://github.com/AHSharan/Spotify-lyrics-overlay/releases)
   and run it. It installs per-user, so no admin rights are needed.

   Windows SmartScreen will warn you, because the build is unsigned — **More
   info → Run anyway**.

2. Launch the app. It asks for a Spotify **Client ID** once. To get one:

   1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
      and log in.
   2. **Create app**. Any name and description will do.
   3. Under **Redirect URIs**, add exactly:

      ```
      http://127.0.0.1:8888/callback
      ```

      Character for character. `localhost` instead of `127.0.0.1`, or a
      trailing slash, will be rejected at login.
   4. Tick **Web API**, save, then copy the **Client ID** from the app's
      settings page. There is no client secret to copy — this app uses PKCE.

3. Paste the Client ID into the overlay and hit **Save**.

4. Click the 🎵 button. Authorise in the browser tab that opens, and you are
   done — the session is remembered, so this is a one-time step.

Start playing something on any Spotify client and lyrics will appear.

## Controls

| Control | What it does |
| --- | --- |
| 👆 | Click-through mode — clicks pass to whatever is underneath |
| 🎵 | Log in to Spotify |
| ⏻ | Log out and forget the stored session |
| ↻ | Refresh the current track now |
| × | Close |
| Click a lyric line | Re-sync the timing to that line |
| Drag the header | Move the window; its position is remembered |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | Toggle click-through — the way back once clicks pass through |

The overlay collapses to a slim bar when nothing is playing or no lyrics were
found.

## Run from source

```bash
git clone https://github.com/AHSharan/Spotify-lyrics-overlay.git
cd Spotify-lyrics-overlay
npm ci
npm start
```

Node 18 or newer. `npm start` is all you need — the server runs inside the
Electron process, so there is no second terminal.

Optionally, copy `.env.example` to `.env` and set `SPOTIPY_CLIENT_ID` to
pre-fill the first-run screen. It is a convenience, not a requirement.

Building the Windows installer is covered in [BUILDING.md](BUILDING.md).

## Known limitations

**Lyric timing is estimated.** Lyrics.ovh serves plain text with no timestamps,
so the app spreads the lines evenly across the track's duration. That drifts on
anything with a long intro, an instrumental break, or a slow outro. Tapping the
line that is actually playing re-anchors it, and the correction holds for the
rest of the song.

**You need your own Client ID.** A Spotify app starts in development mode,
which only serves users on an allowlist the app owner maintains, capped at 25.
Extending it requires a quota extension request to Spotify. That is why setup
asks you to create your own app rather than shipping a shared one — and it is
a Spotify policy, not something the app can work around.

**Not every song has lyrics.** Lyrics.ovh misses remixes, live versions, and
anything obscure. The overlay collapses to its slim bar when a track comes back
empty.

**Windows only, for now.** The build config and the installer target Windows.
The code has nothing Windows-specific in it, but macOS and Linux builds are
untested, so they are not published.

## How it works

Electron main process starts an Express server on `127.0.0.1:8888` (falling
back to 8889 or 8890 if that port is busy), then opens the overlay window. The
server handles the PKCE OAuth exchange, proxies the Spotify playback endpoint,
and fetches lyrics from Lyrics.ovh, caching them to disk.

Your Client ID, refresh token, window position, and cached lyrics all live in
your user data folder — `%APPDATA%\electron-spotify-lyrics` on Windows — never
in the install directory or the repo.

```
├── main.js           # Electron main process, window, IPC
├── preload.js        # contextBridge: API port + click-through
├── server.js         # Express: PKCE auth, playback proxy, lyrics
├── renderer.html     # UI markup
├── renderer.js       # Polling, lyric sync, first-run setup
├── styles.css        # Styles
└── build/            # Icon resources for electron-builder
```

## Contributing

Pull requests are welcome. For anything substantial, open an issue first.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Spotify Web API for playback data, [Lyrics.ovh](https://lyrics.ovh) for lyrics.
