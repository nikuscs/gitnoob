import { GitOperations } from '../core/git';
import { BranchSelector } from '../utils/branch-selector';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class CheckoutCommand implements GitCommand {
  private git: GitOperations;
  private branchSelector: BranchSelector;

  constructor() {
    this.git = new GitOperations();
    this.branchSelector = new BranchSelector(this.git);
  }

  private generateStashMessage(fromBranch: string, toBranch: string): string {
    const timestamp = Date.now(); // Use milliseconds for uniqueness
    return `gitnoob-stash: ${fromBranch} -> ${toBranch} at ${timestamp}`;
  }

  async execute(args: string[]): Promise<GitResult> {
    if (args.length === 0) {
      p.log.error('Please provide a branch name to checkout');
      process.exit(1);
    }

    let targetBranch = args[0];
    p.intro(`Checking out branch: ${targetBranch}`);

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

    if (currentBranch === targetBranch) {
      p.log.warning(`Already on branch '${targetBranch}'`);
      return { success: true, stdout: `Already on branch '${targetBranch}'`, stderr: '', exitCode: 0 };
    }

    // Check if branch exists locally, if not offer suggestions
    const selectedBranch = await this.branchSelector.selectBranch(targetBranch);
    if (!selectedBranch) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }
    
    if (selectedBranch !== targetBranch) {
      targetBranch = selectedBranch;
      p.log.info(`Selected branch: ${targetBranch}`);
    }

    p.log.info(`Current branch: ${currentBranch}`);
    p.log.info(`Target branch: ${targetBranch}`);

    // Check for uncommitted changes
    const status = await this.git.getStatus();
    let stashMessage = null;
    let stashRef = null;

    if (status.hasUncommittedChanges || status.hasStagedChanges) {
      p.log.info('Uncommitted changes detected, creating stash...');
      stashMessage = this.generateStashMessage(currentBranch, targetBranch);
      
      // Get stash count before creating new stash
      const stashListBefore = await this.git.execute('stash', ['list']);
      const stashCountBefore = stashListBefore.success ? stashListBefore.stdout.split('\n').filter(line => line.trim()).length : 0;
      
      if (!(await this.git.createStash(stashMessage))) {
        p.log.error('Failed to create stash, aborting checkout');
        process.exit(1);
      }
      
      // Verify stash was created and get its reference
      const stashListAfter = await this.git.execute('stash', ['list']);
      if (stashListAfter.success) {
        const stashLines = stashListAfter.stdout.split('\n').filter(line => line.trim());
        if (stashLines.length > stashCountBefore) {
          // Get the most recent stash (first in list)
          stashRef = stashLines[0].match(/^(stash@\{\d+\})/)?.[1] || null;
          p.log.info(`Stash created: ${stashRef}`);
        }
      }
      
      if (!stashRef) {
        p.log.error('Failed to verify stash creation, aborting checkout');
        process.exit(1);
      }
    }

    // Fetch latest changes
    p.log.info('Fetching latest changes...');
    const fetchResult = await this.git.fetch();
    if (!fetchResult.success) {
      p.log.warning('Failed to fetch latest changes, continuing anyway');
    }

    // Attempt checkout
    p.log.info(`Switching to branch '${targetBranch}'...`);
    const checkoutSuccess = await this.git.checkout(targetBranch);
    
    if (!checkoutSuccess) {
      // Restore stash if checkout failed
      if (stashRef) {
        p.log.warning('Checkout failed, restoring stash...');
        const restoreResult = await this.git.restoreStash(stashRef);
        if (restoreResult.success) {
          p.log.info('Stash restored successfully');
        } else {
          p.log.error(`Failed to restore stash. Manual restore: git stash pop ${stashRef}`);
        }
      }
      p.log.error('Checkout failed');
      process.exit(1);
    }

    // Update from remote if tracking branch exists
    if (await this.git.hasRemoteBranch(targetBranch)) {
      p.log.info('Updating from remote...');
      if (await this.git.fastForwardMerge(targetBranch)) {
        p.log.info('Successfully updated from remote');
      } else {
        p.log.warning('Could not fast-forward merge, you may need to handle conflicts manually');
      }
    }

    // Restore stash if it was created
    if (stashRef) {
      p.log.info('Restoring stashed changes...');
      
      // Check current status before restoring stash
      const currentStatus = await this.git.getStatus();
      if (currentStatus.hasChanges) {
        p.log.warning('Working directory has changes, stash restore might conflict');
      }
      
      const restoreResult = await this.git.restoreStash(stashRef);
      if (restoreResult.success) {
        p.log.success('Stashed changes restored successfully');
      } else {
        // Check if it's a conflict or other error
        const errorMsg = restoreResult.stderr || restoreResult.stdout;
        if (errorMsg.includes('conflict') || errorMsg.includes('CONFLICT')) {
          p.log.warning('Stash restore conflicts detected!');
          p.log.info('Resolve conflicts and then run: git stash drop');
        } else {
          p.log.error(`Failed to restore stash: ${errorMsg}`);
          p.log.info(`Manual restore: git stash pop ${stashRef}`);
        }
      }
    }

    p.log.success(`Successfully switched to branch '${targetBranch}'`);
    return { success: true, stdout: `Successfully switched to branch '${targetBranch}'`, stderr: '', exitCode: 0 };
  }
}