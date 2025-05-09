import http from 'http';
import { WebSocketServer } from 'ws';
import { RequestHandler } from 'express';
import { initializeHeartbeat } from './websocket/heartbeat';
import { initializeUpgradeHandler } from './websocket/upgrade';
import { initializeConnectionHandler } from './websocket/connection';
import { clientStates } from './websocket/state';
import { sshSuspendService } from './services/ssh-suspend.service'; // 导入实例
import { SftpService } from './services/sftp.service'; // +++ 导入 SftpService +++
// TemporaryLogStorageService 是 SshSuspendService 的依赖，SshSuspendService 内部会处理它的实例化或导入，
// websocket.ts 层面不需要直接使用 temporaryLogStorageService。
// 如果 SshSuspendService 的构造函数需要一个 TemporaryLogStorageService 实例，
// 并且 sshSuspendService 实例是由 ssh-suspend.service.ts 文件创建和导出的，
// 那么该文件应该已经处理了 TemporaryLogStorageService 的注入。
// 因此，我们只需要导入 sshSuspendService。
import {
    SshSuspendClientToServerMessages,
    SshSuspendServerToClientMessages,
    SuspendedSessionInfo
} from './websocket/types';
import { cleanupClientConnection } from './websocket/utils';


export {
    ClientState,
    AuthenticatedWebSocket,
    DockerContainer,
    DockerStats,
    PortInfo,
    SshSuspendClientToServerMessages,
    SshSuspendServerToClientMessages,
    SuspendedSessionInfo
} from './websocket/types'; // Re-export essential types

export const initializeWebSocket = async (server: http.Server, sessionParser: RequestHandler): Promise<WebSocketServer> => {
    // Environment variables are expected to be loaded by index.ts

    const wss = new WebSocketServer({ noServer: true });
    // const db = await getDbInstance(); // db instance might not be directly needed here anymore if all DB interactions are in services/handlers

    // 1. Initialize Heartbeat
    const heartbeatTimer = initializeHeartbeat(wss); // Store timer to potentially clear it, though heartbeat.ts handles its own wss.on('close')

    // 2. Initialize Upgrade Handler (handles authentication and protocol upgrade)
    initializeUpgradeHandler(server, wss, sessionParser);

    // +++ 创建 SftpService 实例 +++
    const sftpService = new SftpService(clientStates);

    // 3. Initialize Connection Handler (handles 'connection' event and message routing)
    initializeConnectionHandler(wss, sshSuspendService, sftpService); // +++ 传递 sftpService 实例 +++

    // --- WebSocket 服务器关闭处理 ---
    wss.on('close', () => {
        console.log('WebSocket 服务器正在关闭，清理心跳定时器和所有活动会话...');
        clearInterval(heartbeatTimer); // Clear heartbeat started by this function
        
        clientStates.forEach((_state, sessionId) => {
            cleanupClientConnection(sessionId);
        });
        console.log('所有活动会话已清理。');
    });


    console.log('WebSocket 服务器初始化完成 (重构版)。');
    return wss;
};

export { clientStates };
