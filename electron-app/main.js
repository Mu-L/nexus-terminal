const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const express = require('express'); 
const http = require('http'); 
const { spawn } = require('child_process');

let mainWindow;
let expressApp;
let httpServer;
let backendProcess;
const PROD_FRONTEND_PORT = 3001; 
const PROD_BACKEND_PORT = 3000; 

async function createWindow() {
  const Store = (await import('electron-store')).default;
  const store = new Store();

  try {
    const { parse } = require('path-to-regexp');
    console.log('[Direct Test] Attempting to parse a simple path with path-to-regexp...');
    const tokens = parse('/test/:id');
    console.log('[Direct Test] path-to-regexp parse successful, tokens:', JSON.stringify(tokens));
  } catch (e) {
    console.error('[Direct Test] path-to-regexp direct test FAILED:', e);
    app.quit();
    return; 
  }


  // 创建浏览器窗口。
  const defaultBounds = { width: 1200, height: 800 };
  const lastWindowState = store.get('windowBounds', defaultBounds);

  mainWindow = new BrowserWindow({
    width: lastWindowState.width,
    height: lastWindowState.height,
    x: lastWindowState.x, // 如果保存了 x，则恢复
    y: lastWindowState.y, // 如果保存了 y，则恢复
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true, // 启用上下文隔离
    },
  });

  // 根据是否是开发模式加载不同的 URL
  const isDev = process.argv.includes('--dev');
  let frontendUrl;

  if (isDev) {
    frontendUrl = 'http://localhost:5173'; 
    console.log(`[Dev Mode] Loading frontend from: ${frontendUrl}`);
  } else {
    // 生产模式：启动 express 服务器托管前端静态文件并启动后端服务
    const backendResourcesPath = path.join(process.resourcesPath, 'packages/backend'); 
    console.log(`[Prod Mode] Starting backend service from ${backendResourcesPath}...`);
    backendProcess = spawn('node', ['dist/index.js'], {
      cwd: backendResourcesPath, 
      stdio: ['pipe', 'pipe', 'pipe'], 
    });

    backendProcess.stdout.on('data', (data) => {
      console.log(`[Backend STDOUT]: ${data.toString().trim()}`);
      // 这里可以添加逻辑，例如等待后端真正启动完成的信号
    });

    backendProcess.stderr.on('data', (data) => {
      console.error(`[Backend STDERR]: ${data.toString().trim()}`);
    });

    backendProcess.on('close', (code) => {
      console.log(`[Backend Process] exited with code ${code}`);
      backendProcess = null; // 清理引用
      // 如果后端意外关闭，可能需要通知用户或尝试重启，或关闭应用
      if (mainWindow && !mainWindow.isDestroyed()) {
      }
    });
    
    backendProcess.on('error', (err) => {
      console.error('[Backend Process] Failed to start:', err);
      // 处理启动错误，例如路径不正确或 Node 未安装
      app.quit();
    });
    
    console.log(`[Prod Mode] Backend service process initiated (PID: ${backendProcess.pid}). Waiting for it to be ready...`);
   

    // 启动 express 前端服务器
    expressApp = express();

    // 恢复静态文件服务和 SPA fallback
    const staticPath = path.join(process.resourcesPath, 'packages/frontend/dist'); 
    console.log('[Prod Mode] Calculated staticPath for express.static:', staticPath);
    
    expressApp.use(express.static(staticPath));
    
   
    expressApp.get(/^(?!\/api\/).*$/, (req, res) => {
      res.sendFile(path.join(staticPath, 'index.html'));
    });

    httpServer = http.createServer(expressApp);

    await new Promise((resolve, reject) => {
      httpServer.listen(PROD_FRONTEND_PORT, () => {
        frontendUrl = `http://localhost:${PROD_FRONTEND_PORT}`; // 恢复加载实际的前端 URL
        console.log(`[Prod Mode] Frontend server started at ${frontendUrl}, serving from ${staticPath}`);
        resolve();
      }).on('error', (err) => {
        console.error('Failed to start frontend server:', err); 
        reject(err);
        app.quit();
      });
    });


  }

  if (!frontendUrl) {
    console.error("Frontend URL was not set. Quitting.");
    app.quit();
    return;
  }

  console.log(`Loading URL: ${frontendUrl}`);
  mainWindow.loadURL(frontendUrl);

  // 保存窗口状态
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      store.set('windowBounds', bounds);
    }
  });

  // 打开开发者工具。
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 当 window 被关闭，这个事件会被触发。
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// Electron 会在初始化后并准备
// 创建浏览器窗口时，调用这个函数。
// 部分 API 在 ready 事件触发后才能使用。
app.on('ready', () => {
  createWindow().catch(err => {
    console.error('Error during createWindow:', err);
    // 发生严重错误，可能需要退出应用
    app.quit();
  });
});

// 当全部窗口关闭时退出。
app.on('window-all-closed', function () {
  // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
  // 否则绝大部分应用及其菜单栏会保持激活。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 在应用退出前关闭 express 服务器 (如果已启动)
app.on('before-quit', () => {
  console.log('Application is quitting...');
  // 1. 关闭前端 HTTP 服务器
  if (httpServer) {
    console.log('Closing frontend server...');
    httpServer.close(() => {
      console.log('Frontend server closed.');
    });
  }
  // 2. 关闭后端子进程
  if (backendProcess) {
    console.log('Stopping backend process...');
    backendProcess.kill('SIGINT'); // 发送 SIGINT 信号，给后端一个优雅关闭的机会
    // 可以设置一个超时，如果后端没有在规定时间内退出，则强制kill
    setTimeout(() => {
        if (backendProcess && !backendProcess.killed) {
            console.warn('Backend process did not exit gracefully, forcing kill.');
            backendProcess.kill('SIGKILL');
        }
    }, 5000); // 5秒超时
  }
});

app.on('activate', function () {
  // 在macOS上，当单击dock图标并且没有其他窗口打开时，
  // 通常在应用程序中重新创建一个窗口。
  if (mainWindow === null) {
    createWindow();
  }
});



// 预留 IPC 通信示例
ipcMain.on('toMain', (event, args) => {
  console.log('Message from renderer:', args);
  // mainWindow.webContents.send('fromMain', { message: 'Hello from main process!' });
});

// 为了允许 localhost 加载，如果前端和后端都通过 localhost 提供服务
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors'); 