# token-footprint

Shows how much water, electricity and CO₂ your AI coding prompts use, and what they cost, from their tokens. It works in three places:

- **[GitHub Copilot Chat in VS Code](#github-copilot-chat-in-vs-code):** a VS Code extension with a Footprint panel and a status bar line.
- **[The GitHub Copilot app](#the-github-copilot-app):** a Footprint panel beside each session.
- **[Claude Code](#claude-code):** a plugin with a live pane in the terminal, the desktop app and the VS Code extension.

All three show water, electricity, CO₂ and cost for the session, each with an everyday comparison that changes as usage grows (teaspoons → glasses → bathtubs, web searches → phone charges → days of a home, metres → kilometres of driving), plus the latest prompt, the usage rate and a per-prompt graph.

## GitHub Copilot Chat in VS Code

You need VS Code with GitHub Copilot Chat signed in.

### Install

1. Download [`token-footprint.vsix`](https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint.vsix) from the latest release.
2. In VS Code, open the Extensions view, click **…** at the top of it, choose **Install from VSIX…** and pick the file you downloaded.

   Or from a terminal, in the folder you downloaded it to:

   ```bash
   code --install-extension token-footprint.vsix
   ```

3. When Token Footprint asks to turn on Copilot Chat's usage log, choose **Turn on**, then **Reload window**. If VS Code then asks to restart, choose **Restart**.
4. Click the drop icon in the activity bar to open the Footprint panel, and use Copilot Chat as usual. The numbers update after each model request.

If you closed the first prompt, use the link in the Footprint panel, or run **Token Footprint: Turn on Copilot Chat's usage log** from the Command Palette.

### What turning on the usage log does

Copilot Chat can write the model name and token counts of each request to a file on your computer. Token Footprint turns that on and reads the file. Prompt and reply text are not written to it, and nothing is sent anywhere.

It sets these user settings, for VS Code's agent host (VS Code 1.146 and later) and for the Copilot Chat extension, which each run requests:

- `chat.agentHost.otel.enabled`, `chat.agentHost.otel.exporterType` and `chat.agentHost.otel.outfile`
- `github.copilot.chat.otel.enabled` and `github.copilot.chat.otel.outfile`

To turn it off, remove those settings from your user `settings.json` and uninstall Token Footprint.

If your organization manages Copilot's telemetry settings, its policy replaces yours, and Token Footprint says it can't turn the log on.

### Differences from the Claude Code version

- **Cost** is what Copilot charges for each request, in AI credits at $0.01 each, when Copilot logs it. Otherwise it falls back to API list prices. The panel says which it used. The amount is the value of the credits used, whether or not your plan's included credits cover it.
- The numbers update after each model request, not while a reply streams.
- The panel counts every Copilot Chat request since its window opened, across all VS Code windows: the agent host serves every window and doesn't record which one a request came from.

## The GitHub Copilot app

### Install

Run one command, then start a new session in the app.

macOS or Linux, in a terminal:

```bash
mkdir -p ~/.copilot/extensions/token-footprint && curl -fsSL -o ~/.copilot/extensions/token-footprint/extension.mjs https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint-copilot-app.mjs
```

Windows, in PowerShell:

```powershell
New-Item -ItemType Directory -Force "$HOME\.copilot\extensions\token-footprint" | Out-Null; Invoke-WebRequest https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint-copilot-app.mjs -OutFile "$HOME\.copilot\extensions\token-footprint\extension.mjs"
```

In the app, click **New** to start a session. The Footprint panel opens on the right and updates after each model call. Sessions that were already open when you installed it don't show it. If you close the panel, ask Copilot to open the Footprint canvas.

If you've set `COPILOT_HOME`, put the file in `$COPILOT_HOME/extensions/token-footprint/` instead. To uninstall, delete the `token-footprint` folder.

### How it works

The panel is a [canvas extension](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions). It reads each model call's usage straight from the app, so there are no settings to change. Cost is what Copilot charges for each call, in AI credits at $0.01 each, falling back to API list prices when the app doesn't report a charge. Each session counts from when it started.

## Claude Code

### Install

In a terminal, start `claude`, then run:

```
/plugin marketplace add SavaStosic3/token-footprint
```

```
/plugin install token-footprint@token-footprint
```

Choose the user scope to run it in every session. The Footprint pane opens right away and in every new session: in the terminal, in the Claude desktop app and in Claude Code for VS Code. `/footprint` reopens it.

The desktop app can't run `/plugin`, so install from a terminal once and the desktop app picks it up.

To update later:

```bash
claude plugin update token-footprint@token-footprint
```

## How the numbers are estimated

These are estimates, not measurements: no provider publishes per-token energy figures.

- **Electricity:** about 0.5 mWh per output token for a Sonnet-class model, the mid-range of Epoch AI's estimates. That puts a typical chat reply near the ~0.3 Wh per query that Google, OpenAI and Microsoft Research report. Input, cache-write and cache-read tokens are weighted by Anthropic's price ratios, and models are scaled by size (Haiku ×0.33, Opus ×1.67, other models ×1.67).
- **Water:** 1.1 mL per Wh for data-center cooling (from Google's Gemini disclosure) plus 3.1 mL per Wh evaporated generating the electricity (US grid average).
- **CO₂:** 0.35 g CO₂e per Wh, the US grid average (EPA eGRID 2023). Compared with driving a typical passenger car, which EPA puts at about 400 g CO₂ per mile.
- **Cost:**
  - **Copilot (VS Code and the app):** Copilot's own charge for each request, when reported: [AI credits](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing) at $0.01 each.
  - **Otherwise:** tokens times the model's published Standard-tier API price per million tokens (input, output, cache write, cache read), checked 2026-11-13. Priced models: Claude Opus 5.5 and Sonnet 5.5 ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)), GPT-6.1 Sol and Terra ([OpenAI](https://developers.openai.com/api/docs/pricing), including their higher rate once a request's prompt passes 272K tokens), and Gemini 4 Argon and Gemini 4 Carbon ([Google](https://aistudio.google.com/docs/pricing), whose launch prices double on 2026-12-01). Cache writes use the shortest retention. Other models count as $0. This is what the tokens would cost on the API, not what a subscription plan bills.
- **Live numbers (Claude Code):** while a reply streams, tokens are estimated at ~4 characters each. When each request finishes, the real token counts replace the estimate.

All three use the same estimates. All of these, prices included, are constants at the top of [`core/footprint.ts`](core/footprint.ts).

## Building

With Node 22 or later:

- **VS Code extension:** `cd vscode && npm install && npm run package` runs the type check and tests, and writes `vscode/token-footprint.vsix`.
- **Copilot app canvas:** `cd copilot-app && npm install && npm run package` runs the type check and tests, and writes `copilot-app/token-footprint-copilot-app.mjs`.
- **Claude Code plugin:** `claude plugin test .` runs its tests.

Each release attaches both `token-footprint.vsix` and `token-footprint-copilot-app.mjs`, so the `releases/latest/download/` links above keep working.
