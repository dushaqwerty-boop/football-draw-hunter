const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const ODDS_API_KEY = (process.env.ODDS_API_KEY || "").trim();

const LEAGUES = [
  { id: "eng.1", name: "Англия — Премьер-лига", oddsKey: "soccer_epl" },
  { id: "esp.1", name: "Испания — Ла Лига", oddsKey: "soccer_spain_la_liga" },
  { id: "ger.1", name: "Германия — Бундеслига", oddsKey: "soccer_germany_bundesliga" },
  { id: "ita.1", name: "Италия — Серия А", oddsKey: "soccer_italy_serie_a" },
  { id: "fra.1", name: "Франция — Лига 1", oddsKey: "soccer_france_ligue_one" },
  { id: "ned.1", name: "Нидерланды — Эредивизи", oddsKey: "soccer_netherlands_eredivisie" },
  { id: "por.1", name: "Португалия — Примейра", oddsKey: "soccer_portugal_primeira_liga" },
  { id: "uefa.champions", name: "Лига чемпионов", oddsKey: "soccer_uefa_champs_league" },
  { id: "uefa.europa", name: "Лига Европы", oddsKey: "soccer_uefa_europa_league" }
];

const FORM_SIZE = 8;
const MAX_PICKS = 3;
const MIN_DRAW_PROBABILITY = 0.265;
const MIN_DATA_RELIABILITY = 55;
const MIN_EXPECTED_VALUE = 0.03;
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
      throw new Error("HTTP " + response.status + " при запросе внешнего источника");
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
    if (response.status === 404) {
      throw new Error("Telegram вернул 404: токен бота недействителен. Проверьте TELEGRAM_BOT_TOKEN в GitHub Secrets; сам токен никому не отправляйте.");
    }
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
    venueMatches: venueMatches.length,
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

function dataReliability(home, away) {
  // This is a data-coverage indicator, not a calibrated probability of a correct prediction.
  const matchCoverage = (home.matches / FORM_SIZE + away.matches / FORM_SIZE) / 2;
  const venueCoverage = (
    Math.min(home.venueMatches, 4) / 4 +
    Math.min(away.venueMatches, 4) / 4
  ) / 2;
  const score = Math.round(100 * (0.6 * matchCoverage + 0.4 * venueCoverage));
  return {
    score,
    label: score >= 75 ? "повышенная" : score >= 55 ? "средняя" : "низкая"
  };
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
    probability: Math.max(0, Math.min(0.65, adjusted)),
    reliability: dataReliability(home, away)
  };
}


function normalizeTeamName(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(fc|cf|afc|sc|ac|as|ssc|club)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function getLeagueOdds(league) {
  if (!ODDS_API_KEY) return [];
  const url = "https://api.the-odds-api.com/v4/sports/" + league.oddsKey +
    "/odds?regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso&apiKey=" +
    encodeURIComponent(ODDS_API_KEY);
  try {
    const data = await fetchJson(url);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Не удалось получить коэффициенты для " + league.oddsKey + " (" + error.name + ")");
    return [];
  }
}

function oddsEventMatchesPick(event, pick) {
  const home = normalizeTeamName(event.home_team);
  const away = normalizeTeamName(event.away_team);
  const pickHome = normalizeTeamName(pick.homeName);
  const pickAway = normalizeTeamName(pick.awayName);
  const sameTeams = home === pickHome && away === pickAway;
  const oddsTime = new Date(event.commence_time).getTime();
  return sameTeams && Number.isFinite(oddsTime) &&
    Math.abs(oddsTime - pick.date.getTime()) <= 4 * 60 * 60 * 1000;
}

function bookmakerDrawQuotes(event) {
  const quotes = [];
  for (const bookmaker of event.bookmakers || []) {
    const market = (bookmaker.markets || []).find(item => item.key === "h2h");
    if (!market) continue;
    const outcomes = market.outcomes || [];
    const draw = outcomes.find(item => ["draw", "tie"].includes(normalizeTeamName(item.name)));
    const home = outcomes.find(item => normalizeTeamName(item.name) === normalizeTeamName(event.home_team));
    const away = outcomes.find(item => normalizeTeamName(item.name) === normalizeTeamName(event.away_team));
    if (!draw || !home || !away) continue;
    const prices = [draw, home, away].map(item => Number(item.price));
    if (prices.some(price => !Number.isFinite(price) || price <= 1)) continue;
    const inverseTotal = prices.reduce((sum, price) => sum + 1 / price, 0);
    quotes.push({
      bookmaker: bookmaker.title || bookmaker.key,
      drawOdds: prices[0],
      noVigDrawProbability: (1 / prices[0]) / inverseTotal,
      updatedAt: market.last_update || bookmaker.last_update || null
    });
  }
  return quotes;
}

function attachOdds(pick, oddsEvents) {
  const quotes = oddsEvents.filter(event => oddsEventMatchesPick(event, pick))
    .flatMap(bookmakerDrawQuotes);
  if (!quotes.length) return { ...pick, odds: null };
  const best = quotes.reduce((a, b) => b.drawOdds > a.drawOdds ? b : a);
  const marketProbability = average(quotes.map(item => item.noVigDrawProbability), pick.probability);
  return {
    ...pick,
    odds: {
      bestBookmaker: best.bookmaker,
      bestDrawOdds: best.drawOdds,
      bookmakerCount: quotes.length,
      marketProbability,
      edge: pick.probability - marketProbability,
      expectedValue: pick.probability * best.drawOdds - 1,
      updatedAt: best.updatedAt
    }
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
  const fairOdds = (1 / pick.probability).toFixed(2);
  const valueOdds = (1 / (pick.probability * 0.95)).toFixed(2);
  return [
    (index + 1) + ". " + pick.homeName + " — " + pick.awayName,
    "🏆 " + pick.leagueName + " | " + formatDate(pick.date) + " (Рига)",
    "📊 Расчётная вероятность ничьей: " + percent + "%",
    "⚽ Ожидаемые голы модели: " + xg,
    "🧾 Покрытие данными: " + pick.reliability.score + "/100 (" + pick.reliability.label + ")",
    "📐 Справедливый коэффициент модели: " + fairOdds,
    "🎯 Ориентир для запаса 5%: от " + valueOdds,
    ...(pick.odds ? [
      "💹 Лучшая котировка на ничью: " + pick.odds.bestDrawOdds.toFixed(2) + " (" + pick.odds.bestBookmaker + ")",
      "Рынок без маржи: " + (pick.odds.marketProbability * 100).toFixed(1).replace(".", ",") +
        "% | перевес модели: " + (pick.odds.edge >= 0 ? "+" : "") +
        (pick.odds.edge * 100).toFixed(1).replace(".", ",") + " п.п.",
      "Ожидаемая доходность по лучшей цене: " +
        (pick.odds.expectedValue >= 0 ? "+" : "") +
        (pick.odds.expectedValue * 100).toFixed(1).replace(".", ",") + "%",
      "Обновлено: " + (pick.odds.updatedAt || "время не указано") +
        " | котировок: " + pick.odds.bookmakerCount
    ] : ["💹 Коэффициенты: нет подтверждённой котировки для этого матча"]),
    "Форма (5 матчей): " + pick.homeName + " " + (pick.home.form || "н/д") +
      " | " + pick.awayName + " " + (pick.away.form || "н/д"),
    "Сыграно в выборке: " + pick.home.matches + " / " + pick.away.matches +
      " | дома/в гостях: " + pick.home.venueMatches + " / " + pick.away.venueMatches,
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

  const statisticalCandidates = upcoming
    .map(match => analyseMatch(match, completed.filter(result => result.leagueId === match.leagueId)))
    .filter(Boolean)
    .filter(pick => pick.probability >= MIN_DRAW_PROBABILITY)
    .filter(pick => pick.reliability.score >= MIN_DATA_RELIABILITY)
    .sort((a, b) => b.probability - a.probability);

  console.log("Кандидатов после статистической фильтрации: " + statisticalCandidates.length);

  let picks = [];
  let oddsStatus = ODDS_API_KEY ? "ожидают проверки" : "не подключены — нужен ODDS_API_KEY";
  if (ODDS_API_KEY && statisticalCandidates.length) {
    const candidateLeagueIds = new Set(statisticalCandidates.map(pick => pick.leagueId));
    const leaguesToCheck = LEAGUES.filter(league => candidateLeagueIds.has(league.id));
    console.log("Загрузка коэффициентов для " + leaguesToCheck.length + " турниров...");
    const oddsResults = await Promise.all(leaguesToCheck.map(getLeagueOdds));
    const oddsByLeague = new Map(leaguesToCheck.map((league, index) => [league.id, oddsResults[index]]));
    const evaluated = statisticalCandidates.map(pick =>
      attachOdds(pick, oddsByLeague.get(pick.leagueId) || [])
    );

    picks = evaluated
      .filter(pick => pick.odds && pick.odds.expectedValue >= MIN_EXPECTED_VALUE)
      .sort((a, b) =>
        b.odds.expectedValue - a.odds.expectedValue ||
        b.probability - a.probability
      )
      .slice(0, MAX_PICKS);

    oddsStatus = "котировки найдены для " + evaluated.filter(pick => pick.odds).length +
      " из " + evaluated.length + " кандидатов";
    console.log(oddsStatus);
    console.log("Прогнозов с расчётным перевесом не менее " +
      (MIN_EXPECTED_VALUE * 100).toFixed(0) + "%: " + picks.length);
  } else if (ODDS_API_KEY) {
    oddsStatus = "нет кандидатов для проверки";
  } else {
    // Without verified bookmaker prices, show a statistical watchlist only.
    picks = statisticalCandidates.slice(0, MAX_PICKS);
  }

  console.log("Итоговых прогнозов: " + picks.length);
  for (const pick of picks) {
    console.log(pick.homeName + " — " + pick.awayName + ": " +
      (pick.probability * 100).toFixed(1) + "%" +
      (pick.odds ? "; EV " + (pick.odds.expectedValue * 100).toFixed(1) + "%" : ""));
  }

  const header = "⚽ FOOTBALL DRAW HUNTER\n" +
    "Анализ на ближайшие 10 дней\n" +
    "Турниров проверено: " + LEAGUES.length + "\n" +
    "Завершённых матчей в базе: " + completed.length + "\n" +
    "Букмекерские коэффициенты: " + oddsStatus + "\n\n";

  if (!picks.length) {
    const reason = ODDS_API_KEY && statisticalCandidates.length
      ? "Статистические кандидаты есть (" + statisticalCandidates.length +
        "), но ни у одного не подтверждён расчётный перевес не менее " +
        (MIN_EXPECTED_VALUE * 100).toFixed(0) +
        "% по доступной котировке. Это не сигнал к ставке."
      : "Сегодня сильных кандидатов по заданным критериям нет.";
    await sendTelegram(header + reason + "\n\n" +
      "Бот не будет выдавать матч без подтверждённой ценовой выгоды за готовый прогноз. Попробуем снова при следующем запуске.\n\n" +
      "Фильтры: вероятность ничьей от " + (MIN_DRAW_PROBABILITY * 100).toFixed(1) +
      "%; покрытие данных от " + MIN_DATA_RELIABILITY +
      "/100; расчётный перевес от " + (MIN_EXPECTED_VALUE * 100).toFixed(0) + "%.");
    return;
  }

  const body = picks.map(formatPick).join("\n\n────────────────\n\n");
  const footer = "\n\nℹ️ Покрытие данными показывает полноту выборки, а не шанс прохода прогноза. " +
    "Справедливый коэффициент = 1 / вероятность модели; ориентир от 5% запаса — только фильтр, не live-коэффициент букмекера. " +
    "Сравни его с актуальным коэффициентом и учитывай маржу букмекера.\n" +
    "⚠️ Модель не откалибрована и не гарантирует результат. Проверяй составы, травмы и мотивацию.";
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
