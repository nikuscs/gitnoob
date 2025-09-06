import { GitOperations } from '../core/git';
import { BranchSelector } from '../utils/branch-selector';
import { GitHubOperations } from '../utils/github';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

interface PRType {
  value: string;
  label: string;
  description?: string;
}

export class PRCommand implements GitCommand {
  private git: GitOperations;
  private branchSelector: BranchSelector;
  private github: GitHubOperations;

  constructor() {
    this.git = new GitOperations();
    this.branchSelector = new BranchSelector(this.git);
    this.github = new GitHubOperations();
  }

  private readonly prTypes: PRType[] = [
    { value: 'feat', label: 'feat - New feature', description: 'A new feature for the application' },
    { value: 'fix', label: 'fix - Bug fix', description: 'A fix for a bug or issue' },
    { value: 'chore', label: 'chore - Maintenance', description: 'Routine tasks, maintenance, or housekeeping' },
    { value: 'docs', label: 'docs - Documentation', description: 'Documentation changes or additions' },
    { value: 'refactor', label: 'refactor - Code refactoring', description: 'Code changes that neither fix bugs nor add features' },
    { value: 'test', label: 'test - Tests', description: 'Adding or updating tests' },
    { value: 'perf', label: 'perf - Performance', description: 'Performance improvements' },
    { value: 'build', label: 'build - Build system', description: 'Build system or dependency changes' },
    { value: 'ci', label: 'ci - CI/CD', description: 'Continuous integration or deployment changes' },
    { value: 'style', label: 'style - Code style', description: 'Code style changes (formatting, etc.)' },
    { value: 'custom', label: 'custom - Custom type', description: 'Enter your own custom type' }
  ];


  private async getBranchCommits(targetBranch: string): Promise<string[]> {
    const result = await this.git.execute('git', ['log', `${targetBranch}..HEAD`, '--oneline']);
    if (!result.success) return [];
    return result.stdout.split('\n').filter(line => line.trim()).slice(0, 5);
  }

  private generatePRTitle(type: string, commits: string[]): string {
    if (commits.length === 0) return `${type}: Quick PR`;
    
    // Try to extract meaningful info from first commit
    const firstCommit = commits[0];
    const commitMessage = firstCommit.split(' ').slice(1).join(' ');
    
    // Remove existing type prefixes from commit message
    const cleanMessage = commitMessage.replace(/^(feat|fix|chore|docs|refactor|test|perf|build|ci|style):\s*/, '');
    
    return `${type}: ${cleanMessage}`;
  }

  private async selectTargetBranch(): Promise<string> {
    const branches = await this.git.getAllBranches();
    const mainBranches = ['develop', 'development', 'dev', 'main', 'master'];
    
    // Find the main branch that exists
    const existingMainBranch = mainBranches.find(branch => 
      branches.local.includes(branch) || branches.remote.includes(`origin/${branch}`)
    );

    if (existingMainBranch) {
      const shouldUseDefault = await p.confirm({
        message: `Use '${existingMainBranch}' as target branch?`,
        initialValue: true
      });

      if (shouldUseDefault) {
        return existingMainBranch;
      }
    }

    // Let user select from available branches
    const currentBranchName = await this.git.getCurrentBranch();
    const targetOptions = [...new Set([...branches.local, ...branches.remote])]
      .filter(branch => branch !== currentBranchName)
      .map(branch => ({ value: branch, label: branch }));

    const selectedBranch = await p.select({
      message: 'Select target branch for PR:',
      options: targetOptions
    });

    if (p.isCancel(selectedBranch)) {
      throw new Error('Operation cancelled');
    }

    return selectedBranch as string;
  }

  private async checkForConflicts(targetBranch: string): Promise<boolean> {
    // Check if we can merge without conflicts
    const result = await this.git.execute('git', ['merge-tree', `origin/${targetBranch}`, 'HEAD']);
    return result.success && !result.stdout.includes('<<<<<<<');
  }

  async execute(args: string[]): Promise<GitResult> {
    p.intro('🚀 Creating a Pull Request');

    // Pre-flight checks
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    // Ensure GitHub CLI is ready (installed and authenticated)
    try {
      await this.github.ensureReady();
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : 'GitHub setup failed');
      process.exit(1);
    }

    const currentBranch = await this.git.getCurrentBranch();
    if (!currentBranch) {
      p.log.error('Could not determine current branch');
      process.exit(1);
    }

    // Check if everything is committed
    const status = await this.git.getStatus();
    if (status.hasChanges) {
      p.log.error('You have uncommitted changes');
      p.log.info('Please commit or stash your changes before creating a PR');
      process.exit(1);
    }

    // Push current branch if needed
    p.log.info('Pushing current branch...');
    const pushResult = await this.git.execute('push', ['-u', 'origin', currentBranch]);
    if (!pushResult.success) {
      p.log.error('Failed to push branch');
      p.log.error(pushResult.stderr || pushResult.stdout);
      process.exit(1);
    }

    // Select PR type
    const selectedType = await p.select({
      message: 'Select PR type:',
      options: this.prTypes.map(type => ({
        value: type.value,
        label: type.label,
        hint: type.description
      }))
    });

    if (p.isCancel(selectedType)) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    let prType = selectedType as string;

    // Handle custom type
    if (prType === 'custom') {
      const customType = await p.text({
        message: 'Enter custom type:',
        placeholder: 'e.g., hotfix, release, etc.'
      });

      if (p.isCancel(customType)) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
      }

      prType = customType as string;
    }

    // Select target branch
    const targetBranch = await this.selectTargetBranch();

    // Get commits for PR title generation
    const commits = await this.getBranchCommits(targetBranch);
    const suggestedTitle = this.generatePRTitle(prType, commits);

    // Get PR title
    const prTitle = await p.text({
      message: 'PR title:',
      placeholder: suggestedTitle,
      defaultValue: suggestedTitle
    });

    if (p.isCancel(prTitle)) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Get PR description
    const prDescription = await p.text({
      message: 'PR description (optional):',
      placeholder: 'Brief description of changes...'
    });

    if (p.isCancel(prDescription)) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    // Check for conflicts
    const hasConflicts = !(await this.checkForConflicts(targetBranch));
    let shouldAutoMerge = false;

    if (!hasConflicts) {
      shouldAutoMerge = await p.confirm({
        message: '✨ No conflicts detected! Auto-merge after creating PR?',
        initialValue: false
      });

      if (p.isCancel(shouldAutoMerge)) {
        shouldAutoMerge = false;
      }
    }

    // Create PR (always as draft initially)
    p.log.info('Creating draft PR...');
    
    const ghArgs = [
      'pr', 'create',
      '--title', prTitle as string,
      '--body', (prDescription as string) || 'Quick PR created with gitnoob',
      '--base', targetBranch,
      '--head', currentBranch,
      '--draft'
    ];

    const createResult = await this.github.execute(ghArgs.slice(1)); // Remove 'gh' from args
    
    if (!createResult.success) {
      p.log.error('Failed to create PR');
      p.log.error(createResult.stderr);
      process.exit(1);
    }

    // Extract PR number from output
    const prMatch = createResult.stdout.match(/\/pull\/(\d+)/);
    const prNumber = prMatch ? prMatch[1] : null;

    p.log.success('Draft PR created successfully!');
    p.log.info(`PR URL: ${createResult.stdout.trim()}`);

    // Auto-merge if requested and possible
    if (shouldAutoMerge && prNumber) {
      p.log.info('Converting to ready for review and auto-merging...');
      
      // Mark as ready for review
      const readyResult = await this.github.execute(['pr', 'ready', prNumber]);
      if (!readyResult.success) {
        p.log.warning('Could not mark PR as ready for review');
      } else {
        // Attempt auto-merge
        const mergeResult = await this.github.execute(['pr', 'merge', prNumber, '--squash', '--auto']);
        if (mergeResult.success) {
          p.log.success('🎉 PR auto-merged successfully!');
        } else {
          p.log.warning('Auto-merge failed, PR is ready for manual review');
        }
      }
    }

    return { 
      success: true, 
      stdout: createResult.stdout, 
      stderr: '', 
      exitCode: 0,
      message: 'PR created successfully'
    };
  }
}