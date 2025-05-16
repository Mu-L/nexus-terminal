import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid'; // 用于生成唯一ID
import { Client, ConnectConfig, SFTPWrapper } from 'ssh2';
import { InitiateTransferPayload, TransferTask, TransferSubTask } from './transfers.types';
import { getConnectionWithDecryptedCredentials } from '../services/connection.service';
import type { ConnectionWithTags, DecryptedConnectionCredentials } from '../types/connection.types';
// import { logger } from '../utils/logger'; // 假设的日志工具路径

export class TransfersService {
  private transferTasks: Map<string, TransferTask> = new Map();
  private readonly TEMP_KEY_PREFIX = 'nexus_target_key_';

  constructor() {
    console.info('[TransfersService] Initialized.');
  }

  public async initiateNewTransfer(payload: InitiateTransferPayload, userId: string | number): Promise<TransferTask> {
    const taskId = uuidv4();
    const now = new Date();
    const subTasks: TransferSubTask[] = [];

    // 每个 (目标服务器, 源文件) 组合都是一个子任务
    for (const connectionId of payload.connectionIds) { // 目标服务器ID列表
      for (const item of payload.sourceItems) { // 源服务器上的文件/目录列表
        const subTaskId = uuidv4();
        subTasks.push({
          subTaskId,
          connectionId, // 这是目标服务器的ID
          sourceItemName: item.name, // 源文件的名称，用于标识
          status: 'queued',
          startTime: now,
        });
      }
    }

    const newTask: TransferTask = {
      taskId,
      status: 'queued',
      userId,
      createdAt: now,
      updatedAt: now,
      subTasks,
      payload, // payload 包含 sourceConnectionId
    };

    this.transferTasks.set(taskId, newTask);
    console.info(`[TransfersService] New transfer task created: ${taskId} for source ${payload.sourceConnectionId} with ${subTasks.length} sub-tasks.`);

    // 异步启动传输，不阻塞当前请求
    this.processTransferTask(taskId).catch(error => {
        console.error(`[TransfersService] Error processing task ${taskId} in background:`, error);
        this.updateOverallTaskStatus(taskId, 'failed', `Background processing error: ${error.message}`);
    });

    return { ...newTask }; // 返回任务的副本
  }

  private buildSshConnectConfig(
    connectionInfo: ConnectionWithTags,
    credentials: DecryptedConnectionCredentials
  ): ConnectConfig {
    const config: ConnectConfig = {
      host: connectionInfo.host,
      port: connectionInfo.port || 22,
      username: connectionInfo.username,
      readyTimeout: 20000, // 20 seconds
      keepaliveInterval: 10000, // 10 seconds
    };
    if (connectionInfo.auth_method === 'password' && credentials.decryptedPassword) {
      config.password = credentials.decryptedPassword;
    } else if (connectionInfo.auth_method === 'key' && credentials.decryptedPrivateKey) {
      config.privateKey = credentials.decryptedPrivateKey;
      if (credentials.decryptedPassphrase) {
        config.passphrase = credentials.decryptedPassphrase;
      }
    }
    return config;
  }

  private async processTransferTask(taskId: string): Promise<void> {
    const task = this.transferTasks.get(taskId);
    if (!task) {
      console.error(`[TransfersService] Task ${taskId} not found for processing.`);
      return;
    }

    this.updateOverallTaskStatus(taskId, 'in-progress');
    let sourceSshClient: Client | undefined;

    try {
      const sourceConnectionResult = await getConnectionWithDecryptedCredentials(task.payload.sourceConnectionId);
      if (!sourceConnectionResult || !sourceConnectionResult.connection) {
        throw new Error(`Source connection with ID ${task.payload.sourceConnectionId} not found or inaccessible.`);
      }
      const { connection: sourceConnection, ...sourceCredentials } = sourceConnectionResult;

      sourceSshClient = new Client();
      const sourceConnectConfig = this.buildSshConnectConfig(sourceConnection, sourceCredentials);

      await new Promise<void>((resolve, reject) => {
        sourceSshClient!
          .on('ready', () => {
            console.info(`[TransfersService] SSH connection established to source server ${sourceConnection.host} for task ${taskId}.`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[TransfersService] SSH connection error to source server ${sourceConnection.host} for task ${taskId}:`, err);
            reject(err);
          })
          .on('close', () => {
             console.info(`[TransfersService] SSH connection closed to source server ${sourceConnection.host} for task ${taskId}.`);
          })
          .connect(sourceConnectConfig);
      });

      for (const subTask of task.subTasks) {
        const currentSourceItem = task.payload.sourceItems.find(it => it.name === subTask.sourceItemName);
        if (!currentSourceItem) {
          this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, `Source item '${subTask.sourceItemName}' not found in payload.`);
          continue;
        }

        try {
          this.updateSubTaskStatus(taskId, subTask.subTaskId, 'connecting', undefined, `Preparing transfer for ${currentSourceItem.name} to target ID ${subTask.connectionId}`);
          const targetConnectionResult = await getConnectionWithDecryptedCredentials(subTask.connectionId);

          if (!targetConnectionResult || !targetConnectionResult.connection) {
            this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, `Target connection with ID ${subTask.connectionId} not found.`);
            continue;
          }
          const { connection: targetConnection, ...targetCredentials } = targetConnectionResult;

          await this.executeRemoteTransferOnSource(
            taskId,
            subTask.subTaskId,
            sourceSshClient,
            sourceConnection, // For logging/info if needed
            currentSourceItem,
            targetConnection,
            targetCredentials,
            task.payload.remoteTargetPath,
            task.payload.transferMethod
          );
        } catch (subTaskError: any) {
          console.error(`[TransfersService] Error in sub-task ${subTask.subTaskId} (item: ${currentSourceItem.name}):`, subTaskError);
          const subTaskInstance = task.subTasks.find(st => st.subTaskId === subTask.subTaskId);
          if (subTaskInstance && subTaskInstance.status !== 'failed' && subTaskInstance.status !== 'completed') {
             this.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, subTaskError.message || 'Unknown sub-task error.');
          }
        }
      }
    } catch (error: any) {
      console.error(`[TransfersService] Major error processing task ${taskId}:`, error);
      this.updateOverallTaskStatus(taskId, 'failed', error.message || 'Failed to process task due to a major error.');
    } finally {
      if (sourceSshClient) { // No .readable property, just call end()
        sourceSshClient.end();
        console.info(`[TransfersService] SSH connection to source server explicitly closed for task ${taskId}.`);
      }
      this.finalizeOverallTaskStatus(taskId);
    }
  }

  private async checkCommandOnSource(client: Client, command: string): Promise<boolean> {
    return new Promise((resolve) => {
      client.exec(`command -v ${command}`, (err, stream) => {
        if (err) {
          console.warn(`[TransfersService] Error checking for command '${command}' on source:`, err);
          return resolve(false);
        }
        let stdout = '';
        stream
          .on('data', (data: Buffer) => stdout += data.toString())
          .on('close', (code: number) => {
            resolve(code === 0 && stdout.trim() !== '');
          })
          .stderr.on('data', (data: Buffer) => {
            console.warn(`[TransfersService] STDERR checking for command '${command}' on source: ${data.toString()}`);
          });
      });
    });
  }

  private async uploadKeyToSourceViaSftp(client: Client, privateKeyContent: string, remotePath: string): Promise<void> {
    console.error(`[Roo Debug][transfers.service.ts] ENTERING uploadKeyToSourceViaSftp for remotePath: ${remotePath}`);
    const SFTP_UPLOAD_TIMEOUT_MS = 30000; // 30 seconds timeout for SFTP key upload

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;
      let sftpSession: SFTPWrapper | null = null; // To ensure sftp.end() can be called in timeout

      const cleanupAndReject = (errMsg: string, errObj?: any) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (errObj) console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp error: ${errMsg}`, errObj);
        else console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp error: ${errMsg}`);
        sftpSession?.end();
        reject(new Error(errMsg));
      };

      timeoutHandle = setTimeout(() => {
        cleanupAndReject(`SFTP upload to ${remotePath} timed out after ${SFTP_UPLOAD_TIMEOUT_MS / 1000}s.`);
      }, SFTP_UPLOAD_TIMEOUT_MS);

      console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: Calling client.sftp(). Timeout set for ${SFTP_UPLOAD_TIMEOUT_MS}ms.`);
      client.sftp((err, sftp) => {
        sftpSession = sftp; // Store session for potential cleanup
        if (err) {
          return cleanupAndReject(`SFTP session error for key upload: ${err.message}`, err);
        }
        if (!sftp) {
          return cleanupAndReject(`SFTP session error: SFTP object is null.`);
        }
        console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: client.sftp() CALLBACK success. SFTP session obtained. Creating write stream to ${remotePath}`);
        const stream = sftp.createWriteStream(remotePath, { mode: 0o600 });
        
        stream.on('error', (writeErr: Error) => {
          cleanupAndReject(`Failed to write key to ${remotePath} on source: ${writeErr.message}`, writeErr);
        });

        // Listen to 'close' instead of 'finish' for more reliability
        stream.on('close', () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: WriteStream ON CLOSE for ${remotePath}. Key upload likely successful.`);
          console.info(`[TransfersService] Private key for target successfully uploaded to source at ${remotePath}`);
          sftp.end();
          resolve();
        });
 
        console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: Previewing privateKeyContent before stream.end(). Length: ${privateKeyContent.length}`);
        console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: Key content START: <<<${privateKeyContent.substring(0, 70)}>>>`);
        console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: Key content END: <<<${privateKeyContent.substring(Math.max(0, privateKeyContent.length - 70))}>>>`);
        console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: Calling stream.end() to write key content.`);
        let keyContentToWrite = privateKeyContent;
        if (!keyContentToWrite.endsWith('\n')) {
          console.error(`[Roo Debug][transfers.service.ts] uploadKeyToSourceViaSftp: privateKeyContent does not end with a newline. Appending one.`);
          keyContentToWrite += '\n';
        }
        stream.end(keyContentToWrite);
      });
    });
  }
 
  private async deleteFileOnSourceViaSftp(client: Client, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(new Error(`SFTP session error for key deletion: ${err.message}`));
        sftp.unlink(remotePath, (unlinkErr) => {
          sftp.end(); // Ensure sftp session is closed
          if (unlinkErr) {
            // Log but don't necessarily reject if file just wasn't there (though it should be)
            console.warn(`[TransfersService] Failed to delete temporary key ${remotePath} from source:`, unlinkErr);
            return reject(new Error(`Failed to delete ${remotePath} from source: ${unlinkErr.message}`));
          }
          console.info(`[TransfersService] Temporary key ${remotePath} deleted from source.`);
          resolve();
        });
      });
    });
  }
  
  private escapeShellArg(arg: string): string {
    // Basic escaping for paths and arguments. More robust escaping might be needed.
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  private buildTransferCommandString(
    sourceItemPathOnA: string, // Absolute path on source A
    isDir: boolean,
    targetConnection: ConnectionWithTags, // Target B connection details
    targetPathOnB: string, // Base remote target path on B
    transferCmd: 'scp' | 'rsync',
    options: { // Options derived from checking source A and target B auth
      sshPassCommand?: string; // e.g., "sshpass -p 'password'"
      sshIdentityFileOption?: string; // e.g., "-i /tmp/key_B_XYZ"
      targetUserAndHost: string; // e.g., "userB@hostB.com"
      sshPortOption?: string; // e.g., "-P 2222" for scp, or part of rsync's -e 'ssh -p 2222'
    }
  ): string {
    const remoteBase = targetPathOnB.endsWith('/') ? targetPathOnB : `${targetPathOnB}/`;
    const remoteFullDest = `${options.targetUserAndHost}:${this.escapeShellArg(remoteBase)}`; // SCP/Rsync will append filename if source is file

    let commandParts: string[] = [];
    if (options.sshPassCommand) {
      commandParts.push(options.sshPassCommand);
    }

    if (transferCmd === 'rsync') {
      commandParts.push('rsync -avz --progress');
      let sshArgsForRsync = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      if (options.sshPortOption && options.sshPortOption.startsWith('-p')) { // for rsync -e "ssh -p XXX"
         sshArgsForRsync += ` ${options.sshPortOption}`;
      }
      if (options.sshIdentityFileOption) {
        sshArgsForRsync += ` ${options.sshIdentityFileOption}`;
      }
      commandParts.push(`-e "${sshArgsForRsync.trim()}"`);
      
      let rsyncSourcePath = this.escapeShellArg(sourceItemPathOnA);
      if (isDir && !rsyncSourcePath.endsWith('/\'')) { // if escaped and ends with /'
        rsyncSourcePath = rsyncSourcePath.slice(0, -1) + '/\''; // Add trailing slash for rsync dir content copy
      }
      commandParts.push(rsyncSourcePath);
      commandParts.push(remoteFullDest);

    } else { // scp
      commandParts.push('scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null');
      if (isDir) commandParts.push('-r');
      if (options.sshPortOption && options.sshPortOption.startsWith('-P')) { // for scp -P XXX
         commandParts.push(options.sshPortOption);
      }
      if (options.sshIdentityFileOption) {
        commandParts.push(options.sshIdentityFileOption);
      }
      commandParts.push(this.escapeShellArg(sourceItemPathOnA));
      commandParts.push(remoteFullDest);
    }
    return commandParts.join(' ');
  }

  private async executeRemoteTransferOnSource(
    taskId: string,
    subTaskId: string,
    sourceSshClient: Client,
    sourceConnectionForInfo: ConnectionWithTags, // unused, but good for context if needed
    sourceItem: { name: string; path: string; type: 'file' | 'directory' },
    targetConnection: ConnectionWithTags,
    targetCredentials: DecryptedConnectionCredentials,
    remoteTargetPathOnTarget: string, // This is the base directory on target
    transferMethodPreference: 'auto' | 'rsync' | 'scp'
  ): Promise<void> {
    console.error(`[Roo Debug][transfers.service.ts] ENTERING executeRemoteTransferOnSource for sub-task ${subTaskId}, item: ${sourceItem.name}`);
    this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 0, `Initializing remote transfer for ${sourceItem.name}`);
    let tempTargetKeyPathOnSource: string | undefined; // Path of target's private key if temporarily on source A
 
    try {
      console.error(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Starting try block in executeRemoteTransferOnSource.`);
      const sshpassAvailableOnSource = await this.checkCommandOnSource(sourceSshClient, 'sshpass');
      const rsyncAvailableOnSource = await this.checkCommandOnSource(sourceSshClient, 'rsync');

      let determinedTransferCmd: 'scp' | 'rsync' = 'scp'; // Default to scp
      if (transferMethodPreference === 'rsync' && rsyncAvailableOnSource) {
        determinedTransferCmd = 'rsync';
      } else if (transferMethodPreference === 'rsync' && !rsyncAvailableOnSource) {
         this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, `Rsync preferred but not available on source server. Sub-task for ${sourceItem.name} failed.`);
         throw new Error('Rsync preferred but not available on source server.');
      } else if (transferMethodPreference === 'auto') {
        determinedTransferCmd = rsyncAvailableOnSource ? 'rsync' : 'scp';
      }
      this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 5, `Using ${determinedTransferCmd}. Source SSHPass: ${sshpassAvailableOnSource}, Rsync: ${rsyncAvailableOnSource}`);
      const subTaskToUpdate = this.transferTasks.get(taskId)?.subTasks.find(st => st.subTaskId === subTaskId);
      if (subTaskToUpdate) subTaskToUpdate.transferMethodUsed = determinedTransferCmd;


      const cmdOptions: any = {
        targetUserAndHost: `${targetConnection.username}@${targetConnection.host}`,
        sshPortOption: targetConnection.port ? (determinedTransferCmd === 'scp' ? `-P ${targetConnection.port}`: `-p ${targetConnection.port}`) : undefined,
      };

      if (targetConnection.auth_method === 'key' && targetCredentials.decryptedPrivateKey) {
        const randomSuffix = crypto.randomBytes(6).toString('hex');
        tempTargetKeyPathOnSource = path.posix.join('/tmp', `${this.TEMP_KEY_PREFIX}${randomSuffix}`); // Use posix path for remote systems

        console.error(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: BEFORE calling uploadKeyToSourceViaSftp for target key path: ${tempTargetKeyPathOnSource}`);
        await this.uploadKeyToSourceViaSftp(sourceSshClient, targetCredentials.decryptedPrivateKey, tempTargetKeyPathOnSource);
        console.error(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: AFTER calling uploadKeyToSourceViaSftp.`);
        cmdOptions.sshIdentityFileOption = `-i ${this.escapeShellArg(tempTargetKeyPathOnSource)}`;
 
        if (targetCredentials.decryptedPassphrase) {
          if (sshpassAvailableOnSource) {
            cmdOptions.sshPassCommand = `sshpass -p ${this.escapeShellArg(targetCredentials.decryptedPassphrase)}`;
          } else {
            const msg = `Target key has passphrase, but sshpass is not available on source server for ${sourceItem.name}.`;
            this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, msg);
            throw new Error(msg);
          }
        }
      } else if (targetConnection.auth_method === 'password' && targetCredentials.decryptedPassword) {
        if (sshpassAvailableOnSource) {
          cmdOptions.sshPassCommand = `sshpass -p ${this.escapeShellArg(targetCredentials.decryptedPassword)}`;
        } else {
          const msg = `Target uses password auth, but sshpass is not available on source server for ${sourceItem.name}.`;
          this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, msg);
          throw new Error(msg);
        }
      } else if (targetConnection.auth_method === 'key' && !targetCredentials.decryptedPrivateKey) {
          const msg = `Target connection ${targetConnection.name} is key-based but no private key found. Sub-task for ${sourceItem.name} failed.`;
          this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, msg);
          throw new Error(msg);
      }


      const commandToExecute = this.buildTransferCommandString(
        sourceItem.path,
        sourceItem.type === 'directory',
        targetConnection,
        remoteTargetPathOnTarget,
        determinedTransferCmd,
        cmdOptions
      );
 
      console.info(`[TransfersService] Executing on source for sub-task ${subTaskId} (item: ${sourceItem.name}): ${commandToExecute}`);
      console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Prepared command: ${commandToExecute}`);
      console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Command options: ${JSON.stringify(cmdOptions)}`);
      this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 10, `Executing: ${determinedTransferCmd} from source to ${targetConnection.name}`);
      
      const COMMAND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout for command execution
 
      await new Promise<void>((resolveCmd, rejectCmd) => {
        let commandTimedOut = false;
        let stdoutCombined = ''; // Moved here to be accessible by timeout
        let stderrCombined = ''; // Moved here to be accessible by timeout
        const timeoutHandle = setTimeout(() => {
          commandTimedOut = true;
          const timeoutMsg = `${determinedTransferCmd} command for ${sourceItem.name} timed out after ${COMMAND_TIMEOUT_MS / 1000}s.`;
          console.warn(`[Roo Debug][transfers.service.ts] TIMEOUT ${timeoutMsg} (Sub-task: ${subTaskId})`);
          console.warn(`[Roo Debug][transfers.service.ts] TIMEOUT Sub-task ${subTaskId}: STDOUT at timeout: ${stdoutCombined}`);
          console.warn(`[Roo Debug][transfers.service.ts] TIMEOUT Sub-task ${subTaskId}: STDERR at timeout: ${stderrCombined}`);
          // Attempt to close the stream, though it might not always work if process is stuck hard
          // stream?.close(); // stream is not in this scope yet, and might not exist
          rejectCmd(new Error(timeoutMsg));
        }, COMMAND_TIMEOUT_MS);
 
        const execOptions: { pty?: boolean } = {};
        if (cmdOptions.sshPassCommand) { // Only use PTY if sshpass is involved
          execOptions.pty = true;
        }

        console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Exec options for ssh2: ${JSON.stringify(execOptions)}`);
        sourceSshClient.exec(commandToExecute, execOptions, (err, stream) => {
          if (commandTimedOut) { // If timeout already fired, don't process stream events
            console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: exec callback fired AFTER timeout. Closing stream.`);
            stream?.close(); // Try to close the stream if exec cb somehow still runs
            return;
          }
          if (err) {
            clearTimeout(timeoutHandle);
            console.error(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Failed to initiate command execution:`, err);
            return rejectCmd(new Error(`Failed to execute command on source: ${err.message}`));
          }
 
          console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Stream obtained for command execution.`);
 
          stream.on('data', (data: Buffer) => {
            if (commandTimedOut) return;
            const output = data.toString();
            stdoutCombined += output;
            // More verbose logging for stdout
            console.debug(`[Roo Debug][transfers.service.ts] RAW STDOUT Sub-task ${subTaskId} (item ${sourceItem.name}): <<<${output}>>>`);
            if (determinedTransferCmd === 'rsync') {
              const progressMatch = output.match(/(\d+)%/);
              if (progressMatch && progressMatch[1]) {
                this.updateSubTaskStatus(taskId, subTaskId, 'transferring', parseInt(progressMatch[1], 10));
              }
            } else {
                this.updateSubTaskStatus(taskId, subTaskId, 'transferring', 50, 'SCP in progress...');
            }
          });
 
          stream.stderr.on('data', (data: Buffer) => {
            if (commandTimedOut) return;
            const errorOutput = data.toString();
            stderrCombined += errorOutput;
            // More verbose logging for stderr
            console.warn(`[Roo Debug][transfers.service.ts] RAW STDERR Sub-task ${subTaskId} (item ${sourceItem.name}): <<<${errorOutput}>>>`);
          });
 
          stream.on('close', (code: number | null, signal?: string) => {
            clearTimeout(timeoutHandle);
            if (commandTimedOut) {
              console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Stream closed AFTER timeout.`);
              return; // Already handled by timeout
            }
            console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Stream closed. Code: ${code}, Signal: ${signal}.`);
            console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Final STDOUT: ${stdoutCombined}`);
            console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Final STDERR: ${stderrCombined}`);
 
            if (code === 0) {
              this.updateSubTaskStatus(taskId, subTaskId, 'completed', 100, `${determinedTransferCmd} successful for ${sourceItem.name} to ${targetConnection.name}.`);
              resolveCmd();
            } else {
              const errorMsg = `${determinedTransferCmd} failed for ${sourceItem.name} to ${targetConnection.name}. Exit code: ${code}, signal: ${signal}. Stderr: ${stderrCombined.trim()}`;
              this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMsg);
              rejectCmd(new Error(errorMsg));
            }
          });
 
          stream.on('error', (streamErr: Error) => { // Should not happen if exec cb err is null
            clearTimeout(timeoutHandle);
            if (commandTimedOut) {
                console.info(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Stream error AFTER timeout.`);
                return;
            }
            console.error(`[Roo Debug][transfers.service.ts] Sub-task ${subTaskId}: Stream error event:`, streamErr);
            const errorMsg = `Stream error during ${determinedTransferCmd} for ${sourceItem.name}: ${streamErr.message}`;
            this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, errorMsg);
            rejectCmd(streamErr);
          });
        });
      });
 
    } catch (error: any) {
      // This will catch errors from checks, key upload, or the command execution promise
      console.error(`[Roo Debug][transfers.service.ts] executeRemoteTransferOnSource CATCH block for sub-task ${subTaskId} (item: ${sourceItem.name}). Error type: ${error?.constructor?.name}`, error);
      console.error(`[TransfersService] executeRemoteTransferOnSource error for sub-task ${subTaskId} (item: ${sourceItem.name}):`, error); // Keep original error log
      // Status should have been updated by the specific failure point, or update here if not already failed
      const taskFromMap = this.transferTasks.get(taskId);
      const currentSubTask = taskFromMap?.subTasks.find((st: TransferSubTask) => st.subTaskId === subTaskId);
      if (currentSubTask && currentSubTask.status !== 'failed' && currentSubTask.status !== 'completed') {
          this.updateSubTaskStatus(taskId, subTaskId, 'failed', undefined, error.message || `Remote transfer execution failed for ${sourceItem.name}.`);
      }
      throw error; // Re-throw to be caught by processTransferTask's loop for this sub-task
    } finally {
      console.info(`[Roo Debug][transfers.service.ts] executeRemoteTransferOnSource FINALLY block for sub-task ${subTaskId} (item: ${sourceItem.name}). Temp key path: ${tempTargetKeyPathOnSource}`);
      if (tempTargetKeyPathOnSource) {
        try {
          await this.deleteFileOnSourceViaSftp(sourceSshClient, tempTargetKeyPathOnSource);
        } catch (cleanupError) {
          console.warn(`[TransfersService] Failed to cleanup temp key ${tempTargetKeyPathOnSource} on source for sub-task ${subTaskId}:`, cleanupError);
          // Log but don't fail the entire sub-task if it otherwise succeeded/failed clearly
        }
      }
    }
  }

  // --- Status Update and Retrieval Methods (largely unchanged) ---
  public async getTransferTaskDetails(taskId: string, userId: string | number): Promise<TransferTask | null> {
    const task = this.transferTasks.get(taskId);
    console.debug(`[TransfersService] Retrieving details for task: ${taskId} for user: ${userId}`);
    if (task && task.userId === userId) {
      return { ...task, subTasks: task.subTasks.map(st => ({...st})) }; // Return copies
    }
    if (task && task.userId !== userId) {
        console.warn(`[TransfersService] User ${userId} attempted to access task ${taskId} owned by ${task.userId}.`);
        return null;
    }
    return null;
  }

  public async getAllTransferTasks(userId: string | number): Promise<TransferTask[]> {
    console.debug(`[TransfersService] Retrieving all transfer tasks for user: ${userId}.`);
    return Array.from(this.transferTasks.values())
      .filter(task => task.userId === userId)
      .map(task => ({ ...task, subTasks: task.subTasks.map(st => ({...st})) })); // Return copies
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
        // Prevent overwriting a final state with a transient one unless it's a retry mechanism (not implemented here)
        if ((subTask.status === 'completed' || subTask.status === 'failed') && (newStatus !== 'completed' && newStatus !== 'failed')) {
            console.warn(`[TransfersService] Attempted to update final sub-task ${subTaskId} status '${subTask.status}' to '${newStatus}'. Ignoring.`);
            return;
        }

        subTask.status = newStatus;
        if (progress !== undefined) subTask.progress = Math.min(100, Math.max(0, progress)); // Clamp progress
        if (message !== undefined) subTask.message = message;
        if ((newStatus === 'completed' || newStatus === 'failed') && !subTask.endTime) {
            subTask.endTime = new Date();
        }
        task.updatedAt = new Date();
        this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Important: update overall task
        console.info(`[TransfersService] Sub-task ${subTaskId} (task ${taskId}) updated: ${newStatus}, progress: ${subTask.progress}%, msg: "${subTask.message}"`);
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
        const isCurrentStatusFinal = task.status === 'completed' || task.status === 'failed' || task.status === 'partially-completed';
        // Check if newStatus is one of the transient states
        const isNewStatusTransient = newStatus === 'queued' || newStatus === 'in-progress';

        if (isCurrentStatusFinal && isNewStatusTransient) {
            // If current status is final and new status is transient, ignore the update.
            console.warn(`[TransfersService] Attempted to update final task ${taskId} status '${task.status}' to transient '${newStatus}'. Ignoring.`);
            return;
        }

        // Proceed with the update if:
        // 1. Current status is not final.
        // 2. Current status is final, and newStatus is also a final state (e.g., 'partially-completed' to 'failed').
        task.status = newStatus;
        task.updatedAt = new Date();
        // Overall task message could be an aggregation or just the first major error.
        // For simplicity, not adding detailed message aggregation here.
        console.info(`[TransfersService] Overall status for task ${taskId} directly updated to: ${newStatus}` + (message ? ` (Msg: ${message})` : ''));
    }
  }

  private updateOverallTaskStatusBasedOnSubTasks(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;

    let completedCount = 0;
    let failedCount = 0;
    let inProgressCount = 0;
    let queuedCount = 0;
    let totalProgress = 0;
    const numSubTasks = task.subTasks.length;

    if (numSubTasks === 0) {
      task.overallProgress = 0;
      // task.status remains as set by initiate or direct updateOverallTaskStatus if no subtasks.
      return;
    }

    task.subTasks.forEach(st => {
      switch (st.status) {
        case 'completed':
          completedCount++;
          totalProgress += 100;
          break;
        case 'failed':
          failedCount++;
          // Failed tasks are "done" but contribute 0 to success progress.
          // Depending on definition, they could count as 100 for task "completion" progress.
          // Here, only successful completion adds to progress towards 100%.
          break;
        case 'transferring':
        case 'connecting': // consider connecting as in-progress for overall status
          inProgressCount++;
          totalProgress += (st.progress !== undefined ? st.progress : (st.status === 'connecting' ? 5 : 0)); // Small progress for connecting
          break;
        case 'queued':
          queuedCount++;
          break;
      }
    });

    task.overallProgress = numSubTasks > 0 ? Math.round(totalProgress / numSubTasks) : 0;

    let newOverallStatus: TransferTask['status'];
    if (failedCount === numSubTasks) {
      newOverallStatus = 'failed';
    } else if (completedCount === numSubTasks) {
      newOverallStatus = 'completed';
    } else if (failedCount > 0 && (completedCount + failedCount === numSubTasks)) {
      newOverallStatus = 'partially-completed';
    } else if (inProgressCount > 0 || (queuedCount > 0 && (failedCount > 0 || completedCount > 0))) {
      // If anything is in progress, or if some are queued while others are done/failed, it's in-progress
      newOverallStatus = 'in-progress';
    } else if (queuedCount === numSubTasks) {
      newOverallStatus = 'queued'; // All subtasks are still queued
    } else {
      // Fallback or unexpected mixed state, treat as in-progress generally
      // This case implies some completed, some queued, no failed, no in-progress items.
      newOverallStatus = 'in-progress'; // Or 'partially-completed' if completedCount > 0
      if (completedCount > 0 && queuedCount > 0 && failedCount === 0 && inProgressCount === 0) {
        newOverallStatus = 'partially-completed'; // More accurate for this specific mix
      }
    }
    
    if (task.status !== newOverallStatus) {
        console.info(`[TransfersService] Task ${taskId} overall status changing from ${task.status} to ${newOverallStatus} (P: ${task.overallProgress}%)`);
        task.status = newOverallStatus;
    }
    task.updatedAt = new Date();
    // console.debug(`[TransfersService] Task ${taskId} overall progress: ${task.overallProgress}%, status: ${task.status}`);
  }

  private finalizeOverallTaskStatus(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;
    this.updateOverallTaskStatusBasedOnSubTasks(taskId); // Recalculate based on final sub-task states
    console.info(`[TransfersService] Finalized overall status for task ${taskId}: ${task.status}, progress: ${task.overallProgress}%`);
  }
}