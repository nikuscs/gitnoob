import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class ForcePushCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private async selectTargetBranch(currentBranch: string): Promise<string> {
    const branches = await this.git.getAllBranches();
    const mainBranches = ['main', 'master', 'develop', 'development', 'dev'];

    // Find the main branch that exists and is different from current branch
    const existingMainBranch = mainBranches.find(branch =>
      branch !== currentBranch && (branches.local.includes(branch) || branches.remote.includes(`origin/${branch}`))
    );

    if (existingMainBranch) {
      const shouldUseDefault = await p.confirm({
        message: `⚠️  Force push '${currentBranch}' to overwrite '${existingMainBranch}'?`,
        initialValue: true
      });

      if (shouldUseDefault) {
        return existingMainBranch;
      }
    }

    // Let user select from available branches
    const currentBranchName = await this.git.getCurrentBranch();
    const targetOptions = [...new Set([...branches.local, ...branches.remote])]
      .filter(branch => branch !== currentBranchName && !branch.startsWith('origin/'))
      .map(branch => ({ value: branch, label: branch }));

    const selectedBranch = await p.select({
      message: '⚠️  Select target branch to FORCE OVERWRITE:',
      options: targetOptions
    });

    if (p.isCancel(selectedBranch)) {
      throw new Error('Operation cancelled');
    }

    return selectedBranch as string;
  }

  async execute(args: string[]): Promise<GitResult> {
    p.intro('💥 Force Push - Overwrite Target Branch');

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

    // Check if everything is committed and handle uncommitted changes
    const status = await this.git.getStatus();
    if (status.hasChanges) {
      p.log.warning('You have uncommitted changes');
      const shouldCommit = await p.confirm({
        message: 'Commit all changes before force pushing?',
        initialValue: true
      });

      if (p.isCancel(shouldCommit) || !shouldCommit) {
        p.log.info('Please commit or stash your changes before force pushing');
        process.exit(1);
      }

      // Stage all changes
      const addResult = await this.git.execute('add', ['.']);
      if (!addResult.success) {
        p.log.error('Failed to stage changes');
        process.exit(1);
      }

      // Get commit message
      const commitMessage = await p.text({
        message: 'Commit message:',
        placeholder: 'Prepare for force push',
        defaultValue: 'Prepare for force push'
      });

      if (p.isCancel(commitMessage)) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
      }

      // Create commit
      const commitResult = await this.git.execute('commit', ['-m', commitMessage as string]);
      if (!commitResult.success) {
        p.log.error('Failed to create commit');
        p.log.error(commitResult.stderr);
        process.exit(1);
      }

      p.log.success('Changes committed successfully');
    } else {
      // Tree is clean, but create a "force-push marker" commit to register this operation
      const shouldCreateMarker = await p.confirm({
        message: 'Create a force-push marker commit to register this operation?',
        initialValue: true
      });

      if (!p.isCancel(shouldCreateMarker) && shouldCreateMarker) {
        const markerMessage = `Force-push preparation commit (${new Date().toISOString()})`;
        const markerResult = await this.git.execute('commit', ['--allow-empty', '-m', markerMessage]);

        if (markerResult.success) {
          p.log.success('Force-push marker commit created');
        } else {
          p.log.warning('Failed to create marker commit, proceeding anyway');
        }
      }
    }

    // Get target branch from args or prompt user
    let targetBranch: string;
    if (args.length > 0) {
      targetBranch = args[0];
      p.log.info(`Target branch: ${targetBranch}`);
    } else {
      targetBranch = await this.selectTargetBranch(currentBranch);
    }

    // Prevent force pushing to self
    if (targetBranch === currentBranch) {
      p.log.error('Cannot force push to the same branch you are on');
      process.exit(1);
    }

    // FIRST CONFIRMATION - Show warning about what will happen
    p.log.warning('⚠️  DANGER ZONE ⚠️');
    p.log.warning(`This will:`);
    p.log.warning(`• Force push your '${currentBranch}' branch to 'origin/${targetBranch}'`);
    p.log.warning(`• OVERWRITE all remote commits in '${targetBranch}' with your local '${currentBranch}'`);
    p.log.warning(`• Make 'origin/${targetBranch}' identical to your current '${currentBranch}' branch`);
    p.log.warning(`• This action CANNOT be undone easily!`);

    const firstConfirm = await p.confirm({
      message: `Do you understand that this will PERMANENTLY OVERWRITE 'origin/${targetBranch}'?`,
      initialValue: false
    });

    if (p.isCancel(firstConfirm) || !firstConfirm) {
      p.cancel('Operation cancelled - no changes made');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // SECOND CONFIRMATION - Final safety check
    p.log.warning('🚨 FINAL WARNING 🚨');
    p.log.warning(`Last chance to abort! You are about to DESTROY all commits in 'origin/${targetBranch}' that are not in '${currentBranch}'`);

    const finalConfirm = await p.confirm({
      message: `Type 'yes' to confirm: Are you absolutely, 100% certain you want to force overwrite 'origin/${targetBranch}' with '${currentBranch}'?`,
      initialValue: false
    });

    if (p.isCancel(finalConfirm) || !finalConfirm) {
      p.cancel('Operation cancelled - no changes made');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Execute the force push
    p.log.info(`Force pushing '${currentBranch}' to 'origin/${targetBranch}'...`);

    const pushResult = await this.git.execute('push', ['--force-with-lease', 'origin', `${currentBranch}:${targetBranch}`]);

    if (!pushResult.success) {
      p.log.error('Force push failed!');
      p.log.error(pushResult.stderr || pushResult.stdout);

      // Check if it's a force-with-lease issue
      if (pushResult.stderr?.includes('force-with-lease')) {
        p.log.info('💡 Tip: Someone else may have pushed to the target branch.');
        p.log.info('   If you\'re sure you want to overwrite, you can use regular force push:');
        p.log.info(`   git push --force origin ${currentBranch}:${targetBranch}`);
      }

      process.exit(1);
    }

    // Success!
    p.log.success('💥🎉 Force push completed successfully!');
    p.log.info(`The remote branch 'origin/${targetBranch}' now matches your local '${currentBranch}' branch`);

    // Optionally offer to update local target branch
    if (targetBranch !== currentBranch) {
      const shouldUpdateLocal = await p.confirm({
        message: `Update your local '${targetBranch}' branch to match the new remote?`,
        initialValue: true
      });

      if (!p.isCancel(shouldUpdateLocal) && shouldUpdateLocal) {
        // Check if local target branch exists
        const branches = await this.git.getAllBranches();
        if (branches.local.includes(targetBranch)) {
          // Switch to target branch and reset it
          await this.git.execute('checkout', [targetBranch]);
          const resetResult = await this.git.execute('reset', ['--hard', `origin/${targetBranch}`]);

          if (resetResult.success) {
            p.log.success(`Local '${targetBranch}' branch updated`);
            // Switch back to original branch
            await this.git.execute('checkout', [currentBranch]);
          } else {
            p.log.warning(`Failed to update local '${targetBranch}' branch`);
          }
        } else {
          p.log.info(`Local '${targetBranch}' branch doesn't exist - you can create it with:`);
          p.log.info(`git checkout -b ${targetBranch} origin/${targetBranch}`);
        }
      }
    }

    return {
      success: true,
      stdout: pushResult.stdout,
      stderr: '',
      exitCode: 0,
      message: 'Force push completed successfully'
    };
  }
}