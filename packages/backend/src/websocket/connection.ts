import WebSocket, { WebSocketServer, RawData } from 'ws';
import { Request } from 'express';
import {
    AuthenticatedWebSocket,
    SshSuspendStartRequest,
    SshSuspendListRequest,
    SshSuspendResumeRequest,
    SshSuspendTerminateRequest,
    SshSuspendRemoveEntryRequest,
    SshSuspendEditNameRequest,
    SshSuspendStartedResponse,
    SshSuspendListResponse,
    SshSuspendResumedNotification,
    SshOutputCachedChunk,
    SshSuspendTerminatedResponse,
    SshSuspendEntryRemovedResponse,
    SshSuspendNameEditedResponse,
    SshSuspendAutoTerminatedNotification, // 尽管此消息由服务发起，但类型定义在此处有用
    ClientState // 导入 ClientState 以便访问 sshClient 等信息
} from './types';
import { SshSuspendService } from '../services/ssh-suspend.service';
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

export function initializeConnectionHandler(wss: WebSocketServer, sshSuspendService: SshSuspendService): void {
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

                        // --- SSH Suspend Cases ---
                        case 'SSH_SUSPEND_START': {
                            const { sessionId: originalFrontendSessionId } = payload as SshSuspendStartRequest['payload'];
                            console.log(`[WebSocket Handler] Received SSH_SUSPEND_START. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, TargetOriginalFrontendSessionID: ${originalFrontendSessionId}`);
                            console.log(`[SSH_SUSPEND_START] (Debug) 当前 clientStates 中的 keys: ${JSON.stringify(Array.from(clientStates.keys()))}`);
                            // console.log(`[SSH_SUSPEND_START] 当前 WebSocket (ws.sessionId): ${ws.sessionId}`); // 重复，已包含在上一条日志

                            if (!ws.userId) {
                                console.error(`[SSH_SUSPEND_START] 用户 ID 未定义。`);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_STARTED_RESP', payload: { frontendSessionId: originalFrontendSessionId, suspendSessionId: '', success: false, error: '用户认证失败' } }));
                                break;
                            }
                            const activeSessionState = clientStates.get(originalFrontendSessionId);
                            if (!activeSessionState || !activeSessionState.sshClient || !activeSessionState.sshShellStream) {
                                console.error(`[SSH_SUSPEND_START] 找不到活动的SSH会话或其组件: ${originalFrontendSessionId}`);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_STARTED_RESP', payload: { frontendSessionId: originalFrontendSessionId, suspendSessionId: '', success: false, error: '未找到活动的SSH会话' } }));
                                break;
                            }
                            try {
                                const suspendSessionId = await sshSuspendService.startSuspend(
                                    ws.userId,
                                    originalFrontendSessionId,
                                    activeSessionState.sshClient,
                                    activeSessionState.sshShellStream,
                                    activeSessionState.connectionName || '未知连接',
                                    String(activeSessionState.dbConnectionId), // 确保是 string
                                    // customSuspendName 初始时可以为空或基于 connectionName
                                );
                                const response: SshSuspendStartedResponse = {
                                    type: 'SSH_SUSPEND_STARTED',
                                    payload: { frontendSessionId: originalFrontendSessionId, suspendSessionId, success: true }
                                };
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                                // 设计文档提到：“原有的直接将 SSH 输出发送到前端 WebSocket 的逻辑需要暂停或修改”
                                // 这部分可能需要修改 ssh.handler.ts，或者 SshSuspendService 内部通过移除监听器等方式实现。
                                // SshSuspendService.startSuspend 内部应该已经处理了数据流重定向到日志。
                                // clientStates.delete(originalFrontendSessionId); // 原会话不再由 websocket 直接管理，转由 SshSuspendService 管理
                            } catch (error: any) {
                                console.error(`[SSH_SUSPEND_START] 启动挂起失败:`, error);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_STARTED_RESP', payload: { frontendSessionId: originalFrontendSessionId, suspendSessionId: '', success: false, error: error.message || '启动挂起失败' } }));
                            }
                            break;
                        }
                        case 'SSH_SUSPEND_LIST_REQUEST': {
                            if (!ws.userId) {
                                console.error(`[SSH_SUSPEND_LIST_REQUEST] 用户 ID 未定义。`);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_LIST_RESPONSE', payload: { suspendSessions: [] } })); // 返回空列表或错误
                                break;
                            }
                            try {
                                const sessions = await sshSuspendService.listSuspendedSessions(ws.userId);
                                const response: SshSuspendListResponse = {
                                    type: 'SSH_SUSPEND_LIST_RESPONSE',
                                    payload: { suspendSessions: sessions }
                                };
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                            } catch (error: any) {
                                console.error(`[SSH_SUSPEND_LIST_REQUEST] 获取挂起列表失败:`, error);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_LIST_RESPONSE', payload: { suspendSessions: [] } })); // 返回空列表或错误
                            }
                            break;
                        }
                        case 'SSH_SUSPEND_RESUME_REQUEST': {
                            const { suspendSessionId, newFrontendSessionId } = payload as SshSuspendResumeRequest['payload'];
                            console.log(`[WebSocket Handler] Received SSH_SUSPEND_RESUME_REQUEST. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}, NewFrontendSessionID: ${newFrontendSessionId}`);
                            if (!ws.userId) {
                                console.error(`[SSH_SUSPEND_RESUME_REQUEST] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_RESUMED_NOTIF', payload: { suspendSessionId, newFrontendSessionId, success: false, error: '用户认证失败' } }));
                                break;
                            }
                            try {
                                const result = await sshSuspendService.resumeSession(ws.userId, suspendSessionId);
                                if (result) {
                                    // 将恢复的 sshClient 和 channel 重新关联到新的前端会话 ID
                                    // 这部分逻辑需要与 handleSshConnect 类似，创建一个新的 ClientState
                                    const newSessionState: ClientState = {
                                        ws, // 当前的 WebSocket 连接
                                        sshClient: result.sshClient,
                                        sshShellStream: result.channel,
                                        dbConnectionId: parseInt(result.originalConnectionId, 10), // 从结果中恢复并转换为数字
                                        connectionName: result.connectionName, // 从结果中恢复
                                        ipAddress: clientIp,
                                        isShellReady: true, // 假设恢复后 Shell 立即可用
                                    };
                                    clientStates.set(newFrontendSessionId, newSessionState);
                                    ws.sessionId = newFrontendSessionId; // 将当前 ws 与新会话关联

                                    // 重新设置事件监听器，将数据流导向新的前端会话
                                    result.channel.removeAllListeners('data'); // 清除 SshSuspendService 可能设置的监听器
                                    result.channel.on('data', (data: Buffer) => {
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({ type: 'ssh:output', payload: { sessionId: newFrontendSessionId, data: data.toString('utf-8') } }));
                                        }
                                    });
                                    result.channel.on('close', () => {
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: { sessionId: newFrontendSessionId } }));
                                        }
                                        cleanupClientConnection(newFrontendSessionId);
                                    });
                                     result.sshClient.on('error', (err: Error) => {
                                        console.error(`恢复后的 SSH 客户端错误 (会话: ${newFrontendSessionId}):`, err);
                                        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ssh:error', payload: { sessionId: newFrontendSessionId, error: err.message } }));
                                        cleanupClientConnection(newFrontendSessionId);
                                    });

                                    // 发送缓存日志块
                                    // 设计文档建议 SSH_OUTPUT_CACHED_CHUNK
                                    // 这个服务返回的是一个完整的 logData 字符串，我们需要分块吗？
                                    // 假设暂时不分块，或者由前端处理。如果需要分块，逻辑会更复杂。
                                    // 这里简单处理，一次性发送。如果日志过大，这可能不是最佳实践。
                                    const logChunkResponse: SshOutputCachedChunk = {
                                        type: 'SSH_OUTPUT_CACHED_CHUNK',
                                        payload: { frontendSessionId: newFrontendSessionId, data: result.logData, isLastChunk: true }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(logChunkResponse));
                                    
                                    const response: SshSuspendResumedNotification = {
                                        type: 'SSH_SUSPEND_RESUMED',
                                        payload: { suspendSessionId, newFrontendSessionId, success: true }
                                    };
                                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));

                                } else {
                                    throw new Error('无法恢复会话，或会话不存在/状态不正确。');
                                }
                            } catch (error: any) {
                                console.error(`[SSH_SUSPEND_RESUME_REQUEST] 恢复会话 ${suspendSessionId} 失败:`, error);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_RESUMED_NOTIF', payload: { suspendSessionId, newFrontendSessionId, success: false, error: error.message || '恢复会话失败' } }));
                            }
                            break;
                        }
                        case 'SSH_SUSPEND_TERMINATE_REQUEST': {
                            const { suspendSessionId } = payload as SshSuspendTerminateRequest['payload'];
                            console.log(`[WebSocket Handler] Received SSH_SUSPEND_TERMINATE_REQUEST. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}`);
                             if (!ws.userId) {
                                 console.error(`[SSH_SUSPEND_TERMINATE_REQUEST] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`);
                                 if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_TERMINATED_RESP', payload: { suspendSessionId, success: false, error: '用户认证失败' } }));
                                 break;
                            }
                            try {
                                const success = await sshSuspendService.terminateSuspendedSession(ws.userId, suspendSessionId);
                                const response: SshSuspendTerminatedResponse = {
                                    type: 'SSH_SUSPEND_TERMINATED',
                                    payload: { suspendSessionId, success }
                                };
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                            } catch (error: any) {
                                console.error(`[SSH_SUSPEND_TERMINATE_REQUEST] 终止会话 ${suspendSessionId} 失败:`, error);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_TERMINATED_RESP', payload: { suspendSessionId, success: false, error: error.message || '终止会话失败' } }));
                            }
                            break;
                        }
                        case 'SSH_SUSPEND_REMOVE_ENTRY': {
                            const { suspendSessionId } = payload as SshSuspendRemoveEntryRequest['payload'];
                            console.log(`[WebSocket Handler] Received SSH_SUSPEND_REMOVE_ENTRY. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}`);
                            if (!ws.userId) {
                                console.error(`[SSH_SUSPEND_REMOVE_ENTRY] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP', payload: { suspendSessionId, success: false, error: '用户认证失败' } }));
                                break;
                            }
                            try {
                                const success = await sshSuspendService.removeDisconnectedSessionEntry(ws.userId, suspendSessionId);
                                const response: SshSuspendEntryRemovedResponse = {
                                    type: 'SSH_SUSPEND_ENTRY_REMOVED',
                                    payload: { suspendSessionId, success }
                                };
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                            } catch (error: any) {
                                console.error(`[SSH_SUSPEND_REMOVE_ENTRY] 移除条目 ${suspendSessionId} 失败:`, error);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP', payload: { suspendSessionId, success: false, error: error.message || '移除条目失败' } }));
                            }
                            break;
                        }
                        case 'SSH_SUSPEND_EDIT_NAME': {
                            const { suspendSessionId, customName } = payload as SshSuspendEditNameRequest['payload'];
                            if (!ws.userId) {
                                console.error(`[SSH_SUSPEND_EDIT_NAME] 用户 ID 未定义。`);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_NAME_EDITED_RESP', payload: { suspendSessionId, success: false, error: '用户认证失败' } }));
                                break;
                            }
                            try {
                                const success = await sshSuspendService.editSuspendedSessionName(ws.userId, suspendSessionId, customName);
                                const response: SshSuspendNameEditedResponse = {
                                    type: 'SSH_SUSPEND_NAME_EDITED',
                                    payload: { suspendSessionId, success, customName: success ? customName : undefined }
                                };
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                            } catch (error: any) {
                                console.error(`[SSH_SUSPEND_EDIT_NAME] 编辑名称 ${suspendSessionId} 失败:`, error);
                                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SSH_SUSPEND_NAME_EDITED_RESP', payload: { suspendSessionId, success: false, error: error.message || '编辑名称失败' } }));
                            }
                            break;
                        }
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

    // 监听 SshSuspendService 发出的会话自动终止事件
    sshSuspendService.on('sessionAutoTerminated', (eventPayload: { userId: number; suspendSessionId: string; reason: string }) => {
        const { userId, suspendSessionId, reason } = eventPayload;
        console.log(`[WebSocket 通知] 准备发送 SSH_SUSPEND_AUTO_TERMINATED_NOTIF 给用户 ${userId} 的会话 ${suspendSessionId}`);

        wss.clients.forEach(client => {
            const wsClient = client as AuthenticatedWebSocket; // 类型断言
            if (wsClient.userId === userId && wsClient.readyState === WebSocket.OPEN) {
                const notification: SshSuspendAutoTerminatedNotification = {
                    type: 'SSH_SUSPEND_AUTO_TERMINATED',
                    payload: {
                        suspendSessionId,
                        reason
                    }
                };
                wsClient.send(JSON.stringify(notification));
                console.log(`[WebSocket 通知] 已发送 SSH_SUSPEND_AUTO_TERMINATED_NOTIF 给用户 ${userId} 的一个 WebSocket 连接 (会话 ${suspendSessionId})。`);
            }
        });
    });

    console.log('WebSocket connection handler initialized, including SshSuspendService event listener.');
}