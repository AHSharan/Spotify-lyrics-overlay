(async function(){
  const API = window.env.API_ORIGIN || 'http://127.0.0.1:8888';
  const authBtn = document.getElementById('authBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const closeBtn = document.getElementById('closeBtn');
  const titleEl = document.getElementById('title');
  const statusEl = document.getElementById('status');
  const lyricsEl = document.getElementById('lyrics');

  authBtn.addEventListener('click', () => {
    window.open(`${API}/login`, '_blank');
  });
  refreshBtn.addEventListener('click', () => fetchAndRender(true));
  closeBtn.addEventListener('click', () => window.close());

  let lastTrackId = null;
  let cachedLyrics = null;

  async function fetchCurrent() {
    try {
      const r = await fetch(`${API}/api/current`);
      if (r.status === 401) {
        titleEl.textContent = 'Not authorized';
        statusEl.textContent = 'Click Login';
        lyricsEl.textContent = 'Press Login and authenticate with Spotify in your browser.';
        return null;
      }
      if (r.status === 204) {
        titleEl.textContent = 'Nothing playing';
        statusEl.textContent = '—';
        lyricsEl.textContent = 'Start playing on Spotify.';
        return null;
      }
      const j = await r.json();
      return j;
    } catch (e) {
      console.error(e);
      titleEl.textContent = 'Server offline';
      statusEl.textContent = 'Start the app/server';
      lyricsEl.textContent = 'Open a terminal and run `npm run dev` if needed.';
      return null;
    }
  }

  async function fetchLyrics(artist, track) {
    try {
      const r = await fetch(`${API}/api/lyrics?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`);
      if (r.status === 200) {
        const j = await r.json();
        return j;
      }
      return null;
    } catch(e) { return null; }
  }

  let autoScrollEnabled = true;
  let scrollInterval = null;
  let lyricsLines = [];
  let currentProgress = 0;
  let songDuration = 0;
  let manualSyncOffset = 0;
  let lastProgress = 0;
  let syncSpeed = 1.0; // Multiplier for sync speed

  async function renderLyricsText(text) {
    lyricsEl.textContent = '';
    lyricsEl.scrollTop = 0;
    lyricsLines = [];
    manualSyncOffset = 0;
    lastProgress = currentProgress;
    
    const lines = text.split('\n').filter(line => line.trim());
    lines.forEach((line, index) => {
      const p = document.createElement('div');
      p.textContent = line;
      p.dataset.index = index;
      
      // Click to sync from this line
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        syncFromLine(index);
      });
      
      lyricsEl.appendChild(p);
      lyricsLines.push(p);
    });

    updateLyricSync();
  }

  function syncFromLine(lineIndex) {
    // Set the manual offset so this line becomes active
    const targetProgress = (lineIndex / lyricsLines.length) * songDuration;
    manualSyncOffset = targetProgress - currentProgress;
    autoScrollEnabled = true;
    updateLyricSync();
  }

  function updateLyricSync() {
    if (!lyricsLines.length || !songDuration) return;
    
    // Calculate progress delta and apply speed multiplier
    const progressDelta = currentProgress - lastProgress;
    if (progressDelta > 0) {
      manualSyncOffset += progressDelta * (syncSpeed - 1);
    }
    lastProgress = currentProgress;
    
    // Apply manual sync offset
    const adjustedProgress = currentProgress + manualSyncOffset;
    const progressPercent = Math.max(0, Math.min(1, adjustedProgress / songDuration));
    const activeIndex = Math.floor(progressPercent * lyricsLines.length);
    
    lyricsLines.forEach((line, index) => {
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

    scrollInterval = setInterval(() => {
      if (autoScrollEnabled) {
        updateLyricSync();
      }
    }, 300);
  }

  function stopAutoScroll() {
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }

  // Pause auto-scroll when user manually scrolls with wheel
  lyricsEl.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      autoScrollEnabled = false;
      stopAutoScroll();
      
      // Re-enable after 4 seconds
      setTimeout(() => {
        autoScrollEnabled = true;
        startAutoScroll();
      }, 4000);
    }
  });

  async function fetchAndRender(force=false) {
    const now = await fetchCurrent();
    if (!now || !now.item) {
      stopAutoScroll();
      minimizeUI(true);
      titleEl.textContent = 'Not playing';
      titleEl.dataset.text = '';
      titleEl.classList.remove('scrolling');
      return;
    }
    const item = now.item;
    const trackId = item.id;
    const title = `${item.name} — ${item.artists.map(a => a.name).join(', ')}`;
    titleEl.textContent = title;
    titleEl.dataset.text = title;
    
    // Enable scrolling if title is too long
    if (title.length > 30) {
      titleEl.classList.add('scrolling');
    } else {
      titleEl.classList.remove('scrolling');
    }
    
    statusEl.textContent = now.is_playing ? '▶ Playing' : '⏸ Paused';

    // Update progress for sync
    currentProgress = now.progress_ms || 0;
    songDuration = item.duration_ms || 0;

    // Resume auto-scroll if song is playing
    if (now.is_playing && !force && trackId === lastTrackId && cachedLyrics) {
      if (!scrollInterval) startAutoScroll();
      updateLyricSync();
      expandUI();
      return;
    }

    // Stop if paused
    if (!now.is_playing) {
      stopAutoScroll();
      return;
    }

    // get lyrics from server
    const artist = item.artists.map(a => a.name).join(', ');
    const track = item.name;
    lyricsEl.textContent = 'Fetching lyrics...';
    stopAutoScroll();
    const resp = await fetchLyrics(artist, track);
    if (resp && resp.lyrics) {
      cachedLyrics = resp.lyrics;
      lastTrackId = trackId;
      renderLyricsText(resp.lyrics);
      if (now.is_playing) startAutoScroll();
      expandUI();
    } else {
      cachedLyrics = null;
      lyricsEl.textContent = 'No lyrics available';
      stopAutoScroll();
      minimizeUI(false);
    }
  }

  function minimizeUI(isEmpty) {
    document.querySelector('.overlay').classList.add('minimized');
    if (isEmpty) {
      lyricsEl.textContent = '';
    }
  }

  function expandUI() {
    document.querySelector('.overlay').classList.remove('minimized');
  }

  // auto poll every 3 sec
  setInterval(() => fetchAndRender(false), 3000);
  // initial
  fetchAndRender(true);
})();
