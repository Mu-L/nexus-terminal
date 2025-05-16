export interface InitiateTransferPayload {
  connectionIds: number[];
  sourceItems: Array<{ name: string; path: string; type: 'file' | 'directory' }>;
  remoteTargetPath: string;
  transferMethod: 'auto' | 'rsync' | 'scp';
}

export interface TransferSubTask {
  subTaskId: string;
  connectionId: number;
  sourceItemName: string;
  status: 'queued' | 'connecting' | 'transferring' | 'completed' | 'failed';
  progress?: number; // 0-100
  message?: string; // 例如错误信息
  transferMethodUsed?: 'rsync' | 'scp';
  startTime?: Date;
  endTime?: Date;
}

export interface TransferTask {
  taskId: string;
  status: 'queued' | 'in-progress' | 'completed' | 'failed' | 'partially-completed';
  userId: string | number; // 添加用户ID字段
  createdAt: Date;
  updatedAt: Date;
  subTasks: TransferSubTask[];
  overallProgress?: number; // 0-100, 根据子任务计算
  payload: InitiateTransferPayload; // 存储原始请求负载，方便追溯
}