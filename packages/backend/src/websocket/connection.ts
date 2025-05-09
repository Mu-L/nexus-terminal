import WebSocket, { WebSocketServer, RawData } from 'ws';
import { Request } from 'express';
import { AuthenticatedWebSocket } from './types';
import { cleanupClientConnection } from './utils';
import { clientStates } from './state'; // Import clientStates for session management

// Handlers
import { handleRdpProxyConnection } from './handlers/rdp.handler';
import {
    handleSshConnect,
    handleSshInput,
    handleSshResize
} from './handlers/ssh.handler';
import {
    handleDockerGetStatus,
    handleDockerCommand,
    handleDockerGetStats
} from './handlers/docker.handler';
import {
    handleSftpOperation,
    handleSftpUploadStart,
    handleSftpUploadChunk,
    handleSftpUploadCancel
} from './handlers/sftp.handler';

export function initializeConnectionHandler(wss: WebSocketServer): void {
    wss.on('connection', (ws: AuthenticatedWebSocket, request: Request) => {
        ws.isAlive = true;
        const isRdpProxy = (request as any).isRdpProxy;
        const clientIp = (request as any).clientIpAddress || 'unknown'; // Preserved from upgrade handler

        console.log(`WebSocket：客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}, RDP Proxy: ${isRdpProxy}) 已连接。`);

        ws.on('pong', () => { ws.isAlive = true; });

        if (isRdpProxy) {
            handleRdpProxyConnection(ws, request);
        } else {
            // Standard SSH/SFTP/Docker connection
            ws.on('message', async (message: RawData) => {
                let parsedMessage: any;
                try {
                    parsedMessage = JSON.parse(message.toString());
                } catch (e) {
                    console.error(`WebSocket：来自 ${ws.username} 的无效 JSON 消息:`, message.toString());
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
                    return;
                }

                const { type, payload, requestId } = parsedMessage;
                const sessionId = ws.sessionId; // Get current WebSocket's session ID

                // It's crucial to get the state associated with the current ws.sessionId
                // For 'ssh:connect', ws.sessionId will be undefined initially, so state will be undefined.
                // For other messages, ws.sessionId should exist if connection was successful.
                const state = sessionId ? clientStates.get(sessionId) : undefined;

                try {
                    switch (type) {
                        // SSH Cases
                        case 'ssh:connect':
                            // Pass the original Express request object for IP and session
                            await handleSshConnect(ws, request, payload);
                            break;
                        case 'ssh:input':
                            handleSshInput(ws, payload);
                            break;
                        case 'ssh:resize':
                            handleSshResize(ws, payload);
                            break;

                        // Docker Cases
                        case 'docker:get_status':
                            await handleDockerGetStatus(ws, sessionId);
                            break;
                        case 'docker:command':
                            await handleDockerCommand(ws, sessionId, payload);
                            break;
                        case 'docker:get_stats':
                            await handleDockerGetStats(ws, sessionId, payload);
                            break;
                        
                        // SFTP Cases (generic operations)
                        case 'sftp:readdir':
                        case 'sftp:stat':
                        case 'sftp:readfile':
                        case 'sftp:writefile':
                        case 'sftp:mkdir':
                        case 'sftp:rmdir':
                        case 'sftp:unlink':
                        case 'sftp:rename':
                        case 'sftp:chmod':
                        case 'sftp:realpath':
                        case 'sftp:copy':
                        case 'sftp:move':
                            await handleSftpOperation(ws, type, payload, requestId);
                            break;

                        // SFTP Upload Cases
                        case 'sftp:upload:start':
                            handleSftpUploadStart(ws, payload);
                            break;
                        case 'sftp:upload:chunk':
                            await handleSftpUploadChunk(ws, payload);
                            break;
                        case 'sftp:upload:cancel':
                            handleSftpUploadCancel(ws, payload);
                            break;

                        default:
                            console.warn(`WebSocket：收到来自 ${ws.username} (会话: ${sessionId}) 的未知消息类型: ${type}`);
                            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', payload: `不支持的消息类型: ${type}` }));
                    }
                } catch (error: any) {
                    console.error(`WebSocket: 处理来自 ${ws.username} (会话: ${sessionId}) 的消息 (${type}) 时发生顶层错误:`, error);
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', payload: `处理消息时发生内部错误: ${error.message}` }));
                }
            });

            ws.on('close', (code, reason) => {
                console.log(`WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 已断开连接。代码: ${code}, 原因: ${reason.toString()}`);
                cleanupClientConnection(ws.sessionId);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 发生错误:`, error);
                cleanupClientConnection(ws.sessionId); // Ensure cleanup on error too
            });
        }
    });
    console.log('WebSocket connection handler initialized.');
}