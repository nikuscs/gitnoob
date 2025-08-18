import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
  relativeDate: string;
}

export class PatchCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private async getCommitHistory(limit: number = 20): Promise<CommitInfo[]> {
    // Format: hash|short|subject|author|date|relative
    const result = await this.git.execute('log', [
      `--max-count=${limit}`,
      '--pretty=format:%H|%h|%s|%an|%ai|%ar',
      '--no-merges'  // Skip merge commits for cleaner list
    ]);

    if (!result.success || !result.stdout) {
      return [];
    }

    return result.stdout.split('\n').map(line => {
      const [hash, shortHash, subject, author, date, relativeDate] = line.split('|');
      return {
        hash,
        shortHash,
        subject,
        author,
        date,
        relativeDate
      };
    });
  }

  private formatCommitForDisplay(commit: CommitInfo): string {
    // Truncate subject if too long
    const maxSubjectLength = 50;
    const subject = commit.subject.length > maxSubjectLength 
      ? commit.subject.substring(0, maxSubjectLength - 3) + '...'
      : commit.subject;

    return `${commit.shortHash} - ${subject} (${commit.relativeDate})`;
  }

  private async selectCommit(): Promise<string | null> {
    p.log.info('Loading commit history...');
    const commits = await this.getCommitHistory();
    
    if (commits.length === 0) {
      p.log.error('No commits found in history');
      return null;
    }

    const selectedCommit = await p.select({
      message: 'Select a commit to create patch for:',
      options: commits.map(commit => ({
        value: commit.hash,
        label: this.formatCommitForDisplay(commit)
      }))
    }) as string | symbol;

    if (p.isCancel(selectedCommit)) {
      return null;
    }

    return selectedCommit as string;
  }

  private parseArgs(args: string[]) {
    const result = {
      mode: 'branch' as 'branch' | 'commit' | 'staged' | 'compare',
      commit: null as string | null,
      compare: null as string | null,
      output: null as string | null
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === 'staged') {
        result.mode = 'staged';
      } else if (arg === 'commit') {
        result.mode = 'commit';
      } else if (arg === 'compare' && i + 1 < args.length) {
        result.mode = 'compare';
        result.compare = args[++i];
      } else if (arg === '--output' && i + 1 < args.length) {
        result.output = args[++i];
      } else if (result.mode === 'commit' && !result.commit && !arg.startsWith('--')) {
        // If mode is commit and we haven't set a commit hash yet
        result.commit = arg;
      } else if (result.mode === 'branch' && !result.commit && !arg.startsWith('--') && arg !== 'staged' && arg !== 'commit' && arg !== 'compare') {
        // If no mode specified and it's not a keyword, treat as commit hash
        result.mode = 'commit';
        result.commit = arg;
      }
    }

    return result;
  }

  private async generatePatchFilename(): Promise<string> {
    const currentBranch = await this.git.getCurrentBranch();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${currentBranch || 'patch'}-${timestamp}.patch`;
  }

  async execute(args: string[]): Promise<GitResult> {
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    const options = this.parseArgs(args);
    
    p.intro('🔧 Creating patch');

    let patchContent: string;
    let description: string;

    if (options.mode === 'staged') {
      p.log.info('Creating patch for staged changes...');
      const result = await this.git.execute('diff', ['--cached']);
      if (!result.success) {
        p.log.error('Failed to get staged changes');
        process.exit(1);
      }
      
      if (!result.stdout.trim()) {
        p.log.warning('No staged changes found');
        return { success: true, stdout: 'No staged changes found', stderr: '', exitCode: 0 };
      }
      
      patchContent = result.stdout;
      description = 'staged changes';
      
    } else if (options.mode === 'commit') {
      let commitHash = options.commit;
      
      if (!commitHash) {
        commitHash = await this.selectCommit();
        if (!commitHash) {
          p.cancel('Operation cancelled');
          return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
        }
      }
      
      p.log.info(`Creating patch for commit: ${commitHash.substring(0, 7)}`);
      const result = await this.git.execute('format-patch', ['-1', '--stdout', commitHash]);
      if (!result.success) {
        p.log.error(`Failed to create patch for commit: ${commitHash}`);
        process.exit(1);
      }
      
      patchContent = result.stdout;
      description = `commit ${commitHash.substring(0, 7)}`;
      
    } else if (options.mode === 'compare') {
      const currentBranch = await this.git.getCurrentBranch();
      if (!currentBranch) {
        p.log.error('Could not determine current branch');
        process.exit(1);
      }

      const baseBranch = options.compare!;
      p.log.info(`Creating patch from ${baseBranch}..${currentBranch}`);
      
      const result = await this.git.execute('format-patch', ['--stdout', `${baseBranch}..${currentBranch}`]);
      if (!result.success) {
        p.log.error(`Failed to create patch from ${baseBranch}..${currentBranch}`);
        process.exit(1);
      }

      if (!result.stdout.trim()) {
        p.log.warning(`No differences found between ${baseBranch} and ${currentBranch}`);
        return { success: true, stdout: `No differences found between ${baseBranch} and ${currentBranch}`, stderr: '', exitCode: 0 };
      }
      
      patchContent = result.stdout;
      description = `${baseBranch}..${currentBranch}`;
      
    } else {
      // Default branch mode
      const currentBranch = await this.git.getCurrentBranch();
      if (!currentBranch) {
        p.log.error('Could not determine current branch');
        process.exit(1);
      }

      const selectedBranch = await this.selectBaseBranch(currentBranch);
      if (!selectedBranch) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
      }
      const baseBranch = selectedBranch;

      p.log.info(`Creating patch from ${baseBranch}..${currentBranch}`);
      
      const result = await this.git.execute('format-patch', ['--stdout', `${baseBranch}..${currentBranch}`]);
      if (!result.success) {
        p.log.error(`Failed to create patch from ${baseBranch}..${currentBranch}`);
        process.exit(1);
      }

      if (!result.stdout.trim()) {
        p.log.warning(`No differences found between ${baseBranch} and ${currentBranch}`);
        return { success: true, stdout: `No differences found between ${baseBranch} and ${currentBranch}`, stderr: '', exitCode: 0 };
      }
      
      patchContent = result.stdout;
      description = `${baseBranch}..${currentBranch}`;
    }

    const filename = options.output || await this.generatePatchFilename();
    const fullPath = join(process.cwd(), filename);

    try {
      writeFileSync(fullPath, patchContent);
      p.log.success(`Patch created successfully: ${filename}`);
      p.log.info(`Patch contains ${description}`);
      p.log.info(`Saved to: ${fullPath}`);
      
      const stats = this.getPatchStats(patchContent);
      if (stats) {
        p.log.info(`Files changed: ${stats.files}, insertions: ${stats.insertions}, deletions: ${stats.deletions}`);
      }
      
      return { 
        success: true, 
        stdout: `Patch created: ${filename}`, 
        stderr: '', 
        exitCode: 0,
        message: `Patch file created at ${fullPath}`
      };
      
    } catch (error) {
      p.log.error(`Failed to write patch file: ${error}`);
      return { success: false, stdout: '', stderr: `Failed to write patch file: ${error}`, exitCode: 1 };
    }
  }

  private async selectBaseBranch(currentBranch: string): Promise<string | null> {
    const commonBases = ['main', 'master', 'develop', 'dev'];
    const availableBases: string[] = [];
    
    // Check which common base branches exist
    for (const base of commonBases) {
      if (base !== currentBranch) {
        const result = await this.git.execute('show-ref', ['--verify', '--quiet', `refs/heads/${base}`]);
        if (result.success) {
          availableBases.push(base);
        }
      }
    }
    
    // If no common bases found, get other local branches
    if (availableBases.length === 0) {
      const result = await this.git.execute('branch', ['--list']);
      if (result.success) {
        const branches = result.stdout
          .split('\n')
          .map((line: string) => line.replace(/^\s*\*?\s*/, '').trim())
          .filter((branch: string) => branch && branch !== currentBranch);
        
        availableBases.push(...branches.slice(0, 5)); // Limit to 5 branches
      }
    }
    
    // Add fallback option
    availableBases.push('HEAD~1 (previous commit)');
    
    if (availableBases.length === 0) {
      p.log.error('No base branch found for comparison');
      return null;
    }
    
    // If only one option and it's a common base, use it automatically
    if (availableBases.length === 1 && commonBases.includes(availableBases[0])) {
      p.log.info(`Using ${availableBases[0]} as base branch`);
      return availableBases[0];
    }
    
    // Let user select
    const selectedBase = await p.select({
      message: `Select base branch to compare ${currentBranch} against:`,
      options: availableBases.map(branch => ({
        value: branch === 'HEAD~1 (previous commit)' ? 'HEAD~1' : branch,
        label: branch
      }))
    });
    
    if (p.isCancel(selectedBase)) {
      return null;
    }
    
    return selectedBase as string;
  }


  private getPatchStats(patchContent: string): { files: number; insertions: number; deletions: number } | null {
    const lines = patchContent.split('\n');
    let files = 0;
    let insertions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        files++;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        insertions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    return files > 0 ? { files, insertions, deletions } : null;
  }
}