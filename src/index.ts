#!/usr/bin/env bun

import { 
  CheckoutCommand, 
  PruneCommand, 
  UpdateCommand, 
  ResetHistoryCommand,
  UpdateAllCommand,
  NukeCommand,
  MergeFromCommand
} from './commands/index';
import type { GitCommand } from './core/types';
import * as p from '@clack/prompts';

class GitWorkflow {
  private commands: Map<string, GitCommand>;

  constructor() {
    this.commands = new Map<string, GitCommand>([
      ['checkout', new CheckoutCommand()],
      ['prune', new PruneCommand()],
      ['update', new UpdateCommand()],
      ['reset-history', new ResetHistoryCommand()],
      ['update-all', new UpdateAllCommand()],
      ['nuke', new NukeCommand()],
      ['merge-from', new MergeFromCommand()],
      // Fun aliases for merge-from
      ['slurp', new MergeFromCommand()],
      ['absorb', new MergeFromCommand()],
      ['yoink', new MergeFromCommand()],
      ['assimilate', new MergeFromCommand()]
    ]);
  }

  private showUsage(): void {
    console.log(`
🚀 GitNoob - Git Workflow Tool

Usage:
  gitnoob <command> [options]

Commands:
  checkout <branch>      Switch to a branch with automatic stash management
  prune [--force]       Remove local branches that no longer exist on remote
                        --force: Force deletion of unmerged branches
  update [--no-rebase]  Update current branch from remote (rebase by default)
                        --no-rebase: Use merge instead of rebase
  update-all            Update all local branches from their remotes
                        --no-rebase: Use merge instead of rebase
  nuke [--force]        🔥 Destroy ALL local changes in current branch
                        --force: Allow nuking protected branches
                        --clear-stashes: Also clear branch stashes
  merge-from <branch>   Safely merge another branch into current
                        --rebase: Use rebase instead of merge
                        Aliases: slurp, absorb, yoink, assimilate
  reset-history         ⚠️  DANGER: Permanently delete ALL git history
  help                  Show this help message

Examples:
  gitnoob checkout develop
  gitnoob prune
  gitnoob prune --force
  gitnoob update
  gitnoob update --no-rebase
  gitnoob update-all
  gitnoob nuke
  gitnoob merge-from feature-branch
  gitnoob yoink main  # Fun alias for merge-from
  gitnoob reset-history

Features:
  • Automatic stash management during branch switching
  • Safe branch pruning with confirmation
  • Seamless integration with remote tracking branches
  • PhpStorm-like git workflow experience
`);
  }

  async run(args: string[]): Promise<void> {
    const [command, ...commandArgs] = args;

    if (!command || command === 'help') {
      this.showUsage();
      return;
    }

    const commandInstance = this.commands.get(command);
    if (!commandInstance) {
      p.log.error(`Unknown command: ${command}`);
      this.showUsage();
      process.exit(1);
    }

    try {
      await commandInstance.execute(commandArgs);
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : 'Unknown error occurred');
      process.exit(1);
    }
  }
}

// Main execution
const workflow = new GitWorkflow();
const args = process.argv.slice(2);

workflow.run(args).catch((err) => {
  p.log.error(err instanceof Error ? err.message : 'Fatal error occurred');
  process.exit(1);
});