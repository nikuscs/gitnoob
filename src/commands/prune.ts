import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class PruneCommand implements GitCommand {
  private git: GitOperations;
  private remote: string;
  private force: boolean;
  private includeOrphaned: boolean;

  constructor() {
    this.git = new GitOperations();
    this.remote = 'origin';
    this.force = false;
    this.includeOrphaned = false;
  }

  async execute(args: string[]): Promise<GitResult> {
    // Parse arguments
    this.force = args.includes('--force') || args.includes('-f');
    this.includeOrphaned = args.includes('--include-orphaned');
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

    // Collect all branches to be deleted
    const allBranchesToDelete = [
      ...analysis.staleBranches,
      ...analysis.goneBranches,
      ...(this.includeOrphaned ? analysis.orphanedBranches : [])
    ];

    // Display different categories of branches found
    let hasAnyBranches = false;

    if (analysis.staleBranches.length > 0) {
      hasAnyBranches = true;
      p.log.info('Found branches that no longer exist on remote:');
      for (const branch of analysis.staleBranches) {
        console.log(`  - ${branch} (stale remote tracking)`);
      }
      console.log();
    }

    if (analysis.goneBranches.length > 0) {
      hasAnyBranches = true;
      p.log.info('Found branches with deleted remote upstreams:');
      for (const branch of analysis.goneBranches) {
        console.log(`  - ${branch} (upstream gone)`);
      }
      console.log();
    }

    if (analysis.orphanedBranches.length > 0) {
      hasAnyBranches = true;
      if (this.includeOrphaned) {
        p.log.warning('Found local branches without remote tracking (WILL BE DELETED):');
        for (const branch of analysis.orphanedBranches) {
          console.log(`  - ${branch} (no upstream) ⚠️`);
        }
        p.log.warning('⚠️  These branches have no remote tracking and may contain unsynced work!');
      } else {
        p.log.warning('Found local branches without remote tracking:');
        for (const branch of analysis.orphanedBranches) {
          console.log(`  - ${branch} (no upstream)`);
        }
        p.log.warning('⚠️  These branches have no remote tracking and may contain unsynced work!');
        p.log.info('To include these in deletion, use --include-orphaned flag');
      }
      console.log();
    }

    if (!hasAnyBranches) {
      p.log.success('No stale branches found');
      return { success: true, stdout: 'No stale branches found', stderr: '', exitCode: 0 };
    }

    if (allBranchesToDelete.length === 0) {
      p.log.success('No safe branches to delete automatically');
      p.log.info('Use --include-orphaned to include untracked branches');
      return { success: true, stdout: 'No safe branches to delete', stderr: '', exitCode: 0 };
    }

    // Ask for confirmation
    const confirmed = await p.confirm({
      message: `Delete ${allBranchesToDelete.length} stale branches?`,
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
    const result = await this.deleteBranches(allBranchesToDelete);
    return result;
  }

  private async analyzeBranches() {
    const analysis = {
      localBranches: await this.git.getLocalBranchesWithUpstream(),
      remoteBranches: await this.git.getRemoteBranches(),
      liveBranches: await this.git.getRemoteLiveBranches(this.remote),
      branchesWithoutUpstream: await this.git.getLocalBranchesWithoutUpstream(),
      branchesWithGoneUpstream: await this.git.getBranchesWithGoneUpstream(),
      staleBranches: [] as string[],
      orphanedBranches: [] as string[],
      goneBranches: [] as string[],
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

    // Find branches with gone upstream (already deleted remotely)
    const goneBranchNames = new Set<string>();
    for (const { local } of analysis.branchesWithGoneUpstream) {
      analysis.goneBranches.push(local);
      goneBranchNames.add(local);
    }

    // Find stale local branches with upstream tracking (but exclude gone branches)
    const activeBranches = analysis.noConnection ? analysis.remoteBranches : analysis.liveBranches;

    for (const { local, remote } of analysis.localBranches) {
      if (!goneBranchNames.has(local) && !activeBranches.includes(remote)) {
        analysis.staleBranches.push(local);
      }
    }

    // Find orphaned branches (no upstream tracking at all)
    const currentBranch = await this.getCurrentBranch();
    const mainBranches = ['main', 'master', 'develop', 'development'];

    analysis.orphanedBranches = analysis.branchesWithoutUpstream.filter(branch =>
      branch !== currentBranch && !mainBranches.includes(branch)
    );

    return analysis;
  }

  private async getCurrentBranch(): Promise<string> {
    const result = await this.git['execute']('branch', ['--show-current']);
    return result.success ? result.stdout.trim() : '';
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