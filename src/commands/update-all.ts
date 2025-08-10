import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class UpdateAllCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  async execute(args: string[]): Promise<GitResult> {
    const useRebase = !args.includes('--no-rebase');
    const strategy = useRebase ? 'rebase' : 'merge';
    
    p.intro(`Updating all local branches (${strategy})`);

    // Pre-flight checks
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    // Get current branch to switch back to it later
    const originalBranch = await this.git.getCurrentBranch();
    if (!originalBranch) {
      p.log.error('Could not determine current branch');
      process.exit(1);
    }

    // Check for uncommitted changes
    const status = await this.git.getStatus();
    let stashMessage = null;

    if (status.hasChanges) {
      p.log.info('Uncommitted changes detected, creating stash...');
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      stashMessage = `gitnoob-update-all-${timestamp}`;
      
      const stashResult = await this.git.stashChanges(stashMessage);
      if (!stashResult.success) {
        p.log.error(`Failed to create stash: ${stashResult.stderr}`);
        process.exit(1);
      }
    }

    // Fetch all remotes
    p.log.info('Fetching all remotes...');
    const fetchResult = await this.git.execute('fetch', ['--all']);
    if (!fetchResult.success) {
      p.log.error(`Failed to fetch: ${fetchResult.stderr}`);
      process.exit(1);
    }

    // Get all local branches
    const branches = await this.git.getLocalBranches();
    if (branches.length === 0) {
      p.log.error('No local branches found');
      process.exit(1);
    }

    p.log.info(`Found ${branches.length} local branches to update`);

    const results = {
      updated: [] as string[],
      upToDate: [] as string[],
      failed: [] as string[],
      skipped: [] as string[]
    };

    // Update each branch
    for (const branch of branches) {
      // Skip if branch has no upstream
      const upstreamBranch = await this.git.getUpstreamBranch(branch);
      if (!upstreamBranch) {
        p.log.info(`Skipping ${branch} (no upstream configured)`);
        results.skipped.push(branch);
        continue;
      }

      // Check if branch is behind remote
      const behindCount = await this.git.getBehindCount(branch, upstreamBranch);
      if (behindCount === 0) {
        results.upToDate.push(branch);
        continue;
      }

      p.log.info(`Updating ${branch} (${behindCount} commits behind)...`);

      // Checkout the branch
      const checkoutResult = await this.git.checkout(branch);
      if (!checkoutResult) {
        p.log.error(`Failed to checkout ${branch}`);
        results.failed.push(branch);
        continue;
      }

      // Attempt to update branch
      const updateResult = useRebase 
        ? await this.git.rebaseFromUpstream(upstreamBranch)
        : await this.git.mergeFromUpstream(upstreamBranch);

      if (!updateResult.success) {
        // Check if it's a conflict
        const isConflict = updateResult.stderr?.includes('conflict') || 
                          updateResult.stderr?.includes('CONFLICT');

        if (isConflict) {
          p.log.warning(`Conflicts detected in ${branch}, aborting...`);
          // Abort the rebase/merge
          if (useRebase) {
            await this.git.execute('rebase', ['--abort']);
          } else {
            await this.git.execute('merge', ['--abort']);
          }
          results.failed.push(`${branch} (conflicts)`);
        } else {
          results.failed.push(branch);
        }
      } else {
        results.updated.push(branch);
      }
    }

    // Switch back to original branch
    p.log.info(`Switching back to ${originalBranch}...`);
    const switchBackResult = await this.git.checkout(originalBranch);
    if (!switchBackResult) {
      p.log.error(`Failed to switch back to ${originalBranch}`);
    }

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

    // Print summary
    p.outro('Update Summary:');
    if (results.updated.length > 0) {
      p.log.success(`Updated: ${results.updated.join(', ')}`);
    }
    if (results.upToDate.length > 0) {
      p.log.info(`Already up-to-date: ${results.upToDate.join(', ')}`);
    }
    if (results.skipped.length > 0) {
      p.log.info(`Skipped (no upstream): ${results.skipped.join(', ')}`);
    }
    if (results.failed.length > 0) {
      p.log.error(`Failed: ${results.failed.join(', ')}`);
    }

    const hasFailures = results.failed.length > 0;
    return { 
      success: !hasFailures, 
      stdout: `Updated ${results.updated.length} branches`, 
      stderr: hasFailures ? `Failed to update ${results.failed.length} branches` : '', 
      exitCode: hasFailures ? 1 : 0 
    };
  }
}