const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();

const LEAGUES = [
  { id: "eng.1", name: "Англия — Премьер-лига" },
  { id: "esp.1", name: "Испания — Ла Лига" },
  { id: "ger.1", name: "Германия — Бундеслига" },
  { id: "ita.1", name: "Италия — Серия А" },
  { id: "fra.1", name: "Франция — Лига 1" },
  { id: "ned.1", name: "Нидерланды — Эредивизи" },
  { id: "por.1", name: "Португалия — Примейра" },
  { id: "uefa.champions", name: "Лига чемпионов" },
  { id: "uefa.europa", name: "Лига Европы" }
];

const FORM_SIZE = 8;
const MAX_PICKS = 5;
const MIN_DRAW_PROBABILITY = 0.265;
const REQUEST_TIMEOUT_MS = 15000;

if (!TOKEN || !CHAT_ID) {
  throw new Error("Не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в GitHub Secrets");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " при запросе " + url);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegram(message) {
  const response = await fetch(
    "https://api.telegram.org/bot" + TOKEN + "/sendMessage",
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error("Telegram API error: " + response.status + " " + (data.description || ""));
  }
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function parseEvent(event, league) {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  if (competitors.length !== 2) return null;

  const home = competitors.find(item => item.homeAway === "home");
  const away = competitors.find(item => item.homeAway === "away");
  if (!home || !away || !home.team?.id || !away.team?.id) return null;

  const homeScore = Number(home.score);
  const awayScore = Number(away.score);
  const completed = Boolean(event.status?.type?.completed);

  return {
    id: String(event.id),
    leagueId: league.id,
    leagueName: league.name,
    date: new Date(event.date),
    homeId: String(home.team.id),
    awayId: String(away.team.id),
    homeName: home.team.displayName || home.team.name || "Хозяева",
    awayName: away.team.displayName || away.team.name || "Гости",
    homeScore: Number.isFinite(homeScore) ? homeScore : null,
    awayScore: Number.isFinite(awayScore) ? awayScore : null,
    completed,
    link: event.links?.find(link => link.rel?.includes("summary"))?.href || event.links?.[0]?.href || ""
  };
}

async function getLeagueEvents(league, from, to) {
  const all = [];
  const month = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  // ESPN retired YYYYMMDD-YYYYMMDD ranges. Month queries remain supported.
  while (month <= lastMonth) {
    const yearMonth = month.getUTCFullYear().toString() +
      String(month.getUTCMonth() + 1).padStart(2, "0");
    const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/" +
      league.id + "/scoreboard?dates=" + yearMonth + "&limit=500";
    try {
      const data = await fetchJson(url);
      all.push(...(data.events || []).map(event => parseEvent(event, league)).filter(Boolean));
    } catch (error) {
      console.error("Лига " + league.id + " (" + yearMonth + "): " + error.message);
    }
    month.setUTCMonth(month.getUTCMonth() + 1);
  }
  return all.filter(event => event.date >= from && event.date <= to);
}

function average(values, fallback) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function teamForm(teamId, side, results) {
  const matches = results
    .filter(match => match.completed &&
      (match.homeId === teamId || match.awayId === teamId) &&
      match.homeScore !== null && match.awayScore !== null)
    .sort((a, b) => b.date - a.date)
    .slice(0, FORM_SIZE);

  const all = matches.map(match => {
    const isHome = match.homeId === teamId;
    return {
      scored: isHome ? match.homeScore : match.awayScore,
      conceded: isHome ? match.awayScore : match.homeScore,
      venue: isHome ? "home" : "away"
    };
  });

  const venueMatches = all.filter(match => match.venue === side);
  return {
    matches: all.length,
    scored: average(all.map(match => match.scored), 1.25),
    conceded: average(all.map(match => match.conceded), 1.25),
    venueScored: average(venueMatches.map(match => match.scored), average(all.map(match => match.scored), 1.25)),
    venueConceded: average(venueMatches.map(match => match.conceded), average(all.map(match => match.conceded), 1.25)),
    form: all.slice(0, 5).map(match => match.scored > match.conceded ? "В" : match.scored < match.conceded ? "П" : "Н").join("")
  };
}

function poisson(lambda, goals) {
  let probability = Math.exp(-lambda);
  for (let i = 1; i <= goals; i++) probability *= lambda / i;
  return probability;
}

function drawProbability(homeExpected, awayExpected) {
  let probability = 0;
  for (let goals = 0; goals <= 8; goals++) {
    probability += poisson(homeExpected, goals) * poisson(awayExpected, goals);
  }
  return probability;
}

function analyseMatch(match, results) {
  const home = teamForm(match.homeId, "home", results);
  const away = teamForm(match.awayId, "away", results);

  if (home.matches < 4 || away.matches < 4) return null;

  // Expected goals blend each team's venue-specific attack with its opponent's venue-specific defence.
  const homeExpected = Math.min(3.2, Math.max(0.2, (home.venueScored + away.venueConceded) / 2));
  const awayExpected = Math.min(3.2, Math.max(0.2, (away.venueScored + home.venueConceded) / 2));
  const probability = drawProbability(homeExpected, awayExpected);
  const goalGap = Math.abs(homeExpected - awayExpected);
  const totalExpected = homeExpected + awayExpected;

  // Small transparent penalties for one-sided or high-scoring match profiles.
  const adjusted = probability
    - Math.max(0, goalGap - 0.35) * 0.025
    - Math.max(0, totalExpected - 2.5) * 0.018;

  return {
    ...match,
    home,
    away,
    homeExpected,
    awayExpected,
    probability: Math.max(0, Math.min(0.65, adjusted))
  };
}

function formatDate(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Riga",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatPick(pick, index) {
  const percent = (pick.probability * 100).toFixed(1).replace(".", ",");
  const xg = pick.homeExpected.toFixed(2) + " : " + pick.awayExpected.toFixed(2);
  return [
    (index + 1) + ". " + pick.homeName + " — " + pick.awayName,
    "🏆 " + pick.leagueName + " | " + formatDate(pick.date) + " (Рига)",
    "📊 Расчётная вероятность ничьей: " + percent + "%",
    "⚽ Ожидаемые голы модели: " + xg,
    "Форма (5 матчей): " + pick.homeName + " " + (pick.home.form || "н/д") +
      " | " + pick.awayName + " " + (pick.away.form || "н/д"),
    "Сыграно в выборке: " + pick.home.matches + " / " + pick.away.matches,
    pick.link
  ].filter(Boolean).join("\n");
}

async function main() {
  const now = new Date();
  const from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  console.log("Загрузка матчей по " + LEAGUES.length + " турнирам...");
  const leagueResults = await Promise.all(
    LEAGUES.map(league => getLeagueEvents(league, from, to))
  );
  const events = leagueResults.flat();
  const unique = new Map(events.map(event => [event.id, event]));
  const allEvents = [...unique.values()];

  const completed = allEvents.filter(event =>
    event.completed && event.homeScore !== null && event.awayScore !== null
  );
  const upcoming = allEvents.filter(event =>
    !event.completed && event.date > now && event.date <= to
  );

  console.log("Получено событий: " + allEvents.length +
    "; завершено: " + completed.length + "; впереди: " + upcoming.length);

  const picks = upcoming
    .map(match => analyseMatch(match, completed.filter(result => result.leagueId === match.leagueId)))
    .filter(Boolean)
    .filter(pick => pick.probability >= MIN_DRAW_PROBABILITY)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, MAX_PICKS);

  const header = "⚽ FOOTBALL DRAW HUNTER\n" +
    "Анализ на ближайшие 10 дней\n" +
    "Турниров проверено: " + LEAGUES.length + "\n" +
    "Завершённых матчей в базе: " + completed.length + "\n\n";

  if (!picks.length) {
    await sendTelegram(header +
      "Сегодня сильных кандидатов по заданным критериям нет.\n\n" +
      "Бот не будет выдавать случайные матчи за прогноз. Попробуем снова при следующем запуске.\n\n" +
      "Модель: последние " + FORM_SIZE + " игр, домашние/гостевые показатели и распределение Пуассона.");
    return;
  }

  const body = picks.map(formatPick).join("\n\n────────────────\n\n");
  const footer = "\n\n⚠️ Это математическая оценка по доступной статистике, а не гарантия результата. " +
    "Перед ставкой проверяй составы, травмы, мотивацию и коэффициент букмекера.";
  await sendTelegram(header + "Найдено кандидатов: " + picks.length + "\n\n" + body + footer);
}

main().catch(async error => {
  console.error(error);
  try {
    await sendTelegram("⚠️ Football Draw Hunter: ошибка анализа.\n" +
      error.message.slice(0, 500) + "\nПроверь GitHub Actions.");
  } catch (telegramError) {
    console.error("Не удалось отправить сообщение об ошибке:", telegramError.message);
  }
  process.exitCode = 1;
});
