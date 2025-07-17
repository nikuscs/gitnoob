# GitNoob 🚀

A TypeScript git workflow tool that mimics PhpStorm's git client behavior, making git operations smoother and more intuitive.

## Features ✨

- **Automatic stash management** during branch switching
- **Safe branch pruning** with confirmation prompts
- **Seamless integration** with remote tracking branches
- **PhpStorm-like git workflow** experience
- **Smart update operations** with rebase/merge options

## Installation 📦

```bash
# Install globally
bun install -g gitnoob

# Or build and install locally
bun run install
```

## Usage 🛠️

```bash
gitnoob <command> [options]
```

### Commands

#### `checkout` 🔄

Switch to a branch with automatic stash management

```bash
gitnoob checkout <branch>
gitnoob checkout develop
```

#### `prune` 🗑️

Remove local branches that no longer exist on remote

```bash
gitnoob prune
gitnoob prune --force  # Force deletion of unmerged branches
```

#### `update` ⬆️

Update current branch from remote (rebase by default)

```bash
gitnoob update
gitnoob update --no-rebase  # Use merge instead of rebase
```

#### `help` ❓

Show help message

```bash
gitnoob help
```

## Examples 💡

```bash
# Switch to develop branch (with automatic stashing)
gitnoob checkout develop

# Clean up old branches
gitnoob prune

# Force remove unmerged branches
gitnoob prune --force

# Update current branch with rebase
gitnoob update

# Update current branch with merge
gitnoob update --no-rebase
```

## Development 🔧

```bash
# Run in development mode
bun run dev

# Build binary
bun run build

# Build platform-specific binaries
bun run build:binary:linux
bun run build:binary:macos
```

## License 📄

MIT
