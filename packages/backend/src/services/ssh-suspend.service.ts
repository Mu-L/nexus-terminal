import { Client, Channel, ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  SuspendSessionDetails,
  SuspendedSessionsMap,
  BackendSshStatus,
  SuspendedSessionInfo,
} from '../types/ssh-suspend.types';
import { temporaryLogStorageService, TemporaryLogStorageService } from './temporary-log-storage.service';
import { clientStates } from '../websocket/state'; // +++ 导入 clientStates +++

/**
 * SshSuspendService 负责管理所有用户的挂起 SSH 会话的生命周期。
 */
export class SshSuspendService extends EventEmitter {
  private suspendedSessions: SuspendedSessionsMap = new Map();
  private readonly logStorageService: TemporaryLogStorageService;

  constructor(logStorage?: TemporaryLogStorageService) {
    super(); // 调用 EventEmitter 的构造函数
    this.logStorageService = logStorage || temporaryLogStorageService;
    // TODO: 考虑在服务启动时从日志目录加载持久化的 'disconnected_by_backend' 会话信息。
    // 这需要日志文件本身包含可解析的元数据。
  }

  /**
   * 获取用户特定的会话映射，如果不存在则创建。
   * @param userId 用户ID。
   * @returns 该用户的 Map<suspendSessionId, SuspendSessionDetails>。
   */
  private getUserSessions(userId: number): Map<string, SuspendSessionDetails> { // userId: string -> number
    if (!this.suspendedSessions.has(userId)) {
      this.suspendedSessions.set(userId, new Map<string, SuspendSessionDetails>());
    }
    return this.suspendedSessions.get(userId)!;
  }

  /**
   * 启动指定 SSH 会话的挂起模式。
   * @param userId 用户ID。
   * @param originalSessionId 原始会话ID。
   * @param sshClient SSH 客户端实例。
   * @param channel SSH 通道实例。
   * @param connectionName 连接名称。
   * @param connectionId 连接ID。
   * @param customSuspendName 可选的自定义挂起名称。
   * @returns Promise<string> 返回生成的 suspendSessionId。
   */
  async startSuspend(
    userId: number, // userId: string -> number
    originalSessionId: string,
    sshClient: Client,
    channel: ClientChannel, // 更新为 ClientChannel
    connectionName: string,
    connectionId: string,
    customSuspendName?: string,
  ): Promise<string> {
    const suspendSessionId = uuidv4();
    const userSessions = this.getUserSessions(userId);

    // 在接管 channel 和 sshClient 前，移除它们上面可能存在的旧监听器
    // 这确保了 SshSuspendService 独占事件处理，避免旧的处理器（如 ssh.handler.ts 中的）继续发送数据或处理关闭事件
    channel.removeAllListeners('data');
    channel.removeAllListeners('close');
    channel.removeAllListeners('error');
    channel.removeAllListeners('end'); // ClientChannel 也有 'end' 事件
    channel.removeAllListeners('exit'); // ClientChannel 也有 'exit' 事件

    // 对于 sshClient，移除监听器需要谨慎，特别是如果 sshClient 实例可能被多个 Shell共享（尽管在此应用中通常不这么做）
    // 假设这里的 sshClient 的生命周期与此 channel 紧密相关，或者是此 channel 的唯一父级。
    sshClient.removeAllListeners('error');
    sshClient.removeAllListeners('end');
    // sshClient.removeAllListeners('close'); // sshClient 本身没有 'close' 事件，通常是 'end' 或连接错误

    const tempLogPath = `./data/temp_suspended_ssh_logs/${suspendSessionId}.log`; // 路径相对于项目根目录

    const sessionDetails: SuspendSessionDetails = {
      sshClient,
      channel,
      tempLogPath,
      connectionName,
      connectionId,
      suspendStartTime: new Date().toISOString(),
      customSuspendName,
      backendSshStatus: 'hanging',
      originalSessionId,
      userId,
    };

    userSessions.set(suspendSessionId, sessionDetails);

    // +++ 更新 ClientState 标记 +++
    const originalClientState = clientStates.get(originalSessionId);
    if (originalClientState) {
      originalClientState.isSuspendedByService = true;
      console.log(`[用户: ${userId}] ClientState for session ${originalSessionId} marked as suspended by service.`);
    } else {
      console.warn(`[用户: ${userId}] Could not find ClientState for original session ID ${originalSessionId} to mark as suspended.`);
    }
    // +++ 结束更新 ClientState 标记 +++

    console.log(`[用户: ${userId}] SSH会话 ${originalSessionId} (连接: ${connectionName}) 已启动挂起，ID: ${suspendSessionId}`);

    // 确保日志目录存在
    await this.logStorageService.ensureLogDirectoryExists();

    // 开始监听通道数据并写入日志
    channel.on('data', (data: Buffer) => {
      if (userSessions.get(suspendSessionId)?.backendSshStatus === 'hanging') {
        this.logStorageService.writeToLog(suspendSessionId, data.toString('utf-8')).catch(err => {
          console.error(`[用户: ${userId}, 会话: ${suspendSessionId}] 写入挂起日志失败:`, err);
        });
      }
    });

    const handleUnexpectedClose = () => {
      const currentSession = userSessions.get(suspendSessionId);
      if (currentSession && currentSession.backendSshStatus === 'hanging') {
        const reason = 'SSH connection closed or errored.';
        console.warn(`[用户: ${userId}, 会话: ${suspendSessionId}] SSH 连接意外断开。原因: ${reason}`);
        currentSession.backendSshStatus = 'disconnected_by_backend';
        currentSession.disconnectionTimestamp = new Date().toISOString();
        
        this.removeChannelListeners(channel, sshClient); // 使用辅助方法移除

        // 发出事件通知 WebSocket 层
        this.emit('sessionAutoTerminated', {
          userId: currentSession.userId, // 使用存储在 sessionDetails 中的 userId
          suspendSessionId,
          reason
        });
      }
    };
    
    channel.on('close', handleUnexpectedClose);
    channel.on('error', (err: Error) => {
        console.error(`[用户: ${userId}, 会话: ${suspendSessionId}] 通道错误:`, err);
        handleUnexpectedClose();
    });
    sshClient.on('error', (err: Error) => {
        console.error(`[用户: ${userId}, 会话: ${suspendSessionId}] SSH客户端错误:`, err);
        handleUnexpectedClose();
    });
    sshClient.on('end', () => { // 'end' 通常是正常关闭，但也需要处理
        console.log(`[用户: ${userId}, 会话: ${suspendSessionId}] SSH客户端连接结束。`);
        handleUnexpectedClose(); // 如果是意外的，则标记为 disconnected
    });


    return suspendSessionId;
  }
  
  /**
   * 辅助方法：移除会话相关的事件监听器。
   */
  private removeChannelListeners(channel: Channel, sshClient: Client): void {
    channel.removeAllListeners('data');
    channel.removeAllListeners('close');
    channel.removeAllListeners('error');
    sshClient.removeAllListeners('error');
    sshClient.removeAllListeners('end');
  }


  /**
   * 列出指定用户的所有挂起会话（包括活跃和已断开的）。
   * 目前主要从内存中获取信息。
   * @param userId 用户ID。
   * @returns Promise<SuspendedSessionInfo[]> 挂起会话信息的数组。
   */
  async listSuspendedSessions(userId: number): Promise<SuspendedSessionInfo[]> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const sessionsInfo: SuspendedSessionInfo[] = [];

    for (const [suspendSessionId, details] of userSessions.entries()) {
      sessionsInfo.push({
        suspendSessionId,
        connectionName: details.connectionName,
        connectionId: details.connectionId,
        suspendStartTime: details.suspendStartTime,
        customSuspendName: details.customSuspendName,
        backendSshStatus: details.backendSshStatus,
        disconnectionTimestamp: details.disconnectionTimestamp,
      });
    }
    // TODO: 增强此方法以从日志目录恢复 'disconnected_by_backend' 的会话状态，
    // 这需要日志文件包含元数据。
    return sessionsInfo;
  }

  /**
   * 恢复指定的挂起会话。
   * @param userId 用户ID。
   * @param suspendSessionId 要恢复的挂起会话ID。
   * @returns Promise<{ sshClient: Client; channel: ClientChannel; logData: string; connectionName: string; originalConnectionId: string; } | null> 恢复成功则返回客户端、通道、日志数据、连接名和原始连接ID，否则返回null。
   */
  async resumeSession(userId: number, suspendSessionId: string): Promise<{ sshClient: Client; channel: ClientChannel; logData: string; connectionName: string; originalConnectionId: string; } | null> {
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session || session.backendSshStatus !== 'hanging') {
      console.warn(`[用户: ${userId}] 尝试恢复的会话 ${suspendSessionId} 不存在或状态不正确 (${session?.backendSshStatus})。`);
      return null;
    }

    // 停止监听旧通道事件
    this.removeChannelListeners(session.channel, session.sshClient);

    const logData = await this.logStorageService.readLog(suspendSessionId);
    
    // 在从 userSessions 删除会话之前，保存需要返回的会话详细信息
    const { sshClient, channel, connectionName, connectionId: originalConnectionId } = session;

    userSessions.delete(suspendSessionId);
    await this.logStorageService.deleteLog(suspendSessionId);

    console.log(`[用户: ${userId}] 挂起会话 ${suspendSessionId} 已成功恢复。`);
    return {
      sshClient,
      channel,
      logData,
      connectionName,
      originalConnectionId
    };
  }

  /**
   * 终止一个活跃的挂起会话。
   * @param userId 用户ID。
   * @param suspendSessionId 要终止的挂起会话ID。
   * @returns Promise<boolean> 操作是否成功。
   */
  async terminateSuspendedSession(userId: number, suspendSessionId: string): Promise<boolean> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session || session.backendSshStatus !== 'hanging') {
      console.warn(`[用户: ${userId}] 尝试终止的会话 ${suspendSessionId} 不存在或不是活跃状态 (${session?.backendSshStatus})。`);
      // 如果会话已断开，但记录还在，也应该能被“终止”（即移除）
      if(session && session.backendSshStatus === 'disconnected_by_backend'){
        userSessions.delete(suspendSessionId);
        await this.logStorageService.deleteLog(suspendSessionId);
        console.log(`[用户: ${userId}] 已断开的挂起会话条目 ${suspendSessionId} 已通过终止操作移除。`);
        return true;
      }
      return false;
    }

    this.removeChannelListeners(session.channel, session.sshClient);

    try {
      session.channel.close(); // 尝试优雅关闭
    } catch (e) {
      console.warn(`[用户: ${userId}, 会话: ${suspendSessionId}] 关闭channel时出错:`, e);
    }
    try {
      session.sshClient.end(); // 尝试优雅关闭
    } catch (e) {
      console.warn(`[用户: ${userId}, 会话: ${suspendSessionId}] 关闭sshClient时出错:`, e);
    }
    
    userSessions.delete(suspendSessionId);
    await this.logStorageService.deleteLog(suspendSessionId);

    console.log(`[用户: ${userId}] 活跃的挂起会话 ${suspendSessionId} 已成功终止并移除。`);
    return true;
  }

  /**
   * 移除一个已断开的挂起会话条目。
   * @param userId 用户ID。
   * @param suspendSessionId 要移除的挂起会话ID。
   * @returns Promise<boolean> 操作是否成功。
   */
  async removeDisconnectedSessionEntry(userId: number, suspendSessionId: string): Promise<boolean> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (session && session.backendSshStatus === 'hanging') {
      console.warn(`[用户: ${userId}] 尝试移除的会话 ${suspendSessionId} 仍处于活跃状态，请先终止。`);
      return false; // 不允许直接移除活跃会话，应先终止
    }

    // 如果会话在内存中（不论状态），则删除
    if (session) {
      userSessions.delete(suspendSessionId);
    }
    
    // 总是尝试删除日志文件，因为它可能对应一个已不在内存中的断开会话
    try {
      await this.logStorageService.deleteLog(suspendSessionId);
      console.log(`[用户: ${userId}] 已断开的挂起会话条目 ${suspendSessionId} 的日志已删除 (内存中状态: ${session ? session.backendSshStatus : '不在内存'})。`);
      return true;
    } catch (error) {
      console.error(`[用户: ${userId}] 删除会话 ${suspendSessionId} 的日志文件失败:`, error);
      // 即便日志删除失败，如果内存条目已删，也算部分成功。但严格来说应返回false。
      // 如果 session 不在内存中，但日志删除成功，也算成功。
      return false; 
    }
  }

  /**
   * 编辑挂起会话的自定义名称。
   * 目前仅更新内存中的名称。
   * @param userId 用户ID。
   * @param suspendSessionId 挂起会话ID。
   * @param newCustomName 新的自定义名称。
   * @returns Promise<boolean> 操作是否成功。
   */
  async editSuspendedSessionName(userId: number, suspendSessionId: string, newCustomName: string): Promise<boolean> { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (!session) {
      console.warn(`[用户: ${userId}] 尝试编辑名称的会话 ${suspendSessionId} 不存在。`);
      return false;
    }

    session.customSuspendName = newCustomName;
    console.log(`[用户: ${userId}] 挂起会话 ${suspendSessionId} 的自定义名称已更新为: ${newCustomName}`);
    // TODO: 如果设计要求将自定义名称持久化到日志文件的元数据部分，
    // 此处需要添加更新日志文件的逻辑。这可能涉及读取、修改元数据、然后重写文件。
    return true;
  }

  /**
   * 处理特定会话的 SSH 连接意外断开。
   * 此方法主要由内部事件监听器调用。
   * @param userId 用户ID。
   * @param suspendSessionId 发生断开的会话ID。
   */
  public handleUnexpectedDisconnection(userId: number, suspendSessionId: string): void { // userId: string -> number
    const userSessions = this.getUserSessions(userId);
    const session = userSessions.get(suspendSessionId);

    if (session && session.backendSshStatus === 'hanging') {
      const reason = 'Unexpected disconnection handled by SshSuspendService.';
      session.backendSshStatus = 'disconnected_by_backend';
      session.disconnectionTimestamp = new Date().toISOString();
      this.removeChannelListeners(session.channel, session.sshClient); // 移除监听器
      console.log(`[用户: ${userId}] 会话 ${suspendSessionId} 状态更新为 'disconnected_by_backend'。原因: ${reason}`);
      
      this.emit('sessionAutoTerminated', {
        userId: session.userId,
        suspendSessionId,
        reason
      });
      // 确保所有已缓冲的日志已尝试写入 (通常由 'data' 事件处理，这里是最终状态确认)
    }
  }
}

// 单例模式导出
export const sshSuspendService = new SshSuspendService();