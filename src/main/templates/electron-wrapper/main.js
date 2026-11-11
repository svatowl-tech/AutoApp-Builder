/**
 * @file src/main/templates/electron-wrapper/main.js
 * @description Минимальный автономный загрузчик Electron для превращения любого собранного
 *              веб-приложения (React, Vue, Vite, Static HTML, Next.js Static) в нативный
 *              исполняемый файл (.exe, .dmg/.app, .AppImage), запускающийся в один клик.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

/** Словарь MIME-типов для встроенного локального микро-сервера статики */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

let mainWindow = null;
let staticServer = null;

/**
 * Запускает локальный сервер на свободном порту 127.0.0.1 для корректной работы
 * SPA-роутинга (React Router, Vue Router) и абсолютных путей к ассетам.
 */
function startEmbeddedStaticServer(wwwRoot) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const safeUrl = (req.url || '/').split('?')[0].split('#')[0];
      let targetPath = path.join(wwwRoot, decodeURIComponent(safeUrl));

      // Защита от выхода за пределы директории wwwRoot
      const resolvedRoot = path.resolve(wwwRoot);
      const resolvedTarget = path.resolve(targetPath);
      if (!resolvedTarget.startsWith(resolvedRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
        targetPath = path.join(resolvedTarget, 'index.html');
      }

      // Fallback на index.html для SPA-маршрутизации
      if (!fs.existsSync(targetPath)) {
        targetPath = path.join(resolvedRoot, 'index.html');
      }

      fs.readFile(targetPath, (err, content) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Файл не найден внутри контейнера приложения.');
          return;
        }
        const ext = path.extname(targetPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });

    server.on('error', reject);
  });
}

async function createWrappedWindow() {
  const wwwRoot = path.join(__dirname, 'www');
  const { server, port } = await startEmbeddedStaticServer(wwwRoot);
  staticServer = server;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    autoHideMenuBar: true,
    backgroundColor: '#0B0F17',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Внешние ссылки открываем в системном браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWrappedWindow);

app.on('window-all-closed', () => {
  if (staticServer) {
    staticServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWrappedWindow();
  }
});
