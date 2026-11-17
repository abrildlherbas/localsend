const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const UDP_PORT = 53317;
const WS_PORT = 8080;
let win, udp, wss;
const pending = new Map();

function getIPv4() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return '127.0.0.1';
}
const deviceName = `${os.hostname()} (PC)`;

function sendUI(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startDiscovery() {
  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.bind(UDP_PORT, () => {
    try { udp.setBroadcast(true); } catch {}
    const beacon = () => {
      const msg = Buffer.from(JSON.stringify({
        type: 'DISCOVER', name: deviceName, host: getIPv4(), port: WS_PORT, platform: process.platform
      }));
      udp.send(msg, 0, msg.length, UDP_PORT, '255.255.255.255');
    };
    beacon();
    setInterval(beacon, 1500);
  });
  udp.on('error', err => sendUI('status', `UDP: ${err.message}`));
}

function startWebSocket() {
  wss = new WebSocketServer({ port: WS_PORT, host: '0.0.0.0', maxPayload: 1024 * 1024 });
  wss.on('connection', (socket) => {
    let transfer = null;
    socket.on('message', async (data, isBinary) => {
      try {
        if (!isBinary) {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'FILE_OFFER') {
            const id = `${Date.now()}-${Math.random()}`;
            transfer = { id, socket, name: safeName(msg.name), size: Number(msg.size), received: 0, stream: null };
            pending.set(id, transfer);
            sendUI('incoming', { id, name: transfer.name, size: transfer.size, from: msg.from || 'Dispositivo móvil' });
            return;
          }
          if (msg.type === 'FILE_END' && transfer) {
            if (transfer.stream) await new Promise((resolve, reject) => transfer.stream.end(err => err ? reject(err) : resolve()));
            socket.send(JSON.stringify({ type: 'DONE', received: transfer.received }));
            sendUI('complete', { name: transfer.name, size: transfer.received });
            pending.delete(transfer.id);
            transfer = null;
          }
          if (msg.type === 'CANCEL' && transfer) {
            if (transfer.stream) transfer.stream.destroy();
            pending.delete(transfer.id);
            transfer = null;
          }
        } else if (transfer && transfer.stream) {
          transfer.received += data.length;
          if (!transfer.stream.write(data)) await new Promise(resolve => transfer.stream.once('drain', resolve));
          sendUI('progress', { id: transfer.id, received: transfer.received, size: transfer.size, name: transfer.name });
        }
      } catch (err) {
        sendUI('status', `Error de transferencia: ${err.message}`);
        try { socket.send(JSON.stringify({ type: 'ERROR', message: err.message })); } catch {}
      }
    });
    socket.on('close', () => {
      if (transfer?.stream) transfer.stream.destroy();
      if (transfer) pending.delete(transfer.id);
    });
  });
  wss.on('listening', () => sendUI('status', `Servidor listo · ${getIPv4()}:${WS_PORT}`));
  wss.on('error', err => sendUI('status', `WebSocket: ${err.message}`));
}

function safeName(name) {
  return path.basename(String(name || 'archivo').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')).slice(0, 180) || 'archivo';
}

function createWindow() {
  win = new BrowserWindow({
    width: 900, height: 680, minWidth: 680, minHeight: 520,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  startDiscovery();
  startWebSocket();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

ipcMain.handle('transfer:decision', async (_event, { id, accepted }) => {
  const item = pending.get(id);
  if (!item) return { ok: false, error: 'La solicitud ya no está disponible.' };
  if (!accepted) {
    item.socket.send(JSON.stringify({ type: 'REJECT' }));
    pending.delete(id);
    return { ok: true };
  }
  const folder = path.join(app.getPath('downloads'), 'LocalSend');
  fs.mkdirSync(folder, { recursive: true });
  let destination = path.join(folder, item.name);
  if (fs.existsSync(destination)) {
    const ext = path.extname(item.name), base = path.basename(item.name, ext);
    destination = path.join(folder, `${base}-${Date.now()}${ext}`);
  }
  item.stream = fs.createWriteStream(destination);
  item.socket.send(JSON.stringify({ type: 'ACCEPT' }));
  sendUI('status', `Recibiendo en: ${destination}`);
  return { ok: true, destination };
});

ipcMain.handle('app:info', () => ({ ip: getIPv4(), name: deviceName, udpPort: UDP_PORT, wsPort: WS_PORT }));
app.on('window-all-closed', () => {
  try { udp?.close(); } catch {}
  try { wss?.close(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
