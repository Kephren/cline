<p align="center">
  <img src="assets/icons/icon.png" width="80" alt="Cline" />
</p>

<h1 align="center">Kline — Cline, Now With More K</h1>

<p align="center">
  <strong>The open-source coding agent in your IDE, terminal, and desktop — supercharged for local LLM &amp; Ollama power users.</strong>
</p>

> ### 🚀 A Game Changer for Local LLM & Ollama Users
>
> Standard AI coding assistants treat local models as an afterthought—locking you into tiny default context windows, hiding hardware utilization, unloading your weights mid-session, and choking on large files. **Kline** re-engineers the Cline experience from the ground up for people running local and self-hosted models via **Ollama**:
>
> - **True Hardware-Aware Autonomy**: Automatically probe and calibrate the exact maximum context window that fits **100% into your GPU VRAM** (`GPU Context Tune`), monitor live GPU/CPU layer splits and real-time `tok/s` inference telemetry right inside the chat bar, and pin models in VRAM (`keep_alive: -1`) so you never wait on cold starts.
> - **Local Inline Ghost-Text Autocomplete**: Built-in Fill-in-the-Middle (FIM) code completion powered by your Ollama instance with a **64K default context window**, startup VRAM preloading, status bar hover telemetry, and zero cloud round-trips.
> - **Unthrottled Local Context & Tooling**: 4× larger file-read, command-output, and search buffers (`192,000` chars) plus full exposure of Ollama sampling and hardware parameters (`num_ctx` up to 1M, `num_gpu`, `num_batch`, `num_predict`, `min_p`, `top_k`, `top_p`, `repeat_penalty`, `seed`, and `think` toggles).
> - **Battle-Tested Networking (Using *Anything* But `fetch`)**: Every Ollama network path has been stripped of Node/Electron's dumpster-fire WHATWG `fetch` / Undici stack and routed over raw Node HTTP sockets (`adapter: "http"`). If you've ever lost days on an Apple Silicon Mac fighting `"RequestInit: duplex option is required while sending body"` or random stream timeouts, rest easy—`fetch` has been taken out back where it belongs.

<div align="center">

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://docs.cline.bot" target="_blank"><strong>Docs</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>Join us!</strong></a>
</td>
</tbody>
</table>
</div>

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center" width="50%">

### CLI

Run Cline in your terminal.
Interactive chat or fully headless 
for CI/CD and scripting.

```
npm i -g cline
```

<a href="./apps/cli/README.md">Learn more</a>
<br><br>

</td>
<td align="center" width="50%">

### Desktop App

Cline as a native app for macOS and Windows.
Run agent sessions in any folder, schedule
routines, and manage models, plugins, and MCP servers.

<a href="https://cline.bot/desktop">Download for macOS and Windows</a>
<br><br>

</td>
</tr>
<tr>
<td align="center" width="50%">

### VS Code Extension

AI coding assistant in your editor.
Create files, run commands, browse the web,
and use tools with human-in-the-loop approval.

<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev">Install from VS Marketplace</a>
<br><br>

</td>
<td align="center" width="50%">

### JetBrains Plugin

The same Cline experience in IntelliJ IDEA,
PyCharm, WebStorm, GoLand, and the rest of
the JetBrains family.

<a href="https://plugins.jetbrains.com/plugin/28247-cline">Install from JetBrains Marketplace</a>
<br><br>

</td>
</tr>
</table>
</div>

<div align="center">
<table>
<tr>
<td align="center">

### SDK

Build your own AI agents and integrations powered by the same engine that runs the CLI, desktop app, VS Code extension, and JetBrains plugin. Custom tools, multi-agent teams, connectors, scheduled automations, and more.

```
npm install @cline/sdk
```

<a href="https://docs.cline.bot/cline-sdk/overview">Documentation</a>
<br><br>

</td>
</tr>
</table>
</div>

---

## Index

| Product | Description | Location | CHANGELOG |
|---------|------------|--------------|--------------|
| **SDK** | Node.js programmatic agent API and extension exports. | [`sdk/`](https://github.com/cline/cline/tree/main/sdk) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/sdk/CHANGELOG.md) |
| **CLI** | Terminal UI, headless mode, shell commands, and CLI-specific flows. | [`apps/cli/`](https://github.com/cline/cline/tree/main/apps/cli) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/apps/cli/CHANGELOG.md) |
| **VS Code Extension** | The Marketplace extension and extension host integration. | [`apps/vscode/`](https://github.com/cline/cline/tree/main/apps/vscode) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/CHANGELOG.md) |
| **Desktop App** | Native macOS and Windows app (Tauri shell, Bun sidecar, Next.js UI). | [`apps/examples/desktop-app/`](https://github.com/cline/cline/tree/main/apps/examples/desktop-app) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/apps/examples/desktop-app/CHANGELOG.md) |
| **JetBrains Plugin** | JetBrains-hosted client that talks to the shared agent core. | Currently we are not open-sourcing JetBrains plugins | - |
| **Docs site** | Public documentation pages. | [`docs/`](https://docs.cline.bot/) | - |

## Edits Code Across Your Project

Cline reads your project structure, understands the relationships between files, and makes coordinated changes across your codebase. It monitors linter and compiler errors as it works, fixing issues like missing imports, type mismatches, and syntax errors before you even see them. In VS Code and JetBrains, every edit shows up as a diff you can review, modify, or revert. All changes are tracked with checkpoints, so you can easily undo the agent's work.

## Runs Bash Commands

Cline executes commands directly in your terminal and watches the output in real time. Install packages, run build scripts, execute tests, deploy applications, manage databases. For long-running processes like dev servers, Cline continues working in the background and reacts to new output as it appears, catching compile errors, test failures, and server crashes as they happen.

## Plan and Act

Toggle between Plan mode and Act mode. In Plan mode, Cline explores your codebase, asks clarifying questions, and lays out a strategy. Once you're aligned, switch to Act mode and Cline executes the plan. Every file edit and terminal command requires your approval, so you stay in control of what actually changes. Or toggle auto-approve and let Cline run autonomously.

## Rules and Skills

Define project-specific rules in `.clinerules` files that guide how Cline works in your codebase: coding standards, architecture conventions, deployment procedures, testing requirements. Rules are picked up automatically by the CLI, VS Code extension, and JetBrains plugin. Use skills to let the model load specific rules when needed.

## Works With Every Model

Cline is not locked to a single AI provider. Use whichever model fits your workflow:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT series models |
| Google | Gemini series models |
| OpenRouter | 200+ models from any provider |
| Vercel AI Gateway | Route to many providers through one gateway |
| AWS Bedrock | Claude, Llama, and more |
| Azure / GCP Vertex | All hosted models |
| Cerebras / Groq | Fast inference models |
| Ollama / LM Studio | Run local models on your machine |
| Any OpenAI-compatible API | Self-hosted or third-party endpoints |

## First-Class Local Model & Ollama Support

Kline provides deep, native support for running local models via Ollama with dedicated controls and real-time hardware telemetry built directly into the interface:

- **In-Chat Model Switching & Inspection**: Select and switch local Ollama models on the fly directly from the chat toolbar without leaving your conversation. View inspected model architecture details (parameter size, quantization level, family, native context window) along with verified badges for native tool calling and multimodal vision support.
- **VRAM Context Autotuning (`GPU Context Tune`)**: Automatically calibrate your context window size with one click. The autotuner probes your hardware in fine-grained steps to find the maximum context size that fits **100% into GPU VRAM**, preventing performance collapse from silent CPU memory spillover.
- **Live Hardware & Inference Telemetry**: Monitor real-time GPU vs. CPU layer allocation (`100% GPU` badge) and active VRAM usage in GB with dynamic color-coded indicators, alongside live inference speed (`tok/s` decode and prefill), token counts, request duration, and cumulative session token usage.
- **Granular Context Control**: Fine-tune your context window using a precision slider with increments from `512` up to `1M` tokens, complete with quick-select presets, snap-to-autotuned indicators, and native context limit warnings.
- **VRAM Lifecycle Management**: Free GPU VRAM immediately with one-click model unloading (`keep_alive: 0`), or preload and warm up model weights into VRAM before running tasks (`keep_alive: 10m` in chat or `keep_alive: -1` for persistent pinning).
- **Power-User Sampling & Hardware Controls**: Directly adjust `temperature`, `min_p` sampling, `top_p`, `top_k`, `repeat_penalty`, max generation tokens (`num_predict`), GPU offload layers (`num_gpu`), prompt batch size (`num_batch`), deterministic `seed` (for reproducible completions), and reasoning/thinking mode (`think`) toggles for models like DeepSeek-R1 and Qwen3.
- **Expanded 4× Tool Output Limits**: File read, terminal command output, and search result limits have been expanded from `48,000` to **`192,000` characters** so high-context local models can inspect large files and logs without aggressive middle-truncation.
- **Zero-`fetch` Native Socket Transport**: All Ollama endpoints (model listing, status polling, context probing, preloading, unloading, and completions) communicate exclusively over Node's native `http`/`https` TCP sockets (`adapter: "http"`), completely bypassing Electron's flaky `fetch`/Undici layer.

## Local Inline Autocomplete (Ghost Text)

Kline includes built-in inline code autocomplete for Visual Studio Code, providing fast, intelligent ghost-text completions powered entirely by your local or remote Ollama models:

- **Private & Local Code Completion**: Generates code suggestions in real time as you type, running 100% against your local machine or private Ollama server with zero code or telemetry leaving your environment.
- **Fill-in-the-Middle (FIM) Support**: Uses standard FIM formatting (`<|fim_prefix|>`, `<|fim_suffix|>`, `<|fim_middle|>`) to analyze both prefix and suffix around your cursor, delivering accurate completions compatible with popular code models such as `qwen2.5-coder`, `deepseek-coder`, `starcoder2`, and `codellama`.
- **Large Context Window (Default 64K)**: Pre-configured with a default context window of **65,536 tokens** (`64K`) and quick presets (`2K`, `4K`, `8K`, `16K`, `32K`, `64K`). The provider allocates context proportionally (approx. 80% prefix / 20% suffix) so completions take advantage of large files without premature truncation.
- **Persistent VRAM Pinning (`keep_alive: -1`) & Startup Preload**: Automatically preloads your autocomplete model into VRAM when the extension starts (including over remote/SSH workspaces) with `keep_alive: -1`. Even if an inline request times out while warming a large model, Kline retains the model in memory so it is never unloaded behind your back unless you explicitly click **Free VRAM**.
- **Think / Reasoning Option**: Includes a dedicated `Think` checkbox for reasoning models, defaulting to `false` (and automatically stripping stray `<think>` tags) so ghost text renders with zero reasoning overhead and minimal latency.
- **Status Bar Hover Telemetry & Quick Toggle**: Hover over `$(sparkle) Cline Autocomplete` in the VS Code status bar at any time to inspect active status, model name, formatted context window size (e.g., `65,536 (64K)`), and endpoint URL—or click it to toggle autocomplete on/off.
- **Flexible Configuration (Shared or Standalone)**:
  - **Shared with Chat**: Automatically inherits the Ollama server URL, credentials, and model configured for your Chat assistant.
  - **Standalone Configuration**: Dedicate a separate, fast FIM code model for real-time autocomplete while reserving heavier models for chat and plan/act modes.
  - **Copy from Chat**: Bootstrap your standalone configuration from your current Chat Ollama settings with a single click.
- **Model Memory Management (VRAM)**:
  - **Live Hardware Telemetry**: Displays real-time GPU offload percentage and VRAM usage directly in the autocomplete settings pane.
  - **Preload Weights**: Warm up and pin weights into GPU VRAM (`keep_alive: -1`) so inline suggestions appear with zero cold-start latency.
  - **Free VRAM**: Instantly unload model weights from GPU memory (`keep_alive: 0`) when you need to reclaim resources.
- **Controls & Keybindings**:
  - Automatically displays ghost suggestions while typing in any open file.
  - Manually trigger suggestions at any time using `Alt + \` (Linux/Windows) or `Option + \` (macOS).
  - Accept with `Tab` or dismiss with `Esc`.
  - Toggle on/off from the VS Code status bar (`$(sparkle) Cline Autocomplete`) or via Settings &rarr; **Autocomplete**.

## Building & Packaging from Source (macOS Apple Silicon & Corporate Proxy Ready)

The build system has been hardened so you can build and package the VS Code extension (`cline.vsix`) cleanly on **Apple Silicon (M1/M2/M3/M4) Macs**, Linux, and Windows—even on locked-down corporate laptops behind SSL-intercepting proxies (such as Cisco Umbrella or Zscaler):

- **Native Apple Silicon (`arm64`) `protoc` Resolution**: `apps/vscode/scripts/build-proto.mjs` automatically discovers native system `protoc` binaries (`/opt/homebrew/bin/protoc`, `/usr/local/bin/protoc`, `$PROTOC`, or system `PATH`) before falling back to `grpc-tools`. This eliminates Rosetta 2 emulation requirements and `node-pre-gyp` binary download failures on M-series Macs.
- **Corporate Proxy / SSL Certificate Fallback**: Build scripts (`download-ripgrep.mjs` and `build-proto.mjs`) automatically fall back to system `curl -fsSL` whenever Node's built-in HTTPS client rejects corporate proxy SSL certificates.
- **Optional Proto Linting**: `proto-lint.sh` checks for `buf` and gracefully skips linting if `buf` is not installed locally.
- **Hassle-Free VSIX Packaging**: Pre-configured packaging scripts bypass `vsce` dependency pruning bugs and false-positive secret-scanner blocks (`--no-dependencies --allow-package-secrets sendgrid`).

### Quick Build Steps (macOS / Linux)

1. **Install Prerequisites**:
   - [Bun 1.4.2+](https://bun.sh) and Node.js `>=22`
   - On macOS (Apple Silicon), install native `protobuf` via Homebrew so `build-proto.mjs` uses native ARM64 `protoc`:
     ```bash
     brew install protobuf
     ```
2. **Install Dependencies & Build SDK**:
   ```bash
   bun install
   bun run build:sdk
   ```
3. **Build & Package the VS Code Extension (`.vsix`)**:
   ```bash
   # From the repo root (or run `bun run package:quick` inside apps/vscode):
   cd apps/vscode
   bun run protos
   bun run package:quick
   ```
   This compiles the webview UI, bundles the extension, and outputs **`apps/vscode/dist/cline.vsix`**.
4. **Install into VS Code**:
   ```bash
   code --install-extension apps/vscode/dist/cline.vsix --force
   ```

## Extend With Plugins or MCP Servers

Extend Cline's capabilities with plugins. Using the SDK, register tools and lifecycle hooks programmatically through the plugin system for logging, auditing, policy enforcement, or adding domain-specific capabilities. Simple plugin example below.

```typescript
import { Agent, createTool } from "@cline/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // your deployment logic
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```
...or use [MCPs](https://github.com/modelcontextprotocol) to connect to databases, query APIs, manage cloud infrastructure, and interact with external systems. Use [community-built servers](https://github.com/modelcontextprotocol/servers) or ask Cline to create custom tools on the fly. In the CLI, manage servers with `cline mcp`.

## Multi-Agent Teams

Coordinate multiple agents working together on complex tasks. A coordinator agent breaks the work into subtasks and delegates to specialist agents, each with their own tools and context. Team state persists across sessions so you can pick up where you left off.

```bash
cline --team-name auth-sprint "Plan and implement user authentication with tests"
```

## Scheduled Agents

Run agents on cron schedules for recurring automations. Daily PR summaries, weekly dependency checks, codebase health reports. Schedules persist across restarts and run independently of any terminal session.

```bash
cline schedule create "PR summary" \
  --cron "0 9 * * MON-FRI" \
  --prompt "List all open PRs and their review status" \
  --workspace /path/to/repo
```

## Connect to Slack, Telegram, Discord, and More

Chat with your agent from any messaging platform: Telegram, Slack, Discord, Google Chat, WhatsApp, and Linear. Each conversation thread maps to an agent session with full context. Set up access control to restrict who can interact with your agent.

```bash
# Connect to Telegram
cline connect telegram -k $BOT_TOKEN
# Connect to Slack through webhook
cline connect slack --bot-token $SLACK_TOKEN --signing-secret $SECRET --base-url $URL
# Connect to Slack using socket mode
cline connect slack --bot-token $SLACK_TOKEN --app-token $SLACK_APP_TOKEN
```

## Headless CLI for CI/CD

Run Cline with zero interaction for scripting and automation. Pipe input, get JSON output, chain commands, integrate into CI/CD pipelines.

```bash
cline "Run tests and fix any failures"
git diff origin/main | cline "Review these changes for issues"
cline --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## Contributing

Start with the [Contributing Guide](CONTRIBUTING.md). Join our [Discord](https://discord.gg/cline) and head to the `#contributors` channel to connect with other contributors. Check our [careers page](https://cline.bot/join-us) for full-time roles.

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
