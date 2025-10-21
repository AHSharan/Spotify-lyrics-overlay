// Express server: OAuth with Spotify, token exchange, cached token, endpoints for current playback and lyrics
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const open = require('open');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8888;
const CLIENT_ID = process.env.SPOTIPY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIPY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing SPOTIPY_CLIENT_ID or SPOTIPY_CLIENT_SECRET in .env');
  process.exit(1);
}

let access_token = null;
let refresh_token = null;
let token_expires_at = 0;

function setTokens(data) {
  access_token = data.access_token;
  refresh_token = data.refresh_token || refresh_token;
  token_expires_at = Date.now() + (data.expires_in || 3600) * 1000 - 30000; // 30s early
}

async function refreshIfNeeded() {
  if (!access_token || Date.now() > token_expires_at) {
    if (!refresh_token) return;
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refresh_token);
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);

    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      body: params
    });
    const j = await r.json();
    if (j.access_token) setTokens(j);
  }
}

// OAuth start
app.get('/auth', (req, res) => {
  const scopes = encodeURIComponent('user-read-playback-state user-read-currently-playing');
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(url);
});

// OAuth callback
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('No code in callback');
  const params = new URLSearchParams();
  params.append('grant_type', 'authorization_code');
  params.append('code', code);
  params.append('redirect_uri', REDIRECT_URI);
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      body: params
    });
    const j = await r.json();
    if (j.error) return res.send('Token error: ' + JSON.stringify(j));
    setTokens(j);
    res.send('<html><body><h3>Auth successful — you can close this tab.</h3></body></html>');
  } catch (e) {
    console.error(e);
    res.send('Auth exchange failed');
  }
});

app.get('/login', (req, res) => {
  // open auth in user's default browser
  const authUrl = `http://127.0.0.1:${PORT}/auth`;
  open(authUrl);
  res.send('<html><body><h3>Opened browser for Spotify login — check your browser.</h3></body></html>');
});

// Proxy endpoint: get current playback (uses stored access_token)
app.get('/api/current', async (req, res) => {
  try {
    await refreshIfNeeded();
    if (!access_token) return res.status(401).json({ error: 'Not authorized. Visit /login' });
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (r.status === 204) return res.json({});
    const j = await r.json();
    res.json(j);
  } catch (e) {
    console.error('current error', e);
    res.status(500).json({ error: 'server error' });
  }
});

// Lyrics.ovh endpoint
async function fetchLyricsOVH(artist, track) {
  try {
    const artistEnc = encodeURIComponent(artist || '');
    const trackEnc = encodeURIComponent(track || '');
    const url = `https://api.lyrics.ovh/v1/${artistEnc}/${trackEnc}`;
    const r = await fetch(url, { timeout: 8000 });
    if (r.status !== 200) return null;
    const j = await r.json();
    return j.lyrics ? j.lyrics.trim() : null;
  } catch (e) {
    return null;
  }
}

// /api/lyrics?artist=&track=
app.get('/api/lyrics', async (req, res) => {
  const artist = req.query.artist || '';
  const track = req.query.track || '';
  // try cache file
  const cacheDir = path.join(__dirname, 'lyrics_cache');
  try { if (!require('fs').existsSync(cacheDir)) require('fs').mkdirSync(cacheDir); } catch(e){}
  const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '_');
  const cacheFile = path.join(cacheDir, `${safeName(artist)}--${safeName(track)}.txt`);
  if (require('fs').existsSync(cacheFile)) {
    return res.json({ lyrics: require('fs').readFileSync(cacheFile, 'utf8'), source: 'cache' });
  }

  let lyrics = await fetchLyricsOVH(artist, track);
  if (lyrics) {
    require('fs').writeFileSync(cacheFile, lyrics, 'utf8');
    return res.json({ lyrics, source: 'lyrics.ovh' });
  }

  return res.status(404).json({ error: 'Lyrics not found' });
});

// Serve static files (renderer) if needed
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
  console.log(`Open http://127.0.0.1:${PORT}/login to authenticate with Spotify`);
});
