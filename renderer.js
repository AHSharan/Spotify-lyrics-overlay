(async function () {
  const API = window.env.API_ORIGIN;

  const authBtn = document.getElementById('authBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const closeBtn = document.getElementById('closeBtn');
  const clickThroughBtn = document.getElementById('clickThroughBtn');
  const opacityBtn = document.getElementById('opacityBtn');
  const titleEl = document.getElementById('title');
  const statusEl = document.getElementById('status');
  const lyricsEl = document.getElementById('lyrics');

  const setupEl = document.getElementById('setup');
  const clientIdInput = document.getElementById('clientIdInput');
  const saveClientIdBtn = document.getElementById('saveClientIdBtn');
  const setupError = document.getElementById('setupError');
  const redirectUriHint = document.getElementById('redirectUriHint');
  const dashboardLink = document.getElementById('dashboardLink');

  // ---------- playback / sync state ----------

  let lastTrackId = null;
  let cachedLyrics = null;
  let lyricsLines = [];

  let currentProgress = 0; // progress_ms as of the last poll
  let lastPollTime = 0; // Date.now() when that poll landed
  let isPlaying = false;
  let songDuration = 0;
  let manualSyncOffset = 0;

  let autoScrollEnabled = true;
  let scrollInterval = null;

  // Polls land every 3s but the tick runs every 300ms, so interpolate between them.
  function effectiveProgress() {
    if (!isPlaying || !lastPollTime) return currentProgress;
    return currentProgress + (Date.now() - lastPollTime);
  }

  // ---------- first-run setup ----------

  async function refreshConfig() {
    try {
      const r = await fetch(API + '/api/config');
      const cfg = await r.json();
      redirectUriHint.textContent = cfg.redirectUri;
      setupEl.classList.toggle('hidden', cfg.hasClientId);
      return cfg;
    } catch (e) {
      return null;
    }
  }

  saveClientIdBtn.addEventListener('click', async function () {
    setupError.textContent = '';
    try {
      const r = await fetch(API + '/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientIdInput.value })
      });
      const j = await r.json();
      if (!r.ok) {
        setupError.textContent = j.error || 'Could not save that Client ID.';
        return;
      }
      setupEl.classList.add('hidden');
      fetchAndRender(true);
    } catch (e) {
      setupError.textContent = 'Could not reach the local server.';
    }
  });

  clientIdInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveClientIdBtn.click();
  });

  dashboardLink.addEventListener('click', function (e) {
    e.preventDefault();
    window.overlay.openDashboard();
  });

  // ---------- controls ----------

  authBtn.addEventListener('click', function () {
    fetch(API + '/login').catch(function () {});
  });

  logoutBtn.addEventListener('click', async function () {
    await fetch(API + '/logout', { method: 'POST' }).catch(function () {});
    lastTrackId = null;
    cachedLyrics = null;
    stopAutoScroll();
    titleEl.textContent = 'Logged out';
    statusEl.textContent = '—';
    lyricsEl.textContent = 'Click the 🎵 button to log in again.';
  });

  refreshBtn.addEventListener('click', function () {
    fetchAndRender(true);
  });

  closeBtn.addEventListener('click', function () {
    window.close();
  });

  clickThroughBtn.addEventListener('click', async function () {
    await window.overlay.toggleClickThrough();
  });

  // Transparency: only the panel background fades, so lyrics stay legible.
  // Window-level setOpacity would fade the text along with it.
  const OPACITY_MODES = ['solid', 'translucent', 'ghost'];
  const OPACITY_ICONS = { solid: '●', translucent: '◐', ghost: '○' };
  let opacityMode = 'solid';

  function applyOpacity(mode) {
    opacityMode = mode;
    const overlay = document.querySelector('.overlay');
    overlay.dataset.opacity = mode;
    opacityBtn.textContent = OPACITY_ICONS[mode];
    opacityBtn.classList.remove('translucent', 'ghost');
    if (mode !== 'solid') opacityBtn.classList.add(mode);
    opacityBtn.title = 'Transparency: ' + mode + ' (click to cycle)';
    try {
      localStorage.setItem('overlay-opacity', mode);
    } catch (e) {
      /* private mode / blocked storage — the default is fine */
    }
  }

  opacityBtn.addEventListener('click', function () {
    const next = OPACITY_MODES[(OPACITY_MODES.indexOf(opacityMode) + 1) % OPACITY_MODES.length];
    applyOpacity(next);
  });

  let savedOpacity = 'solid';
  try {
    savedOpacity = localStorage.getItem('overlay-opacity') || 'solid';
  } catch (e) {
    /* fall through to the default */
  }
  applyOpacity(OPACITY_MODES.indexOf(savedOpacity) === -1 ? 'solid' : savedOpacity);

  window.overlay.onClickThroughChanged(function (enabled) {
    clickThroughBtn.classList.toggle('active', enabled);
    clickThroughBtn.textContent = enabled ? '🚫' : '👆';
    statusEl.textContent = enabled ? 'Click-through on — Ctrl+Shift+L to exit' : statusEl.textContent;
  });

  // ---------- data ----------

  // Returns a state as well as the data: only 'idle' should collapse the panel.
  // Collapsing on every non-playing state clipped the setup and login screens,
  // which are taller than the 70px minimised height.
  async function fetchCurrent() {
    try {
      const r = await fetch(API + '/api/current');

      if (r.status === 428) {
        setupEl.classList.remove('hidden');
        await refreshConfig();
        return { state: 'setup' };
      }
      if (r.status === 401) {
        titleEl.textContent = 'Not logged in';
        statusEl.textContent = 'Click 🎵';
        lyricsEl.textContent = 'Press the 🎵 button and authorise with Spotify in your browser.';
        return { state: 'unauth' };
      }
      if (r.status === 204) {
        titleEl.textContent = 'Nothing playing';
        statusEl.textContent = '—';
        lyricsEl.textContent = 'Start playing on Spotify.';
        return { state: 'idle' };
      }
      if (!r.ok) {
        titleEl.textContent = 'Spotify error';
        statusEl.textContent = 'Error ' + r.status;
        lyricsEl.textContent = 'Spotify rejected the request. Try the ↻ button.';
        return { state: 'error' };
      }
      return { state: 'ok', data: await r.json() };
    } catch (e) {
      titleEl.textContent = 'Server offline';
      statusEl.textContent = 'Restart the app';
      lyricsEl.textContent = 'The local server is not responding.';
      return { state: 'error' };
    }
  }

  async function fetchLyrics(artist, track) {
    try {
      const r = await fetch(
        API + '/api/lyrics?artist=' + encodeURIComponent(artist) + '&track=' + encodeURIComponent(track)
      );
      if (r.status !== 200) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  // ---------- lyric rendering / sync ----------

  function renderLyricsText(text) {
    lyricsEl.textContent = '';
    lyricsEl.scrollTop = 0;
    lyricsLines = [];
    manualSyncOffset = 0;

    text
      .split('\n')
      .filter(function (line) {
        return line.trim();
      })
      .forEach(function (line, index) {
        const p = document.createElement('div');
        p.textContent = line;
        p.dataset.index = index;
        p.addEventListener('click', function (e) {
          e.stopPropagation();
          syncFromLine(index);
        });
        lyricsEl.appendChild(p);
        lyricsLines.push(p);
      });

    updateLyricSync();
  }

  // Lyrics.ovh gives plain text with no timings, so line position is estimated
  // from elapsed fraction; tapping a line corrects the estimate.
  function syncFromLine(lineIndex) {
    const targetProgress = (lineIndex / lyricsLines.length) * songDuration;
    manualSyncOffset = targetProgress - effectiveProgress();
    autoScrollEnabled = true;
    updateLyricSync();
  }

  function updateLyricSync() {
    if (!lyricsLines.length || !songDuration) return;

    const adjusted = effectiveProgress() + manualSyncOffset;
    const percent = Math.max(0, Math.min(1, adjusted / songDuration));
    const activeIndex = Math.min(lyricsLines.length - 1, Math.floor(percent * lyricsLines.length));

    lyricsLines.forEach(function (line, index) {
      line.classList.remove('active', 'past', 'future');
      if (index === activeIndex) {
        line.classList.add('active');
        if (autoScrollEnabled) {
          line.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (index < activeIndex) {
        line.classList.add('past');
      } else {
        line.classList.add('future');
      }
    });
  }

  function startAutoScroll() {
    stopAutoScroll();
    if (!autoScrollEnabled) return;
    scrollInterval = setInterval(function () {
      if (autoScrollEnabled) updateLyricSync();
    }, 300);
  }

  function stopAutoScroll() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  lyricsEl.addEventListener('wheel', function (e) {
    if (e.deltaY !== 0) {
      autoScrollEnabled = false;
      stopAutoScroll();
      setTimeout(function () {
        autoScrollEnabled = true;
        startAutoScroll();
      }, 4000);
    }
  });

  // ---------- main loop ----------

  async function fetchAndRender(force) {
    const result = await fetchCurrent();
    const now = result.state === 'ok' ? result.data : null;

    if (!now || !now.item) {
      stopAutoScroll();
      isPlaying = false;
      titleEl.classList.remove('scrolling');
      // Only a genuinely idle player collapses the panel. Setup, login and
      // error states need the full height to show their message.
      if (result.state === 'idle') {
        minimizeUI(true);
      } else {
        expandUI();
      }
      return;
    }

    const item = now.item;
    const trackId = item.id;
    const title = item.name + ' — ' + item.artists.map(function (a) { return a.name; }).join(', ');

    if (title.length > 30) {
      titleEl.innerHTML = '';
      const span = document.createElement('span');
      span.textContent = title + ' • ' + title;
      titleEl.appendChild(span);
      titleEl.classList.add('scrolling');
    } else {
      titleEl.textContent = title;
      titleEl.classList.remove('scrolling');
    }

    statusEl.textContent = now.is_playing ? '▶ Playing' : '⏸ Paused';

    const trackChanged = trackId !== lastTrackId;
    currentProgress = now.progress_ms || 0;
    lastPollTime = Date.now();
    isPlaying = Boolean(now.is_playing);
    songDuration = item.duration_ms || 0;
    if (trackChanged) manualSyncOffset = 0;

    if (now.is_playing && !force && !trackChanged && cachedLyrics) {
      if (!scrollInterval) startAutoScroll();
      updateLyricSync();
      expandUI();
      return;
    }

    if (!now.is_playing) {
      stopAutoScroll();
      updateLyricSync();
      return;
    }

    const artist = item.artists.map(function (a) { return a.name; }).join(', ');
    lyricsEl.textContent = 'Fetching lyrics...';
    stopAutoScroll();

    const resp = await fetchLyrics(artist, item.name);
    if (resp && resp.lyrics) {
      cachedLyrics = resp.lyrics;
      lastTrackId = trackId;
      renderLyricsText(resp.lyrics);
      startAutoScroll();
      expandUI();
    } else {
      cachedLyrics = null;
      lastTrackId = trackId;
      lyricsEl.textContent = 'No lyrics available';
      stopAutoScroll();
      minimizeUI(false);
    }
  }

  function minimizeUI(isEmpty) {
    document.querySelector('.overlay').classList.add('minimized');
    if (isEmpty) lyricsEl.textContent = '';
  }

  function expandUI() {
    document.querySelector('.overlay').classList.remove('minimized');
  }

  await refreshConfig();
  setInterval(function () {
    fetchAndRender(false);
  }, 3000);
  fetchAndRender(true);
})();
