import WebSocket from 'ws';
import { Client, ClientChannel, SFTPWrapper } from 'ssh2';

// 扩展 WebSocket 类型以包含会话 ID
export interface AuthenticatedWebSocket extends WebSocket {
    isAlive?: boolean;
    userId?: number;
    username?: string;
    sessionId?: string; // 用于关联 ClientState 的唯一 ID
}

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

export interface PortInfo {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: 'tcp' | 'udp' | string;
}

// --- Docker Interfaces (Ensure this matches frontend and DockerService) ---
// Stats 接口
export interface DockerStats {
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
export interface DockerContainer {
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