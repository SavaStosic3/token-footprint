# token-footprint

A Claude Code mod that estimates, live, how much water and electricity your prompts and session use, from their tokens.

- **Desktop app:** a card with water and electricity totals, each with an everyday comparison that changes as usage grows (teaspoons → glasses → bathtubs, web searches → phone charges → days of a home), plus this prompt, the live usage rate, and a per-prompt graph.
- **Terminal:** the same numbers as plain text.
- `/footprint` reopens the pane.

## Install

In a Claude Code terminal session:

```
/plugin install token-footprint --marketplace SavaStosic3/token-footprint
```

Answer `y` to add the marketplace, then pick a scope.

## How the numbers are estimated

These are estimates, not measurements: no provider publishes per-token energy figures.

- **Electricity:** about 0.5 mWh per output token for a Sonnet-class model, the mid-range of Epoch AI's estimates. That puts a typical chat reply near the ~0.3 Wh per query that Google, OpenAI and Microsoft Research report. Input, cache-write and cache-read tokens are weighted by Anthropic's price ratios, and models are scaled by size (Haiku ×0.33, Opus ×1.67).
- **Water:** 1.1 mL per Wh for data-center cooling (from Google's Gemini disclosure) plus 3.1 mL per Wh evaporated generating the electricity (US grid average).
- **Live numbers:** while a reply streams, tokens are estimated at ~4 characters each. When each request finishes, the real token counts replace the estimate.

All of these are constants at the top of [`hooks/register.tsx`](hooks/register.tsx).
