# Football Draw Hunter

Telegram bot that scans football fixtures and ranks draw candidates.

## What it does

- Scans nine competitions: England, Spain, Germany, Italy, France, Netherlands, Portugal, UEFA Champions League and UEFA Europa League.
- Downloads recent results and upcoming fixtures from ESPN's public scoreboard feed.
- Uses each team's last eight completed matches, with home/away splits.
- Estimates expected goals for both teams and calculates the draw probability with a Poisson model.
- Sends up to five highest-ranked candidates, or says when none meet the filter.

The percentage is a model estimate, not a guarantee or a calibrated betting edge. Check team news, lineups, motivation and market odds independently. ESPN's feed is unofficial and may change.

## GitHub Actions secrets

In **Settings → Secrets and variables → Actions**, create:

- `TELEGRAM_BOT_TOKEN`: token from BotFather (keep it private).
- `TELEGRAM_CHAT_ID`: numeric chat ID or channel ID where the bot is allowed to post.

Never put credentials in source files or send them in chat.

## Run

GitHub Actions supports manual runs and a daily scheduled run at 06:00 UTC. Updating `src/index.js` also triggers a run.

The workflow checks JavaScript syntax before starting the bot.
