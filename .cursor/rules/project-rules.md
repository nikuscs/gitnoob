# GitNoob Project Rules

## Project Overview

GitNoob is a TypeScript CLI tool that replicates PhpStorm's git workflow behavior using Bun runtime. It provides seamless branch switching with automatic stash management and safe branch pruning.

## Architecture Guidelines

### File Organization

- `src/core/` - Core business logic (git operations, types)
- `src/commands/` - Command implementations following command pattern
- `src/index.ts` - Main CLI entry point

### Code Style

- Use TypeScript interfaces over types
- Prefer named exports
- Single-word method names when possible
- Descriptive variable names
- Early returns for error conditions
- Document complex functions with comments (no @params)

### Error Handling

- Always handle git operation failures gracefully
- Provide clear error messages with recovery instructions
- Use process.exit(1) for fatal errors
- Log all important operations using @clack/prompts

### Git Operations

- All git commands must be wrapped in GitOperations class
- Use async/await consistently
- Handle subprocess failures with proper error messages
- Always validate git repository state before operations

### Stash Management

- Use timestamp-based stash messages for uniqueness
- Always restore stashes on checkout failures
- Provide clear feedback on stash operations
- Handle stash conflicts gracefully

### Terminal UI

- Use @clack/prompts for all UI interactions
- Use p.log.info/error/warning/success for consistent logging
- Use p.intro for operation headers
- Always confirm destructive operations with p.confirm

## Development Practices

### Testing Approach

- Test with real git repositories
- Verify stash creation and restoration
- Test error recovery scenarios
- Validate branch switching edge cases

### Performance Considerations

- Minimize git command executions
- Use parallel operations where safe
- Cache git status when possible
- Avoid unnecessary remote fetches

### Extension Guidelines

- Follow command pattern for new commands
- Implement GitCommand interface
- Add proper error handling
- Update CLI usage documentation

## Common Patterns

### Command Implementation

```typescript
export class NewCommand implements GitCommand {
  private git: GitOperations;
  
  constructor() {
    this.git = new GitOperations();
  }
  
  async execute(args: string[]): Promise<void> {
    // Implementation
  }
}
```

### Error Recovery

```typescript
if (!operationSuccess) {
  if (stashMessage) {
    const stashRef = await this.git.findStash(stashMessage);
    if (stashRef) await this.git.restoreStash(stashRef);
  }
  process.exit(1);
}
```

### Git Operation Wrapping

```typescript
async operation(): Promise<boolean> {
  const result = await this.execute('command', ['args']);
  return result.success;
}
```

## Dependencies

- `@clack/prompts` - For terminal UI and user interactions
- `@types/bun` - For Bun runtime types
- Uses `Bun.spawn` for subprocess execution

## Build & Run

- `bun run dev` - Run in development mode
- `bun run build` - Build for production
- `bun run install-global` - Install globally as `gitnoob` command

## Maintenance Notes

- Keep git command wrappers minimal and focused
- Maintain backward compatibility with existing workflows
- Document any breaking changes in commit messages
- Test thoroughly with different git repository states
