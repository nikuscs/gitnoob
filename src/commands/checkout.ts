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
    const timestamp = new Date().toISOString();
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

    if (status.hasUncommittedChanges || status.hasStagedChanges) {
      p.log.info('Uncommitted changes detected, creating stash...');
      stashMessage = this.generateStashMessage(currentBranch, targetBranch);
      
      if (!(await this.git.createStash(stashMessage))) {
        p.log.error('Failed to create stash, aborting checkout');
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
      if (stashMessage) {
        p.log.warning('Checkout failed, restoring stash...');
        const stashRef = await this.git.findStash(stashMessage);
        if (stashRef) {
          await this.git.restoreStash(stashRef);
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
    if (stashMessage) {
      p.log.info('Restoring stashed changes...');
      const stashRef = await this.git.findStash(stashMessage);
      if (stashRef) {
        const restoreResult = await this.git.restoreStash(stashRef);
        if (!restoreResult.success) {
          p.log.error(`Failed to restore stash. You may need to manually restore with: git stash pop ${stashRef}`);
        }
      }
    }

    p.log.success(`Successfully switched to branch '${targetBranch}'`);
    return { success: true, stdout: `Successfully switched to branch '${targetBranch}'`, stderr: '', exitCode: 0 };
  }
}