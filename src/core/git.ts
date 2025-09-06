import type { GitResult, GitStatus, BranchInfo } from './types';

export class GitOperations {
  async execute(command: string, args: string[] = []): Promise<GitResult> {
    try {
      const proc = Bun.spawn(['git', command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe'
      });

      const result = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        success: result === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: result
      };
    } catch (err) {
      return {
        success: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Unknown error',
        exitCode: -1
      };
    }
  }

  async isGitRepo(): Promise<boolean> {
    const result = await this.execute('rev-parse', ['--git-dir']);
    return result.success;
  }

  async getStatus(): Promise<GitStatus> {
    const [workingTree, staged, untracked] = await Promise.all([
      this.execute('diff-index', ['--quiet', 'HEAD', '--']),
      this.execute('diff', ['--cached', '--quiet']),
      this.execute('ls-files', ['--others', '--exclude-standard'])
    ]);

    const hasUncommittedChanges = !workingTree.success;
    const hasStagedChanges = !staged.success;
    const hasUntrackedFiles = untracked.success && untracked.stdout.trim() !== '';

    return {
      hasUncommittedChanges,
      hasStagedChanges,
      hasUntrackedFiles,
      hasChanges: hasUncommittedChanges || hasStagedChanges || hasUntrackedFiles
    };
  }

  async fetch(): Promise<GitResult> {
    return await this.execute('fetch', ['origin', '--prune']);
  }

  async checkout(branch: string): Promise<boolean> {
    const result = await this.execute('checkout', [branch]);
    return result.success;
  }

  async hasRemoteBranch(branch: string): Promise<boolean> {
    const result = await this.execute('show-ref', ['--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    return result.success;
  }

  async fastForwardMerge(branch: string): Promise<boolean> {
    const result = await this.execute('merge', [`origin/${branch}`, '--ff-only']);
    return result.success;
  }

  async getCurrentBranch(): Promise<string> {
    const result = await this.execute('rev-parse', ['--abbrev-ref', 'HEAD']);
    return result.success ? result.stdout : '';
  }

  async createStash(message: string): Promise<boolean> {
    // First try with untracked files
    let result = await this.execute('stash', ['push', '-m', message, '--include-untracked']);
    if (result.success) {
      return true;
    }
    
    // If that fails, try without untracked files (they might cause issues)
    result = await this.execute('stash', ['push', '-m', message]);
    return result.success;
  }

  async findStash(message: string): Promise<string | null> {
    const result = await this.execute('stash', ['list']);
    if (!result.success) return null;

    const lines = result.stdout.split('\n');
    for (const line of lines) {
      if (line.includes(message)) {
        const match = line.match(/^(stash@\{\d+\})/);
        return match ? match[1] : null;
      }
    }
    return null;
  }

  async restoreStash(stashRef: string): Promise<GitResult> {
    return await this.execute('stash', ['pop', stashRef]);
  }

  async hasRemote(): Promise<boolean> {
    const result = await this.execute('remote');
    return result.success && result.stdout.trim().length > 0;
  }

  async getUpstreamBranch(branch: string): Promise<string | null> {
    const result = await this.execute('rev-parse', ['--abbrev-ref', `${branch}@{upstream}`]);
    return result.success ? result.stdout.trim() : null;
  }

  async getBehindCount(localBranch: string, remoteBranch: string): Promise<number> {
    const result = await this.execute('rev-list', ['--count', `${localBranch}..${remoteBranch}`]);
    return result.success ? parseInt(result.stdout.trim()) || 0 : 0;
  }

  async mergeFromUpstream(upstreamBranch: string): Promise<GitResult> {
    return await this.execute('merge', ['--no-ff', upstreamBranch]);
  }

  async rebaseFromUpstream(upstreamBranch: string): Promise<GitResult> {
    return await this.execute('rebase', [upstreamBranch]);
  }

  async stashChanges(message: string): Promise<GitResult> {
    return await this.execute('stash', ['push', '-m', message]);
  }

  async getGoneBranches(): Promise<BranchInfo[]> {
    const result = await this.execute('for-each-ref', [
      '--format=%(refname:short) %(upstream:track)',
      'refs/heads'
    ]);

    if (!result.success) return [];

    const branches: BranchInfo[] = [];
    const lines = result.stdout.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const [name, track] = line.split(' ');
      if (track === '[gone]') {
        branches.push({
          name,
          hasRemote: false,
          upstreamStatus: 'gone'
        });
      }
    }

    return branches;
  }

  async deleteBranch(branch: string): Promise<boolean> {
    const result = await this.execute('branch', ['-D', branch]);
    return result.success;
  }

  async branchExists(branch: string): Promise<boolean> {
    const result = await this.execute('show-ref', ['--verify', '--quiet', `refs/heads/${branch}`]);
    return result.success;
  }

  async getLocalBranches(): Promise<string[]> {
    const result = await this.execute('branch', ['--format=%(refname:short)']);
    if (!result.success) return [];
    return result.stdout.split('\n').filter(branch => branch.trim() && !branch.startsWith('*'));
  }

  async getRemoteBranches(): Promise<string[]> {
    const result = await this.execute('branch', ['-r', '--format=%(refname:short)']);
    if (!result.success) return [];
    return result.stdout.split('\n')
      .filter(branch => branch.trim() && !branch.includes('HEAD'))
      .map(branch => branch.replace('origin/', '').trim());
  }

  async getAllBranches(): Promise<{ local: string[], remote: string[] }> {
    const [local, remote] = await Promise.all([
      this.getLocalBranches(),
      this.getRemoteBranches()
    ]);
    return { local, remote };
  }

  async getRemoteLiveBranches(remote = 'origin'): Promise<string[]> {
    try {
      const result = await this.execute('ls-remote', ['-h', remote]);
      if (!result.success) return [];

      const branches: string[] = [];
      const lines = result.stdout.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const match = line.match(/refs\/heads\/([^\s]*)/);
        if (match) {
          branches.push(match[1]);
        }
      }

      return branches;
    } catch {
      return [];
    }
  }

  async getLocalBranchesWithUpstream(): Promise<Array<{ local: string, remote: string }>> {
    const result = await this.execute('branch', ['--format=%(refname:short)@{%(upstream)}']);
    if (!result.success) return [];

    const branches: Array<{ local: string, remote: string }> = [];
    const lines = result.stdout.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const upstreamIndex = line.indexOf('@{refs/remotes/origin/');
      if (upstreamIndex !== -1) {
        const localBranch = line.slice(0, upstreamIndex);
        const upstream = line.slice(upstreamIndex + 2, -1);
        const remoteBranch = upstream.replace('refs/remotes/origin/', '');

        branches.push({
          local: localBranch,
          remote: remoteBranch
        });
      }
    }

    return branches;
  }

  async isRemoteAvailable(remote = 'origin'): Promise<boolean> {
    const result = await this.execute('remote', ['-v']);
    if (!result.success) return false;

    const lines = result.stdout.split('\n');
    return lines.some(line => line.startsWith(`${remote}\t`));
  }
}