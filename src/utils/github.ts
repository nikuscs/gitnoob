import { GitOperations } from '../core/git';
import type { GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class GitHubOperations {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private async executeGH(args: string[]): Promise<GitResult> {
    try {
      const proc = Bun.spawn(['gh', ...args], {
        stdout: 'pipe',
        stderr: 'pipe'
      });

      const result = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        success: result === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: result
      };
    } catch (err) {
      return {
        success: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Unknown error',
        exitCode: -1
      };
    }
  }

  async checkCLIInstalled(): Promise<boolean> {
    const result = await this.executeGH(['--version']);
    return result.success;
  }

  async ensureInstalled(): Promise<void> {
    if (!(await this.checkCLIInstalled())) {
      p.log.error('GitHub CLI (gh) is not installed');
      p.log.info('Install it with:');
      p.log.info('• macOS: brew install gh');
      p.log.info('• Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md');
      p.log.info('• Windows: https://github.com/cli/cli/releases');
      throw new Error('GitHub CLI not installed');
    }
  }

  async checkAuthenticated(): Promise<boolean> {
    const result = await this.executeGH(['auth', 'status']);
    return result.success;
  }

  async login(): Promise<boolean> {
    p.log.info('Starting GitHub authentication...');
    const result = await this.executeGH(['auth', 'login']);
    return result.success;
  }

  async ensureAuthenticated(): Promise<void> {
    if (!(await this.checkAuthenticated())) {
      p.log.warning('Not authenticated with GitHub');
      
      const shouldLogin = await p.confirm({
        message: 'Would you like to authenticate with GitHub now?',
        initialValue: true
      });

      if (p.isCancel(shouldLogin) || !shouldLogin) {
        throw new Error('GitHub authentication required');
      }

      const loginSuccess = await this.login();
      if (!loginSuccess) {
        p.log.error('GitHub authentication failed');
        p.log.info('You can manually authenticate with: gh auth login');
        throw new Error('GitHub authentication failed');
      }

      p.log.success('Successfully authenticated with GitHub!');
    }
  }

  async ensureReady(): Promise<void> {
    await this.ensureInstalled();
    await this.ensureAuthenticated();
  }

  async execute(args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return await this.executeGH(args);
  }
}