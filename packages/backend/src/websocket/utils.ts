import { PortInfo, ClientState } from './types';
import { SftpService } from '../services/sftp.service'; // 将被 state.ts 中的实例替换，但类型导入保留
import { StatusMonitorService } from '../services/status-monitor.service'; // 将被 state.ts 中的实例替换，但类型导入保留
import { clientStates, sftpService, statusMonitorService } from './state';

// --- 新增：解析 Ports 字符串的辅助函数 ---
export function parsePortsString(portsString: string | undefined | null): PortInfo[] {
    if (!portsString) {
        return [];
    }
    const ports: PortInfo[] = [];
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


/**
 * 清理指定会话 ID 关联的所有资源
 * @param sessionId - 会话 ID
 */
export const cleanupClientConnection = (sessionId: string | undefined) => {
    if (!sessionId) return;

    const state = clientStates.get(sessionId);
    if (state) {
        console.log(`WebSocket: 清理会话 ${sessionId} (用户: ${state.ws.username}, DB 连接 ID: ${state.dbConnectionId})...`);

        // 1. 停止状态轮询
        statusMonitorService.stopStatusPolling(sessionId);

        // 2. 清理 SFTP 会话
        sftpService.cleanupSftpSession(sessionId);

        // 3. 清理 SSH 连接
        // +++ 仅当会话未被 SshSuspendService 接管时才关闭 SSH 连接 +++
        if (!state.isSuspendedByService) {
            state.sshShellStream?.end(); // 结束 shell 流
            state.sshClient?.end(); // 结束 SSH 客户端
            console.log(`WebSocket: 会话 ${sessionId} 的 SSH 连接已关闭 (未被挂起服务接管)。`);
        } else {
            console.log(`WebSocket: 会话 ${sessionId} 的 SSH 连接由挂起服务管理，跳过关闭。`);
        }
        // +++ 结束条件关闭 +++

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
        // console.warn(`[WebSocket Utils] cleanupClientConnection: No state found for session ID ${sessionId}.`);
    }
};