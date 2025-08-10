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
}

export class TimeTravelCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private async getCommitHistory(limit: number = 50): Promise<CommitInfo[]> {
    // Format: hash|short|subject|author|date|relative
    const result = await this.git.execute('log', [
      `--max-count=${limit}`,
      '--pretty=format:%H|%h|%s|%an|%ai|%ar',
      '--no-merges'  // Skip merge commits for cleaner list
    ]);

    if (!result.success || !result.stdout) {
      return [];
    }

    return result.stdout.split('\n').map(line => {
      const [hash, shortHash, subject, author, date, relativeDate] = line.split('|');
      return {
        hash,
        shortHash,
        subject,
        author,
        date,
        relativeDate
      };
    });
  }

  private formatCommitForDisplay(commit: CommitInfo): string {
    // Truncate subject if too long
    const maxSubjectLength = 60;
    const subject = commit.subject.length > maxSubjectLength 
      ? commit.subject.substring(0, maxSubjectLength - 3) + '...'
      : commit.subject;

    return `${commit.shortHash} - ${subject} (${commit.relativeDate} by ${commit.author})`;
  }

  async execute(_args: string[]): Promise<GitResult> {
    p.intro('🚀 Time Travel - Go back to any commit safely');

    // Pre-flight checks
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    const currentBranch = await this.git.getCurrentBranch();
    if (!currentBranch) {
      p.log.error('Could not determine current branch');
      process.exit(1);
    }

    // Check for detached HEAD state
    if (currentBranch === 'HEAD') {
      p.log.error('Cannot time travel in detached HEAD state');
      p.log.info('Please checkout a branch first');
      process.exit(1);
    }

    // Check for uncommitted changes including untracked files
    const statusResult = await this.git.execute('status', ['--porcelain']);
    if (statusResult.stdout && statusResult.stdout.trim()) {
      p.log.error('You have uncommitted changes or untracked files.');
      p.log.info('Please commit or stash them first:');
      p.log.info('  git add . && git stash');
      p.log.info('  OR');
      p.log.info('  git stash --include-untracked');
      process.exit(1);
    }

    // Get current commit info
    const currentCommitResult = await this.git.execute('rev-parse', ['HEAD']);
    const currentCommit = currentCommitResult.stdout?.trim();

    // Get commit history
    p.log.info('Loading commit history...');
    const commits = await this.getCommitHistory();
    
    if (commits.length === 0) {
      p.log.error('No commits found in history');
      process.exit(1);
    }

    // Show current position
    const currentPosition = commits.findIndex(c => c.hash === currentCommit);
    if (currentPosition >= 0) {
      p.log.info(`Current position: ${this.formatCommitForDisplay(commits[currentPosition])}`);
    }

    // Let user select a commit
    const selectedCommit = await p.select({
      message: 'Select a commit to travel to:',
      options: commits.map(commit => ({
        value: commit,
        label: this.formatCommitForDisplay(commit),
        hint: commit.hash === currentCommit ? '(current)' : undefined
      }))
    }) as CommitInfo | symbol;

    if (p.isCancel(selectedCommit)) {
      p.cancel('Time travel cancelled');
      process.exit(0);
    }

    const commit = selectedCommit as CommitInfo;

    // Check if selected commit is current
    if (commit.hash === currentCommit) {
      p.log.info('You are already at this commit');
      return { success: true, stdout: 'Already at selected commit', stderr: '', exitCode: 0 };
    }

    // Determine direction (forward or backward)
    const selectedIndex = commits.findIndex(c => c.hash === commit.hash);
    const isGoingBack = selectedIndex > currentPosition;

    if (isGoingBack) {
      p.log.info(`Going back ${selectedIndex - currentPosition} commits...`);
    } else {
      p.log.info(`Going forward ${currentPosition - selectedIndex} commits...`);
    }

    // Show what will happen
    p.log.warning('This will:');
    p.log.info(`  1. Reset your branch to: ${commit.shortHash}`);
    p.log.info(`  2. Create a new commit that reverts to that state`);
    p.log.info(`  3. Your history will be preserved`);

    const confirm = await p.confirm({
      message: 'Do you want to proceed?',
      initialValue: false
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel('Time travel cancelled');
      process.exit(0);
    }

    // Get the commit message from the selected commit
    const messageResult = await this.git.execute('log', [
      '-1',
      '--pretty=format:%s',
      commit.hash
    ]);
    const originalMessage = messageResult.stdout || 'previous state';

    // Get list of files that will change
    const diffResult = await this.git.execute('diff', [
      '--name-only',
      'HEAD',
      commit.hash
    ]);

    const changedFiles = diffResult.stdout?.split('\n').filter(f => f.trim()).length || 0;
    p.log.info(`${changedFiles} files will be modified`);

    // Perform the time travel
    p.log.info('Initiating time travel...');

    // Create a backup tag before making changes
    const backupTag = `backup-before-timetravel-${Date.now()}`;
    const tagResult = await this.git.execute('tag', [backupTag, 'HEAD']);
    if (tagResult.success) {
      p.log.info(`Created backup tag: ${backupTag}`);
    }
    
    // First, save current HEAD for the commit message
    const currentShortHash = commits[currentPosition]?.shortHash || 'HEAD';

    // Use checkout to get all files from the target commit
    const checkoutResult = await this.git.execute('checkout', [commit.hash, '--', '.']);
    if (!checkoutResult.success) {
      p.log.error(`Failed to checkout files from target commit: ${checkoutResult.stderr}`);
      if (tagResult.success) {
        p.log.info(`You can restore your original state with: git reset --hard ${backupTag}`);
      }
      process.exit(1);
    }

    // Stage all changes
    const addResult = await this.git.execute('add', ['-A']);
    if (!addResult.success) {
      p.log.error('Failed to stage changes');
      // Try to recover
      await this.git.execute('reset', ['--hard', 'HEAD']);
      if (tagResult.success) {
        p.log.info(`You can restore your original state with: git reset --hard ${backupTag}`);
      }
      process.exit(1);
    }

    // Now all changes are staged, ready for commit
    const revertMessage = `revert: back to "${originalMessage}"\n\nReverted from ${currentShortHash} to ${commit.shortHash}`;

    // Create the revert commit
    const commitResult = await this.git.execute('commit', [
      '-m',
      revertMessage,
      '--no-verify'  // Skip hooks for safety
    ]);

    if (!commitResult.success) {
      p.log.error(`Failed to create revert commit: ${commitResult.stderr}`);
      // Try to restore
      await this.git.execute('reset', ['--hard', 'HEAD']);
      if (tagResult.success) {
        p.log.info(`You can restore your original state with: git reset --hard ${backupTag}`);
      }
      process.exit(1);
    }

    // Get the new commit hash
    const newCommitResult = await this.git.execute('rev-parse', ['HEAD']);
    const newCommit = newCommitResult.stdout?.trim().substring(0, 7);

    p.outro(`✨ Time travel complete!`);
    p.log.success(`Created revert commit: ${newCommit}`);
    p.log.info(`You are now at the state of commit: ${commit.shortHash}`);
    p.log.info(`To undo this time travel, run: git reset --hard HEAD~1`);
    if (tagResult.success) {
      p.log.info(`Or restore to exact original state: git reset --hard ${backupTag}`);
      p.log.info(`Clean up backup tag when done: git tag -d ${backupTag}`);
    }

    return { 
      success: true, 
      stdout: `Successfully traveled to ${commit.shortHash}`, 
      stderr: '', 
      exitCode: 0 
    };
  }
}