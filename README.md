# token-footprint

See the water, electricity, CO₂ and cost of your AI coding prompts, estimated from their tokens. Works with **GitHub Copilot Chat in VS Code**, the **GitHub Copilot app** and **Claude Code**.

A Footprint panel shows the session's totals, each with an everyday comparison (teaspoons of water, phone charges, metres of driving), plus the latest prompt and a per-prompt graph.

## Install

### GitHub Copilot Chat in VS Code

1. Download [`token-footprint.vsix`](https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint.vsix).
2. In VS Code, open the Extensions view, click **…**, choose **Install from VSIX…** and pick the file.
3. When asked, choose **Turn on**, then **Reload window**, and **Restart** if VS Code asks.

The Footprint panel is behind the drop icon in the activity bar.

### GitHub Copilot app

macOS or Linux:

```bash
mkdir -p ~/.copilot/extensions/token-footprint && curl -fsSL -o ~/.copilot/extensions/token-footprint/extension.mjs https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint-copilot-app.mjs
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.copilot\extensions\token-footprint" | Out-Null; Invoke-WebRequest https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint-copilot-app.mjs -OutFile "$HOME\.copilot\extensions\token-footprint\extension.mjs"
```

Then click **New** in the app. The Footprint panel opens beside the session.

### Claude Code

In a terminal, start `claude` and run:

```
/plugin marketplace add SavaStosic3/token-footprint
```

```
/plugin install token-footprint@token-footprint
```

Choose the user scope. The Footprint pane then opens in every session, including in the Claude desktop app.

## Good to know

- **Privacy:** nothing leaves your computer. In VS Code, Token Footprint turns on Copilot Chat's local usage log, which holds model names and token counts but no prompt or reply text. If your company manages Copilot's telemetry settings, that may be blocked.
- **Cost:** what Copilot charges, in AI credits at $0.01 each, when Copilot reports it. Otherwise it's the model's API list price, and models without a listed price count as $0.
- **Update:** in VS Code and the Copilot app, install again. In Claude Code, run `claude plugin update token-footprint@token-footprint`.
- **Uninstall:**
  - **VS Code:** uninstall the extension, then remove the `chat.agentHost.otel.*` and `github.copilot.chat.otel.*` settings it added.
  - **Copilot app:** delete `~/.copilot/extensions/token-footprint`.
  - **Claude Code:** run `claude plugin uninstall token-footprint@token-footprint`.

## How the numbers are estimated

These are estimates, not measurements. Every constant and price is in [`core/footprint.ts`](core/footprint.ts).

- **Electricity:** about 0.5 mWh per output token for a Sonnet-class model, the mid-range of Epoch AI's estimates. That puts a typical reply near the ~0.3 Wh per query that Google, OpenAI and Microsoft Research report. Input and cached tokens count for less, and bigger models count for more.
- **Water:** 4.2 mL per Wh: data-center cooling (from Google's Gemini disclosure) plus the water used to generate the electricity (US grid average).
- **CO₂:** 0.35 g per Wh, the US grid average (EPA eGRID 2023), compared with a typical car at about 400 g per mile.
- **Cost:** Copilot's own charge when it reports one ([AI credits](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing)). Otherwise the model's published API price, checked 2026-11-13, for:
  - Claude Opus 5.5 and Sonnet 5.5 ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing))
  - GPT-6.1 Sol and Terra ([OpenAI](https://developers.openai.com/api/docs/pricing))
  - Gemini 4 Argon and Carbon ([Google](https://aistudio.google.com/docs/pricing))

  That's what the tokens would cost on the API, not what a subscription bills.

## Building

With Node 22 or later:

- **VS Code extension:** in `vscode/`, run `npm install && npm run package` to get `token-footprint.vsix`.
- **Copilot app:** in `copilot-app/`, run `npm install && npm run package` to get `token-footprint-copilot-app.mjs`.
- **Claude Code plugin:** run `claude plugin test .` for its tests.

Attach both built files to every release, so the `latest` download links keep working.
