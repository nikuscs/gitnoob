export interface GitCommand {
  execute(args: string[]): Promise<GitResult>;
}

export interface StashInfo {
  ref: string;
  message: string;
  timestamp: number;
}

export interface BranchInfo {
  name: string;
  hasRemote: boolean;
  upstreamStatus: 'gone' | 'behind' | 'ahead' | 'current' | 'unknown';
}

export interface GitStatus {
  hasUncommittedChanges: boolean;
  hasStagedChanges: boolean;
  hasUntrackedFiles: boolean;
  hasChanges: boolean;
}

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  message?: string;
  requiresManualResolution?: boolean;
}