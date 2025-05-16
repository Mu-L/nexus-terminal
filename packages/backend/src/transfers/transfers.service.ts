import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid'; // 用于生成唯一ID
import { InitiateTransferPayload, TransferTask, TransferSubTask } from './transfers.types';
import { getConnectionWithDecryptedCredentials } from '../services/connection.service';
import type { ConnectionWithTags } from '../types/connection.types';
// import { logger } from '../utils/logger'; // 假设的日志工具路径

export class TransfersService {
  private transferTasks: Map<string, TransferTask> = new Map();

  constructor() {
    console.info('[TransfersService] Initialized.');
  }

  public async initiateNewTransfer(payload: InitiateTransferPayload, userId: string | number): Promise<TransferTask> {
    const taskId = uuidv4();
    const now = new Date();
    const subTasks: TransferSubTask[] = [];

    for (const connectionId of payload.connectionIds) {
      for (const item of payload.sourceItems) {
        const subTaskId = uuidv4();
        subTasks.push({
          subTaskId,
          connectionId,
          sourceItemName: item.name,
          status: 'queued',
          startTime: now,
        });
      }
    }

    const newTask: TransferTask = {
      taskId,
      status: 'queued',
      userId, // 添加 userId
      createdAt: now,
      updatedAt: now,
      subTasks,
      payload,
    };

    this.transferTasks.set(taskId, newTask);
    console.info(`[TransfersService] New transfer task created: ${taskId} with ${subTasks.length} sub-tasks.`);

    // 异步启动传输，不阻塞当前请求
    this.processTransferTask(taskId).catch(error => {
        console.error(`[TransfersService] Error processing task ${taskId} in background:`, error);
        // 可能需要更新父任务状态为 failed
        this.updateOverallTaskStatus(taskId, 'failed', `Background processing error: ${error.message}`);
    });

    return { ...newTask }; // 返回任务的副本
  }

  private async processTransferTask(taskId: string): Promise<void> {
    const task = this.transferTasks.get(taskId);
    if (!task) {
      console.error(`[TransfersService] Task ${taskId} not found for processing.`);
      return;
    }

    this.updateOverallTaskStatus(taskId, 'in-progress');

    for (const subTask of task.subTasks) {
      let tempKeyPath: string | undefined;
      try {
        this.updateSubTaskStatus(taskId, subTask.subTaskId, 'connecting');
        const connectionResult = await getConnectionWithDecryptedCredentials(subTask.connectionId);

        if (!connectionResult || !connectionResult.connection) {
          this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, `Connection with ID ${subTask.connectionId} not found or inaccessible.`);
          continue;
        }
        const { connection, decryptedPassword, decryptedPrivateKey, decryptedPassphrase } = connectionResult;

        if (connection.auth_method === 'key' && decryptedPrivateKey) {
          try {
            const tempDir = os.tmpdir();
            const randomFileName = `nexus_tmp_key_${crypto.randomBytes(6).toString('hex')}`;
            tempKeyPath = path.join(tempDir, randomFileName);
            await fs.promises.writeFile(tempKeyPath, decryptedPrivateKey, { mode: 0o600 });
            console.info(`[TransfersService] Temporary private key created at ${tempKeyPath} for sub-task ${subTask.subTaskId}`);
          } catch (keyError: any) {
            console.error(`[TransfersService] Failed to prepare private key for sub-task ${subTask.subTaskId}:`, keyError);
            this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, `Failed to prepare private key: ${keyError.message}`);
            if (tempKeyPath) {
              try { await fs.promises.unlink(tempKeyPath); } catch (e) { console.error(`[TransfersService] Error cleaning up partially created temp key ${tempKeyPath}:`, e); }
            }
            tempKeyPath = undefined;
            continue;
          }
        }

        const sourceItem = task.payload.sourceItems.find(s => s.name === subTask.sourceItemName);
        if (!sourceItem) {
          this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, `Source item ${subTask.sourceItemName} not found in payload.`);
          // No 'continue' here, let finally block handle tempKeyPath cleanup if it was created
          // However, if sourceItem is not found, we should not proceed with transfer commands.
          // The 'continue' implies we might have created a temp key that needs cleanup *before* continuing.
          // So, cleanup and continue pattern is better.
          if (tempKeyPath) {
             try { await fs.promises.unlink(tempKeyPath); console.info(`[TransfersService] Temporary private key ${tempKeyPath} deleted after source item not found.`);}
             catch (e) { console.error(`[TransfersService] Error cleaning temp key ${tempKeyPath} after source item not found:`, e); }
             tempKeyPath = undefined; // Ensure it is not used/cleaned again in finally
          }
          continue;
        }
        
        const determinedMethod = await this.determineTransferCommand(
            connection,
            task.payload.transferMethod,
            connection.host,
            tempKeyPath, // Pass tempKeyPath (which is undefined if not key auth or error)
            decryptedPassphrase
        );
        this.updateSubTaskStatus(taskId, subTask.subTaskId, 'transferring', 0, `Using ${determinedMethod}.`);
        subTask.transferMethodUsed = determinedMethod;

        if (determinedMethod === 'rsync') {
            await this.executeRsync(taskId, subTask.subTaskId, connection, sourceItem.path, task.payload.remoteTargetPath, sourceItem.type === 'directory', decryptedPassword, tempKeyPath, decryptedPassphrase);
        } else { // scp
            await this.executeScp(taskId, subTask.subTaskId, connection, sourceItem.path, task.payload.remoteTargetPath, sourceItem.type === 'directory', decryptedPassword, tempKeyPath, decryptedPassphrase);
        }
      } catch (error: any) {
        console.error(`[TransfersService] Error processing sub-task ${subTask.subTaskId} for task ${taskId}:`, error);
        // Avoid double-updating status if it was already set to failed due to key prep error
        const currentSubTask = task.subTasks.find(st => st.subTaskId === subTask.subTaskId);
        if (currentSubTask && currentSubTask.status !== 'failed') {
            this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, error.message || 'Unknown error during sub-task processing.');
        }
      } finally {
        if (tempKeyPath) {
          try {
            await fs.promises.unlink(tempKeyPath);
            console.info(`[TransfersService] Temporary private key ${tempKeyPath} deleted for sub-task ${subTask.subTaskId}`);
          } catch (cleanupError) {
            console.error(`[TransfersService] Error cleaning up temporary private key ${tempKeyPath} for sub-task ${subTask.subTaskId}:`, cleanupError);
          }
        }
      }
    }
    this.finalizeOverallTaskStatus(taskId);
  }


  public async getTransferTaskDetails(taskId: string, userId: string | number): Promise<TransferTask | null> {
    const task = this.transferTasks.get(taskId);
    console.debug(`[TransfersService] Retrieving details for task: ${taskId} for user: ${userId}`);
    if (task && task.userId === userId) {
      return { ...task };
    }
    if (task && task.userId !== userId) {
        console.warn(`[TransfersService] User ${userId} attempted to access task ${taskId} owned by ${task.userId}.`);
        return null; // Or throw ForbiddenException
    }
    return null;
  }

  public async getAllTransferTasks(userId: string | number): Promise<TransferTask[]> {
    console.debug(`[TransfersService] Retrieving all transfer tasks for user: ${userId}.`);
    return Array.from(this.transferTasks.values())
      .filter(task => task.userId === userId)
      .map(task => ({ ...task }));
  }

  public updateSubTaskStatus(
    taskId: string,
    subTaskId: string,
    newStatus: TransferSubTask['status'],
    progress?: number,
    message?: string
  ): void {
    const task = this.transferTasks.get(taskId);
    if (task) {
      const subTask = task.subTasks.find(st => st.subTaskId === subTaskId);
      if (subTask) {
        subTask.status = newStatus;
        if (progress !== undefined) subTask.progress = progress;
        if (message !== undefined) subTask.message = message;
        if (newStatus === 'completed' || newStatus === 'failed') {
            subTask.endTime = new Date();
        }
        task.updatedAt = new Date();
        // 可能需要根据子任务状态更新父任务状态和进度
        this.updateOverallTaskStatusBasedOnSubTasks(taskId);
        console.info(`[TransfersService] Sub-task ${subTaskId} for task ${taskId} updated: ${newStatus}, progress: ${progress}%, message: ${message}`);
      } else {
        console.warn(`[TransfersService] Sub-task ${subTaskId} not found for task ${taskId} during status update.`);
      }
    } else {
      console.warn(`[TransfersService] Task ${taskId} not found during sub-task status update.`);
    }
  }

  private updateOverallTaskStatus(taskId: string, newStatus: TransferTask['status'], message?: string): void {
    const task = this.transferTasks.get(taskId);
    if (task) {
        task.status = newStatus;
        task.updatedAt = new Date();
        if (message && (newStatus === 'failed' || newStatus === 'partially-completed')) {
            // Append to existing messages or set if none
            task.payload.sourceItems.forEach(item => { // Simplified: maybe a task-level message array
                // task.message = (task.message ? task.message + "; " : "") + message;
            });
        }
        console.info(`[TransfersService] Overall status for task ${taskId} updated to: ${newStatus}`);
    }
  }

  private updateOverallTaskStatusBasedOnSubTasks(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;

    let completedCount = 0;
    let failedCount = 0;
    let totalProgress = 0;
    const activeSubTasks = task.subTasks.filter(st => st.status !== 'queued');


    if (activeSubTasks.length === 0 && task.subTasks.length > 0) {
        // If no subtasks have started processing, keep task as queued or in-progress if already set
        if (task.status === 'queued') return;
    }


    task.subTasks.forEach(st => {
      if (st.status === 'completed') {
        completedCount++;
        totalProgress += 100;
      } else if (st.status === 'failed') {
        failedCount++;
        // Failed tasks contribute 0 to progress for simplicity, or 100 if considering them "done"
      } else if (st.status === 'transferring' && st.progress !== undefined) {
        totalProgress += st.progress;
      }
      // 'queued' and 'connecting' don't add to progress here
    });

    if (task.subTasks.length > 0) {
      task.overallProgress = Math.round(totalProgress / task.subTasks.length);
    } else {
      task.overallProgress = 0;
    }

    if (failedCount === task.subTasks.length && task.subTasks.length > 0) {
      task.status = 'failed';
    } else if (completedCount === task.subTasks.length && task.subTasks.length > 0) {
      task.status = 'completed';
    } else if (failedCount > 0 && (failedCount + completedCount) === task.subTasks.length) {
      task.status = 'partially-completed';
    } else if (activeSubTasks.some(st => st.status === 'transferring' || st.status === 'connecting')) {
      task.status = 'in-progress';
    } else if (task.subTasks.every(st => st.status === 'queued')) {
        task.status = 'queued';
    }
    // else, if some are queued and others completed/failed, it might remain 'in-progress' or 'partially-completed'
    // This logic might need refinement based on exact desired behavior for mixed states.

    task.updatedAt = new Date();
    console.debug(`[TransfersService] Task ${taskId} overall progress: ${task.overallProgress}%, status: ${task.status}`);
  }

  private finalizeOverallTaskStatus(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;
    this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Recalculate based on final sub-task states
    console.info(`[TransfersService] Finalized overall status for task ${taskId}: ${task.status}`);
  }


  private async executeRsync(
    taskId: string,
    subTaskId: string,
    connection: ConnectionWithTags,
    sourcePath: string,
    remoteBaseDestPath: string,
    isDir: boolean,
    decryptedPassword?: string,
    privateKeyPath?: string, // Changed from decryptedPrivateKey
    decryptedPassphrase?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { host, username, port, auth_method } = connection;
      const remoteDest = `${username}@${host}:${remoteBaseDestPath.endsWith('/') ? remoteBaseDestPath : remoteBaseDestPath + '/'}`;
      
      let sshCommand = `ssh -p ${port || 22}`;
      if (auth_method === 'key' && privateKeyPath) {
        sshCommand += ` -i "${privateKeyPath}"`; // Use the provided temporary key path
      }

      const rsyncArgs = [
        '-avz',
        '--progress',
        '-e',
        sshCommand,
      ];

      if (isDir && !sourcePath.endsWith('/')) {
        sourcePath += '/';
      }
      rsyncArgs.push(sourcePath);
      rsyncArgs.push(remoteDest);

      console.info(`[TransfersService] Executing rsync for sub-task ${subTaskId}: rsync ${rsyncArgs.join(' ')}`);
      
      let command = 'rsync';
      let finalArgs = rsyncArgs.filter(arg => arg); // Ensure no empty strings if sshCommand parts were conditional

      // Logic for sshpass with password auth remains as a comment/TODO, as per original
      if (auth_method === 'password' && decryptedPassword) {
          console.warn(`[TransfersService] Rsync with password authentication. Consider using sshpass if direct password input is needed and rsync/ssh doesn't prompt. Sub-task ${subTaskId} might fail if not configured for passwordless sudo or if sshpass is not used correctly.`);
          // Example for sshpass (requires sshpass to be installed):
          // command = 'sshpass';
          // finalArgs = ['-p', decryptedPassword, 'rsync', ...rsyncArgs.filter(arg => arg)];
      } else if (auth_method === 'key' && privateKeyPath && decryptedPassphrase) {
        // If key (now a file path) has a passphrase, ssh itself will prompt or use ssh-agent.
        // sshpass could be used here if ssh-agent is not an option and no TTY for prompt.
        // console.warn(`[TransfersService] Rsync with passphrase-protected key. Ensure ssh-agent is configured or use sshpass if direct passphrase input is needed.`);
      }

      const process = spawn(command, finalArgs);

      let stdoutData = '';
      let stderrData = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdoutData += output;
        const progressMatch = output.match(/(\d+)%/);
        if (progressMatch && progressMatch[1]) {
          this.updateSubTaskStatus(taskId, subTaskId, 'transferring', parseInt(progressMatch[1], 10));
        }
        console.debug(`[TransfersService] Rsync STDOUT (sub-task ${subTaskId}): ${output.trim()}`);
      });

      process.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.warn(`[TransfersService] Rsync STDERR (sub-task ${subTaskId}): ${data.toString().trim()}`);
      });

      process.on('close', (code) => {
        if (code === 0) {
          this.updateSubTaskStatus(taskId, subTaskId, 'completed', 100, 'Rsync transfer successful.');
          console.info(`[TransfersService] Rsync completed successfully for sub-task ${subTaskId}.`);
          resolve();
        } else {
          const errorMessage = `Rsync failed with code ${code}. STDERR: ${stderrData.trim()} STDOUT: ${stdoutData.trim()}`;
          this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMessage);
          console.error(`[TransfersService] Rsync failed for sub-task ${subTaskId}. Code: ${code}. Error: ${errorMessage}`);
          reject(new Error(errorMessage));
        }
      });

      process.on('error', (err) => {
        const errorMessage = `Rsync process error: ${err.message}`;
        this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMessage);
        console.error(`[TransfersService] Rsync process error for sub-task ${subTaskId}:`, err);
        reject(err);
      });
    });
  }

  private async executeScp(
    taskId: string,
    subTaskId: string,
    connection: ConnectionWithTags,
    sourcePath: string,
    remoteBaseDestPath: string,
    isDir: boolean,
    decryptedPassword?: string,
    privateKeyPath?: string, // Changed from decryptedPrivateKey
    decryptedPassphrase?: string
  ): Promise<void> {
      const { host, username, port, auth_method } = connection;
      // Source is on the remote server identified by 'connection'
      const remoteSourceIdentifier = `${username}@${host}:${sourcePath}`;
      
      // Destination is local to the backend server.
      // remoteBaseDestPath from payload is the local directory to save to.
      const sourceFileName = path.basename(sourcePath);
      // Ensure remoteBaseDestPath is treated as a directory for path.join
      const localTargetDirectory = remoteBaseDestPath.endsWith(path.sep) ? remoteBaseDestPath : path.join(remoteBaseDestPath, path.sep);
      const localTargetFullPath = path.join(localTargetDirectory, sourceFileName);

      try {
        await fs.promises.mkdir(localTargetDirectory, { recursive: true });
        console.info(`[TransfersService] Ensured local destination directory exists: ${localTargetDirectory}`);
      } catch (mkdirError: any) {
        const errorMessage = `Failed to create local destination directory ${localTargetDirectory}: ${mkdirError.message}`;
        console.error(`[TransfersService] ${errorMessage}`);
        this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMessage);
        // Return a rejected promise directly, as the function is async
        return Promise.reject(new Error(errorMessage));
      }

      return new Promise((resolve, reject) => {
        const scpArgs = [];
      if (port) scpArgs.push('-P', port.toString());
      if (auth_method === 'key' && privateKeyPath) {
        scpArgs.push('-i', privateKeyPath); // Use the provided temporary key path
      }
      if (isDir) { // If the remote source is a directory, use -r
        scpArgs.push('-r');
      }

      scpArgs.push(remoteSourceIdentifier); // Remote source
      scpArgs.push(localTargetFullPath);    // Local destination

      console.info(`[TransfersService] Executing SCP for sub-task ${subTaskId}: scp ${scpArgs.join(' ')}`);
      
      let command = 'scp';
      let finalArgs = [...scpArgs];

      // Logic for sshpass with password auth remains as a comment/TODO, as per original
      if (auth_method === 'password' && decryptedPassword) {
          console.warn(`[TransfersService] SCP with password authentication. Consider using sshpass. Sub-task ${subTaskId} might fail if not configured for passwordless sudo or if sshpass is not used correctly.`);
          // Example with sshpass (requires sshpass to be installed):
          // command = 'sshpass';
          // finalArgs = ['-p', decryptedPassword, 'scp', ...scpArgs];
      } else if (auth_method === 'key' && privateKeyPath && decryptedPassphrase) {
        // If key (now a file path) has a passphrase, scp/ssh itself will prompt or use ssh-agent.
        // console.warn(`[TransfersService] SCP with passphrase-protected key. Ensure ssh-agent is configured or use sshpass if direct passphrase input is needed.`);
      }
      
      const process = spawn(command, finalArgs);
      let stderrData = '';
      let stdoutData = '';

      process.stdout.on('data', (data) => {
        stdoutData += data.toString();
        console.debug(`[TransfersService] SCP STDOUT (sub-task ${subTaskId}): ${data.toString().trim()}`);
        this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 50, 'SCP transfer in progress.');
      });

      process.stderr.on('data', (data) => {
        stderrData += data.toString();
        console.warn(`[TransfersService] SCP STDERR (sub-task ${subTaskId}): ${data.toString().trim()}`);
      });

      process.on('close', (code) => {
        if (code === 0) {
          this.updateSubTaskStatus(taskId, subTaskId, 'completed', 100, 'SCP transfer successful.');
          console.info(`[TransfersService] SCP completed successfully for sub-task ${subTaskId}.`);
          resolve();
        } else {
          const errorMessage = `SCP failed with code ${code}. STDERR: ${stderrData.trim()} STDOUT: ${stdoutData.trim()}`;
          this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMessage);
          console.error(`[TransfersService] SCP failed for sub-task ${subTaskId}. Code: ${code}. Error: ${errorMessage}`);
          reject(new Error(errorMessage));
        }
      });

      process.on('error', (err) => {
        const errorMessage = `SCP process error: ${err.message}`;
        this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMessage);
        console.error(`[TransfersService] SCP process error for sub-task ${subTaskId}:`, err);
        reject(err);
      });
    });
  }

  private async determineTransferCommand(
    connection: ConnectionWithTags,
    method: 'auto' | 'rsync' | 'scp',
    remoteHost: string,
    privateKeyPath?: string, // Changed from decryptedPrivateKey
    decryptedPassphrase?: string
  ): Promise<'rsync' | 'scp'> {
    if (method === 'rsync') return 'rsync';
    if (method === 'scp') return 'scp';

    if (method === 'auto') {
      console.info(`[TransfersService] Auto-detecting rsync capability on ${remoteHost}`);
      return new Promise((resolve) => {
        const { username, port, auth_method } = connection;
        const sshArgs = [];
        if (port) sshArgs.push('-p', port.toString());
        
        if (auth_method === 'key' && privateKeyPath) {
          sshArgs.push('-i', privateKeyPath); // Use the provided temporary key path
          // If privateKeyPath (a file) is passphrase protected, ssh will handle it (prompt or agent)
          // For detection, we hope it works without interactive passphrase entry if agent is not set up.
        }
        // Password auth detection remains best-effort as ssh won't take password directly for a command.

        const filteredSshArgs = sshArgs.filter(arg => !['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'].includes(arg));

        const commandToRun = 'command -v rsync';
        const fullSshCommand = [...filteredSshArgs, `${username}@${remoteHost}`, commandToRun];
        
        console.debug(`[TransfersService] Executing SSH for rsync check: ssh ${fullSshCommand.join(' ')}`);

        const process = spawn('ssh', fullSshCommand);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => stdout += data.toString());
        process.stderr.on('data', (data) => stderr += data.toString());

        const timeoutDuration = 5000; // 5 seconds
        const timeoutId = setTimeout(() => {
            if (!process.killed) {
                process.kill();
                console.warn(`[TransfersService] Rsync detection on ${remoteHost} timed out after ${timeoutDuration}ms. Falling back to SCP.`);
                resolve('scp');
            }
        }, timeoutDuration);

        process.on('close', (code) => {
          clearTimeout(timeoutId);
          if (code === 0 && stdout.trim() !== '') {
            console.info(`[TransfersService] Rsync detected on ${remoteHost}. Path: ${stdout.trim()}`);
            resolve('rsync');
          } else {
            console.warn(`[TransfersService] Rsync not detected on ${remoteHost} (exit code ${code}, stderr: ${stderr.trim()}). Falling back to SCP.`);
            resolve('scp');
          }
        });

        process.on('error', (err) => {
          clearTimeout(timeoutId);
          console.error(`[TransfersService] Error trying to detect rsync on ${remoteHost}: ${err.message}. Falling back to SCP.`);
          resolve('scp');
        });
      });
    }
    return 'scp'; // Default fallback
  }
}