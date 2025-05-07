import WebSocket, { WebSocketServer, RawData } from 'ws';
import http from 'http';
import url from 'url';
// path and dotenv are no longer needed here as env vars are loaded in index.ts
// import path from 'path';
// import dotenv from 'dotenv';
import { Request, RequestHandler } from 'express';
import { Client, ClientChannel } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { getDbInstance } from './database/connection'; 
import { SftpService } from './services/sftp.service';
import { StatusMonitorService } from './services/status-monitor.service';
import * as SshService from './services/ssh.service';
import { DockerService } from './services/docker.service';
import { AuditLogService } from './services/audit.service';
import { NotificationService } from './services/notification.service'; // 添加导入
import { settingsService } from './services/settings.service';

// 扩展 WebSocket 类型以包含会话 ID
interface AuthenticatedWebSocket extends WebSocket {
    isAlive?: boolean;
    userId?: number;
    username?: string;
    sessionId?: string; // 用于关联 ClientState 的唯一 ID
}

import { SFTPWrapper } from 'ssh2'; // 引入 SFTPWrapper 类型

// 中心化的客户端状态接口 (统一版本)
export interface ClientState { // 导出以便 Service 可以导入
    ws: AuthenticatedWebSocket;
    sshClient: Client;
    sshShellStream?: ClientChannel;
    dbConnectionId: number;
connectionName?: string; // 添加连接名称字段
    sftp?: SFTPWrapper; // 添加 sftp 实例 (由 SftpService 管理)
    statusIntervalId?: NodeJS.Timeout; // 添加状态轮询 ID (由 StatusMonitorService 管理)
    dockerStatusIntervalId?: NodeJS.Timeout; // NEW: Docker 状态轮询 ID
    ipAddress?: string; // 添加 IP 地址字段
    isShellReady?: boolean; // 新增：标记 Shell 是否已准备好处理输入和调整大小
}


interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | string;
}


// --- Docker Interfaces (Ensure this matches frontend and DockerService) ---
// Stats 接口
interface DockerStats {
    ID: string;       // 来自 docker stats
    Name: string;     // 来自 docker stats
    CPUPerc: string;  // 来自 docker stats
    MemUsage: string; // 来自 docker stats
    MemPerc: string;  // 来自 docker stats
    NetIO: string;    // 来自 docker stats
    BlockIO: string;  // 来自 docker stats
    PIDs: string;     // 来自 docker stats
}

// Container 接口 (包含 stats)
interface DockerContainer {
    id: string; // 使用小写 id 以匹配前端期望
    Names: string[];
    Image: string;
    ImageID: string;
    Command: string;
    Created: number;
    State: string;
    Status: string;
    Ports: PortInfo[];
    Labels: Record<string, string>;
    stats?: DockerStats | null; // 可选的 stats 字段
}


// --- 新增：解析 Ports 字符串的辅助函数 ---
function parsePortsString(portsString: string | undefined | null): PortInfo[] { 
    if (!portsString) {
        return [];
    }
    const ports: PortInfo[] = []; // Now PortInfo is defined
    const entries = portsString.split(', ');

    for (const entry of entries) {
        const parts = entry.split('->');
        let publicPart = '';
        let privatePart = '';

        if (parts.length === 2) {
            publicPart = parts[0];
            privatePart = parts[1];
        } else if (parts.length === 1) { 
            privatePart = parts[0];
        } else {
            console.warn(`[WebSocket] Skipping unparsable port entry: ${entry}`);
            continue;
        }

        const privateMatch = privatePart.match(/^(\d+)\/(tcp|udp|\w+)$/);
        if (!privateMatch) {
            //  console.warn(`[WebSocket] Skipping unparsable private port part: ${privatePart}`);
             continue;
        }
        const privatePort = parseInt(privateMatch[1], 10);
        const type = privateMatch[2];

        let ip: string | undefined = undefined;
        let publicPort: number | undefined = undefined;

        
        if (publicPart) {
            const publicMatch = publicPart.match(/^(?:([\d.:a-fA-F]+):)?(\d+)$/); 
             if (publicMatch) {
                 ip = publicMatch[1] || undefined; 
                 publicPort = parseInt(publicMatch[2], 10);
             } else {
                //   console.warn(`[WebSocket] Skipping unparsable public port part: ${publicPart}`);
                  
             }
        }

        if (!isNaN(privatePort)) {
             ports.push({
                 IP: ip,
                 PrivatePort: privatePort,
                 PublicPort: publicPort,
                 Type: type
             });
        }
    }
    return ports;
}


// 存储所有活动客户端的状态 (key: sessionId)
export const clientStates = new Map<string, ClientState>(); 

// --- 服务实例化 ---
// 将 clientStates 传递给需要访问共享状态的服务
const sftpService = new SftpService(clientStates);
const statusMonitorService = new StatusMonitorService(clientStates);
const auditLogService = new AuditLogService(); // 实例化 AuditLogService
const notificationService = new NotificationService(); // 添加实例
const dockerService = new DockerService(); // 实例化 DockerService (主要用于类型或未来可能的本地调用)

/**
 * 清理指定会话 ID 关联的所有资源
 * @param sessionId - 会话 ID
 */
const cleanupClientConnection = (sessionId: string | undefined) => {
    if (!sessionId) return;

    const state = clientStates.get(sessionId);
    if (state) {
        console.log(`WebSocket: 清理会话 ${sessionId} (用户: ${state.ws.username}, DB 连接 ID: ${state.dbConnectionId})...`);

        // 1. 停止状态轮询
        statusMonitorService.stopStatusPolling(sessionId);

        // 2. 清理 SFTP 会话
        sftpService.cleanupSftpSession(sessionId);

        // 3. 清理 SSH 连接 (调用 SshService 中的底层清理逻辑，或直接操作)
        state.sshShellStream?.end(); // 结束 shell 流
        state.sshClient?.end(); // 结束 SSH 客户端

        // 4. 清理 Docker 状态轮询定时器
        if (state.dockerStatusIntervalId) {
            clearInterval(state.dockerStatusIntervalId);
            console.log(`WebSocket: Cleared Docker status interval for session ${sessionId}.`);
        }

        // 5. 从状态 Map 中移除
        clientStates.delete(sessionId);

        // 6. 清除 WebSocket 上的 sessionId 关联 (可选，因为 ws 可能已关闭)
        if (state.ws && state.ws.sessionId === sessionId) {
            delete state.ws.sessionId;
        }

        console.log(`WebSocket: 会话 ${sessionId} 已清理。`);
    } else {
        
    }
};


const fetchRemoteDockerStatus = async (state: ClientState): Promise<{ available: boolean; containers: DockerContainer[] }> => {
    if (!state || !state.sshClient) {
        throw new Error('SSH client is not available in the current state.');
    }

    let allContainers: DockerContainer[] = [];
    const statsMap = new Map<string, DockerStats>();
    let isDockerCmdAvailable = false; 

    
    try {
        const versionCommand = "docker version --format '{{.Server.Version}}'";
        // console.log(`[fetchRemoteDockerStatus] Executing: ${versionCommand} on session ${state.ws.sessionId}`);
        const { stdout: versionStdout, stderr: versionStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            state.sshClient.exec(versionCommand, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', (code: number | null) => {
                    
                    resolve({ stdout, stderr });
                });
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

        
        if (versionStderr.includes('command not found') ||
            versionStderr.includes('permission denied') ||
            versionStderr.includes('Cannot connect to the Docker daemon')) {
            console.warn(`[fetchRemoteDockerStatus] Docker version check failed on session ${state.ws.sessionId}. Docker unavailable or inaccessible. Stderr: ${versionStderr.trim()}`);
            return { available: false, containers: [] }; 
        } else if (versionStderr) {
            
            console.warn(`[fetchRemoteDockerStatus] Docker version command stderr on session ${state.ws.sessionId}: ${versionStderr.trim()}`);
        }

        
        if (versionStdout.trim()) {
            // console.log(`[fetchRemoteDockerStatus] Docker version check successful on session ${state.ws.sessionId}. Version: ${versionStdout.trim()}`);
            isDockerCmdAvailable = true;
        } else {
            
            console.warn(`[fetchRemoteDockerStatus] Docker version check on session ${state.ws.sessionId} produced no output, assuming Docker unavailable.`);
            return { available: false, containers: [] };
        }

    } catch (error: any) {
        console.error(`[fetchRemoteDockerStatus] Error executing docker version for session ${state.ws.sessionId}:`, error);
        
        return { available: false, containers: [] };
    }

    

    
    try {
        const psCommand = "docker ps -a --no-trunc --format '{{json .}}'";
        // console.log(`[fetchRemoteDockerStatus] Executing: ${psCommand} on session ${state.ws.sessionId}`);
        const { stdout: psStdout, stderr: psStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            state.sshClient.exec(psCommand, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', (code: number | null) => {
                    
                    resolve({ stdout, stderr });
                });
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

        
        if (psStderr.includes('command not found') || 
            psStderr.includes('permission denied') || 
            psStderr.includes('Cannot connect to the Docker daemon')) { 
            console.warn(`[fetchRemoteDockerStatus] Docker ps command failed unexpectedly after version check on session ${state.ws.sessionId}. Stderr: ${psStderr.trim()}`);
            
            return { available: false, containers: [] };
        } else if (psStderr) {
             console.warn(`[fetchRemoteDockerStatus] Docker ps command stderr on session ${state.ws.sessionId}: ${psStderr.trim()}`);
             
        }

        
        const lines = psStdout.trim() ? psStdout.trim().split('\n') : [];
        allContainers = lines
            .map(line => {
                try {
                    const data = JSON.parse(line);
                    
                    const container: DockerContainer = {
                        id: data.ID, 
                        Names: typeof data.Names === 'string' ? data.Names.split(',') : (data.Names || []),
                        Image: data.Image || '',
                        ImageID: data.ImageID || '',
                        Command: data.Command || '',
                        Created: data.CreatedAt || 0, 
                        State: data.State || 'unknown',
                        Status: data.Status || '',
                        Ports: parsePortsString(data.Ports),
                        Labels: data.Labels || {},
                        stats: null 
                    };
                    return container;
                } catch (parseError) {
                    console.error(`[fetchRemoteDockerStatus] Failed to parse container JSON line for session ${state.ws.sessionId}: ${line}`, parseError);
                    return null;
                }
            })
            .filter((container): container is DockerContainer => container !== null);

    } catch (error: any) {
        console.error(`[fetchRemoteDockerStatus] Error executing docker ps for session ${state.ws.sessionId}:`, error);
        
        return { available: false, containers: [] };
        
        
    }

    
    
    const runningContainerIds = allContainers.filter(c => c.State === 'running').map(c => c.id);

    if (runningContainerIds.length > 0) {
        try {
            
            const statsCommand = `docker stats ${runningContainerIds.join(' ')} --no-stream --format '{{json .}}'`;
            // console.log(`[fetchRemoteDockerStatus] Executing: ${statsCommand} on session ${state.ws.sessionId}`);
            const { stdout: statsStdout, stderr: statsStderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
                let stdout = '';
            let stderr = '';
            state.sshClient.exec(statsCommand, { pty: false }, (err, stream) => {
                if (err) return reject(err);
                stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                stream.on('close', (code: number | null) => {
                    
                    resolve({ stdout, stderr });
                });
                stream.on('error', (execErr: Error) => reject(execErr));
            });
        });

            if (statsStderr) {
                
                console.warn(`[fetchRemoteDockerStatus] Docker stats command stderr on session ${state.ws.sessionId}: ${statsStderr.trim()}`);
            }

            const statsLines = statsStdout.trim() ? statsStdout.trim().split('\n') : [];
            statsLines.forEach(line => {
                try {
                    const statsData = JSON.parse(line) as DockerStats;
                    if (statsData.ID) {
                        
                        statsMap.set(statsData.ID, statsData);
                    }
                } catch (parseError) {
                    console.error(`[fetchRemoteDockerStatus] Failed to parse stats JSON line for session ${state.ws.sessionId}: ${line}`, parseError);
                }
            });
        } catch (error: any) {
            
            console.warn(`[fetchRemoteDockerStatus] Error executing docker stats for session ${state.ws.sessionId}:`, error);
        }
    } else {
        //  console.log(`[fetchRemoteDockerStatus] No running containers found on session ${state.ws.sessionId}, skipping docker stats.`);
    }

    
    allContainers.forEach(container => {
        const shortId = container.id.substring(0, 12); 
        const stats = statsMap.get(container.id) || statsMap.get(shortId); 
        if (stats) {
            container.stats = stats;
        }
    });

    
    return { available: true, containers: allContainers };
};



export const initializeWebSocket = async (server: http.Server, sessionParser: RequestHandler): Promise<WebSocketServer> => {
    // Environment variables (including DEPLOYMENT_MODE and RDP URLs)
    // are now expected to be loaded by index.ts before this function is called.

    const wss = new WebSocketServer({ noServer: true });
    const db = await getDbInstance();
    const DOCKER_STATUS_INTERVAL = 2000;

    // --- 心跳检测 ---
    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws: WebSocket) => {
            const extWs = ws as AuthenticatedWebSocket;
            if (extWs.isAlive === false) {
                console.log(`WebSocket 心跳检测：用户 ${extWs.username} (会话: ${extWs.sessionId}) 连接无响应，正在终止...`);
                cleanupClientConnection(extWs.sessionId); // 使用会话 ID 清理
                return extWs.terminate();
            }
            extWs.isAlive = false;
            extWs.ping(() => {});
        });
    }, 5000); // 增加到 60 秒心跳间隔

    // --- WebSocket 升级处理 (认证) ---
    server.on('upgrade', (request: Request, socket, head) => {
        // --- 添加详细日志：检查传入的请求头和 request.ip ---
        console.log('[WebSocket Upgrade] Received upgrade request.');
        console.log('[WebSocket Upgrade] Request Headers:', JSON.stringify(request.headers, null, 2));
        console.log(`[WebSocket Upgrade] Initial request.ip value: ${request.ip}`); // Express 尝试解析的 IP
        console.log(`[WebSocket Upgrade] X-Real-IP Header: ${request.headers['x-real-ip']}`);
        console.log(`[WebSocket Upgrade] X-Forwarded-For Header: ${request.headers['x-forwarded-for']}`);
        // --- 结束添加日志 ---

        const parsedUrl = url.parse(request.url || '', true); // Parse URL and query string
        const pathname = parsedUrl.pathname;
        // const ipAddress = request.ip; // Get IP address early - Let's re-evaluate this later

        // --- 修改：尝试从头部获取 IP，并处理 X-Forwarded-For 列表 ---
        let ipAddress: string | undefined;
        const xForwardedFor = request.headers['x-forwarded-for'];
        const xRealIp = request.headers['x-real-ip'];

        if (xForwardedFor) {
            // 如果 X-Forwarded-For 存在，取列表中的第一个 IP
            const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor.split(',')[0];
            ipAddress = ips?.trim();
            console.log(`[WebSocket Upgrade] Using first IP from X-Forwarded-For: ${ipAddress}`);
        } else if (xRealIp) {
            // 否则，尝试 X-Real-IP
            ipAddress = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp.trim();
            console.log(`[WebSocket Upgrade] Using IP from X-Real-IP: ${ipAddress}`);
        } else {
            // 最后回退到 socket.remoteAddress 或 request.ip
            ipAddress = request.socket.remoteAddress || request.ip;
            console.log(`[WebSocket Upgrade] Using fallback IP: ${ipAddress}`);
        }

        // 确保 ipAddress 不是 undefined 或空字符串，否则设为 'unknown'
        ipAddress = ipAddress || 'unknown';
        console.log(`[WebSocket Upgrade] Determined IP Address: ${ipAddress}`);
        // --- 结束修改 ---


        console.log(`WebSocket: 升级请求来自 IP: ${ipAddress}, Path: ${pathname}`); // 使用新获取的 ipAddress

        // @ts-ignore Express-session 类型问题
        sessionParser(request, {} as any, () => {
            // --- 认证检查 ---
            if (!request.session || !request.session.userId) {
                console.log(`WebSocket 认证失败 (Path: ${pathname})：未找到会话或用户未登录。`);
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            console.log(`WebSocket 认证成功 (Path: ${pathname})：用户 ${request.session.username} (ID: ${request.session.userId})`);

            // --- 根据路径处理升级 ---
            // 本地调试用/rdp-proxy，nginx反代用/ws/rdp-proxy
            if (pathname === '/rdp-proxy' || pathname === '/ws/rdp-proxy') {
                // RDP 代理路径 - 直接处理升级，连接逻辑在 'connection' 事件中处理
                console.log(`WebSocket: Handling RDP proxy upgrade for user ${request.session.username}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    // 传递必要信息给 connection 事件
                    (request as any).clientIpAddress = ipAddress;
                    (request as any).isRdpProxy = true; // 标记为 RDP 代理连接
                    // 传递 RDP token 和其他参数
                    (request as any).rdpToken = parsedUrl.query.token;
                    (request as any).rdpWidth = parsedUrl.query.width;
                    (request as any).rdpHeight = parsedUrl.query.height;
                    (request as any).rdpDpi = parsedUrl.query.dpi;
                    wss.emit('connection', extWs, request);
                });
            } else {
                // 默认路径 (SSH, SFTP, Docker etc.) - 按原逻辑处理
                console.log(`WebSocket: Handling standard upgrade for user ${request.session.username}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    (request as any).clientIpAddress = ipAddress;
                    (request as any).isRdpProxy = false; // 标记为非 RDP 代理连接
                    wss.emit('connection', extWs, request);
                });
            }
        });
    });

    // --- WebSocket 连接处理 ---
    wss.on('connection', (ws: AuthenticatedWebSocket, request: Request) => {
        ws.isAlive = true;
        const isRdpProxy = (request as any).isRdpProxy;
        const clientIp = (request as any).clientIpAddress || 'unknown';

        console.log(`WebSocket：客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}, RDP Proxy: ${isRdpProxy}) 已连接。`);

        ws.on('pong', () => { ws.isAlive = true; });

        // --- RDP 代理连接处理 ---
        if (isRdpProxy) {
            // Retrieve all necessary parameters passed from the upgrade handler
            const rdpToken = (request as any).rdpToken;
            const rdpWidthStr = (request as any).rdpWidth; // Get as string first
            const rdpHeightStr = (request as any).rdpHeight; // Get as string first
            // const rdpDpi = (request as any).rdpDpi; // Original DPI from URL - we will recalculate

            // --- 新增：参数验证和 DPI 计算 ---
            if (!rdpToken || !rdpWidthStr || !rdpHeightStr) { // Check string presence
                console.error(`WebSocket: RDP Proxy connection for ${ws.username} missing required parameters (token, width, height).`);
                ws.send(JSON.stringify({ type: 'rdp:error', payload: 'Missing RDP connection parameters (token, width, height).' }));
                ws.close(1008, 'Missing RDP parameters');
                return;
            }

            const rdpWidth = parseInt(rdpWidthStr, 10);
            const rdpHeight = parseInt(rdpHeightStr, 10);

            if (isNaN(rdpWidth) || isNaN(rdpHeight) || rdpWidth <= 0 || rdpHeight <= 0) {
                 console.error(`WebSocket: RDP Proxy connection for ${ws.username} has invalid width or height parameters.`);
                 ws.send(JSON.stringify({ type: 'rdp:error', payload: 'Invalid width or height parameters.' }));
                 ws.close(1008, 'Invalid RDP dimensions');
                 return;
            }

            // 根据宽高的简单 DPI 计算逻辑 (如果宽度 > 1920，则 DPI=120，否则 DPI=96)
            const calculatedDpi = rdpWidth > 1920 ? 120 : 96;
            console.log(`WebSocket: RDP Proxy calculated DPI for ${ws.username} based on width ${rdpWidth}: ${calculatedDpi}`);



            // Determine RDP target URL based on deployment mode
            const deploymentMode = process.env.DEPLOYMENT_MODE;
            let remoteGatewayWsBaseUrl: string;
            if (deploymentMode === 'local') {
                remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_LOCAL || 'ws://localhost:8080'; // 更新端口和环境变量名
                console.log(`[WebSocket Remote Desktop Proxy] Using LOCAL deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`);
            } else if (deploymentMode === 'docker') {
                remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_DOCKER || 'ws://remote-gateway:8080'; // 更新服务名、端口和环境变量名
                console.log(`[WebSocket Remote Desktop Proxy] Using DOCKER deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`);
            } else {
                remoteGatewayWsBaseUrl = 'ws://localhost:8080'; // 更新默认端口
                console.warn(`[WebSocket Remote Desktop Proxy] Unknown deployment mode '${deploymentMode}'. Defaulting to safe fallback Target Base: ${remoteGatewayWsBaseUrl}`);
            }

            const cleanRemoteGatewayWsBaseUrl = remoteGatewayWsBaseUrl.endsWith('/') ? remoteGatewayWsBaseUrl.slice(0, -1) : remoteGatewayWsBaseUrl;

            // 构建目标 URL 时，协议 (RDP/VNC) 信息现在由 remote-gateway 处理，我们只需要传递令牌和尺寸
            const remoteDesktopTargetUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=${encodeURIComponent(rdpToken)}&width=${encodeURIComponent(rdpWidth)}&height=${encodeURIComponent(rdpHeight)}&dpi=${encodeURIComponent(calculatedDpi)}`;

            console.log(`WebSocket: Remote Desktop Proxy for ${ws.username} attempting to connect to ${remoteDesktopTargetUrl}`);

            const rdpWs = new WebSocket(remoteDesktopTargetUrl);
            let clientWsClosed = false;
            let rdpWsClosed = false;

            // --- 消息转发: Client -> RDP ---
            ws.on('message', (message: RawData) => {
                if (rdpWs.readyState === WebSocket.OPEN) {
                    const messageString = message.toString('utf-8'); // 尝试解码为 UTF-8
                    rdpWs.send(message);
                } else {
                    console.warn(`[RDP 代理 C->S] 用户: ${ws.username}, 会话: ${ws.sessionId}, RDP WS 未打开，丢弃消息。`);
                }
            });

            // --- 消息转发: RDP -> Client ---
            rdpWs.on('message', (message: RawData) => {
                if (ws.readyState === WebSocket.OPEN) {
                    // 将 RawData (可能是 Buffer) 转换为 UTF-8 字符串再发送
                    const messageString = message.toString('utf-8');
                    ws.send(messageString);
                } else {
                     console.warn(`[RDP 代理 S->C] 用户: ${ws.username}, 会话: ${ws.sessionId}, 客户端 WS 未打开，丢弃消息。`);
                }
            });

            // --- 错误处理 ---
            ws.on('error', (error) => {
                console.error(`[RDP 代理 客户端 WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 错误:`, error);
                if (!rdpWsClosed && rdpWs.readyState !== WebSocket.CLOSED && rdpWs.readyState !== WebSocket.CLOSING) {
                    console.log(`[RDP 代理] 因客户端 WS 错误关闭 RDP WS。会话: ${ws.sessionId}`);
                    rdpWs.close(1011, 'Client WS Error');
                    rdpWsClosed = true;
                }
                clientWsClosed = true;
            });
            rdpWs.on('error', (error) => {

                 console.error(`[RDP 代理 RDP WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 连接到 ${remoteDesktopTargetUrl} 时出错:`, error);
                 if (!clientWsClosed && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                    console.log(`[RDP 代理] 因 RDP WS 错误关闭客户端 WS。会话: ${ws.sessionId}`);
                    ws.close(1011, `RDP WS Error: ${error.message}`);
                    clientWsClosed = true;
                }
                rdpWsClosed = true;
            });

            // --- 关闭处理 ---
            ws.on('close', (code, reason) => {
                clientWsClosed = true;
                // --- 添加中文日志 ---
                console.log(`[RDP 代理 客户端 WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 代码: ${code}, 原因: ${reason.toString()}`);
                // --- 结束日志 ---
                if (!rdpWsClosed && rdpWs.readyState !== WebSocket.CLOSED && rdpWs.readyState !== WebSocket.CLOSING) {
                    console.log(`[RDP 代理] 因客户端 WS 关闭而关闭 RDP WS。会话: ${ws.sessionId}`);
                    rdpWs.close(1000, 'Client WS Closed');
                    rdpWsClosed = true;
                }
            });
            rdpWs.on('close', (code, reason) => {
                rdpWsClosed = true;
                 // --- 添加中文日志 ---
                 console.log(`[RDP 代理 RDP WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${remoteDesktopTargetUrl} 的连接已关闭。代码: ${code}, 原因: ${reason.toString()}`);
                 // --- 结束日志 ---
                if (!clientWsClosed && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
                    console.log(`[RDP 代理] 因 RDP WS 关闭而关闭客户端 WS。会话: ${ws.sessionId}`);
                    ws.close(1000, 'RDP WS Closed');
                    clientWsClosed = true;
                }
            });

            rdpWs.on('open', () => {
                 console.log(`[RDP 代理 RDP WS 打开] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${remoteDesktopTargetUrl} 的连接已建立。开始转发消息。`);
            });

        // --- 标准 (SSH/SFTP/Docker) 连接处理 ---
        } else {
            // --- 消息处理 (原有逻辑) ---
            ws.on('message', async (message) => {
                // console.log(`WebSocket：收到来自 ${ws.username} (会话: ${ws.sessionId}) 的消息: ${message.toString().substring(0, 100)}...`);
                let parsedMessage: any;
                try {
                    parsedMessage = JSON.parse(message.toString());
                } catch (e) {
                    console.error(`WebSocket：来自 ${ws.username} 的无效 JSON 消息:`, message.toString());
                    ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
                    return;
                }

                const { type, payload, requestId } = parsedMessage; // requestId 用于 SFTP 操作
                const sessionId = ws.sessionId; // 获取当前 WebSocket 的会话 ID
                const state = sessionId ? clientStates.get(sessionId) : undefined; // 获取当前会话状态

                try {
                    switch (type) {
                        // --- SSH 连接请求 ---
                        case 'ssh:connect': {
                            if (sessionId && state) {
                            console.warn(`WebSocket: 用户 ${ws.username} (会话: ${sessionId}) 已有活动连接，忽略新的连接请求。`);
                            ws.send(JSON.stringify({ type: 'ssh:error', payload: '已存在活动的 SSH 连接。' }));
                            return;
                        }

                        const dbConnectionId = payload?.connectionId;
                        if (!dbConnectionId) {
                            ws.send(JSON.stringify({ type: 'ssh:error', payload: '缺少 connectionId。' }));
                            return;
                        }

                        console.log(`WebSocket: 用户 ${ws.username} 请求连接到数据库 ID: ${dbConnectionId}`);
                        ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在处理连接请求...' }));
                        // 从传递过来的 request 对象获取 IP 地址 (在 catch 块中也需要访问) - 使用 upgrade 阶段确定的 ipAddress
                        const clientIp = (request as any).clientIpAddress || 'unknown'; // clientIpAddress 在 upgrade 阶段被设置
                        console.log(`[SSH Connect] Using IP from upgrade handler: ${clientIp}`); // 添加日志确认
let connInfo: SshService.DecryptedConnectionDetails | null = null; // 将 connInfo 移到 try 外部

                        try {
                            // --- 手动编排 SSH 连接流程 ---
                            // 1. 获取连接信息
                            ws.send(JSON.stringify({ type: 'ssh:status', payload: '正在获取连接信息...' }));
                            connInfo = await SshService.getConnectionDetails(dbConnectionId); // 在 try 内部赋值

                            // 2. 建立 SSH 连接
                            ws.send(JSON.stringify({ type: 'ssh:status', payload: `正在连接到 ${connInfo.host}...` }));
                            const sshClient = await SshService.establishSshConnection(connInfo);

                            // 3. 连接成功，创建状态
                            const newSessionId = uuidv4();
                            ws.sessionId = newSessionId;

                            // --- 修正：确保 dbConnectionId 存储为数字 ---
                            const dbConnectionIdAsNumber = parseInt(dbConnectionId, 10);
                            if (isNaN(dbConnectionIdAsNumber)) {
                                // 如果转换失败，记录错误并可能关闭连接
                                console.error(`WebSocket: 无效的 dbConnectionId '${dbConnectionId}' (非数字)，无法创建会话 ${newSessionId}。`);
                                ws.send(JSON.stringify({ type: 'ssh:error', payload: '无效的连接 ID。' }));
                                sshClient.end(); // 关闭 SSH 连接
                                ws.close(1008, 'Invalid Connection ID'); // 关闭 WebSocket
                                return; // 停止执行
                            }
                            const newState: ClientState = {
                                ws: ws,
                                sshClient: sshClient,
                                dbConnectionId: dbConnectionIdAsNumber, // 存储数字类型
                                connectionName: connInfo!.name, // 填充 connectionName (non-null assertion)
                                ipAddress: clientIp, // 存储 IP 地址
                                isShellReady: false, // 初始化 Shell 状态为未就绪
                            };
                            clientStates.set(newSessionId, newState);
                            console.log(`WebSocket: 为用户 ${ws.username} (IP: ${clientIp}) 创建新会话 ${newSessionId} (DB ID: ${dbConnectionIdAsNumber})`);

                            // 4. 立即打开 Shell (使用默认尺寸)
                            ws.send(JSON.stringify({ type: 'ssh:status', payload: 'SSH 连接成功，正在打开 Shell...' }));
                            try {
                                // 使用默认尺寸 80x24 打开 Shell
                                const defaultCols = 80;
                                const defaultRows = 24;
                                sshClient.shell({ term: 'xterm-256color', cols: defaultCols, rows: defaultRows }, (err, stream) => {
                                    if (err) {
                                        console.error(`SSH: 会话 ${newSessionId} 打开 Shell 失败:`, err);
                                        // 记录审计日志：打开 Shell 失败
                                        auditLogService.logAction('SSH_SHELL_FAILURE', {
connectionName: newState.connectionName, // 添加连接名称
                                            userId: ws.userId,
                                            username: ws.username,
                                            connectionId: dbConnectionId,
                                            sessionId: newSessionId,
                                            ip: newState.ipAddress,
                                            reason: err.message
                                        });
                                        notificationService.sendNotification('SSH_SHELL_FAILURE', { // 添加通知调用
                                            userId: ws.userId,
                                            username: ws.username,
                                            connectionId: dbConnectionId,
                                            sessionId: newSessionId,
                                            ip: newState.ipAddress,
                                            reason: err.message
                                        });
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 失败: ${err.message}` }));
                                        }
                                        cleanupClientConnection(newSessionId); // 清理连接
                                        return;
                                    }

                                    // Shell 打开成功
                                    console.log(`WebSocket: 会话 ${newSessionId} Shell 打开成功 (使用默认尺寸 ${defaultCols}x${defaultRows})。`);
                                    newState.sshShellStream = stream;
                                    newState.isShellReady = true; // 标记 Shell 已就绪

                                    // 5. 立即设置 Shell 事件转发 (捕获初始输出)
                                    stream.on('data', (data: Buffer) => {
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({ type: 'ssh:output', payload: data.toString('base64'), encoding: 'base64' }));
                                        }
                                    });
                                    stream.stderr.on('data', (data: Buffer) => {
                                        console.error(`SSH Stderr (会话: ${newSessionId}): ${data.toString('utf8').substring(0, 100)}...`);
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({ type: 'ssh:output', payload: data.toString('base64'), encoding: 'base64' }));
                                        }
                                    });
                                    stream.on('close', () => {
                                        console.log(`SSH: 会话 ${newSessionId} 的 Shell 通道已关闭。`);
                                        if (ws.readyState === WebSocket.OPEN) {
                                            ws.send(JSON.stringify({ type: 'ssh:disconnected', payload: 'Shell 通道已关闭。' }));
                                        }
                                        cleanupClientConnection(newSessionId);
                                    });

                                    // 6. 发送 SSH 连接成功消息 (现在 Shell 也已打开)
                                    ws.send(JSON.stringify({
                                        type: 'ssh:connected',
                                        payload: {
                                            connectionId: dbConnectionId,
                                            sessionId: newSessionId
                                        }
                                    }));
                                    console.log(`WebSocket: 会话 ${newSessionId} SSH 连接和 Shell 建立成功。`);
                                    // 记录审计日志：SSH 连接成功
                                    auditLogService.logAction('SSH_CONNECT_SUCCESS', {
                                        userId: ws.userId,
                                        username: ws.username,
                                        connectionId: dbConnectionId,
                                        sessionId: newSessionId,
                                        ip: newState.ipAddress,
                                        connectionName: connInfo!.name, // 添加连接名称 (non-null assertion)
                                    });
                                    notificationService.sendNotification('SSH_CONNECT_SUCCESS', { // 添加通知调用
                                        userId: ws.userId,
                                        username: ws.username,
                                        connectionId: dbConnectionId,
                                        sessionId: newSessionId,
                                        ip: newState.ipAddress
                                    });

                                    // 7. 启动异步任务 (SFTP, Status Monitor, Docker)
                                    console.log(`WebSocket: 会话 ${newSessionId} 正在异步初始化 SFTP...`);
                                    sftpService.initializeSftpSession(newSessionId)
                                        .then(() => console.log(`SFTP: 会话 ${newSessionId} 异步初始化成功。`))
                                        .catch(sftpInitError => console.error(`WebSocket: 会话 ${newSessionId} 异步初始化 SFTP 失败:`, sftpInitError));

                                    console.log(`WebSocket: 会话 ${newSessionId} 正在启动状态监控...`);
                                    statusMonitorService.startStatusPolling(newSessionId);

                                    console.log(`WebSocket: 会话 ${newSessionId} 正在启动 Docker 状态轮询...`);
                                    let dockerPollIntervalMs = 2000;
                                    (async () => { // 使用 IIFE 获取设置
                                        try {
                                            const intervalSetting = await settingsService.getSetting('dockerStatusIntervalSeconds');
                                            if (intervalSetting) {
                                                const intervalSeconds = parseInt(intervalSetting, 10);
                                                if (!isNaN(intervalSeconds) && intervalSeconds >= 1) {
                                                    dockerPollIntervalMs = intervalSeconds * 1000;
                                                    console.log(`[Docker Polling] Using interval from settings: ${intervalSeconds}s (${dockerPollIntervalMs}ms) for session ${newSessionId}`);
                                                } else {
                                                     console.warn(`[Docker Polling] Invalid interval setting '${intervalSetting}' found. Using default ${dockerPollIntervalMs}ms for session ${newSessionId}`);
                                                }
                                            } else {
                                                console.log(`[Docker Polling] No interval setting found. Using default ${dockerPollIntervalMs}ms for session ${newSessionId}`);
                                            }
                                        } catch (settingError) {
                                             console.error(`[Docker Polling] Error fetching interval setting for session ${newSessionId}. Using default ${dockerPollIntervalMs}ms:`, settingError);
                                        }

                                        const dockerIntervalId = setInterval(async () => {
                                            const currentState = clientStates.get(newSessionId);
                                            if (!currentState || currentState.ws.readyState !== WebSocket.OPEN) {
                                                console.log(`[Docker Polling] Session ${newSessionId} no longer valid or WS closed. Stopping poll.`);
                                                clearInterval(dockerIntervalId);
                                                return;
                                            }
                                            try {
                                                const statusPayload = await fetchRemoteDockerStatus(currentState);
                                                if (currentState.ws.readyState === WebSocket.OPEN) {
                                                    currentState.ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
                                                }
                                            } catch (error: any) {
                                                console.error(`[Docker Polling] Error fetching Docker status for session ${newSessionId}:`, error);
                                            }
                                        }, dockerPollIntervalMs);
                                        if (newState) newState.dockerStatusIntervalId = dockerIntervalId; // 确保 newState 仍然存在

                                        // 立即触发一次 Docker 状态获取
                                        const currentState = clientStates.get(newSessionId);
                                        if (currentState && currentState.ws.readyState === WebSocket.OPEN) {
                                            try {
                                                console.log(`[Docker Initial Fetch] Fetching status for session ${newSessionId}...`);
                                                const statusPayload = await fetchRemoteDockerStatus(currentState);
                                                if (currentState.ws.readyState === WebSocket.OPEN) {
                                                    currentState.ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
                                                }
                                            } catch (error: any) {
                                                console.error(`[Docker Initial Fetch] Error fetching Docker status for session ${newSessionId}:`, error);
                                                if (currentState.ws.readyState === WebSocket.OPEN) {
                                                     const errorMessage = error.message || 'Unknown error during initial fetch';
                                                     const isUnavailable = errorMessage.includes('command not found') || errorMessage.includes('Cannot connect to the Docker daemon');
                                                     if (isUnavailable) {
                                                         currentState.ws.send(JSON.stringify({ type: 'docker:status:update', payload: { available: false, containers: [] } }));
                                                     } else {
                                                         currentState.ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: `Initial Docker status fetch failed: ${errorMessage}` } }));
                                                     }
                                                }
                                            }
                                        }
                                    })(); 
                                }); // End of sshClient.shell callback
                            } catch (shellError: any) {
                                 // 这个 catch 块理论上不会被触发，因为错误在 shell 回调中处理，但保留以防万一
                                 console.error(`SSH: 会话 ${newSessionId} 打开 Shell 时发生意外错误:`, shellError);
                                 if (ws.readyState === WebSocket.OPEN) {
                                     ws.send(JSON.stringify({ type: 'ssh:error', payload: `打开 Shell 时发生意外错误: ${shellError.message}` }));
                                 }
                                 cleanupClientConnection(newSessionId);
                            }

                            // 8. 设置 SSH Client 的关闭和错误处理
                            sshClient.on('close', () => {
                                console.log(`SSH: 会话 ${newSessionId} 的客户端连接已关闭。`);
                                cleanupClientConnection(newSessionId);
                            });
                            sshClient.on('error', (err: Error) => {
                                console.error(`SSH: 会话 ${newSessionId} 的客户端连接错误:`, err);
                                // 确保在发送错误消息前检查 WebSocket 是否仍然打开
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({ type: 'ssh:error', payload: `SSH 连接错误: ${err.message}` }));
                                }
                                cleanupClientConnection(newSessionId);
                            });

                        } catch (connectError: any) {
                            console.error(`WebSocket: 用户 ${ws.username} (IP: ${clientIp}) 连接到数据库 ID ${dbConnectionId} 失败:`, connectError);
                            // 记录审计日志：SSH 连接失败

                            auditLogService.logAction('SSH_CONNECT_FAILURE', {
                                userId: ws.userId,
                                username: ws.username,
                                connectionId: dbConnectionId,
connectionName: connInfo?.name || 'Unknown', // 添加连接名称 (使用可选链)
                                ip: clientIp,
                                reason: connectError.message
                            });
                            notificationService.sendNotification('SSH_CONNECT_FAILURE', { // 添加通知调用
                                userId: ws.userId,
                                username: ws.username,
                                connectionId: dbConnectionId,
                                ip: clientIp,
                                reason: connectError.message
                            });
                            ws.send(JSON.stringify({ type: 'ssh:error', payload: `连接失败: ${connectError.message}` }));
                            // 在 SSH 连接建立失败时关闭 WebSocket
                            ws.close(1011, `SSH Connection Failed: ${connectError.message}`);
                        }
                        break;
                    }

                    // --- SSH 输入 ---
                    case 'ssh:input': {
                        if (!state || !state.sshShellStream) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SSH 输入，但无活动 Shell。`);
                            return;
                        }
                        const data = payload?.data;
                        if (typeof data === 'string') {
                            state.sshShellStream.write(data);
                        }
                        break;
                    }

                    // --- SSH 终端大小调整 ---
                    case 'ssh:resize': {
                        if (!sessionId || !state || !state.sshClient) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} 的调整大小请求，但无有效会话或 SSH 客户端。`);
                            return;
                        }

                        const { cols, rows } = payload || {};
                        if (typeof cols !== 'number' || typeof rows !== 'number' || cols <= 0 || rows <= 0) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效调整大小请求:`, payload);
                            return;
                        }

                        if (state.isShellReady && state.sshShellStream) {
                            console.log(`SSH: 会话 ${sessionId} 调整终端大小: ${cols}x${rows}`);
                            state.sshShellStream.setWindow(rows, cols, 0, 0); // ssh2 使用 (rows, cols)
                        } else {
                            console.warn(`WebSocket: 会话 ${sessionId} 收到调整大小请求，但 Shell 尚未就绪或流不存在 (isShellReady: ${state.isShellReady})。`);
                        }
                        break;
                    }

                    
                    case 'docker:get_status': {
                        if (!state) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但无活动会话状态。`);
                            ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: 'Session state not found.' } }));
                            return;
                        }
                         if (!state.sshClient) {
                             console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但无活动 SSH 连接。`);
                             ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: 'SSH connection not active.' } }));
                             return;
                         }
                        console.log(`WebSocket: 处理来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求 (手动触发)...`);
                        try {
                            
                            const statusPayload = await fetchRemoteDockerStatus(state);
                            ws.send(JSON.stringify({ type: 'docker:status:update', payload: statusPayload }));
                        } catch (error: any) {
                            console.error(`WebSocket: 手动执行远程 Docker 状态命令失败 for session ${sessionId}:`, error);
                            const errorMessage = error.message || 'Unknown error fetching status';
                            
                            const isUnavailable = errorMessage.includes('command not found') || errorMessage.includes('Cannot connect to the Docker daemon');
                            if (isUnavailable) {
                                ws.send(JSON.stringify({ type: 'docker:status:update', payload: { available: false, containers: [] } }));
                            } else {
                                ws.send(JSON.stringify({ type: 'docker:status:error', payload: { message: `Failed to get remote Docker status: ${errorMessage}` } }));
                            }
                        }
                        break;
                    } 

                    
                    case 'docker:command': {
                         if (!state || !state.sshClient) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但无活动 SSH 连接。`);
                            ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command: payload?.command, message: 'SSH connection not active.' } }));
                            return;
                        }
                        const { containerId, command } = payload || {};
                         if (!containerId || typeof containerId !== 'string' || !command || !['start', 'stop', 'restart', 'remove'].includes(command)) {
                             console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效 ${type} 请求。Payload:`, payload);
                             ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command: command, message: 'Invalid containerId or command.' } }));
                             return;
                         }

                        // --- 添加日志 ---
                        console.log(`WebSocket: Received docker:command. Raw Payload:`, payload);
                        console.log(`WebSocket: Validating containerId: "${containerId}" (Type: ${typeof containerId}), Command: "${command}" (Type: ${typeof command})`);
                        // --- 结束日志 ---

                         // 验证逻辑:
                         if (!containerId || typeof containerId !== 'string' || !command || !['start', 'stop', 'restart', 'remove'].includes(command)) {
                             console.error(`WebSocket: Validation FAILED for docker:command. Payload:`, payload); // 增加失败日志
                             ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command: command, message: 'Invalid containerId or command.' } }));
                             return;
                         }

                        console.log(`WebSocket: Validation PASSED for docker:command.`); // 增加成功日志
                        console.log(`WebSocket: Processing command '${command}' for container '${containerId}' on session ${sessionId}...`);
                        try {
                             
                             const cleanContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, '');
                             if (!cleanContainerId) throw new Error('Invalid container ID format after sanitization.');

                             let dockerCliCommand: string;
                             switch (command) {
                                 case 'start': dockerCliCommand = `docker start ${cleanContainerId}`; break;
                                 case 'stop': dockerCliCommand = `docker stop ${cleanContainerId}`; break;
                                 case 'restart': dockerCliCommand = `docker restart ${cleanContainerId}`; break;
                                 case 'remove': dockerCliCommand = `docker rm -f ${cleanContainerId}`; break; 
                                 default: throw new Error(`Unsupported command: ${command}`); 
                             }

                             
                             await new Promise<void>((resolve, reject) => {
                                 state.sshClient.exec(dockerCliCommand, { pty: false }, (err, stream) => {
                                     if (err) return reject(err);
                                     let stderr = '';
                                     stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                                     stream.on('close', (code: number | null) => {
                                         if (code === 0) {
                                             console.log(`WebSocket: 远程 Docker 命令 (${dockerCliCommand}) on session ${sessionId} 执行成功。`);
                                             resolve();
                                         } else {
                                             console.error(`WebSocket: 远程 Docker 命令 (${dockerCliCommand}) on session ${sessionId} 执行失败 (Code: ${code}). Stderr: ${stderr}`);
                                             reject(new Error(`Command failed with code ${code}. ${stderr || 'No stderr output.'}`));
                                         }
                                     });
                                      
                                      stream.on('error', (execErr: Error) => reject(execErr));
                                 });
                             });
                             
                             

                             
                             
                             setTimeout(() => {
                                 if (clientStates.has(sessionId!)) { 
                                     ws.send(JSON.stringify({ type: 'request_docker_status_update' })); 
                                     
                                     
                                 }
                             }, 500);


                        } catch (error: any) {
                             console.error(`WebSocket: 执行远程 Docker 命令 (${command} for ${containerId}) 失败 for session ${sessionId}:`, error);
                             ws.send(JSON.stringify({ type: 'docker:command:error', payload: { command, containerId, message: `Failed to execute remote command: ${error.message}` } }));
                        }
                        break;
                    } 


                    
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
                     { // Keep the outer grouping for common checks
                        if (!sessionId || !state) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 请求 (${type})，但无活动会话。`);
                            const errPayload: { message: string; requestId?: string } = { message: '无效的会话' };
                            if (requestId) errPayload.requestId = requestId;
                            ws.send(JSON.stringify({ type: 'sftp_error', payload: errPayload }));
                            return;
                        }
                        if (!requestId) {
                            console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SFTP 请求 (${type})，但缺少 requestId。`);
                            ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `SFTP 操作 ${type} 缺少 requestId` } }));
                            return;
                        }
                        try {
                            switch (type) {
                                case 'sftp:readdir':
                                    if (payload?.path) sftpService.readdir(sessionId, payload.path, requestId);
                                    else throw new Error("Missing 'path' in payload for readdir");
                                    break;
                                case 'sftp:stat':
                                    if (payload?.path) sftpService.stat(sessionId, payload.path, requestId);
                                    else throw new Error("Missing 'path' in payload for stat");
                                    break;
                                case 'sftp:readfile':
                                     // --- 修改：提取并传递可选的 encoding 参数 ---
                                     if (payload?.path) {
                                         const requestedEncoding = payload?.encoding; // 获取可选的 encoding
                                         sftpService.readFile(sessionId, payload.path, requestId, requestedEncoding); // 传递给 service 方法
                                     } else {
                                          throw new Error("Missing 'path' in payload for readfile");
                                     }
                                     break;
                                     // --- 结束修改 ---
                                case 'sftp:writefile':
                                    const fileContent = payload?.content ?? payload?.data ?? '';
                                    // --- 修改：提取可选的 encoding 参数 ---
                                    const encoding = payload?.encoding; // 获取可选的 encoding
                                    if (payload?.path) {
                                        const dataToSend = (typeof fileContent === 'string') ? fileContent : '';
                                        // --- 修改：将 encoding 传递给 service 方法 ---
                                        sftpService.writefile(sessionId, payload.path, dataToSend, requestId, encoding);
                                    } else throw new Error("Missing 'path' in payload for writefile");
                                    break;
                                    // --- 结束修改 ---
                                case 'sftp:mkdir':
                                     if (payload?.path) sftpService.mkdir(sessionId, payload.path, requestId);
                                     else throw new Error("Missing 'path' in payload for mkdir");
                                     break;
                                case 'sftp:rmdir':
                                     if (payload?.path) sftpService.rmdir(sessionId, payload.path, requestId);
                                     else throw new Error("Missing 'path' in payload for rmdir");
                                     break;
                                case 'sftp:unlink':
                                     if (payload?.path) sftpService.unlink(sessionId, payload.path, requestId);
                                     else throw new Error("Missing 'path' in payload for unlink");
                                     break;
                                case 'sftp:rename':
                                     if (payload?.oldPath && payload?.newPath) sftpService.rename(sessionId, payload.oldPath, payload.newPath, requestId);
                                     else throw new Error("Missing 'oldPath' or 'newPath' in payload for rename");
                                     break;
                                case 'sftp:chmod':
                                     if (payload?.path && typeof payload?.mode === 'number') sftpService.chmod(sessionId, payload.path, payload.mode, requestId);
                                     else throw new Error("Missing 'path' or invalid 'mode' in payload for chmod");
                                     break;
                                case 'sftp:realpath':
                                    if (payload?.path) sftpService.realpath(sessionId, payload.path, requestId);
                                    else throw new Error("Missing 'path' in payload for realpath");
                                    break;
                                // Cases for copy and move are now handled within this inner switch
                                case 'sftp:copy':
                                    if (Array.isArray(payload?.sources) && payload?.destination) {
                                        sftpService.copy(sessionId, payload.sources, payload.destination, requestId);
                                    } else throw new Error("Missing 'sources' (array) or 'destination' in payload for copy");
                                    break;
                                case 'sftp:move':
                                     if (Array.isArray(payload?.sources) && payload?.destination) {
                                        sftpService.move(sessionId, payload.sources, payload.destination, requestId);
                                    } else throw new Error("Missing 'sources' (array) or 'destination' in payload for move");
                                    break;
                                default:
                                    // Only throw error if the type wasn't handled by any SFTP case
                                    console.warn(`WebSocket: Received unhandled SFTP message type inside SFTP block: ${type}`);
                                    // Optionally send a specific error back, or rely on the outer catch
                                    // ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `内部未处理的 SFTP 类型: ${type}`, requestId } }));
                                    throw new Error(`Unhandled SFTP type: ${type}`); // Keep throwing for the outer catch
                            }
                        } catch (sftpCallError: any) {
                             console.error(`WebSocket: Error preparing/calling SFTP service for ${type} (Request ID: ${requestId}):`, sftpCallError);
                             ws.send(JSON.stringify({ type: 'sftp_error', payload: { message: `处理 SFTP 请求 ${type} 时出错: ${sftpCallError.message}`, requestId } }));
                        }
                        break;
                    }
                    // --- SFTP 文件上传 ---
                    case 'sftp:upload:start': {
                        if (!sessionId || !state) {
                            console.warn(`WebSocket: 收到来自 ${ws.username} 的 SFTP 请求 (${type})，但无活动会话。`);
                            ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '无效的会话' } }));
                            return;
                        }
                        if (!payload?.uploadId || !payload?.remotePath || typeof payload?.size !== 'number') {
                            console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但缺少 uploadId, remotePath 或 size。`);
                            ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '缺少 uploadId, remotePath 或 size' } }));
                            return;
                        }
                        // --- 修改：传递 relativePath 给 SftpService ---
                        const relativePath = payload?.relativePath; // 获取 relativePath
                        console.log(`WebSocket: SFTP Upload Start - Session: ${sessionId}, UploadID: ${payload.uploadId}, RemotePath: ${payload.remotePath}, Size: ${payload.size}, RelativePath: ${relativePath}`);
                        sftpService.startUpload(sessionId, payload.uploadId, payload.remotePath, payload.size, relativePath); // 传递 relativePath
                        // --- 结束修改 ---
                        break;
                    }
                    case 'sftp:upload:chunk': {
                        if (!sessionId || !state) return;
                         if (!payload?.uploadId || typeof payload?.chunkIndex !== 'number' || !payload?.data) {
                            console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但缺少 uploadId, chunkIndex 或 data。`);
                            return;
                        }
                        // --- FIX: Add await for async backpressure handling ---
                        await sftpService.handleUploadChunk(sessionId, payload.uploadId, payload.chunkIndex, payload.data);
                        break;
                    }
                    case 'sftp:upload:cancel': {
                         if (!sessionId || !state) return;
                         if (!payload?.uploadId) {
                            console.error(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但缺少 uploadId。`);
                            ws.send(JSON.stringify({ type: 'sftp:upload:error', payload: { uploadId: payload?.uploadId, message: '缺少 uploadId' } }));
                            return;
                        }
                        
                        sftpService.cancelUpload(sessionId, payload.uploadId);
                        break;
                    }

                    
                    case 'docker:get_stats': {
                        if (!state || !state.sshClient) { 
                            console.warn(`WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 ${type} 请求，但无活动 SSH 连接。`);
                            ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId: payload?.containerId, message: 'SSH connection not active.' } }));
                            return; 
                        }
                        if (!payload || !payload.containerId) {
                            console.warn(`WebSocket: Invalid payload for docker:get_stats in session ${sessionId}:`, payload);
                            ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId: payload?.containerId, message: 'Missing containerId.' } }));
                            return;
                        }

                        const containerId = payload.containerId;
                        console.log(`WebSocket: Handling docker:get_stats for container ${containerId} in session ${sessionId}`);
                        const command = `docker stats ${containerId} --no-stream --format '{{json .}}'`;

                        try {
                            
                            const execResult = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
                                let stdout = '';
                                let stderr = '';
                                state.sshClient.exec(command, { pty: false }, (err, stream) => {
                                    if (err) return reject(err);
                                    stream.on('data', (data: Buffer) => { stdout += data.toString(); });
                                    stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
                                    stream.on('close', (code: number | null) => {
                                        
                                        resolve({ stdout, stderr });
                                    });
                                    stream.on('error', (execErr: Error) => reject(execErr));
                                });
                            });
                            

                            if (execResult.stderr) {
                                
                                console.error(`WebSocket: Docker stats stderr for ${containerId} in session ${sessionId}: ${execResult.stderr}`);
                                ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: execResult.stderr.trim() || 'Error executing stats command.' } }));
                                return; 
                            }

                            if (!execResult.stdout) {
                                console.warn(`WebSocket: No stats output for container ${containerId} in session ${sessionId}. Might be stopped or error occurred.`);
                                
                                if (!execResult.stderr) {
                                     ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: 'No stats data received (container might be stopped).' } }));
                                }
                                return; 
                            }

                            try {
                                const statsData = JSON.parse(execResult.stdout.trim());
                                
                                ws.send(JSON.stringify({ type: 'docker:stats:update', payload: { containerId, stats: statsData } }));
                            } catch (parseError) {
                                console.error(`WebSocket: Failed to parse docker stats JSON for ${containerId} in session ${sessionId}: ${execResult.stdout}`, parseError);
                                ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: 'Failed to parse stats data.' } }));
                            }

                        } catch (error: any) {
                            console.error(`WebSocket: Failed to execute docker stats for ${containerId} in session ${sessionId}:`, error);
                            ws.send(JSON.stringify({ type: 'docker:stats:error', payload: { containerId, message: error.message || 'Failed to fetch Docker stats.' } }));
                        }
                        break; 
                    } 


                    default:
                        console.warn(`WebSocket：收到来自 ${ws.username} (会话: ${sessionId}) 的未知消息类型: ${type}`);
                        ws.send(JSON.stringify({ type: 'error', payload: `不支持的消息类型: ${type}` }));
                }
            } catch (error: any) {
                console.error(`WebSocket: 处理来自 ${ws.username} (会话: ${sessionId}) 的消息 (${type}) 时发生顶层错误:`, error);
                ws.send(JSON.stringify({ type: 'error', payload: `处理消息时发生内部错误: ${error.message}` }));
            }
        });

        // --- 连接关闭和错误处理 ---
        ws.on('close', (code, reason) => {
            console.log(`WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 已断开连接。代码: ${code}, 原因: ${reason.toString()}`);
            cleanupClientConnection(ws.sessionId);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId}) 发生错误:`, error);
            cleanupClientConnection(ws.sessionId);
        });
} // End of else block for non-RDP connections
    });

    // --- WebSocket 服务器关闭处理 ---
    wss.on('close', () => {
        console.log('WebSocket 服务器正在关闭，清理心跳定时器和所有活动会话...');
        clearInterval(heartbeatInterval);
        clientStates.forEach((state, sessionId) => {
            cleanupClientConnection(sessionId);
        });
        console.log('所有活动会话已清理。');
    });

    console.log('WebSocket 服务器初始化完成。');
    return wss;
};



