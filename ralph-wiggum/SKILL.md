---
name: ralph-wiggum
description: "Iterative self-improving development loops using worker/monitor subagents. Use when tasks require multiple iterations, self-correction, or refinement until completion criteria are met. Enables autonomous iterative improvement where agents work on tasks, validate progress, and continue until completion."
metadata: {"clawdbot":{"emoji":"🔄","requires":{"bins":["node"]},"tags":["iteration","subagents","automation","self-improvement","development"]}}
license: MIT
---

# Ralph-Wiggum Loop

Create iterative, self-referential development loops using Clawdbot subagents. This skill implements the Ralph Wiggum pattern where agents iteratively work on tasks, validate progress, and continue until completion criteria are met.

## Why this skill exists (when to reach for it)

Use this skill for tasks that require **iterative refinement** and **self-correction**:

- Test-driven development (write tests, implement, fix failures, repeat)
- Bug fixing with multiple attempts
- Code refactoring requiring incremental changes
- Feature development with clear completion criteria
- Tasks where previous work persists in files and informs next iteration

Avoid for:
- One-shot tasks with immediate completion
- Tasks requiring human judgment at each step
- Tasks with unclear success criteria

## Key Terms

- **iteration**: One complete cycle of work + validation
- **worker subagent**: Subagent that performs actual work tasks
- **monitor subagent**: Subagent that validates completion and checks exit conditions
- **completion promise**: Specific text phrase that signals task completion (e.g., `<promise>COMPLETE</promise>`)
- **shared state**: JSON files coordinating between parent, workers, and monitors
- **step**: Individual work unit tracked in the loop

## Prerequisites

- Node.js available (for helper scripts)
- Clawdbot with subagent support
- Agent workspace with write permissions

## Complete Workflow

### Step 1: Initialize Loop

Initialize the ralph loop state structure:

```bash
exec command:"node {baseDir}/scripts/ralph-init.mjs 'Build REST API for todos' --completion-promise 'COMPLETE' --max-iterations 50"
```

This creates `.ralph/` directory with:
- `ralph-state.json`: Main state file
- `steps/`: Directory for step tracking files
- `progress/`: Directory for worker progress files
- `validation/`: Directory for validation results

Parse the JSON response to get `stateDir` path for subsequent operations.

### Step 2: Break Task into Steps

Analyze the task and create step definitions. Steps can be:
- Sequential (step-1, step-2, step-3)
- Parallel (multiple steps worked on simultaneously)
- Hierarchical (sub-steps within steps)

Update `ralph-state.json` to include step definitions in the `steps` object (keyed by step id). Each step should have:
- `description`: What this step accomplishes
- `status`: `"pending"` initially

Example:
```json
{
  "steps": {
    "step-1": { "description": "Implement GET /todos", "status": "pending" },
    "step-2": { "description": "Add tests", "status": "pending" }
  }
}
```

### Step 3: Spawn Worker Subagents

Spawn worker subagents to perform work:

```bash
sessions_spawn task:"Claim and complete step-1: Implement GET /todos endpoint. Use ralph-worker-claim.mjs to claim the step, then implement the endpoint, then use ralph-worker-complete.mjs to mark it done." label:"Worker: Step 1"
```

Each worker should:
1. Use `ralph-worker-claim.mjs` to atomically claim a step
2. Perform the assigned work
3. Use `ralph-worker-complete.mjs` to mark completion and write results

### Step 4: Spawn Monitor Subagent

Spawn a monitor subagent to validate completion:

```bash
sessions_spawn task:"Validate iteration completion. Use ralph-monitor-check.mjs to check if all steps are complete, tests pass, and completion promise is found. Report COMPLETE or CONTINUE." label:"Monitor: Iteration 1"
```

The monitor:
1. Uses `ralph-monitor-check.mjs` to validate all conditions
2. Writes validation results to `validation/iteration-{N}.json`
3. Announces "COMPLETE" if all conditions met, "CONTINUE" otherwise

### Step 5: Wait for Announces and Check State

`sessions_spawn` is non-blocking and announces are best-effort, so treat this as a **poll** step:
- Use `/subagents list` to see active/finished runs (optional)
- Poll the shared state via `ralph-state-read.mjs`

```bash
exec command:"node {baseDir}/scripts/ralph-state-read.mjs --format summary"
```

Check the response:
- `isComplete`: true if monitor confirmed completion
- `canContinue`: true if not at max iterations and not complete
- `pendingSteps`: Steps still needing work

### Step 6: Decision Logic

If `isComplete` is true:
- Report success to user
- Optionally run cleanup: `node {baseDir}/scripts/ralph-cleanup.mjs --archive`
- Exit loop

If `canContinue` is true and not complete:
- Increment iteration in `ralph-state.json`
- Spawn next batch of workers for remaining/pending steps
- Spawn new monitor for next iteration
- Return to Step 5

If max iterations reached:
- Report current state to user
- Exit loop with status

## Helper Script Usage

### ralph-init.mjs

Initialize loop state:

```bash
node scripts/ralph-init.mjs <task_description> [--completion-promise <text>] [--max-iterations <n>] [--state-dir <path>]
```

Examples:
```bash
node scripts/ralph-init.mjs "Build todo API" --completion-promise "COMPLETE" --max-iterations 20
node scripts/ralph-init.mjs "Fix auth bug" --max-iterations 10
```

Returns JSON: `{ "stateDir": ".ralph", "stateFile": ".ralph/ralph-state.json" }`

### ralph-worker-claim.mjs

Atomically claim a step for a worker:

```bash
node scripts/ralph-worker-claim.mjs <step_id> [--state-dir <path>] [--worker-id <id>] [--force-overwrite]
```

Examples:
```bash
node scripts/ralph-worker-claim.mjs step-1 --worker-id subagent-abc
node scripts/ralph-worker-claim.mjs step-2
```

Returns JSON with step details and lock file path. Fails if step already claimed.

### ralph-worker-complete.mjs

Mark a step complete and update progress:

```bash
node scripts/ralph-worker-complete.mjs <step_id> [--result <text>] [--output-file <path>] [--state-dir <path>] [--worker-id <id>]
```

Examples:
```bash
node scripts/ralph-worker-complete.mjs step-1 --result "GET /todos endpoint implemented" --worker-id subagent-abc
node scripts/ralph-worker-complete.mjs step-2 --output-file steps/step-2-output.md
```

Validates worker-id matches the claim. Writes result to step file and progress file.

### ralph-monitor-check.mjs

Validate completion and check exit conditions:

```bash
node scripts/ralph-monitor-check.mjs [--iteration <n>] [--state-dir <path>] [--monitor-id <id>] [--run-tests] [--test-command <cmd>]
```

Examples:
```bash
node scripts/ralph-monitor-check.mjs --run-tests
node scripts/ralph-monitor-check.mjs --test-command "npm test"
node scripts/ralph-monitor-check.mjs --monitor-id subagent-xyz
```

Checks:
- All steps complete
- Tests passing (if `--run-tests`)
- Completion promise found in outputs (by default searches for `<promise>COMPLETE</promise>` when `--completion-promise COMPLETE` was used)

Writes validation file and returns completion status.

### ralph-state-read.mjs

Read and aggregate current state:

```bash
node scripts/ralph-state-read.mjs [--state-dir <path>] [--format <json|summary>]
```

Examples:
```bash
node scripts/ralph-state-read.mjs --format summary
node scripts/ralph-state-read.mjs --format json
```

Returns aggregated state with step counts, completion status, and continuation eligibility.

### ralph-cleanup.mjs

Clean up state files:

```bash
node scripts/ralph-cleanup.mjs [--state-dir <path>] [--archive] [--remove-all --force]
```

Examples:
```bash
node scripts/ralph-cleanup.mjs --archive
node scripts/ralph-cleanup.mjs --remove-all
```

Removes lock files. `--archive` copies state into `archive/`. `--remove-all` deletes the entire state directory (requires `--force`).

## Best Practices

### Prompt Writing

- **Clear completion criteria**: Specify exactly what "done" means
- **Incremental goals**: Break large tasks into testable steps
- **Self-correction guidance**: Include instructions for fixing failures
- **Completion promise**: Use specific, verifiable phrases

Example good prompt:
```
Build REST API for todos with:
- GET /todos (list all)
- POST /todos (create)
- GET /todos/:id (get one)
- PUT /todos/:id (update)
- DELETE /todos/:id (delete)

Requirements:
- Input validation
- Error handling
- Tests for all endpoints
- Output <promise>COMPLETE</promise> when all tests pass
```

### Step Design

- **Atomic steps**: Each step should be independently completable
- **Clear dependencies**: Document step ordering if sequential
- **Parallelizable**: Design steps that can run simultaneously when possible
- **Testable**: Each step should have clear success criteria

### Iteration Limits

Always set `--max-iterations` to prevent infinite loops:
- Simple tasks: 10-20 iterations
- Complex tasks: 20-50 iterations
- Very complex: 50-100 iterations

### Error Handling

- Workers should handle failures gracefully and mark steps as "failed"
- Monitors should report blockers in validation notes
- Parent should check for failed steps and retry or exit appropriately

## Architecture Notes

### File-Based Coordination

All coordination happens via shared files in `.ralph/`:
- No direct subagent-to-subagent communication needed
- Parent reads state files to make decisions
- Workers write progress, monitors write validation

### Atomic Operations

Scripts use atomic file operations to prevent race conditions:
- Lock files for step claiming (temp file + rename)
- Atomic state updates (write temp + rename)
- Safe concurrent access from multiple subagents

### State Management

State is distributed across multiple files:
- `ralph-state.json`: Main state, iteration, task description
- `steps/step-{N}.json`: Individual step status
- `progress/worker-{id}.json`: Worker progress tracking
- `validation/iteration-{N}.json`: Validation results per iteration

This allows parallel access and reduces contention.

## Limitations

- No real-time coordination (file-based, not event-driven)
- Parent must actively check state (not automatic like stop hooks)
- Requires careful step design for parallel work
- State files can grow large with many iterations

## See Also

- Original Ralph Wiggum technique: https://ghuntley.com/ralph/
- Clawdbot subagents documentation for spawning patterns
- Helper scripts in `scripts/` directory for implementation details
