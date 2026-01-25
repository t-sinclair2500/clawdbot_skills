# LM Studio Subagents Skill

A Clawdbot skill that equips agents to search for and offload tasks to local models running in LM Studio. This skill enables agents to discover available models, select appropriate ones based on task requirements, and use them for cost-effective local processing.

## Features

- **Model discovery** - Lists and selects from models available in LM Studio
- **Task offloading** - Routes appropriate tasks to local models to save paid API tokens
- **No configuration required** - Works with models in LM Studio without Clawdbot config setup
- **Local processing** - All processing happens locally for privacy
- **Model selection** - Supports LLMs, VLMs, and embedding models based on task needs

## Installation

### Via ClawdHub (Recommended)

```bash
npm i -g clawdhub
clawdhub install lmstudio-subagents
```

### Manual Installation

1. Clone this repository or download the skill folder
2. Place the `lmstudio-subagents` folder in your Clawdbot skills directory:
   - Workspace: `<workspace>/skills/lmstudio-subagents/`
   - Global: `~/.clawdbot/skills/lmstudio-subagents/`

## Prerequisites

- LM Studio installed with `lms` CLI available on PATH
- LM Studio server running (default: http://127.0.0.1:1234)
- Models downloaded in LM Studio

## Usage

The skill is automatically triggered when the agent needs to:
- Offload simple tasks to free local models (summarization, extraction, classification, rewriting, first-pass code review, brainstorming)
- Use specialized model capabilities (vision models for images, smaller models for quick tasks, larger models for complex reasoning)
- Save paid API tokens by using local models when quality is sufficient
- Process tasks locally for privacy

Example: "Use lmstudio-subagents to summarize this document"

## How It Works

1. Lists available models via `lms ls`
2. Checks currently loaded models via `lms ps`
3. Selects appropriate model based on task requirements
4. Loads model if not already loaded
5. Calls LM Studio API directly with the selected model
6. Returns results and optionally unloads model

## Performance

Tested with LM Studio 0.3.39, meta-llama-3.1-8b-instruct (Q4_K_M):
- Model load time: ~1.15s (p50)
- API call latency: ~0.17s (p50), varies with generation length
- Model unload time: ~0.11s

## License

MIT License - See [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please open an issue or pull request.

## Links

- [GitHub Repository](https://github.com/t-sinclair2500/clawdbot_skills) - Source code and issues
- [ClawdHub](https://clawdhub.com) - Browse and install skills
- [Clawdbot Documentation](https://clawdbot.com/docs) - Learn more about Clawdbot
- [LM Studio](https://lmstudio.ai) - Download LM Studio
