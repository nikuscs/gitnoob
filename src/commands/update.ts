import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class UpdateCommand implements GitCommand {
  private git: GitOperations;
  private useRebase: boolean;

  constructor() {
    this.git = new GitOperations();
    this.useRebase = false;
  }

  async execute(args: string[]): Promise<GitResult> {
    // Parse arguments - rebase by default, --no-rebase to use merge
    this.useRebase = !args.includes('--no-rebase');
    const strategy = this.useRebase ? 'rebase' : 'merge';
    
    p.intro(`Updating current branch (${strategy})`);

    // Pre-flight checks
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    // Get current branch
    const currentBranch = await this.git.getCurrentBranch();
    if (!currentBranch) {
      p.log.error('Could not determine current branch');
      process.exit(1);
    }

    // Check if remote exists
    const remoteExists = await this.git.hasRemote();
    if (!remoteExists) {
      p.log.error('No remote repository configured');
      process.exit(1);
    }

    // Get upstream branch
    const upstreamBranch = await this.git.getUpstreamBranch(currentBranch);
    if (!upstreamBranch) {
      p.log.error(`No upstream branch configured for ${currentBranch}`);
      process.exit(1);
    }

    p.log.info(`Current branch: ${currentBranch}`);
    p.log.info(`Upstream branch: ${upstreamBranch}`);

    // Check for uncommitted changes
    const status = await this.git.getStatus();
    let stashMessage = null;

    if (status.hasChanges) {
      p.log.info('Uncommitted changes detected, creating stash...');
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      stashMessage = `gitnoob-update-${timestamp}`;
      
      const stashResult = await this.git.stashChanges(stashMessage);
      if (!stashResult.success) {
        p.log.error(`Failed to create stash: ${stashResult.stderr}`);
        process.exit(1);
      }
    }

    // Fetch latest changes
    p.log.info('Fetching latest changes...');
    const fetchResult = await this.git.fetch();
    if (!fetchResult.success) {
      p.log.error(`Failed to fetch: ${fetchResult.stderr}`);
      process.exit(1);
    }

    // Check if we're behind remote
    const behindCount = await this.git.getBehindCount(currentBranch, upstreamBranch);
    if (behindCount === 0) {
      p.log.success('Branch is already up to date');
      
      // Restore stash if we created one
      if (stashMessage) {
        p.log.info('Restoring stashed changes...');
        const stashRef = await this.git.findStash(stashMessage);
        if (stashRef) {
          const restoreResult = await this.git.restoreStash(stashRef);
          if (!restoreResult.success) {
            p.log.warning(`Failed to restore stash: ${restoreResult.stderr}`);
            p.log.info('Manually restore with: git stash pop');
          }
        }
      }
      
      return { success: true, stdout: 'Branch already up to date', stderr: '', exitCode: 0 };
    }

    // Attempt to update branch
    p.log.info(`Updating branch with ${strategy}...`);
    const updateResult = this.useRebase 
      ? await this.git.rebaseFromUpstream(upstreamBranch)
      : await this.git.mergeFromUpstream(upstreamBranch);

    if (!updateResult.success) {
      // Check if it's a conflict
      const isConflict = updateResult.stderr?.includes('conflict') || 
                        updateResult.stderr?.includes('CONFLICT') ||
                        updateResult.stderr?.includes('merge conflict');

      if (isConflict) {
        p.log.warning('Merge conflicts detected!');
        p.log.info(`Resolve conflicts in VSCode and then run:`);
        p.log.info(`  git add .`);
        p.log.info(`  git ${this.useRebase ? 'rebase --continue' : 'commit'}`);
        
        if (stashMessage) {
          p.log.info(`Your stashed changes: ${stashMessage}`);
          p.log.info('Restore after resolving conflicts: git stash pop');
        }
        
        return { 
          success: false, 
          stdout: '',
          stderr: 'Merge conflicts detected',
          exitCode: 1,
          requiresManualResolution: true 
        };
      }

      p.log.error(`Failed to update branch: ${updateResult.stderr}`);
      process.exit(1);
    }

    p.log.success(`Branch updated successfully with ${strategy}`);

    // Restore stash if we created one
    if (stashMessage) {
      p.log.info('Restoring stashed changes...');
      const stashRef = await this.git.findStash(stashMessage);
      if (stashRef) {
        const restoreResult = await this.git.restoreStash(stashRef);
        
        if (!restoreResult.success) {
          // Check if it's a conflict during stash restore
          const isStashConflict = restoreResult.stderr?.includes('conflict') || 
                                 restoreResult.stderr?.includes('CONFLICT');

          if (isStashConflict) {
            p.log.warning('Conflicts while restoring stashed changes!');
            p.log.info('Resolve conflicts in VSCode and then run:');
            p.log.info('  git add .');
            p.log.info('  git stash drop');
            return { 
              success: false, 
              stdout: '',
              stderr: 'Stash restore conflicts detected',
              exitCode: 1,
              requiresManualResolution: true 
            };
          }

          p.log.warning(`Failed to restore stash: ${restoreResult.stderr}`);
          p.log.info('Manually restore with: git stash pop');
        } else {
          p.log.success('Stashed changes restored successfully');
        }
      }
    }

    p.log.success('Branch update completed successfully');
    return { success: true, stdout: 'Branch updated successfully', stderr: '', exitCode: 0 };
  }
}