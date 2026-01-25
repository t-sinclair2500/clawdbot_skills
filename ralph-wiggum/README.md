# Ralph-Wiggum Loop Skill

A Clawdbot skill that implements iterative, self-improving development loops using worker and monitor subagents. This skill enables agents to autonomously work on tasks, validate progress, and continue iterating until completion criteria are met.

## Features

- **Iterative refinement** - Agents work on tasks across multiple iterations, improving with each cycle
- **Worker/monitor architecture** - Parallel worker subagents perform work while monitor subagents validate completion
- **File-based coordination** - Shared state files coordinate between parent, workers, and monitors
- **Completion validation** - Checks for completion promises, test results, and step completion
- **No configuration required** - Works with default Clawdbot subagent settings

## Installation

### Via ClawdHub (Recommended)

```bash
npm i -g clawdhub
clawdhub install ralph-wiggum
```

### Manual Installation

1. Clone this repository or download the skill folder
2. Place the `ralph-wiggum` folder in your Clawdbot skills directory:
   - Workspace: `<workspace>/skills/ralph-wiggum/`
   - Global: `~/.clawdbot/skills/ralph-wiggum/`

## Prerequisites

- Node.js available (for helper scripts)
- Clawdbot with subagent support
- Agent workspace with write permissions

## Usage

The skill is automatically triggered when the agent needs to:
- Perform iterative refinement on tasks
- Work on test-driven development (write tests, implement, fix failures, repeat)
- Fix bugs requiring multiple attempts
- Refactor code incrementally
- Develop features with clear completion criteria

Example workflow:

1. Initialize the loop:
   ```bash
   node scripts/ralph-init.mjs "Build REST API for todos" --completion-promise "COMPLETE" --max-iterations 50
   ```
   The monitor treats `--completion-promise "COMPLETE"` as a request to find `<promise>COMPLETE</promise>` in step outputs.

2. Spawn worker subagents to perform work
3. Spawn monitor subagent to validate completion
4. Check state and continue until complete

## How It Works

The skill implements a supervised orchestration pattern:

1. **Parent Agent** initializes the loop and manages iterations
2. **Worker Subagents** claim steps, perform work, and mark completion
3. **Monitor Subagents** validate completion by checking:
   - All steps complete
   - Tests passing (optional)
   - Completion promise found in outputs
4. **Parent Agent** reads validation results and decides to continue or exit

All coordination happens via shared state files in `.ralph/` directory:
- `ralph-state.json` - Main state tracking
- `steps/` - Individual step status files
- `progress/` - Worker progress tracking
- `validation/` - Validation results per iteration

## Architecture

Unlike the original Claude Code ralph-wiggum plugin (which uses stop hooks to block exit), this Clawdbot implementation uses:

- **Subagents** for parallel work execution
- **File-based state** for coordination
- **Parent orchestration** for loop management
- **Atomic operations** to prevent race conditions

This approach works within Clawdbot's architecture while maintaining the core ralph-wiggum philosophy of iterative improvement.

## Helper Scripts

The skill includes helper scripts for state management:

- `ralph-init.mjs` - Initialize loop state
- `ralph-worker-claim.mjs` - Atomically claim a step
- `ralph-worker-complete.mjs` - Mark step complete
- `ralph-monitor-check.mjs` - Validate completion
- `ralph-state-read.mjs` - Read aggregated state
- `ralph-cleanup.mjs` - Clean up state files

Safety notes:
- `ralph-cleanup.mjs --remove-all` requires `--force`.

See `SKILL.md` for detailed usage examples.

## Best Practices

- **Set iteration limits** - Always use `--max-iterations` to prevent infinite loops
- **Clear completion criteria** - Specify exactly what "done" means
- **Atomic steps** - Design steps that are independently completable
- **Test integration** - Use `--run-tests` flag for test-driven workflows

## Development

Run the built-in self-test (no deps):
```bash
node scripts/ralph-self-test.mjs
```

## Limitations

- No real-time coordination (file-based, not event-driven)
- Parent must actively check state (not automatic like stop hooks)
- Requires careful step design for parallel work
- State files can grow large with many iterations

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please open an issue or pull request.

## Links

- [GitHub Repository](https://github.com/t-sinclair2500/clawdbot_skills) - Source code and issues
- [ClawdHub](https://clawdhub.com) - Browse and install skills
- [Clawdbot Documentation](https://clawdbot.com/docs) - Learn more about Clawdbot
- [Original Ralph Wiggum Technique](https://ghuntley.com/ralph/) - Inspiration for this implementation
