# Token Footprint for GitHub Copilot

Shows the water, electricity, CO₂ and cost of your GitHub Copilot Chat requests in VS Code, from their tokens.

- **Footprint panel** (drop icon in the activity bar): water, electricity, CO₂ and cost since the window opened, each with an everyday comparison, plus the latest prompt, the usage rate and a per-prompt graph.
- **Status bar:** the same totals at a glance. Click to open the panel.

## Setup

1. Install the extension: download [`token-footprint.vsix`](https://github.com/SavaStosic3/token-footprint/releases/latest/download/token-footprint.vsix), then in the Extensions view choose **… → Install from VSIX…**.
2. When asked, choose **Turn on**, then **Reload window**, and **Restart** if VS Code asks. You can also use the link in the Footprint panel, or run **Token Footprint: Turn on Copilot Chat's usage log** from the Command Palette.
3. Use Copilot Chat. The numbers update after each model request.

Turning it on makes Copilot Chat write the model name and token counts of each request to a file on your computer, which the extension reads. Prompt and reply text are not written, and nothing is sent anywhere. See [what it changes](https://github.com/SavaStosic3/token-footprint#what-turning-on-the-usage-log-does).

If your organization manages Copilot's telemetry settings, they replace your own and the extension says it can't turn the log on.

## How the numbers are estimated

These are estimates, not measurements, except cost where Copilot reports it.

- **Cost:** what Copilot charges for each request, in [AI credits](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing) at $0.01 each, when Copilot logs it. Otherwise the model's published API price per million tokens, for Claude Opus 5.5 and Sonnet 5.5, GPT-6.1 Sol and Terra, and Gemini 4 Argon and Gemini 4 Carbon; other models count as $0. The panel says which it used.
- **Water, electricity and CO₂:** estimated from the tokens, the same way as the [Claude Code version](https://github.com/SavaStosic3/token-footprint#how-the-numbers-are-estimated).

The panel counts every Copilot Chat request since its window opened, in any VS Code window: the agent host serves all windows and doesn't record which one a request came from. Reloading the window starts over.
