const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDFs', extensions: ['pdf'] }],
    });
    if (canceled) {
      return;
    } else {
      return filePaths[0];
    }
  });

  ipcMain.handle('fs:readFile', async (event, filePath) => {
    return fs.readFile(filePath);
  });

  ipcMain.handle('dialog:saveFile', async (event, data) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'modified.pdf',
      filters: [{ name: 'PDFs', extensions: ['pdf'] }],
    });
    if (canceled) {
      return;
    } else {
      return fs.writeFile(filePath, data);
    }
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});