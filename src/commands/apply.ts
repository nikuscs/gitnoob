import { GitOperations } from '../core/git';
import type { GitCommand, GitResult } from '../core/types';
import * as p from '@clack/prompts';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export class ApplyCommand implements GitCommand {
  private git: GitOperations;

  constructor() {
    this.git = new GitOperations();
  }

  private parseArgs(args: string[]) {
    const result = {
      patchFile: null as string | null,
      check: false,
      reverse: false,
      dry: false
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === 'check') {
        result.check = true;
      } else if (arg === 'reverse') {
        result.reverse = true;
      } else if (arg === 'dry') {
        result.dry = true;
      } else if (!result.patchFile && !arg.startsWith('--') && arg !== 'check' && arg !== 'reverse' && arg !== 'dry') {
        result.patchFile = arg;
      }
    }

    return result;
  }

  private async findPatchFiles(): Promise<string[]> {
    try {
      const files = readdirSync(process.cwd());
      return files.filter(file => file.endsWith('.patch')).sort();
    } catch {
      return [];
    }
  }

  private async selectPatchFile(): Promise<string | null> {
    const patchFiles = await this.findPatchFiles();
    
    if (patchFiles.length === 0) {
      p.log.error('No patch files found in current directory');
      return null;
    }

    if (patchFiles.length === 1) {
      p.log.info(`Found patch file: ${patchFiles[0]}`);
      return patchFiles[0];
    }

    const selectedFile = await p.select({
      message: 'Select patch file to apply:',
      options: patchFiles.map(file => ({
        value: file,
        label: file
      }))
    }) as string | symbol;

    if (p.isCancel(selectedFile)) {
      return null;
    }

    return selectedFile as string;
  }

  private async checkPatchApplicability(patchFile: string): Promise<{ canApply: boolean; conflicts: string[]; stats: string }> {
    const result = await this.git.execute('apply', ['--check', '--verbose', patchFile]);
    
    const conflicts: string[] = [];
    if (!result.success && result.stderr) {
      const lines = result.stderr.split('\n');
      for (const line of lines) {
        if (line.includes('does not apply') || line.includes('failed')) {
          conflicts.push(line.trim());
        }
      }
    }

    // Get patch stats
    const statResult = await this.git.execute('apply', ['--stat', patchFile]);
    const stats = statResult.success ? statResult.stdout : 'Unable to read patch stats';

    return {
      canApply: result.success,
      conflicts,
      stats
    };
  }

  async execute(args: string[]): Promise<GitResult> {
    if (!(await this.git.isGitRepo())) {
      p.log.error('Not in a git repository');
      process.exit(1);
    }

    const options = this.parseArgs(args);
    
    p.intro('🔧 Applying patch');

    // Select or validate patch file
    let patchFile = options.patchFile;
    if (!patchFile) {
      patchFile = await this.selectPatchFile();
      if (!patchFile) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled', exitCode: 1 };
      }
    }

    // Check if file exists
    const fullPath = join(process.cwd(), patchFile);
    if (!existsSync(fullPath)) {
      p.log.error(`Patch file not found: ${patchFile}`);
      return { success: false, stdout: '', stderr: `Patch file not found: ${patchFile}`, exitCode: 1 };
    }

    p.log.info(`Using patch file: ${patchFile}`);

    // Check patch applicability
    if (options.check) {
      p.log.info('Checking if patch can be applied...');
      const checkResult = await this.checkPatchApplicability(patchFile);
      
      p.log.info('Patch statistics:');
      console.log(checkResult.stats);
      
      if (checkResult.canApply) {
        p.log.success('✅ Patch can be applied cleanly');
        return { success: true, stdout: 'Patch can be applied cleanly', stderr: '', exitCode: 0 };
      } else {
        p.log.error('❌ Patch cannot be applied cleanly');
        if (checkResult.conflicts.length > 0) {
          p.log.info('Conflicts:');
          checkResult.conflicts.forEach(conflict => console.log(`  ${conflict}`));
        }
        return { success: false, stdout: '', stderr: 'Patch cannot be applied cleanly', exitCode: 1 };
      }
    }

    // Check for uncommitted changes
    const status = await this.git.getStatus();
    if (status.hasChanges) {
      const shouldContinue = await p.confirm({
        message: 'You have uncommitted changes. Continue applying patch?',
        initialValue: false
      });

      if (p.isCancel(shouldContinue) || !shouldContinue) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled due to uncommitted changes', exitCode: 1 };
      }
    }

    // Pre-check the patch
    const preCheck = await this.checkPatchApplicability(patchFile);
    
    p.log.info('Patch statistics:');
    console.log(preCheck.stats);

    if (!preCheck.canApply) {
      p.log.warning('⚠️ Patch may not apply cleanly');
      if (preCheck.conflicts.length > 0) {
        p.log.info('Potential conflicts:');
        preCheck.conflicts.forEach(conflict => console.log(`  ${conflict}`));
      }

      const shouldContinue = await p.confirm({
        message: 'Continue with potentially conflicting patch?',
        initialValue: false
      });

      if (p.isCancel(shouldContinue) || !shouldContinue) {
        p.cancel('Operation cancelled');
        return { success: false, stdout: '', stderr: 'Operation cancelled due to conflicts', exitCode: 1 };
      }
    }

    // Apply the patch
    const applyArgs = [];
    if (options.dry) {
      applyArgs.push('--dry-run');
      p.log.info('Performing dry run...');
    }
    if (options.reverse) {
      applyArgs.push('--reverse');
      p.log.info('Applying patch in reverse...');
    }
    applyArgs.push(patchFile);

    const applyResult = await this.git.execute('apply', applyArgs);

    if (!applyResult.success) {
      p.log.error(`Failed to apply patch: ${applyResult.stderr}`);
      
      // Check if it's a conflict
      if (applyResult.stderr?.includes('does not apply') || applyResult.stderr?.includes('failed')) {
        p.log.info('💡 You might want to try:');
        p.log.info('  • Check differences with: git apply --check --verbose <patch>');
        p.log.info('  • Apply with 3-way merge: git apply --3way <patch>');
        p.log.info('  • Manual application and conflict resolution');
      }
      
      return { 
        success: false, 
        stdout: applyResult.stdout, 
        stderr: applyResult.stderr, 
        exitCode: applyResult.exitCode 
      };
    }

    if (options.dry) {
      p.log.success('✅ Dry run completed - patch would apply cleanly');
      return { success: true, stdout: 'Dry run successful', stderr: '', exitCode: 0 };
    }

    // Show what was applied
    const diffResult = await this.git.execute('diff', ['--stat']);
    if (diffResult.success && diffResult.stdout) {
      p.log.info('Changes applied:');
      console.log(diffResult.stdout);
    }

    const action = options.reverse ? 'reversed' : 'applied';
    p.log.success(`✅ Patch ${action} successfully!`);
    
    if (!options.reverse) {
      p.log.info('💡 Next steps:');
      p.log.info('  • Review changes: git diff');
      p.log.info('  • Stage changes: git add .');
      p.log.info('  • Commit changes: git commit -m "Apply patch: <description>"');
    }

    return { 
      success: true, 
      stdout: `Patch ${action} successfully`, 
      stderr: '', 
      exitCode: 0 
    };
  }
}