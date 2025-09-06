import { PRCommand } from './pr';
import type { GitCommand, GitResult } from '../core/types';

export class PRFastCommand implements GitCommand {
  private prCommand: PRCommand;

  constructor() {
    this.prCommand = new PRCommand();
  }

  async execute(args: string[]): Promise<GitResult> {
    // Forward to PR command with fast flag
    return await this.prCommand.execute(['--fast', ...args]);
  }
}