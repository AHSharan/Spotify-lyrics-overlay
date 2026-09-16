// Bridges the actual server port and the click-through toggle into the renderer.
const { contextBridge, ipcRenderer } = require('electron');

// main.js passes the resolved port via additionalArguments, since it may have
// fallen back from 8888 to 8889/8890.
function resolvePort() {
  const arg = process.argv.find(function (a) {
    return a.startsWith('--api-port=');
  });
  return arg ? arg.split('=')[1] : '8888';
}

contextBridge.exposeInMainWorld('env', {
  API_ORIGIN: 'http://127.0.0.1:' + resolvePort()
});

contextBridge.exposeInMainWorld('overlay', {
  toggleClickThrough: function () {
    return ipcRenderer.invoke('toggle-click-through');
  },
  // Fixed destination, chosen in main — the renderer cannot pass a URL through.
  openDashboard: function () {
    return ipcRenderer.invoke('open-dashboard');
  },
  onClickThroughChanged: function (callback) {
    ipcRenderer.on('click-through-changed', function (_event, enabled) {
      callback(enabled);
    });
  }
});
