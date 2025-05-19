const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');
const express = require('express'); 
const http = require('http'); 
const { spawn } = require('child_process');
const fs = require('fs');

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
    const userDataPath = app.getPath('userData');
    // 使用 app.getName() (通常由 electron-builder 的 productName 设置) 来创建应用特定的子目录名
    // 进行小写和字符清理，以确保路径的健壮性
    const appNameForPath = (app.getName() || 'nexus-terminal')
      .toLowerCase()
      .replace(/\s+/g, '-') // 将空格替换为连字符
      .replace(/[^a-z0-9-]/gi, ''); // 移除除字母、数字、连字符外的所有字符
    const appDataRootPath = path.join(userDataPath, appNameForPath); // 例如: C:\Users\<user>\AppData\Roaming\nexus-terminal
    const backendDataPath = path.join(appDataRootPath, 'backend-data'); // 后端数据的特定子目录

    // 确保后端数据目录存在
    if (!fs.existsSync(backendDataPath)) {
      try {
        fs.mkdirSync(backendDataPath, { recursive: true });
        console.log(`[Main Process] Backend data directory created/ensured: ${backendDataPath}`);
      } catch (err) {
        console.error(`[Main Process] Critical error: Failed to create backend data directory at ${backendDataPath}. Error: ${err}. The application might not function correctly without this directory.`);
        // 根据应用的重要性，这里可能需要更强硬的错误处理，例如通知用户并退出应用。
        // app.quit();
        // return; // 停止执行 createWindow
      }
    } else {
      console.log(`[Main Process] Backend data directory already exists: ${backendDataPath}`);
    }

    // 提醒：后续步骤中，您需要在后端代码 (packages/backend) 中适配，
    // 读取并使用 APP_BACKEND_DATA_PATH 环境变量。
    // 此外，考虑实现一次性的数据迁移逻辑，将旧安装目录下的数据（如果存在）迁移到新的 backendDataPath。
    const backendResourcesPath = path.join(process.resourcesPath, 'packages/backend'); 
    console.log(`[Prod Mode] Starting backend service from ${backendResourcesPath}...`);
    backendProcess = spawn('node', ['dist/index.js'], {
      cwd: backendResourcesPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env, // 继承当前进程的环境变量
        APP_BACKEND_DATA_PATH: backendDataPath // 将定义好的后端数据路径传递给子进程
      },
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

// IPC handlers for window controls
ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.on('toggle-maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// IPC handler for opening RDP connection
ipcMain.on('open-rdp-connection', async (event, { host, port, username, password }) => {
  if (!host) {
    console.error('[Main Process] RDP: Received request without host.');
    // event.reply('open-rdp-connection-error', 'Host is required');
    return;
  }

  const serverAddressForMstsc = port ? `${host}:${port}` : host; // 用于 mstsc.exe /v:
  const cmdkeyTarget = `TERMSRV/${host}`; // cmdkey 的目标通常不包含端口

  const executeCommand = (command, args, operationDesc) => {
    return new Promise((resolve, reject) => {
      console.log(`[Main Process] RDP: Executing ${operationDesc}: cmd.exe /C ${command} ${args.join(' ')}`);
      // 使用 cmd.exe /C 来执行，这更接近 BAT 脚本的行为，并有助于处理路径和环境变量
      const process = spawn('cmd.exe', ['/C', command, ...args], { stdio: 'pipe' });

      let stdout = '';
      let stderr = '';
      process.stdout.on('data', (data) => stdout += data.toString());
      process.stderr.on('data', (data) => stderr += data.toString());

      process.on('close', (code) => {
        if (code === 0) {
          console.log(`[Main Process] RDP: ${operationDesc} successful.`);
          resolve(stdout);
        } else {
          console.error(`[Main Process] RDP: ${operationDesc} failed with code ${code}. Stderr: [${stderr.trim()}]. Stdout: [${stdout.trim()}]`);
          reject(new Error(`${operationDesc} failed. Code: ${code}. Stderr: ${stderr.trim()}. Stdout: ${stdout.trim()}`));
        }
      });
      process.on('error', (err) => {
        console.error(`[Main Process] RDP: Failed to start ${operationDesc}:`, err);
        reject(err);
      });
    });
  };

  try {
    // 步骤 1: 如果提供了用户名和密码，则存储凭据
    if (username && password) {
      // 重要: 确保参数被正确引用，特别是密码中可能包含特殊字符
      const cmdkeyAddArgs = ['/generic:' + cmdkeyTarget, '/user:' + username, '/pass:' + password];
      console.log('[Main Process] RDP: Preparing to add credentials with cmdkey. Target:', cmdkeyTarget, 'User:', username);
      await executeCommand('cmdkey.exe', cmdkeyAddArgs, 'add credentials');
    } else {
      console.log('[Main Process] RDP: Username or password not provided, skipping credential storage.');
    }

    // 步骤 2: 启动 mstsc.exe
    const mstscArgs = [`/v:${serverAddressForMstsc}`]; // 使用包含端口的地址给 mstsc
    console.log(`[Main Process] RDP: Launching mstsc.exe with args: mstsc.exe ${mstscArgs.join(' ')}`);
    const mstscProcess = spawn('mstsc.exe', mstscArgs, {
      detached: true,
      stdio: 'ignore',
    });

    mstscProcess.on('error', (err) => {
      console.error('[Main Process] RDP: Failed to start mstsc.exe:', err);
      // event.reply('open-rdp-connection-error', `Failed to start mstsc.exe: ${err.message}`);
      // 即使 mstsc 启动失败，也尝试清理凭据（如果已设置）
      if (username && password) { // 只有在尝试添加凭据后才尝试删除
        console.log('[Main Process] RDP: Attempting to delete credentials after mstsc error. Target:', cmdkeyTarget);
        executeCommand('cmdkey.exe', ['/delete:' + cmdkeyTarget], 'delete credentials (after mstsc error)')
          .catch(cleanupErr => console.error('[Main Process] RDP: Error during post-mstsc-error credential cleanup:', cleanupErr.message));
      }
    });
    mstscProcess.unref(); // 允许主进程独立于 mstsc 退出

    // 步骤 3: 在 mstsc 启动后（不需要等待其关闭），如果之前存储了凭据，则删除它们
    // 稍作延迟以确保 mstsc 有时间读取凭据，但这是一个猜测性的延迟。
    if (username && password) {
      setTimeout(async () => {
        try {
          console.log('[Main Process] RDP: Attempting to delete credentials after mstsc launch. Target:', cmdkeyTarget);
          await executeCommand('cmdkey.exe', ['/delete:' + cmdkeyTarget], 'delete credentials (after mstsc launch)');
        } catch (cleanupErr) {
          console.error('[Main Process] RDP: Error during post-mstsc-launch credential cleanup:', cleanupErr.message);
        }
      }, 3000); // 增加到3秒延迟，可以根据需要调整
    }

    // event.reply('open-rdp-connection-success', `RDP process for ${serverAddress} initiated.`);

  } catch (error) {
    console.error('[Main Process] RDP: Overall error in open-rdp-connection handler:', error);
    // event.reply('open-rdp-connection-error', `Error processing RDP connection: ${error.message}`);
    // 确保在主处理流程出错时也尝试清理凭据
    if (username && password) {
        console.log('[Main Process] RDP: Attempting credential cleanup due to main handler error. Target:', cmdkeyTarget);
        executeCommand('cmdkey.exe', ['/delete:' + cmdkeyTarget], 'delete credentials (after main error)')
            .catch(cleanupErr => console.error('[Main Process] RDP: Error during post-main-error credential cleanup:', cleanupErr.message));
    }
  }
});

// 为了允许 localhost 加载，如果前端和后端都通过 localhost 提供服务
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');