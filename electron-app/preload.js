const { contextBridge, ipcRenderer } = require('electron');

// 将选择的 API 暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 从渲染进程向主进程发送消息
  sendMessage: (channel, data) => {
    const validChannels = ['toMain']; 
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`Invalid channel: ${channel}`);
    }
  },
  // 从主进程接收消息
  receiveMessage: (channel, func) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    } else {
      console.warn(`Invalid channel: ${channel}`);
    }
  },
  // 移除监听器，防止内存泄漏
  removeListener: (channel, func) => {
    ipcRenderer.removeListener(channel, func);
  },
  // 移除所有特定频道的监听器
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
  // 窗口控制
  minimizeWindow: () => {
    ipcRenderer.send('minimize-window');
  },
  closeWindow: () => {
    ipcRenderer.send('close-window');
  },
  toggleMaximizeWindow: () => {
    ipcRenderer.send('toggle-maximize-window');
  },
  // Function to trigger RDP connection
  openRdp: (connectionDetails) => { // e.g., { host, username, password }
    // Validate connectionDetails if necessary before sending
    if (connectionDetails && connectionDetails.host) {
      ipcRenderer.send('open-rdp-connection', connectionDetails);
    } else {
      console.warn('[Preload] openRdp called without necessary connection details (host).');
    }
  }
});

console.log('Preload script loaded.');