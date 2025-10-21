# Spotify Lyrics Overlay

A compact desktop overlay application that displays real-time Spotify playback information with synchronized lyrics.

## Features

- Real-time now-playing information from Spotify
- Automatic lyrics fetching from Lyrics.ovh
- Local lyrics caching for faster loading
- Manual tap-to-sync lyrics timing
- Auto-minimize when lyrics are unavailable
- Always-on-top transparent overlay
- Smooth animations and modern UI
- Auto-scrolling for long song titles
- Lightweight with minimal resource usage

## Screenshots

<!-- Add screenshots here -->

## Installation

### Prerequisites
- Node.js v14 or higher
- Spotify account
- Spotify Developer App credentials

### Setup

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/spotify-lyrics-overlay.git
   cd spotify-lyrics-overlay
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Configure Spotify API
   
   Copy `.env.example` to `.env` and add your credentials:
   ```env
   SPOTIPY_CLIENT_ID=your_client_id
   SPOTIPY_CLIENT_SECRET=your_client_secret
   REDIRECT_URI=http://127.0.0.1:8888/callback
   PORT=8888
   ```
   
   Get your credentials from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Make sure to add `http://127.0.0.1:8888/callback` to your app's Redirect URIs.

4. Start the application
   
   Terminal 1:
   ```bash
   node server.js
   ```
   
   Terminal 2:
   ```bash
   npx electron .
   ```

5. Authenticate
   
   Click the login button in the overlay and complete the OAuth flow in your browser. Start playing music on any Spotify client to see lyrics.

## Usage

### Controls
- Login button - Authenticate with Spotify (one-time)
- Refresh button - Manually refresh current song
- Close button - Close the overlay
- Click lyrics - Tap any line to manually sync timing
- Drag window - Click and drag the header to reposition

### Window States
The overlay automatically adjusts its size:
- Full view (420px height) - Displays song title, status, and lyrics
- Minimized (70px height) - Collapses when no lyrics are found
- Scrolling title - Long song names scroll horizontally

## Technical Details

### Architecture
- Electron - Desktop application framework
- Express.js - Local server for OAuth and API proxy
- Lyrics.ovh API - Free lyrics provider
- Local file caching - Stores fetched lyrics

### Project Structure
```
├── main.js           # Electron main process
├── preload.js        # Preload script
├── server.js         # Express server
├── renderer.html     # UI markup
├── renderer.js       # Frontend logic
├── styles.css        # Styles
├── package.json      # Dependencies
└── lyrics_cache/     # Cached lyrics
```

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT License - see LICENSE file for details.

## Notes

This application is for personal use. Please comply with Spotify's Terms of Service and respect API usage limits.

## Acknowledgments

- Spotify Web API for playback data
- Lyrics.ovh for lyrics content
