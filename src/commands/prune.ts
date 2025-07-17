import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class PruneCommand implements GitCommand {
  private git: GitOperations;
  private remote: string;
  private force: boolean;

  constructor() {
    this.git = new GitOperations();
    this.remote = 'origin';
    this.force = false;
  }

  async execute(args: string[]): Promise<GitResult> {
    // Parse arguments
    this.force = args.includes('--force') || args.includes('-f');
    const remoteIndex = args.indexOf('--remote');
    if (remoteIndex !== -1 && args[remoteIndex + 1]) {
      this.remote = args[remoteIndex + 1];
    }

    p.intro('Pruning local branches');

    // Pre-flight checks
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    // Check if remote exists
    if (!(await this.git.isRemoteAvailable(this.remote))) {
      p.log.error(`Remote '${this.remote}' not found`);
      const remoteResult = await this.git['execute']('remote', ['-v']);
      if (remoteResult.success) {
        p.log.info('Available remotes:');
        console.log(remoteResult.stdout);
      }
      process.exit(1);
    }

    // Fetch with prune to update remote references
    p.log.info('Fetching latest changes and pruning remote references...');
    const fetchResult = await this.git.fetch();
    if (!fetchResult.success) {
      p.log.error('Failed to fetch latest changes');
      process.exit(1);
    }

    // Get comprehensive branch analysis
    const analysis = await this.analyzeBranches();
    
    if (analysis.noConnection) {
      p.log.warning('Unable to connect to remote host. Using cached remote references.');
    }

    if (analysis.outdatedRemotes.length > 0) {
      p.log.warning('Your git repository has outdated remote references:');
      for (const branch of analysis.outdatedRemotes) {
        console.log(`  - ${branch}`);
      }
      p.log.info('Consider running: git fetch -p');
    }

    if (analysis.staleBranches.length === 0) {
      p.log.success('No stale branches found');
      return { success: true, stdout: 'No stale branches found', stderr: '', exitCode: 0 };
    }

    // Display branches to be deleted
    p.log.info('Found branches that no longer exist on remote:');
    for (const branch of analysis.staleBranches) {
      console.log(`  - ${branch}`);
    }

    // Ask for confirmation
    const confirmed = await p.confirm({
      message: `Delete ${analysis.staleBranches.length} stale branches?`,
      initialValue: false
    });

    if (p.isCancel(confirmed)) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    if (!confirmed) {
      p.log.info('Pruning cancelled');
      return { success: false, stdout: '', stderr: 'Pruning cancelled', exitCode: 1 };
    }

    // Delete branches
    const result = await this.deleteBranches(analysis.staleBranches);
    return result;
  }

  private async analyzeBranches() {
    const analysis = {
      localBranches: await this.git.getLocalBranchesWithUpstream(),
      remoteBranches: await this.git.getRemoteBranches(),
      liveBranches: await this.git.getRemoteLiveBranches(this.remote),
      staleBranches: [] as string[],
      outdatedRemotes: [] as string[],
      noConnection: false
    };

    // Check if we could connect to remote
    if (analysis.liveBranches.length === 0) {
      // Try to determine if it's a connection issue
      const isAvailable = await this.git.isRemoteAvailable(this.remote);
      if (isAvailable) {
        analysis.noConnection = true;
        // Fall back to using cached remote branches
        analysis.liveBranches = analysis.remoteBranches;
      }
    }

    // Find outdated cached remote branches
    if (!analysis.noConnection) {
      analysis.outdatedRemotes = analysis.remoteBranches.filter(
        branch => !analysis.liveBranches.includes(branch) && branch !== 'HEAD'
      );
    }

    // Find stale local branches
    const activeBranches = analysis.noConnection ? analysis.remoteBranches : analysis.liveBranches;
    
    for (const { local, remote } of analysis.localBranches) {
      if (!activeBranches.includes(remote)) {
        analysis.staleBranches.push(local);
      }
    }

    return analysis;
  }

  private async deleteBranches(branches: string[]): Promise<GitResult> {
    const failed: string[] = [];
    const deleteFlag = this.force ? '-D' : '-d';

    for (const branch of branches) {
      p.log.info(`Deleting branch: ${branch}`);
      
      const result = await this.git['execute']('branch', [deleteFlag, branch]);
      if (!result.success) {
        p.log.error(`Failed to delete '${branch}': ${result.stderr}`);
        failed.push(branch);
      }
    }

    const deletedCount = branches.length - failed.length;
    
    if (failed.length === 0) {
      p.log.success(`Successfully deleted ${deletedCount} branches`);
      return { success: true, stdout: `Successfully deleted ${deletedCount} branches`, stderr: '', exitCode: 0 };
    } else {
      p.log.warning(`Deleted ${deletedCount} of ${branches.length} branches`);
      p.log.info('Failed to delete:');
      for (const branch of failed) {
        console.log(`  - ${branch}`);
      }
      
      if (!this.force) {
        p.log.info('To force deletion, use: gitnoob prune --force');
      }
      
      return { success: false, stdout: `Deleted ${deletedCount} of ${branches.length} branches`, stderr: `Failed to delete ${failed.length} branches`, exitCode: 1 };
    }
  }
}