const { app, BrowserWindow, session } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 500,
    title: 'DuoPlayX - Watch Party & Voice Room',
    icon: path.join(__dirname, 'public', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#07050d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true
    }
  });

  // Conceder automáticamente permisos de Micrófono y Audio para la Sala de Voz
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'audioCapture', 'notifications', 'pointerLock'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(true);
    }
  });

  const targetUrl = process.env.DUOPLAYX_URL || 'https://duoplayx.onrender.com';
  console.log(`🚀 Cargando DuoPlayX en Electron desde: ${targetUrl}`);

  mainWindow.loadURL(targetUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
