import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  relativeDate: string;
  branch: string;
}

export class CherryPickCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private parseArgs(args: string[]) {
    const result = {
      commits: [] as string[],
      branch: null as string | null,
      continue: false,
      abort: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === 'continue') {
        result.continue = true;
      } else if (arg === 'abort') {
        result.abort = true;
      } else if (arg === 'from' && i + 1 < args.length) {
        result.branch = args[++i];
      } else if (!arg.startsWith('--') && arg !== 'from') {
        result.commits.push(arg);
      }
    }

    return result;
  }

  private async getCommitsFromBranch(branch: string, limit: number = 50): Promise<CommitInfo[]> {
    const result = await this.git.execute('log', [
      `--max-count=${limit}`,
      '--pretty=format:%H|%h|%s|%an|%ai|%ar',
      '--no-merges',
      branch
    ]);

    if (!result.success || !result.stdout) {
      return [];
    }

    return result.stdout.split('\n').filter(line => line.trim()).map(line => {
      const [hash, shortHash, subject, author, date, relativeDate] = line.split('|');
      return {
        hash,
        shortHash,
        subject,
        author,
        date,
        relativeDate,
        branch
      };
    });
  }


  private formatCommitForDisplay(commit: CommitInfo): string {
    const maxSubjectLength = 50;
    const subject = commit.subject.length > maxSubjectLength
      ? commit.subject.substring(0, maxSubjectLength - 3) + '...'
      : commit.subject;

    return `${commit.shortHash} - ${subject} (${commit.relativeDate}) [${commit.branch}]`;
  }

  private async selectCommitsWithPagination(commits: CommitInfo[]): Promise<CommitInfo[]> {
    if (commits.length === 0) {
      p.log.error('No commits available for cherry-picking');
      return [];
    }

    const pageSize = 8; // Safe number for terminal display
    let currentPage = 0;
    const totalPages = Math.ceil(commits.length / pageSize);
    const selectedCommits: CommitInfo[] = [];

    while (true) {
      const startIdx = currentPage * pageSize;
      const endIdx = Math.min(startIdx + pageSize, commits.length);
      const pageCommits = commits.slice(startIdx, endIdx);

      const options = [
        ...pageCommits.map(commit => ({
          value: commit.hash,
          label: this.formatCommitForDisplay(commit),
          hint: selectedCommits.some(s => s.hash === commit.hash) ? '✓ selected' : undefined
        }))
      ];

      // Add navigation and action options
      if (totalPages > 1) {
        options.push({ value: 'nav-separator', label: '─'.repeat(50), hint: undefined });
        
        if (currentPage > 0) {
          options.push({ value: 'prev-page', label: '← Previous page', hint: undefined });
        }
        if (currentPage < totalPages - 1) {
          options.push({ value: 'next-page', label: '→ Next page', hint: undefined });
        }
      }

      if (selectedCommits.length > 0) {
        options.push({ value: 'confirm-selection', label: `✅ Continue with ${selectedCommits.length} selected commits`, hint: undefined });
      }
      
      options.push({ value: 'cancel', label: '❌ Cancel', hint: undefined });

      const selected = await p.select({
        message: `Select commits to cherry-pick (Page ${currentPage + 1}/${totalPages}):`,
        options: options.filter(opt => opt.value !== 'nav-separator')
      }) as string | symbol;

      if (p.isCancel(selected) || selected === 'cancel') {
        return [];
      }

      if (typeof selected === 'string') {
        if (selected === 'prev-page') {
          currentPage = Math.max(0, currentPage - 1);
          continue;
        }
        if (selected === 'next-page') {
          currentPage = Math.min(totalPages - 1, currentPage + 1);
          continue;
        }
        if (selected === 'confirm-selection') {
          return selectedCommits;
        }

        // Toggle commit selection
        const commit = commits.find(c => c.hash === selected);
        if (commit) {
          const existingIndex = selectedCommits.findIndex(s => s.hash === commit.hash);
          if (existingIndex >= 0) {
            selectedCommits.splice(existingIndex, 1);
            p.log.info(`Removed: ${commit.shortHash}`);
          } else {
            selectedCommits.push(commit);
            p.log.info(`Added: ${commit.shortHash}`);
          }
        }
      }
    }
  }

  private async selectCommits(commits: CommitInfo[]): Promise<CommitInfo[]> {
    // Use pagination for better UX with large commit lists
    return this.selectCommitsWithPagination(commits);
  }

  private async selectBranch(currentBranch: string): Promise<string | null> {
    // Get all branches except current
    const branchResult = await this.git.execute('branch', ['--format=%(refname:short)']);
    if (!branchResult.success) return null;

    const branches = branchResult.stdout
      .split('\n')
      .map(branch => branch.trim())
      .filter(branch => branch && branch !== currentBranch);

    if (branches.length === 0) {
      p.log.error('No other branches found');
      return null;
    }

    const selectedBranch = await p.select({
      message: 'Select branch to cherry-pick from:',
      options: branches.map(branch => ({
        value: branch,
        label: branch
      }))
    }) as string | symbol;

    if (p.isCancel(selectedBranch)) {
      return null;
    }

    return selectedBranch as string;
  }

  async execute(args: string[]): Promise<GitResult> {
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    const options = this.parseArgs(args);

    // Handle continue/abort operations
    if (options.continue) {
      p.intro('🍒 Continuing cherry-pick');
      const continueResult = await this.git.execute('cherry-pick', ['--continue']);
      if (continueResult.success) {
        p.log.success('Cherry-pick continued successfully');
        return { success: true, stdout: 'Cherry-pick continued', stderr: '', exitCode: 0 };
      } else {
        p.log.error(`Failed to continue cherry-pick: ${continueResult.stderr}`);
        return { success: false, stdout: '', stderr: continueResult.stderr, exitCode: 1 };
      }
    }

    if (options.abort) {
      p.intro('🍒 Aborting cherry-pick');
      const abortResult = await this.git.execute('cherry-pick', ['--abort']);
      if (abortResult.success) {
        p.log.success('Cherry-pick aborted successfully');
        return { success: true, stdout: 'Cherry-pick aborted', stderr: '', exitCode: 0 };
      } else {
        p.log.error(`Failed to abort cherry-pick: ${abortResult.stderr}`);
        return { success: false, stdout: '', stderr: abortResult.stderr, exitCode: 1 };
      }
    }

    p.intro('🍒 Cherry-pick commits');

    const currentBranch = await this.git.getCurrentBranch();
    if (!currentBranch) {
      p.log.error('Could not determine current branch');
      process.exit(1);
    }

    let commitsToPickFrom: CommitInfo[] = [];

    // If specific commits provided, validate them
    if (options.commits.length > 0) {
      for (const commitHash of options.commits) {
        const commitResult = await this.git.execute('show', ['--pretty=format:%H|%h|%s|%an|%ai|%ar', '--no-patch', commitHash]);
        if (commitResult.success) {
          const [hash, shortHash, subject, author, date, relativeDate] = commitResult.stdout.split('|');
          commitsToPickFrom.push({
            hash,
            shortHash,
            subject,
            author,
            date,
            relativeDate,
            branch: 'specified'
          });
        } else {
          p.log.error(`Invalid commit: ${commitHash}`);
          process.exit(1);
        }
      }
    } else {
      // Interactive mode
      let sourceBranch = options.branch;

      if (!sourceBranch) {
        sourceBranch = await this.selectBranch(currentBranch);
        if (!sourceBranch) {
          p.cancel('Operation cancelled');
          return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
        }
      }

      p.log.info(`Getting commits from branch: ${sourceBranch}`);
      commitsToPickFrom = await this.getCommitsFromBranch(sourceBranch);

      if (commitsToPickFrom.length === 0) {
        p.log.error(`No commits found in branch: ${sourceBranch}`);
        return { success: false, stdout: '', stderr: 'No commits found', exitCode: 1 };
      }
    }

    // If we have multiple commits or no specific commits, show selection
    let selectedCommits: CommitInfo[];
    if (options.commits.length === 0) {
      selectedCommits = await this.selectCommits(commitsToPickFrom);
      if (selectedCommits.length === 0) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
      }
    } else {
      selectedCommits = commitsToPickFrom;
    }

    // Check for uncommitted changes
    const status = await this.git.getStatus();
    if (status.hasChanges) {
      const shouldContinue = await p.confirm({
        message: 'You have uncommitted changes. Cherry-pick may conflict. Continue?',
        initialValue: false
      });

      if (p.isCancel(shouldContinue) || !shouldContinue) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled due to uncommitted changes', exitCode: 1 };
      }
    }

    // Show what will be cherry-picked
    p.log.info(`Cherry-picking ${selectedCommits.length} commit(s) onto ${currentBranch}:`);
    selectedCommits.forEach(commit => {
      console.log(`  ${this.formatCommitForDisplay(commit)}`);
    });

    const confirm = await p.confirm({
      message: 'Proceed with cherry-pick?',
      initialValue: true
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Perform cherry-pick
    let successCount = 0;
    let failedCommit: CommitInfo | null = null;

    for (const commit of selectedCommits) {
      p.log.info(`Cherry-picking: ${commit.shortHash} - ${commit.subject}`);

      const pickResult = await this.git.execute('cherry-pick', [commit.hash]);

      if (pickResult.success) {
        successCount++;
        p.log.success(`✅ ${commit.shortHash} applied successfully`);
      } else {
        failedCommit = commit;

        // Check if it's a conflict
        if (pickResult.stderr?.includes('conflict') || pickResult.stderr?.includes('CONFLICT')) {
          p.log.warning(`⚠️ Conflicts in ${commit.shortHash}`);
          p.log.info('Resolve conflicts in your editor and then run:');
          p.log.info('  git add .');
          p.log.info('  gitnoob cherry-pick continue');
          p.log.info('Or to abort:');
          p.log.info('  gitnoob cherry-pick abort');

          return {
            success: false,
            stdout: `${successCount} commits applied, conflicts in ${commit.shortHash}`,
            stderr: 'Cherry-pick conflicts detected',
            exitCode: 1,
            requiresManualResolution: true
          };
        } else {
          p.log.error(`❌ Failed to cherry-pick ${commit.shortHash}: ${pickResult.stderr}`);
          break;
        }
      }
    }

    if (failedCommit && !failedCommit.hash.includes('conflict')) {
      p.log.error(`Cherry-pick failed at ${failedCommit.shortHash}`);
      return {
        success: false,
        stdout: `${successCount} of ${selectedCommits.length} commits applied`,
        stderr: `Failed at ${failedCommit.shortHash}`,
        exitCode: 1
      };
    }

    p.log.success(`🎉 Successfully cherry-picked ${successCount} commit(s)`);
    p.log.info('💡 Next steps:');
    p.log.info('  • Review the changes: git log --oneline -n ' + successCount);
    p.log.info('  • Run tests to ensure everything works');

    return {
      success: true,
      stdout: `Successfully cherry-picked ${successCount} commits`,
      stderr: '',
      exitCode: 0
    };
  }
}