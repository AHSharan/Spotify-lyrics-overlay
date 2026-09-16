// Express server: Spotify PKCE OAuth + playback/lyrics endpoints.
// Exports start({ userDataDir, openExternal }) — does NOT listen at import time.
require('dotenv').config(); // developer convenience only; absent in a packaged app
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT_CANDIDATES = [8888, 8889, 8890];
const SCOPES = 'user-read-playback-state user-read-currently-playing';

let paths = null; // { config, tokens, lyricsCache }
let activePort = null;
let openExternal = null;

// in-memory session state
let access_token = null;
let token_expires_at = 0;
let pkce_verifier = null;

// ---------- persistence (userData, never the repo folder) ----------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getClientId() {
  const stored = readJson(paths.config, {}).clientId;
  if (stored) return stored;
  // .env pre-fills during development but is no longer required.
  return process.env.SPOTIPY_CLIENT_ID || null;
}

function setClientId(clientId) {
  const cfg = readJson(paths.config, {});
  cfg.clientId = clientId;
  writeJson(paths.config, cfg);
}

function getRefreshToken() {
  return readJson(paths.tokens, {}).refresh_token || null;
}

function setRefreshToken(token) {
  if (!token) return;
  writeJson(paths.tokens, { refresh_token: token });
}

function clearTokens() {
  access_token = null;
  token_expires_at = 0;
  try {
    fs.rmSync(paths.tokens, { force: true });
  } catch (e) {
    /* nothing to remove */
  }
}

function redirectUri() {
  return 'http://127.0.0.1:' + activePort + '/callback';
}

// ---------- PKCE ----------

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeVerifier() {
  return base64url(crypto.randomBytes(48));
}

function challengeFor(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// ---------- token handling ----------

function applyTokenResponse(j) {
  access_token = j.access_token;
  token_expires_at = Date.now() + (j.expires_in || 3600) * 1000 - 30000; // refresh 30s early
  if (j.refresh_token) setRefreshToken(j.refresh_token); // Spotify rotates these under PKCE
}

async function refreshIfNeeded() {
  if (access_token && Date.now() < token_expires_at) return;

  const refresh_token = getRefreshToken();
  const clientId = getClientId();
  if (!refresh_token || !clientId) return;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh_token,
    client_id: clientId
  });

  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    const j = await r.json();
    if (j.access_token) {
      applyTokenResponse(j);
    } else if (j.error === 'invalid_grant') {
      // revoked or expired — force a fresh login rather than retrying forever
      clearTokens();
    }
  } catch (e) {
    console.error('token refresh failed:', e.message);
  }
}

// ---------- lyrics ----------

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '_');
}

async function fetchLyricsOVH(artist, track) {
  try {
    const url =
      'https://api.lyrics.ovh/v1/' +
      encodeURIComponent(artist || '') +
      '/' +
      encodeURIComponent(track || '');
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j.lyrics ? j.lyrics.trim() : null;
  } catch (e) {
    return null;
  }
}

// ---------- routes ----------

function buildApp() {
  const app = express();
  app.use(express.json());

  // First-run state for the renderer.
  app.get('/api/config', function (req, res) {
    res.json({
      hasClientId: Boolean(getClientId()),
      loggedIn: Boolean(getRefreshToken()),
      redirectUri: redirectUri(),
      port: activePort
    });
  });

  app.post('/api/config', function (req, res) {
    const clientId = ((req.body && req.body.clientId) || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      return res
        .status(400)
        .json({ error: 'That does not look like a Spotify Client ID (32 hex characters).' });
    }
    setClientId(clientId);
    res.json({ ok: true });
  });

  app.get('/auth', function (req, res) {
    const clientId = getClientId();
    if (!clientId) return res.status(400).send('<h3>No Client ID configured yet.</h3>');

    pkce_verifier = makeVerifier();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challengeFor(pkce_verifier)
    });
    res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
  });

  app.get('/callback', async function (req, res) {
    const code = req.query.code;
    const error = req.query.error;

    if (error) return res.send('<h3>Spotify returned an error: ' + error + '</h3>');
    if (!code) return res.send('<h3>No code in callback</h3>');
    if (!pkce_verifier) {
      return res.send('<h3>No login in progress — click Login in the overlay again.</h3>');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri(),
      client_id: getClientId(),
      code_verifier: pkce_verifier
    });

    try {
      const r = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body
      });
      const j = await r.json();
      pkce_verifier = null;

      if (j.error) {
        return res.send(
          '<h3>Token error: ' + j.error + '</h3><p>' + (j.error_description || '') + '</p>' +
          '<p>Check that <code>' + redirectUri() + '</code> is registered as a Redirect URI in ' +
          'your Spotify app dashboard, character for character.</p>'
        );
      }

      applyTokenResponse(j);
      res.send('<html><body><h3>Logged in — you can close this tab.</h3></body></html>');
    } catch (e) {
      console.error(e);
      res.send('<h3>Auth exchange failed</h3>');
    }
  });

  app.get('/login', function (req, res) {
    if (!getClientId()) return res.status(400).json({ error: 'No Client ID configured' });
    openExternal('http://127.0.0.1:' + activePort + '/auth');
    res.json({ ok: true });
  });

  app.post('/logout', function (req, res) {
    clearTokens();
    res.json({ ok: true });
  });

  app.get('/api/current', async function (req, res) {
    try {
      if (!getClientId()) return res.status(428).json({ error: 'No Client ID configured' });

      await refreshIfNeeded();
      if (!access_token) return res.status(401).json({ error: 'Not authorized' });

      const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: 'Bearer ' + access_token }
      });

      if (r.status === 204) return res.status(204).end(); // real 204: nothing playing
      if (r.status === 401) {
        access_token = null;
        return res.status(401).json({ error: 'Token rejected' });
      }
      if (!r.ok) return res.status(502).json({ error: 'Spotify returned ' + r.status });

      res.json(await r.json());
    } catch (e) {
      console.error('current error', e);
      res.status(500).json({ error: 'server error' });
    }
  });

  app.get('/api/lyrics', async function (req, res) {
    const artist = req.query.artist || '';
    const track = req.query.track || '';

    fs.mkdirSync(paths.lyricsCache, { recursive: true });
    const cacheFile = path.join(paths.lyricsCache, safeName(artist) + '--' + safeName(track) + '.txt');

    if (fs.existsSync(cacheFile)) {
      return res.json({ lyrics: fs.readFileSync(cacheFile, 'utf8'), source: 'cache' });
    }

    const lyrics = await fetchLyricsOVH(artist, track);
    if (lyrics) {
      try {
        fs.writeFileSync(cacheFile, lyrics, 'utf8');
      } catch (e) {
        /* cache is best-effort */
      }
      return res.json({ lyrics: lyrics, source: 'lyrics.ovh' });
    }

    res.status(404).json({ error: 'Lyrics not found' });
  });

  return app;
}

// ---------- startup with port fallback ----------

function listenOn(app, port) {
  return new Promise(function (resolve, reject) {
    const server = app.listen(port, '127.0.0.1');
    server.once('listening', function () {
      resolve(server);
    });
    server.once('error', reject);
  });
}

async function start(options) {
  paths = {
    config: path.join(options.userDataDir, 'config.json'),
    tokens: path.join(options.userDataDir, 'tokens.json'),
    lyricsCache: path.join(options.userDataDir, 'lyrics_cache')
  };
  openExternal = options.openExternal;

  const app = buildApp();
  let lastError = null;

  for (const port of PORT_CANDIDATES) {
    try {
      const server = await listenOn(app, port);
      activePort = port;
      console.log('Server listening on http://127.0.0.1:' + port);

      if (port !== PORT_CANDIDATES[0]) {
        console.warn(
          'Port ' + PORT_CANDIDATES[0] + ' was busy, so this run uses ' + port + '. ' +
          'Add "' + redirectUri() + '" as a Redirect URI in your Spotify app dashboard, ' +
          'or close whatever is using ' + PORT_CANDIDATES[0] + '.'
        );
      }
      return { server: server, port: port };
    } catch (e) {
      lastError = e;
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }

  const err = new Error(
    'Ports ' + PORT_CANDIDATES.join(', ') + ' are all in use. A server from a previous ' +
    'crashed run is probably still alive — close it and try again.'
  );
  err.code = 'EADDRINUSE';
  err.cause = lastError;
  throw err;
}

module.exports = { start: start };
