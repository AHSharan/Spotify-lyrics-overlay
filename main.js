// Electron main process: starts the local Express server (OAuth + API) then opens renderer window
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let serverProcess = null;
let mainWindow = null;

function startServer() {
  // Start server.js in the same folder using Node.js (not Electron)
  const serverPath = path.join(__dirname, 'server.js');
  if (!fs.existsSync(serverPath)) {
    console.error('server.js not found — make sure you created files from the template.');
    return;
  }
  // Use 'node' command instead of process.execPath to avoid Electron context
  serverProcess = spawn('node', [serverPath], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true
  });
  serverProcess.on('error', (err) => console.error('Server process error', err));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 280,
    height: 420,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load local UI page which will talk to the server at http://127.0.0.1:8888
  mainWindow.loadFile('renderer.html');
  // Uncomment to open devtools during development:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  // startServer(); // Comment out - run server manually with: node server.js
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
  if (serverProcess) serverProcess.kill();
});
