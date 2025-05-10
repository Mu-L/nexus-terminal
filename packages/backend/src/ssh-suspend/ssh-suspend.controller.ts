import { Request, Response } from 'express';
import { sshSuspendService } from '../services/ssh-suspend.service'; // 导入单例服务
import { SuspendedSessionInfo } from '../types/ssh-suspend.types'; // 导入类型

export class SshSuspendController {
  // private sshSuspendService: SshSuspendService; // 不再需要，直接使用导入的单例

  constructor() {
    // this.sshSuspendService = new SshSuspendService(); // 不再需要实例化
    // 绑定方法到当前实例，以确保 'this' 上下文正确
    this.getSuspendedSshSessions = this.getSuspendedSshSessions.bind(this);
    this.terminateAndRemoveSession = this.terminateAndRemoveSession.bind(this);
    this.removeSessionEntry = this.removeSessionEntry.bind(this);
    this.editSessionNameHttp = this.editSessionNameHttp.bind(this); // 绑定新方法
  }

  public async getSuspendedSshSessions(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.session.userId;

      if (!userId) {
        res.status(401).json({ message: 'Unauthorized. User ID not found in session.' });
        return;
      }
      
      console.log(`[SshSuspendController] getSuspendedSshSessions called for user ID: ${userId}`);

      const sessions: SuspendedSessionInfo[] = await sshSuspendService.listSuspendedSessions(userId);
      res.status(200).json(sessions);
    } catch (error) {
      console.error(`[SshSuspendController] Error fetching suspended SSH sessions for user ID: ${req.session.userId}:`, error);
      if (error instanceof Error) {
        res.status(500).json({ message: 'Failed to fetch suspended SSH sessions', error: error.message });
      } else {
        res.status(500).json({ message: 'Failed to fetch suspended SSH sessions', error: 'Unknown error' });
      }
    }
  } // Closes getSuspendedSshSessions

  public async terminateAndRemoveSession(req: Request, res: Response): Promise<void> {
      try {
        const userId = req.session.userId;
        const { suspendSessionId } = req.params;
  
        if (!userId) {
          res.status(401).json({ message: 'Unauthorized. User ID not found in session.' });
          return;
        }
        if (!suspendSessionId) {
          res.status(400).json({ message: 'Bad Request. suspendSessionId parameter is missing.' });
          return;
        }
        
        console.log(`[SshSuspendController] terminateAndRemoveSession called for user ID: ${userId}, suspendSessionId: ${suspendSessionId}`);
  
        const success = await sshSuspendService.terminateSuspendedSession(userId, suspendSessionId);
        if (success) {
          res.status(200).json({ message: `Suspended session ${suspendSessionId} terminated and removed successfully.` });
        } else {
          // The service logs warnings for non-existent or wrong state sessions,
          // which might be a 404 or a 409 depending on the exact cause.
          // For simplicity, returning 404 if not successful, assuming it means "not found or not in correct state to terminate".
          res.status(404).json({ message: `Failed to terminate and remove session ${suspendSessionId}. It might not exist or not be in a 'hanging' state.` });
        }
      } catch (error) {
        console.error(`[SshSuspendController] Error terminating session for user ID: ${req.session.userId}, suspendSessionId: ${req.params.suspendSessionId}:`, error);
        if (error instanceof Error) {
          res.status(500).json({ message: 'Failed to terminate suspended session', error: error.message });
        } else {
          res.status(500).json({ message: 'Failed to terminate suspended session', error: 'Unknown error' });
        }
      }
    }
  
  public async removeSessionEntry(req: Request, res: Response): Promise<void> {
      try {
        const userId = req.session.userId;
        const { suspendSessionId } = req.params;
  
        if (!userId) {
          res.status(401).json({ message: 'Unauthorized. User ID not found in session.' });
          return;
        }
        if (!suspendSessionId) {
          res.status(400).json({ message: 'Bad Request. suspendSessionId parameter is missing.' });
          return;
        }
  
        console.log(`[SshSuspendController] removeSessionEntry called for user ID: ${userId}, suspendSessionId: ${suspendSessionId}`);
        
        const success = await sshSuspendService.removeDisconnectedSessionEntry(userId, suspendSessionId);
        if (success) {
          res.status(200).json({ message: `Suspended session entry ${suspendSessionId} removed successfully.` });
        } else {
          // Similar to terminate, if not successful, it might be due to various reasons logged by the service.
          // Returning 404 if not successful, assuming it means "not found or not in correct state to remove".
          res.status(404).json({ message: `Failed to remove session entry ${suspendSessionId}. It might not exist or was still 'hanging'.` });
        }
      } catch (error) {
        console.error(`[SshSuspendController] Error removing session entry for user ID: ${req.session.userId}, suspendSessionId: ${req.params.suspendSessionId}:`, error);
        if (error instanceof Error) {
          res.status(500).json({ message: 'Failed to remove suspended session entry', error: error.message });
        } else {
          res.status(500).json({ message: 'Failed to remove suspended session entry', error: 'Unknown error' });
        }
      }
    }

  public async editSessionNameHttp(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.session.userId;
      const { suspendSessionId } = req.params;
      const { customName } = req.body; // 从请求体获取新名称

      if (!userId) {
        res.status(401).json({ message: 'Unauthorized. User ID not found in session.' });
        return;
      }
      if (!suspendSessionId) {
        res.status(400).json({ message: 'Bad Request. suspendSessionId parameter is missing.' });
        return;
      }
      if (typeof customName !== 'string') { // 验证 customName
        res.status(400).json({ message: 'Bad Request. customName must be a string and is missing or invalid.' });
        return;
      }

      console.log(`[SshSuspendController] editSessionNameHttp called for user ID: ${userId}, suspendSessionId: ${suspendSessionId}, newName: "${customName}"`);

      const success = await sshSuspendService.editSuspendedSessionName(userId, suspendSessionId, customName);
      if (success) {
        res.status(200).json({ message: `Suspended session ${suspendSessionId} name updated to "${customName}".`, customName });
      } else {
        // 假设服务层在找不到会话时返回 false
        res.status(404).json({ message: `Failed to update name for session ${suspendSessionId}. It might not exist.` });
      }
    } catch (error) {
      console.error(`[SshSuspendController] Error editing session name for user ID: ${req.session.userId}, suspendSessionId: ${req.params.suspendSessionId}:`, error);
      if (error instanceof Error) {
        res.status(500).json({ message: 'Failed to edit suspended session name', error: error.message });
      } else {
        res.status(500).json({ message: 'Failed to edit suspended session name', error: 'Unknown error' });
      }
    }
  }
}