```
RALPH-WIGGUM LOOP IMPLEMENTATION FOR CLAWDBOT
==============================================

OVERVIEW
--------
Recreating the ralph-wiggum iterative loop pattern using Clawdbot subagents.
Instead of blocking the parent agent from exiting (like Claude Code's stop hook),
we use a supervised orchestration pattern where the parent agent actively manages
the loop by spawning worker and monitor subagents.

ARCHITECTURE
------------
Parent Agent (Orchestrator):
  - Spawns X worker subagents to perform actual work
  - Spawns Y monitor subagents to validate completion
  - Waits for announces from subagents
  - Reads shared state files to check progress
  - Makes loop decision: continue or exit
  - Never exits until monitors confirm completion

Worker Subagents:
  - Perform assigned work tasks
  - Write progress to shared state files
  - Announce completion with status

Monitor Subagents:
  - Read shared state files
  - Check exit conditions (completion promise, tests, validation)
  - Write validation results to shared files
  - Announce: "COMPLETE" or "CONTINUE"

WORKFLOW
--------
1. User initiates: "/ralph-loop <task> --completion-promise <text> --max-iterations <n>"
2. Parent spawns initial batch:
   - Worker subagents (parallel work on different steps/tasks)
   - Monitor subagent (validates completion)
3. Workers do work, write progress to shared files
4. Monitor checks completion, writes validation results
5. Parent reads announces + shared state files
6. Decision:
   - If complete → exit loop, report success
   - If not complete → increment iteration, spawn next batch
   - If max iterations reached → exit with status

SHARED STATE MANAGEMENT
------------------------
State file: ralph-state.json
  - iteration: current iteration number
  - steps: object tracking each step/task status
  - completion: validation results (allStepsComplete, testsPassing, promiseFound)
  - workers: tracking which workers are active/completed
  - monitors: validation results from monitor subagents

Step files: steps/step-{N}.json
  - status: "pending" | "in-progress" | "complete" | "failed"
  - worker: subagent session key that claimed/completed it
  - timestamp: when status changed
  - result: optional result/output from worker

Progress files: progress/worker-{id}.json
  - workerId: subagent identifier
  - status: "working" | "complete" | "failed"
  - stepsCompleted: array of step IDs
  - output: summary of work done

Validation files: validation/iteration-{N}.json
  - iteration: iteration number
  - monitorId: subagent that performed validation
  - allStepsComplete: boolean
  - testsPassing: boolean (if applicable)
  - promiseFound: boolean (completion promise detected)
  - overallComplete: boolean (final decision)
  - notes: any issues or blockers

HELPER SCRIPTS NEEDED
---------------------
1. ralph-init.mjs
   - Creates initial state structure
   - Sets up directories (steps/, progress/, validation/)
   - Writes initial ralph-state.json with task description
   - Returns state file path

2. ralph-worker-claim.mjs
   - Atomically claims a step/task for a worker
   - Creates lock file to prevent race conditions
   - Updates step status to "in-progress"
   - Returns step ID and details

3. ralph-worker-complete.mjs
   - Marks a step as complete
   - Writes step result/output
   - Updates worker progress file
   - Releases lock file
   - Updates ralph-state.json

4. ralph-monitor-check.mjs
   - Reads all step files
   - Checks if all required steps are complete
   - Runs validation (tests, linting, etc.) if applicable
   - Searches for completion promise in outputs
   - Writes validation/iteration-{N}.json
   - Returns completion status

5. ralph-state-read.mjs
   - Reads current ralph-state.json
   - Aggregates status from all step files
   - Returns current iteration, completion status, pending steps

6. ralph-cleanup.mjs
   - Cleans up lock files
   - Archives old iteration files (optional)
   - Removes temporary state if loop cancelled

SKILL COMPONENTS
----------------
SKILL.md:
  - Describes the ralph-wiggum loop pattern
  - Explains worker/monitor architecture
  - Provides workflow examples
  - Documents helper script usage
  - Includes best practices for prompt writing

README.md (for GitHub/ClawdHub):
  - Overview of the skill
  - Installation instructions
  - Usage examples
  - Architecture explanation

LICENSE:
  - MIT license (or user's choice)

SCRIPTS DIRECTORY:
  - All helper scripts listed above
  - Each script is executable and documented

CONFIGURATION REQUIREMENTS
---------------------------
No Clawdbot config changes required. Uses:
  - Default subagent tool access (all tools except session tools)
  - File-based coordination (shared workspace)
  - Standard announce mechanism for subagent communication

OPTIONAL ENHANCEMENTS
---------------------
- Enable sessions_send for subagents if real-time coordination needed
- Add progress reporting to parent via shared files
- Support for cancelling loop mid-iteration
- Integration with git for tracking changes between iterations
- Support for parallel validation (multiple monitors with consensus)

EDGE CASES HANDLED
------------------
- Race conditions: exclusive lock creation + atomic file replacement for JSON writes
- Partial completion: monitors check "all required steps" not "all started"
- Stale state: timestamps and iteration numbers in all files
- Monitor disagreement: single authoritative monitor (or consensus logic)
- Worker failures: failed steps tracked, can retry in next iteration
- Max iterations: parent exits gracefully with current state
