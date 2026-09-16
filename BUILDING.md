# Building the Windows installer

```bash
npm ci
npm run build:win
```

The installer lands in `dist/` as `Spotify Lyrics Overlay Setup <version>.exe`.

## Windows gotchas

These are the failures that actually come up on a clean Windows machine.

### `winCodeSign` fails to extract with a symlink error

electron-builder unpacks a `winCodeSign` bundle into its cache, and that
archive contains symlinks. Creating symlinks on Windows needs a privilege
normal accounts don't have, so extraction dies with something like
`ERROR: Cannot create symbolic link`.

Fix it once, either way:

- **Enable Developer Mode** — Settings → System → For developers → Developer
  Mode. This grants symlink creation permanently, and is the option to prefer.
- **Or run the terminal as Administrator** for a single build, just long
  enough to populate the cache.

The cache lives at `%LOCALAPPDATA%\electron-builder\Cache`. If a half-extracted
bundle is already there, delete that folder before retrying.

### The build hunts for a signing certificate

An unsigned build will otherwise stop looking for one. This repo sets
`"signExecutable": false` under `build.win`, which covers it.

Use that and **not** `signAndEditExecutable: false`. The latter also disables
*resource editing*, which is the step that writes your icon and version
metadata into the .exe — you get a working build carrying the default Electron
icon, with only a line in the build log to tell you. If you hit certificate
errors anyway, belt and braces:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:win
```

Unsigned installers make SmartScreen show a "Windows protected your PC"
warning — **More info → Run anyway**. Getting rid of that needs a real code
signing certificate, which costs money and is out of scope here.

### Installing needs admin rights

It shouldn't. `build.nsis` sets `oneClick: false` and `perMachine: false`, so
the installer runs per-user and prompts for an install directory. If you see a
UAC prompt, check those two values haven't been changed.

### The icon

`build/icon.ico` must exist and be a real multi-size ICO — electron-builder
aborts if it is missing, and Windows renders a blank icon if the file is just a
renamed PNG. The committed one carries 16/24/32/48/64/128/256 px.

To regenerate it from `build/icon.png`:

```bash
python -c "from PIL import Image; im=Image.open('build/icon.png'); im.save('build/icon.ico', sizes=[(s,s) for s in (16,24,32,48,64,128,256)])"
```

## Verifying a build

`npm start` runs from source and does **not** exercise the packaged paths.
Packaging is where `__dirname` becomes a read-only `app.asar`, so always test
the real thing:

1. Run `dist/Spotify Lyrics Overlay Setup <version>.exe`.
2. Launch the installed app from the Start menu.
3. The first-run screen should ask for a Client ID — that confirms the app is
   reading and writing `userData` rather than the install folder.
4. Log in, play a song, confirm lyrics appear.

If the app opens but the window is blank, the server failed to start; it will
normally say why in the window itself.
