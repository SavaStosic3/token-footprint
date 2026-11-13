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

## Install with an agent

Your coding agent can do the install. Give it this prompt, naming where you use it:

> Install token-footprint from https://github.com/SavaStosic3/token-footprint for [GitHub Copilot Chat in VS Code / the GitHub Copilot app / Claude Code]. Follow the "Steps for agents" in its README.

### Steps for agents

Show the user each command and get their OK before running it. If a download or install is blocked (no network access, a company policy, an approval the user declines), stop and tell the user. Don't work around it.

**GitHub Copilot Chat in VS Code**

1. Install the extension.

   macOS or Linux:

   ```bash
   curl -fsSL -o "${TMPDIR:-/tmp}/token-footprint.vsix" https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint.vsix && code --install-extension "${TMPDIR:-/tmp}/token-footprint.vsix"
   ```

   Windows (PowerShell):

   ```powershell
   Invoke-WebRequest https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint.vsix -OutFile "$env:TEMP\token-footprint.vsix"; code --install-extension "$env:TEMP\token-footprint.vsix"
   ```

   If `code` isn't found on macOS, use `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"` instead.
2. Check that `code --list-extensions` lists `savastosic3.token-footprint`.
3. Tell the user to reload VS Code, choose **Turn on** in the Token Footprint prompt, then **Reload window**, and **Restart** if VS Code asks. Only the user can do this step.

**GitHub Copilot app**

1. Run the command under [GitHub Copilot app](#github-copilot-app) for the user's OS. If `COPILOT_HOME` is set, use `$COPILOT_HOME/extensions/token-footprint/` instead of `~/.copilot/extensions/token-footprint/`.
2. Check that `extension.mjs` is in that folder and isn't empty.
3. Tell the user to click **New** in the app. Sessions that were open before the install don't load it, including the one you're running in.

**Claude Code**

1. Run these two commands. Both succeed if the plugin is already there.

   ```bash
   claude plugin marketplace add SavaStosic3/token-footprint
   ```

   ```bash
   claude plugin install token-footprint@token-footprint --scope user
   ```

2. Check that `claude plugin list` shows `token-footprint@token-footprint` as enabled.
3. Tell the user the pane appears in new sessions, or in this one after they type `/reload-plugins`.

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
