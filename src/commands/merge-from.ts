import { GitOperations } from '../core/git';
import { BranchSelector } from '../utils/branch-selector';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class MergeFromCommand implements GitCommand {
  private git: GitOperations;
  private branchSelector: BranchSelector;

  constructor() {
    this.git = new GitOperations();
    this.branchSelector = new BranchSelector(this.git);
  }

  async execute(args: string[]): Promise<GitResult> {
    if (args.length === 0) {
      p.log.error('Please provide a branch name to merge from');
      p.log.info('Usage: gitnoob merge-from <branch>');
      p.log.info('  Aliases: slurp, absorb, yoink, assimilate');
      process.exit(1);
    }

    let sourceBranch = args[0];
    const useRebase = args.includes('--rebase');
    const strategy = useRebase ? 'rebase' : 'merge';

    // Fun easter egg messages based on alias used
    const funnyIntros: Record<string, string> = {
      'slurp': '🍜 Slurping changes from',
      'absorb': '🧽 Absorbing changes from',
      'yoink': '👋 Yoinking changes from',
      'assimilate': '🤖 Resistance is futile. Assimilating',
      'merge-from': '🔀 Merging changes from'
    };

    const commandAlias = process.argv[2] || 'merge-from';
    const intro = funnyIntros[commandAlias] || funnyIntros['merge-from'];
    
    p.intro(`${intro} ${sourceBranch}`);

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

    if (currentBranch === sourceBranch) {
      p.log.error(`Cannot merge branch '${sourceBranch}' into itself`);
      process.exit(1);
    }

    // Check if source branch exists, offer suggestions if not
    const selectedBranch = await this.branchSelector.selectBranch(sourceBranch);
    if (!selectedBranch) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }
    
    if (selectedBranch !== sourceBranch) {
      sourceBranch = selectedBranch;
      p.log.info(`Selected branch: ${sourceBranch}`);
    }

    p.log.info(`Current branch: ${currentBranch}`);
    p.log.info(`Source branch: ${sourceBranch}`);
    p.log.info(`Strategy: ${strategy}`);

    // Step 1: Check for uncommitted changes
    const status = await this.git.getStatus();
    let stashMessage = null;

    if (status.hasChanges) {
      p.log.info('Uncommitted changes detected, creating stash...');
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
      stashMessage = `gitnoob-merge-from-${timestamp}`;
      
      const stashResult = await this.git.stashChanges(stashMessage);
      if (!stashResult.success) {
        p.log.error(`Failed to create stash: ${stashResult.stderr}`);
        process.exit(1);
      }
    }

    // Step 2: Fetch latest changes
    p.log.info('Fetching latest changes...');
    const fetchResult = await this.git.fetch();
    if (!fetchResult.success) {
      p.log.warning('Failed to fetch latest changes, continuing anyway');
    }

    // Step 3: Update current branch from upstream if it has one
    const currentUpstream = await this.git.getUpstreamBranch(currentBranch);
    if (currentUpstream) {
      const behindCount = await this.git.getBehindCount(currentBranch, currentUpstream);
      if (behindCount > 0) {
        p.log.info(`Current branch is ${behindCount} commits behind upstream, updating...`);
        
        const updateResult = await this.git.rebaseFromUpstream(currentUpstream);
        if (!updateResult.success) {
          // Restore stash and exit
          if (stashMessage) {
            const stashRef = await this.git.findStash(stashMessage);
            if (stashRef) await this.git.restoreStash(stashRef);
          }
          p.log.error('Failed to update current branch from upstream');
          p.log.info('Please resolve conflicts and try again');
          process.exit(1);
        }
      }
    }

    // Step 4: Checkout and update source branch
    p.log.info(`Switching to source branch '${sourceBranch}'...`);
    const checkoutResult = await this.git.checkout(sourceBranch);
    if (!checkoutResult) {
      // Restore stash and exit
      if (stashMessage) {
        const stashRef = await this.git.findStash(stashMessage);
        if (stashRef) await this.git.restoreStash(stashRef);
      }
      p.log.error(`Failed to checkout branch '${sourceBranch}'`);
      process.exit(1);
    }

    // Update source branch from upstream if it has one
    const sourceUpstream = await this.git.getUpstreamBranch(sourceBranch);
    if (sourceUpstream) {
      const sourceBehindCount = await this.git.getBehindCount(sourceBranch, sourceUpstream);
      if (sourceBehindCount > 0) {
        p.log.info(`Source branch is ${sourceBehindCount} commits behind upstream, updating...`);
        
        const sourceUpdateResult = await this.git.rebaseFromUpstream(sourceUpstream);
        if (!sourceUpdateResult.success) {
          // Switch back to current branch
          await this.git.checkout(currentBranch);
          // Restore stash
          if (stashMessage) {
            const stashRef = await this.git.findStash(stashMessage);
            if (stashRef) await this.git.restoreStash(stashRef);
          }
          p.log.error('Failed to update source branch from upstream');
          p.log.info('Please resolve conflicts in the source branch first');
          process.exit(1);
        }
      }
    }

    // Step 5: Switch back to current branch
    p.log.info(`Switching back to '${currentBranch}'...`);
    const switchBackResult = await this.git.checkout(currentBranch);
    if (!switchBackResult) {
      p.log.error(`Failed to switch back to '${currentBranch}'`);
      process.exit(1);
    }

    // Step 6: Perform the merge/rebase
    p.log.info(`${useRebase ? 'Rebasing' : 'Merging'} changes from '${sourceBranch}'...`);
    
    const mergeResult = useRebase
      ? await this.git.execute('rebase', [sourceBranch])
      : await this.git.execute('merge', ['--no-ff', sourceBranch, '-m', `Merge branch '${sourceBranch}' into ${currentBranch}`]);

    if (!mergeResult.success) {
      // Check if it's a conflict
      const isConflict = mergeResult.stderr?.includes('conflict') || 
                        mergeResult.stderr?.includes('CONFLICT');

      if (isConflict) {
        p.log.warning('Merge conflicts detected!');
        p.log.info('Resolve conflicts in your editor and then run:');
        p.log.info('  git add .');
        p.log.info(`  git ${useRebase ? 'rebase --continue' : 'commit'}`);
        
        if (stashMessage) {
          p.log.info(`\nYour stashed changes: ${stashMessage}`);
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

      p.log.error(`Failed to ${useRebase ? 'rebase' : 'merge'}: ${mergeResult.stderr}`);
      process.exit(1);
    }

    p.log.success(`Successfully ${useRebase ? 'rebased' : 'merged'} changes from '${sourceBranch}'`);

    // Step 7: Restore stash if we created one
    if (stashMessage) {
      p.log.info('Restoring stashed changes...');
      const stashRef = await this.git.findStash(stashMessage);
      if (stashRef) {
        const restoreResult = await this.git.restoreStash(stashRef);
        
        if (!restoreResult.success) {
          const isStashConflict = restoreResult.stderr?.includes('conflict') || 
                                 restoreResult.stderr?.includes('CONFLICT');

          if (isStashConflict) {
            p.log.warning('Conflicts while restoring stashed changes!');
            p.log.info('Resolve conflicts in your editor and then run:');
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

    // Fun success messages
    const successMessages: Record<string, string> = {
      'slurp': '✨ Changes successfully slurped!',
      'absorb': '✨ Changes successfully absorbed!',
      'yoink': '✨ Changes successfully yoinked!',
      'assimilate': '✨ Assimilation complete. You are now one with the changes.',
      'merge-from': '✨ Merge completed successfully!'
    };

    const successMessage = successMessages[commandAlias] || successMessages['merge-from'];
    p.outro(successMessage);

    return { 
      success: true, 
      stdout: `Successfully ${useRebase ? 'rebased' : 'merged'} from ${sourceBranch}`, 
      stderr: '', 
      exitCode: 0 
    };
  }
}