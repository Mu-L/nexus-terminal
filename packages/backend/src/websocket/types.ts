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
    isSuspendedByService?: boolean; // 新增：标记此会话是否已被 SshSuspendService 接管
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
// --- SSH Suspend Mode WebSocket Message Types ---

// Client -> Server
export interface SshSuspendStartRequest {
  type: "SSH_SUSPEND_START";
  payload: {
    sessionId: string; // The ID of the active SSH session to be suspended
  };
}

export interface SshSuspendListRequest {
  type: "SSH_SUSPEND_LIST_REQUEST";
}

export interface SshSuspendResumeRequest {
  type: "SSH_SUSPEND_RESUME_REQUEST";
  payload: {
    suspendSessionId: string; // The ID of the suspended session to resume
    newFrontendSessionId: string; // The new frontend session ID for the resumed connection
  };
}

export interface SshSuspendTerminateRequest {
  type: "SSH_SUSPEND_TERMINATE_REQUEST";
  payload: {
    suspendSessionId: string; // The ID of the active suspended session to terminate
  };
}

export interface SshSuspendRemoveEntryRequest {
  type: "SSH_SUSPEND_REMOVE_ENTRY";
  payload: {
    suspendSessionId: string; // The ID of the disconnected session entry to remove
  };
}

export interface SshSuspendEditNameRequest {
  type: "SSH_SUSPEND_EDIT_NAME";
  payload: {
    suspendSessionId: string;
    customName: string;
  };
}

// Server -> Client
export interface SshSuspendStartedResponse {
  type: "SSH_SUSPEND_STARTED";
  payload: {
    frontendSessionId: string; // The original frontend session ID
    suspendSessionId: string;  // The new ID for the suspended session
    success: boolean;
    error?: string;
  };
}

export interface SuspendedSessionInfo {
  suspendSessionId: string;
  connectionName: string; // Original connection name
  connectionId: string; // Original connection ID
  suspendStartTime: string; // ISO string
  customSuspendName?: string;
  backendSshStatus: 'hanging' | 'disconnected_by_backend';
  disconnectionTimestamp?: string; // ISO string, if applicable
}

export interface SshSuspendListResponse {
  type: "SSH_SUSPEND_LIST_RESPONSE";
  payload: {
    suspendSessions: SuspendedSessionInfo[];
  };
}

export interface SshSuspendResumedNotification {
  type: "SSH_SUSPEND_RESUMED";
  payload: {
    suspendSessionId: string;
    newFrontendSessionId: string; // The frontend session ID this resumed session is now associated with
    success: boolean;
    error?: string;
  };
}

export interface SshOutputCachedChunk {
  type: "SSH_OUTPUT_CACHED_CHUNK";
  payload: {
    frontendSessionId: string; // The frontend session ID to send the chunk to
    data: string;
    isLastChunk: boolean;
  };
}

export interface SshSuspendTerminatedResponse {
  type: "SSH_SUSPEND_TERMINATED";
  payload: {
    suspendSessionId: string;
    success: boolean;
    error?: string;
  };
}

export interface SshSuspendEntryRemovedResponse {
  type: "SSH_SUSPEND_ENTRY_REMOVED";
  payload: {
    suspendSessionId: string;
    success: boolean;
    error?: string;
  };
}

export interface SshSuspendNameEditedResponse {
  type: "SSH_SUSPEND_NAME_EDITED";
  payload: {
    suspendSessionId: string;
    success: boolean;
    customName?: string;
    error?: string;
  };
}

export interface SshSuspendAutoTerminatedNotification {
  type: "SSH_SUSPEND_AUTO_TERMINATED";
  payload: {
    suspendSessionId: string;
    reason: string;
  };
}

// Union type for all client-to-server messages for SSH Suspend
export type SshSuspendClientToServerMessages =
  | SshSuspendStartRequest
  | SshSuspendListRequest
  | SshSuspendResumeRequest
  | SshSuspendTerminateRequest
  | SshSuspendRemoveEntryRequest
  | SshSuspendEditNameRequest;

// Union type for all server-to-client messages for SSH Suspend
export type SshSuspendServerToClientMessages =
  | SshSuspendStartedResponse
  | SshSuspendListResponse
  | SshSuspendResumedNotification
  | SshOutputCachedChunk
  | SshSuspendTerminatedResponse
  | SshSuspendEntryRemovedResponse
  | SshSuspendNameEditedResponse
  | SshSuspendAutoTerminatedNotification;

// It might be useful to have a general type for incoming messages if not already present
// For example, if you have a main message handler:
// export type WebSocketMessage = BaseMessageType | SshSuspendClientToServerMessages | OtherFeatureMessages;
// And for outgoing:
// export type WebSocketResponse = BaseResponseType | SshSuspendServerToClientMessages | OtherFeatureResponses;
// This part depends on the existing structure, so I'm providing the specific types for now.