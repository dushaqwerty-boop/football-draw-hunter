
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  throw new Error("Не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
}

async function sendTelegram(message) {
  const response = await fetch(
    `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        disable_web_page_preview: true
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }
}

async function getMatches() {
  const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard";
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ESPN API error: ${response.status}`);
  }

  const data = await response.json();
  return data.events || [];
}

function scoreMatch(event) {
  const competitors = event.competitions?.[0]?.competitors || [];
  if (competitors.length !== 2) return null;

  const home = competitors.find(team => team.homeAway === "home");
  const away = competitors.find(team => team.homeAway === "away");

  if (!home || !away) return null;

  const homeName = home.team.displayName;
  const awayName = away.team.displayName;

  const homeRecord = home.records?.[0]?.summary || "";
  const awayRecord = away.records?.[0]?.summary || "";

  return {
    homeName,
    awayName,
    homeRecord,
    awayRecord,
    date: event.date,
    link: event.links?.[0]?.href || ""
  };
}

async function main() {
  const events = await getMatches();
  const candidates = events
    .map(scoreMatch)
    .filter(Boolean)
    .slice(0, 3);

  if (!candidates.length) {
    await sendTelegram("⚽ Сегодня подходящих матчей для анализа не найдено.");
    return;
  }

  const lines = candidates.map((match, index) =>
    `${index + 1}. ${match.homeName} — ${match.awayName}\n` +
    `Статистика: ${match.homeRecord || "нет данных"} / ${match.awayRecord || "нет данных"}\n` +
    `${match.link}`
  );

  await sendTelegram(
    "⚽ Кандидаты на ничью\n\n" +
    lines.join("\n\n") +
    "\n\nЭто предварительный список для анализа, не прогноз и не гарантия результата."
  );
}

main().catch(async error => {
  console.error(error);
  await sendTelegram("⚠️ Ошибка при получении матчей. Проверьте журнал GitHub Actions.");
  process.exitCode = 1;
});
