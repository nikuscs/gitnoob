#!/usr/bin/env bun

import { 
  CheckoutCommand, 
  PruneCommand, 
  UpdateCommand, 
  ResetHistoryCommand,
  UpdateAllCommand,
  ResetCommand,
  MergeFromCommand,
  TimeTravelCommand,
  PatchCommand,
  ApplyCommand,
  CherryPickCommand,
  PRCommand,
  PRFastCommand
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
      ['reset', new ResetCommand()],
      ['merge-from', new MergeFromCommand()],
      // Fun aliases for merge-from
      ['slurp', new MergeFromCommand()],
      ['absorb', new MergeFromCommand()],
      ['yoink', new MergeFromCommand()],
      ['assimilate', new MergeFromCommand()],
      ['time-travel', new TimeTravelCommand()],
      ['patch', new PatchCommand()],
      ['apply', new ApplyCommand()],
      ['cherry-pick', new CherryPickCommand()],
      ['pr', new PRCommand()],
      ['pr-fast', new PRFastCommand()]
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
  reset [--force]       🔄 Discard ALL local changes in current branch
                        --force: Allow resetting protected branches
                        --clear-stashes: Also clear branch stashes
  merge-from <branch>   Safely merge another branch into current
                        --rebase: Use rebase instead of merge
                        Aliases: slurp, absorb, yoink, assimilate
  time-travel           🚀 Go back to any commit with automatic revert
  reset-history         ⚠️  DANGER: Permanently delete ALL git history
  patch [mode]          🔧 Create patch file for branch or specific commit
                        staged: Create patch from staged changes only
                        commit [hash]: Interactive commit selection or specific hash
                        compare <branch>: Compare with specific branch
                        --output <file>: Specify output filename
  apply [file]          🔧 Apply patch file to current working directory
                        check: Check if patch can be applied without applying
                        reverse: Apply patch in reverse (undo)
                        dry: Dry run to see what would be applied
  cherry-pick [commit]  🍒 Apply specific commits from other branches
                        from <branch>: Cherry-pick from specific branch
                        continue: Continue after resolving conflicts
                        abort: Abort cherry-pick operation
  pr                    🚀 Create a draft Pull Request with smart defaults
                        Auto-detects conflicts and offers instant merge
  pr-fast               ⚡ Create & instantly merge PR (aborts if conflicts)
                        Fast track for clean, conflict-free changes
  help                  Show this help message

Examples:
  gitnoob checkout develop
  gitnoob prune
  gitnoob prune --force
  gitnoob update
  gitnoob update --no-rebase
  gitnoob update-all
  gitnoob reset
  gitnoob merge-from feature-branch
  gitnoob yoink main  # Fun alias for merge-from
  gitnoob time-travel
  gitnoob reset-history
  gitnoob patch
  gitnoob patch staged
  gitnoob patch commit
  gitnoob patch commit abc123
  gitnoob patch compare main
  gitnoob patch --output my-feature.patch
  gitnoob apply
  gitnoob apply my-feature.patch
  gitnoob apply check
  gitnoob apply reverse
  gitnoob cherry-pick
  gitnoob cherry-pick from feature-branch
  gitnoob cherry-pick abc123 def456
  gitnoob cherry-pick continue
  gitnoob pr

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