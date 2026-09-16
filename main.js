// Electron main process: starts the local Express server in-process, then opens the overlay.
const { app, BrowserWindow, ipcMain, shell, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const WINDOW_DEFAULTS = { width: 280, height: 420 };

let mainWindow = null;
let httpServer = null;
let clickThrough = false;

// ---------- window position persistence ----------

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function loadWindowPosition() {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
  } catch (e) {
    return null;
  }

  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;

  // Only restore if the position still lands on a connected display — monitors
  // get unplugged and a saved position can end up off-screen.
  const onScreen = screen.getAllDisplays().some(function (display) {
    const b = display.bounds;
    return (
      saved.x >= b.x &&
      saved.y >= b.y &&
      saved.x < b.x + b.width &&
      saved.y < b.y + b.height
    );
  });

  return onScreen ? saved : null;
}

function saveWindowPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify({ x: bounds.x, y: bounds.y }), 'utf8');
  } catch (e) {
    /* position memory is a nicety, never fatal */
  }
}

// ---------- windows ----------

function createWindow(port) {
  const saved = loadWindowPosition();

  mainWindow = new BrowserWindow(
    Object.assign({}, WINDOW_DEFAULTS, {
      x: saved ? saved.x : undefined,
      y: saved ? saved.y : undefined,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        additionalArguments: ['--api-port=' + port]
      }
    })
  );

  mainWindow.loadFile('renderer.html');

  let moveTimer = null;
  mainWindow.on('move', function () {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(saveWindowPosition, 400); // debounce the drag
  });
  mainWindow.on('close', saveWindowPosition);
}

// Users never see the terminal, so startup failures have to render in the window.
function showErrorWindow(message) {
  mainWindow = new BrowserWindow(
    Object.assign({}, WINDOW_DEFAULTS, {
      frame: false,
      transparent: true,
      alwaysOnTop: true
    })
  );

  const html =
    '<html><body style="margin:0;font:13px system-ui;background:rgba(20,20,20,.94);' +
    'color:#eee;padding:18px;-webkit-app-region:drag">' +
    '<h3 style="margin:0 0 10px;color:#ff6b6b">Could not start</h3>' +
    '<p style="line-height:1.5;white-space:pre-wrap">' +
    String(message).replace(/[<>&]/g, '') +
    '</p>' +
    '<p style="opacity:.6;margin-top:14px">Close this window and try again.</p>' +
    '</body></html>';

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// ---------- click-through ----------

function setClickThrough(enabled) {
  clickThrough = enabled;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // forward:true keeps hover/scroll events flowing to the page while clicks pass under.
  mainWindow.setIgnoreMouseEvents(enabled, { forward: true });
  mainWindow.webContents.send('click-through-changed', enabled);
}

// ---------- lifecycle ----------

app.whenReady().then(async function () {
  try {
    const result = await require('./server.js').start({
      userDataDir: app.getPath('userData'),
      openExternal: function (url) {
        shell.openExternal(url);
      }
    });
    httpServer = result.server;
    createWindow(result.port);
  } catch (e) {
    console.error('Server failed to start:', e);
    showErrorWindow(e.message);
    return;
  }

  ipcMain.handle('toggle-click-through', function () {
    setClickThrough(!clickThrough);
    return clickThrough;
  });

  ipcMain.handle('open-dashboard', function () {
    shell.openExternal('https://developer.spotify.com/dashboard');
  });

  // Escape hatch: once the window is click-through, its own button is unreachable.
  globalShortcut.register('CommandOrControl+Shift+L', function () {
    setClickThrough(!clickThrough);
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(8888);
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', function () {
  globalShortcut.unregisterAll();
  if (httpServer) httpServer.close();
});
