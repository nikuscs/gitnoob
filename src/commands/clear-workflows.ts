import { GitOperations } from '../core/git';
import { GitHubOperations } from '../utils/github';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';

export class ClearWorkflowsCommand implements GitCommand {
  private git: GitOperations;
  private github: GitHubOperations;

  constructor() {
    this.git = new GitOperations();
    this.github = new GitHubOperations();
  }

  async execute(args: string[]): Promise<GitResult> {
    p.intro('🧹 Clear Workflow Runs');

    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    try {
      await this.github.ensureReady();
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : 'GitHub setup failed');
      process.exit(1);
    }

    const shouldDelete = await p.confirm({
      message: 'Delete ALL workflow runs? This cannot be undone.',
      initialValue: false
    });

    if (p.isCancel(shouldDelete) || !shouldDelete) {
      p.cancel('Operation cancelled');
      return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
    }

    const s = p.spinner();
    s.start('Fetching workflow runs...');

    try {
      const repoResult = await this.github.execute([
        'repo', 'view',
        '--json', 'nameWithOwner',
        '-q', '.nameWithOwner'
      ]);

      if (!repoResult.success) {
        s.stop('Failed to get repository info');
        p.log.error(repoResult.stderr);
        return { success: false, stdout: '', stderr: repoResult.stderr, exitCode: 1 };
      }

      const repoPath = repoResult.stdout.trim();

      const runListResult = await this.github.execute([
        'run', 'list',
        '--json', 'databaseId',
        '-q', '.[].databaseId',
        '--limit', '1000'
      ]);

      if (!runListResult.success) {
        s.stop('Failed to fetch workflow runs');
        p.log.error(runListResult.stderr);
        return { success: false, stdout: '', stderr: runListResult.stderr, exitCode: 1 };
      }

      const runIds = runListResult.stdout
        .trim()
        .split('\n')
        .filter(id => id.trim());

      if (runIds.length === 0) {
        s.stop('No workflow runs found');
        p.log.info('Repository has no workflow runs to delete');
        return { success: true, stdout: 'No runs to delete', stderr: '', exitCode: 0 };
      }

      s.stop(`Found ${runIds.length} workflow run(s)`);

      const confirmCount = await p.confirm({
        message: `Confirm deletion of ${runIds.length} workflow run(s)?`,
        initialValue: false
      });

      if (p.isCancel(confirmCount) || !confirmCount) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
      }

      s.start(`Deleting ${runIds.length} workflow run(s)...`);

      let deleted = 0;
      let failed = 0;

      for (const runId of runIds) {
        try {
          const deleteResult = await this.github.execute([
            'api',
            '-X', 'DELETE',
            `repos/${repoPath}/actions/runs/${runId}`
          ]);

          if (deleteResult.success || deleteResult.exitCode === 0) {
            deleted++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
        }

        s.message(`Deleted ${deleted}/${runIds.length} (${failed} failed)`);
      }

      s.stop(`Deletion complete: ${deleted} deleted, ${failed} failed`);

      if (deleted > 0) {
        p.log.success(`Successfully deleted ${deleted} workflow run(s)`);
      }

      if (failed > 0) {
        p.log.warning(`Failed to delete ${failed} workflow run(s)`);
      }

      return {
        success: deleted > 0,
        stdout: `Deleted ${deleted} runs`,
        stderr: failed > 0 ? `${failed} deletions failed` : '',
        exitCode: 0
      };
    } catch (error) {
      s.stop('Failed to clear workflow runs');
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Unknown error',
        exitCode: 1
      };
    }
  }
}
