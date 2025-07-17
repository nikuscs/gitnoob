import { GitOperations } from '../core/git';
import * as p from '@clack/prompts';

export class BranchSelector {
  private git: GitOperations;

  constructor(git: GitOperations) {
    this.git = git;
  }

  async selectBranch(targetBranch: string): Promise<string | null> {
    // Check if branch exists locally
    if (await this.git.branchExists(targetBranch)) {
      return targetBranch;
    }

    p.log.warning(`Branch '${targetBranch}' not found locally`);
    
    const branches = await this.git.getAllBranches();
    const allBranches = [...new Set([...branches.local, ...branches.remote])];
    
    if (allBranches.length === 0) {
      p.log.error('No branches available');
      return null;
    }

    // Find similar branches (case-insensitive partial match)
    const suggestions = allBranches
      .filter(branch => branch.toLowerCase().includes(targetBranch.toLowerCase()) || 
                       targetBranch.toLowerCase().includes(branch.toLowerCase()))
      .slice(0, 10);

    if (suggestions.length === 0) {
      // If no similar branches, show all branches
      suggestions.push(...allBranches.slice(0, 10));
    }

    // Add option to cancel
    const choices = [
      ...suggestions.map(branch => ({
        value: branch,
        label: branches.local.includes(branch) ? 
          `${branch} (local)` : 
          `${branch} (remote)`
      })),
      { value: 'cancel', label: 'Cancel operation' }
    ];

    const selectedBranch = await p.select({
      message: 'Select a branch to checkout:',
      options: choices
    });

    if (p.isCancel(selectedBranch) || selectedBranch === 'cancel') {
      return null;
    }

    return selectedBranch as string;
  }
}