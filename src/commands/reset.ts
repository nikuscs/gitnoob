import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class ResetCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  async execute(args: string[]): Promise<GitResult> {
    const force = args.includes('--force');
    
    p.intro('🔄 Resetting all changes in current branch');

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

    // Safety check - don't reset main/master without --force
    const protectedBranches = ['main', 'master', 'develop', 'development'];
    if (protectedBranches.includes(currentBranch) && !force) {
      p.log.error(`Cannot reset protected branch '${currentBranch}' without --force flag`);
      p.log.info('Use: gitnoob reset --force to override this safety check');
      process.exit(1);
    }

    p.log.warning(`This will destroy ALL local changes in branch '${currentBranch}'`);
    p.log.info('The following will be removed:');
    p.log.info('  • All uncommitted changes');
    p.log.info('  • All staged changes');
    p.log.info('  • Any merge/rebase in progress');
    p.log.info('  • All untracked files');

    // Confirm with user
    const confirm = await p.confirm({
      message: 'Are you absolutely sure you want to proceed?',
      initialValue: false
    });

    if (p.isCancel(confirm) || !confirm) {
      p.log.info('Reset cancelled - your changes are safe');
      return { success: true, stdout: 'Reset cancelled', stderr: '', exitCode: 0 };
    }

    // Double confirmation for protected branches
    if (protectedBranches.includes(currentBranch)) {
      const doubleConfirm = await p.confirm({
        message: `⚠️  You are about to reset '${currentBranch}'. Are you REALLY sure?`,
        initialValue: false
      });

      if (p.isCancel(doubleConfirm) || !doubleConfirm) {
        p.log.info('Reset cancelled - your changes are safe');
        return { success: true, stdout: 'Reset cancelled', stderr: '', exitCode: 0 };
      }
    }

    p.log.info('Starting reset process...');

    // 1. Abort any rebase in progress
    const rebaseInProgress = await this.git.execute('status', ['--porcelain=v1']).then(
      result => result.stdout?.includes('rebase') || false
    );
    if (rebaseInProgress) {
      p.log.info('Aborting rebase in progress...');
      await this.git.execute('rebase', ['--abort']);
    }

    // 2. Abort any merge in progress
    const mergeInProgress = await this.git.execute('status', ['--porcelain=v1']).then(
      result => result.stdout?.includes('merge') || false
    );
    if (mergeInProgress) {
      p.log.info('Aborting merge in progress...');
      await this.git.execute('merge', ['--abort']);
    }

    // 3. Clear all stashes for current branch (optional)
    if (args.includes('--clear-stashes')) {
      p.log.info('Clearing all stashes for current branch...');
      const stashes = await this.git.execute('stash', ['list']);
      if (stashes.success && stashes.stdout) {
        const branchStashes = stashes.stdout
          .split('\n')
          .filter(line => line.includes(currentBranch));
        
        for (const stash of branchStashes) {
          const stashRef = stash.split(':')[0];
          await this.git.execute('stash', ['drop', stashRef]);
        }
      }
    }

    // 4. Reset to HEAD (discard all staged and unstaged changes)
    p.log.info('Resetting all changes...');
    const resetResult = await this.git.execute('reset', ['--hard', 'HEAD']);
    if (!resetResult.success) {
      p.log.error(`Failed to reset: ${resetResult.stderr}`);
      process.exit(1);
    }

    // 5. Clean all untracked files and directories
    p.log.info('Removing all untracked files and directories...');
    const cleanResult = await this.git.execute('clean', ['-fd']);
    if (!cleanResult.success) {
      p.log.error(`Failed to clean: ${cleanResult.stderr}`);
      process.exit(1);
    }

    // 6. If branch has upstream, reset to match it exactly
    const upstreamBranch = await this.git.getUpstreamBranch(currentBranch);
    if (upstreamBranch) {
      p.log.info(`Resetting branch to match upstream (${upstreamBranch})...`);
      
      // Fetch latest from upstream
      await this.git.fetch();
      
      // Hard reset to upstream
      const upstreamReset = await this.git.execute('reset', ['--hard', upstreamBranch]);
      if (!upstreamReset.success) {
        p.log.warning(`Could not reset to upstream: ${upstreamReset.stderr}`);
      } else {
        p.log.success(`Branch reset to match ${upstreamBranch}`);
      }
    }

    // Final status check
    const finalStatus = await this.git.getStatus();
    if (finalStatus.hasChanges) {
      p.log.warning('Some changes could not be removed');
    } else {
      p.log.success('✨ Branch is now completely clean!');
    }

    p.outro(`Branch '${currentBranch}' has been reset successfully`);

    return { 
      success: true, 
      stdout: 'All changes reset successfully', 
      stderr: '', 
      exitCode: 0 
    };
  }
}