# Clawdbot Skills

A collection of Clawdbot skills for extending agent capabilities.

## Skills

### [lmstudio-subagents](./lmstudio-subagents/)
Reduces token usage from paid providers by offloading work to local LM Studio models. Use when cutting costs with local models (summarization, extraction, classification, etc.), avoiding paid API calls for high-volume work, or when no extra model configuration is desired (load/unload or JIT via REST API).

### [ralph-wiggum](./ralph-wiggum/)
Iterative self-improving development loops using worker/monitor subagents. Use when tasks require multiple iterations, self-correction, or refinement until completion criteria are met.

## Installation

Each skill can be installed individually:

### Via ClawdHub (Recommended)

```bash
npm i -g clawdhub
clawdhub install lmstudio-subagents
clawdhub install ralph-wiggum
```

### Manual Installation

1. Clone this repository or download individual skill folders
2. Place the skill folder in your Clawdbot skills directory:
   - Workspace: `<workspace>/skills/<skill-name>/`
   - Global: `~/.clawdbot/skills/<skill-name>/`

## License

Each skill is licensed under the MIT License. See individual skill directories for license details.

## Contributing

Contributions welcome! Please open an issue or pull request for any skill.

## Links

- [ClawdHub](https://clawdhub.com) - Browse and install skills
- [Clawdbot Documentation](https://clawdbot.com/docs) - Learn more about Clawdbot
