# X-FACTOR — Прогнозы на ничью

Telegram-бот с аналитикой футбольных матчей и кандидатами на ничью.

## What it does

- Scans nine competitions: England, Spain, Germany, Italy, France, Netherlands, Portugal, UEFA Champions League and UEFA Europa League.
- Downloads recent results and upcoming fixtures from ESPN's public scoreboard feed.
- Uses each team's last eight completed matches, with home/away splits.
- Estimates expected goals for both teams and calculates the draw probability with a Poisson model.
- Sends up to three candidates only when the model estimate is at least 60%, data coverage is at least 55/100, and a bookmaker quote shows estimated value of at least 3%.
- Saves every sent pick with its original probability and quoted odds in `data/forecast-history.json`.
- Checks completed fixtures automatically and calculates hit rate and simulated flat-stake ROI (1 unit per pick).
- Runs a rolling historical validation: the most recent 60 days are the test period, with up to 120 earlier days used only as prior match history.

The 60% figure is a raw model estimate, not a calibrated probability or guarantee. The rolling test reports how often selected historical fixtures actually ended in a draw and the Brier score; a small sample is not reliable evidence. Simulated ROI uses the odds saved when a pick was first recorded and a flat 1-unit stake; it does not represent actual betting activity. Check team news, lineups, motivation and market odds independently. ESPN's feed is unofficial and may change.

## GitHub Actions secrets

In **Settings → Secrets and variables → Actions**, create:

- `TELEGRAM_BOT_TOKEN`: token from BotFather (keep it private).
- `TELEGRAM_CHAT_ID`: numeric chat ID or channel ID where the bot is allowed to post.

Never put credentials in source files or send them in chat.

## Run

GitHub Actions supports manual runs and a daily scheduled run at 06:00 UTC. Each run persists the pick history to the repository. Updating `src/index.js` also triggers a run.

The workflow checks JavaScript syntax before starting the bot.
