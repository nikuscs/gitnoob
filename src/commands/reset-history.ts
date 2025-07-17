import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class ResetHistoryCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private async getRemoteUrl(): Promise<string | null> {
    const result = await this.git.execute('config', ['--get', 'remote.origin.url']);
    if (!result.success) return null;

    // Extract repo name from URL
    const url = result.stdout;
    const match = url.match(/(?:https:\/\/github\.com\/|git@github\.com:)([^\/]+\/[^\/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  }

  async execute(args: string[]): Promise<GitResult> {
    p.intro('⚠️  Git History Reset - DANGER ZONE ⚠️');

    // Pre-flight checks
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    // Get repo name
    const repoName = await this.getRemoteUrl();
    if (!repoName) {
      p.log.error('Could not determine repository name from remote URL');
      process.exit(1);
    }

    p.log.warning('This command will PERMANENTLY DELETE ALL GIT HISTORY!');
    p.log.warning('This action cannot be undone.');
    p.log.info(`Repository: ${repoName}`);

    // First confirmation
    const firstConfirm = await p.confirm({
      message: 'Do you want to proceed with resetting git history?',
      initialValue: false
    });

    if (p.isCancel(firstConfirm) || !firstConfirm) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Second confirmation
    const secondConfirm = await p.confirm({
      message: 'Are you absolutely sure? This will delete ALL commit history!',
      initialValue: false
    });

    if (p.isCancel(secondConfirm) || !secondConfirm) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Third confirmation - repo name
    const repoConfirm = await p.text({
      message: `Please type the repository name to confirm: ${repoName}`,
      validate: (value) => {
        if (value !== repoName) {
          return 'Repository name does not match. Please type exactly: ' + repoName;
        }
      }
    });

    if (p.isCancel(repoConfirm) || repoConfirm !== repoName) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Final confirmation
    const finalConfirm = await p.text({
      message: 'Type "yes, im sure" to proceed with history reset:',
      validate: (value) => {
        if (value !== 'yes, im sure') {
          return 'Please type exactly: yes, im sure';
        }
      }
    });

    if (p.isCancel(finalConfirm) || finalConfirm !== 'yes, im sure') {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    p.log.warning('Starting git history reset...');

    try {
      // Step 1: Create orphan branch
      p.log.info('Creating orphan branch...');
      const orphanResult = await this.git.execute('checkout', ['--orphan', 'latest_branch']);
      if (!orphanResult.success) {
        throw new Error('Failed to create orphan branch: ' + orphanResult.stderr);
      }

      // Step 2: Add all files
      p.log.info('Adding all files...');
      const addResult = await this.git.execute('add', ['-A']);
      if (!addResult.success) {
        throw new Error('Failed to add files: ' + addResult.stderr);
      }

      // Step 3: Initial commit
      p.log.info('Creating initial commit...');
      const commitResult = await this.git.execute('commit', ['-am', 'initial commit']);
      if (!commitResult.success) {
        throw new Error('Failed to create initial commit: ' + commitResult.stderr);
      }

      // Step 4: Delete main branch
      p.log.info('Deleting old main branch...');
      const deleteResult = await this.git.execute('branch', ['-D', 'main']);
      if (!deleteResult.success) {
        p.log.warning('Could not delete main branch (may not exist): ' + deleteResult.stderr);
      }

      // Step 5: Rename current branch to main
      p.log.info('Renaming branch to main...');
      const renameResult = await this.git.execute('branch', ['-m', 'main']);
      if (!renameResult.success) {
        throw new Error('Failed to rename branch to main: ' + renameResult.stderr);
      }

      // Step 6: Force push to origin
      p.log.info('Force pushing to origin...');
      const pushResult = await this.git.execute('push', ['-f', 'origin', 'main']);
      if (!pushResult.success) {
        throw new Error('Failed to force push: ' + pushResult.stderr);
      }

      p.log.success('✅ Git history has been reset successfully!');
      p.log.info('All previous commits have been removed and replaced with a single initial commit.');

      return {
        success: true,
        stdout: 'Git history reset successfully',
        stderr: '',
        exitCode: 0
      };

    } catch (error) {
      p.log.error('❌ Failed to reset git history: ' + (error instanceof Error ? error.message : 'Unknown error'));
      p.log.warning('Your repository may be in an inconsistent state. Please check manually.');

      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: 1
      };
    }
  }
} 