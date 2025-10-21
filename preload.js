// Simple preload to allow fetch from renderer (no privileged APIs needed)
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('env', {
  API_ORIGIN: 'http://127.0.0.1:8888'
});
