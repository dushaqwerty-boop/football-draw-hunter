import { readFile, writeFile, mkdir } from "node:fs/promises";
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
const MIN_DRAW_PROBABILITY = 0.45;
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


async function configureTelegramProfile() {
  const profile = [
    ["setMyName", { name: "X-FACTOR | Прогнозы на ничью" }],
    ["setDescription", {
      description: "X-FACTOR — аналитика футбольных матчей и кандидаты на ничью. Статистика, модельная вероятность и актуальные букмекерские коэффициенты. Прогнозы не гарантируют результат."
    }],
    ["setShortDescription", {
      short_description: "Футбольная аналитика и прогнозы на ничью. Вероятности и коэффициенты — без гарантий результата."
    }]
  ];

  for (const [method, payload] of profile) {
    try {
      const response = await fetch("https://api.telegram.org/bot" + TOKEN + "/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        console.error("Не удалось обновить профиль Telegram (" + method + "): HTTP " + response.status);
      } else {
        console.log("Профиль Telegram обновлён: " + method);
      }
    } catch (error) {
      console.error("Ошибка обновления профиля Telegram (" + method + "): " + error.name);
    }
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

function teamForm(teamId, side, results, adjustForOpponents = false) {
  const matches = results
    .filter(match => match.completed &&
      (match.homeId === teamId || match.awayId === teamId) &&
      Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore))
    .sort((a, b) => b.date - a.date)
    .slice(0, FORM_SIZE);

  const all = matches.map(match => {
    const isHome = match.homeId === teamId;
    let scored = isHome ? match.homeScore : match.awayScore;
    let conceded = isHome ? match.awayScore : match.homeScore;
    if (adjustForOpponents) {
      const opponentId = isHome ? match.awayId : match.homeId;
      const opponentHistory = results.filter(prior =>
        prior.completed && prior.date < match.date &&
        (prior.homeId === opponentId || prior.awayId === opponentId) &&
        Number.isFinite(prior.homeScore) && Number.isFinite(prior.awayScore)
      );
      if (opponentHistory.length >= 3) {
        const opponentScored = average(opponentHistory.map(prior =>
          prior.homeId === opponentId ? prior.homeScore : prior.awayScore), 1.25);
        const opponentConceded = average(opponentHistory.map(prior =>
          prior.homeId === opponentId ? prior.awayScore : prior.homeScore), 1.25);
        const leagueGoals = average(results.filter(prior =>
          prior.completed && prior.date < match.date &&
          Number.isFinite(prior.homeScore) && Number.isFinite(prior.awayScore)
        ).flatMap(prior => [prior.homeScore, prior.awayScore]), 1.25);
        const attackFactor = Math.max(0.75, Math.min(1.25, leagueGoals / Math.max(0.4, opponentConceded)));
        const defenceFactor = Math.max(0.75, Math.min(1.25, leagueGoals / Math.max(0.4, opponentScored)));
        scored *= attackFactor;
        conceded *= defenceFactor;
      }
    }
    return { scored, conceded, venue: isHome ? "home" : "away" };
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

function venueDrawRate(teamId, side, results, leagueRate) {
  const matches = results
    .filter(match => match.completed &&
      Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore) &&
      (side === "home"
        ? match.homeId === teamId
        : match.awayId === teamId))
    .sort((a, b) => b.date - a.date)
    .slice(0, 10);
  const draws = matches.filter(match => match.homeScore === match.awayScore).length;
  // Bayesian shrinkage prevents tiny venue samples from dominating the estimate.
  const priorMatches = 6;
  return {
    matches: matches.length,
    rate: (draws + leagueRate * priorMatches) / (matches.length + priorMatches)
  };
}

function analyseMatch(match, results, adjustForOpponents = false) {
  const home = teamForm(match.homeId, "home", results, adjustForOpponents);
  const away = teamForm(match.awayId, "away", results, adjustForOpponents);

  if (home.matches < 4 || away.matches < 4) return null;

  // Expected goals blend each team's venue-specific attack with its opponent's venue-specific defence.
  const homeExpected = Math.min(3.2, Math.max(0.2, (home.venueScored + away.venueConceded) / 2));
  const awayExpected = Math.min(3.2, Math.max(0.2, (away.venueScored + home.venueConceded) / 2));
  const poissonProbability = drawProbability(homeExpected, awayExpected);
  const goalGap = Math.abs(homeExpected - awayExpected);
  const totalExpected = homeExpected + awayExpected;

  // Small transparent penalties for one-sided or high-scoring match profiles.
  const adjustedPoisson = poissonProbability
    - Math.max(0, goalGap - 0.35) * 0.025
    - Math.max(0, totalExpected - 2.5) * 0.018;

  const leagueRate = average(
    results.map(result => result.homeScore === result.awayScore ? 1 : 0),
    0.26
  );
  const homeDrawProfile = venueDrawRate(match.homeId, "home", results, leagueRate);
  const awayDrawProfile = venueDrawRate(match.awayId, "away", results, leagueRate);
  const venueDrawSignal = (homeDrawProfile.rate + awayDrawProfile.rate) / 2;

  // Blend a modest venue-specific historical signal with the goal model.
  // Rates are shrunk toward the league baseline to limit small-sample noise.
  const probability = 0.85 * adjustedPoisson + 0.15 * venueDrawSignal;

  return {
    ...match,
    home,
    away,
    homeExpected,
    awayExpected,
    homeDrawRate: homeDrawProfile.rate,
    awayDrawRate: awayDrawProfile.rate,
    probability: Math.max(0, Math.min(1, probability)),
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


const HISTORY_PATH = "data/forecast-history.json";

async function updateForecastHistory(completed, picks) {
  await mkdir("data", { recursive: true });
  let history = { predictions: [] };
  try {
    history = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
    if (!Array.isArray(history.predictions)) history.predictions = [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const completedByKey = new Map(completed.map(match =>
    [match.leagueId + ":" + match.id, match]
  ));

  for (const prediction of history.predictions) {
    if (prediction.status !== "pending") continue;
    const result = completedByKey.get(prediction.leagueId + ":" + prediction.eventId);
    if (!result) continue;
    prediction.status = "settled";
    prediction.homeScore = result.homeScore;
    prediction.awayScore = result.awayScore;
    prediction.actualDraw = result.homeScore === result.awayScore;
    prediction.settledAt = new Date().toISOString();
    prediction.profitUnits = Number.isFinite(prediction.drawOdds)
      ? (prediction.actualDraw ? prediction.drawOdds - 1 : -1)
      : null;
  }

  const known = new Set(history.predictions.map(item => item.leagueId + ":" + item.eventId));
  for (const pick of picks) {
    const key = pick.leagueId + ":" + pick.id;
    if (known.has(key)) continue;
    history.predictions.push({
      eventId: pick.id,
      leagueId: pick.leagueId,
      league: pick.leagueName,
      home: pick.homeName,
      away: pick.awayName,
      kickoff: pick.date.toISOString(),
      probability: pick.probability,
      reliability: pick.reliability.score,
      drawOdds: pick.odds?.bestDrawOdds ?? null,
      bookmaker: pick.odds?.bestBookmaker ?? null,
      status: "pending",
      recordedAt: new Date().toISOString()
    });
    known.add(key);
  }

  history.updatedAt = new Date().toISOString();
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf8");

  const settled = history.predictions.filter(item => item.status === "settled");
  const wins = settled.filter(item => item.actualDraw).length;
  const quoted = settled.filter(item => Number.isFinite(item.profitUnits));
  const profit = quoted.reduce((sum, item) => sum + item.profitUnits, 0);
  const roi = quoted.length ? profit / quoted.length * 100 : null;
  return {
    total: history.predictions.length,
    settled: settled.length,
    pending: history.predictions.filter(item => item.status === "pending").length,
    wins,
    hitRate: settled.length ? wins / settled.length * 100 : null,
    quotedSettled: quoted.length,
    profit,
    roi
  };
}

function calibrationBins(items, probabilityKey) {
  const ranges = [
    { min: 0, max: 0.30, label: "до 30%" },
    { min: 0.30, max: 0.35, label: "30–35%" },
    { min: 0.35, max: 0.40, label: "35–40%" },
    { min: 0.40, max: 0.45, label: "40–45%" },
    { min: 0.45, max: 0.50, label: "45–50%" },
    { min: 0.50, max: 0.55, label: "50–55%" },
    { min: 0.55, max: 0.60, label: "55–60%" },
    { min: 0.60, max: 1.001, label: "60%+" }
  ];
  return ranges.map(range => {
    const sample = items.filter(item =>
      item[probabilityKey] >= range.min && item[probabilityKey] < range.max
    );
    return {
      label: range.label,
      count: sample.length,
      meanProbability: sample.length
        ? average(sample.map(item => item[probabilityKey]), null) : null,
      drawRate: sample.length
        ? average(sample.map(item => item.actual), null) : null
    };
  });
}

function runHistoricalBacktest(completed, testFrom) {
  const sorted = [...completed].sort((a, b) => a.date - b.date);
  const evaluated = [];
  const testMatches = sorted.filter(match => match.date >= testFrom);
  for (const match of testMatches) {
    const priorResults = sorted.filter(result =>
      result.leagueId === match.leagueId && result.date < match.date
    );
    const baseline = analyseMatch(match, priorResults, false);
    const adjusted = analyseMatch(match, priorResults, true);
    if (!baseline || !adjusted ||
        baseline.reliability.score < MIN_DATA_RELIABILITY ||
        adjusted.reliability.score < MIN_DATA_RELIABILITY) continue;
    evaluated.push({
      probability: baseline.probability,
      adjustedProbability: adjusted.probability,
      actual: match.homeScore === match.awayScore ? 1 : 0
    });
  }

  const thresholds = [0.30, 0.35, 0.40, 0.45].map(threshold => {
    const candidates = evaluated.filter(item => item.probability >= threshold);
    const wins = candidates.filter(item => item.actual === 1).length;
    const brier = candidates.length
      ? average(candidates.map(item => (item.probability - item.actual) ** 2), 0)
      : null;
    return {
      threshold,
      count: candidates.length,
      wins,
      hitRate: candidates.length ? wins / candidates.length * 100 : null,
      brier
    };
  });

  const baselineBrier = average(evaluated.map(item =>
    (item.probability - item.actual) ** 2), null);
  const adjustedBrier = average(evaluated.map(item =>
    (item.adjustedProbability - item.actual) ** 2), null);
  const adjustedAt45 = evaluated.filter(item => item.adjustedProbability >= 0.45);
  const adjustedWinsAt45 = adjustedAt45.filter(item => item.actual === 1).length;

  return {
    evaluated: evaluated.length,
    thresholds,
    calibration: {
      baseline: calibrationBins(evaluated, "probability"),
      opponentAdjusted: calibrationBins(evaluated, "adjustedProbability")
    },
    opponentAdjustment: {
      baselineBrier,
      adjustedBrier,
      deltaBrier: baselineBrier === null || adjustedBrier === null
        ? null : adjustedBrier - baselineBrier,
      adjustedAt45Count: adjustedAt45.length,
      adjustedAt45Wins: adjustedWinsAt45,
      adjustedAt45HitRate: adjustedAt45.length
        ? adjustedWinsAt45 / adjustedAt45.length * 100 : null
    }
  };
}
function formatBacktest(stats) {
  const formatCalibration = (title, bins) => [
    title,
    "Диапазон | матчей | средняя оценка | фактические ничьи",
    ...bins.map(bin =>
      bin.label + " | " + bin.count + " | " +
      (bin.meanProbability === null ? "н/д" :
        (bin.meanProbability * 100).toFixed(1).replace(".", ",") + "%") + " | " +
      (bin.drawRate === null ? "н/д" :
        (bin.drawRate * 100).toFixed(1).replace(".", ",") + "%") +
      (bin.count > 0 && bin.count < 20 ? " ⚠️ мало данных" : "")
    )
  ];

  return [
    "🧪 Историческая проверка модели (последние 270 дней после 95-дневного периода накопления истории; только матчи с покрытием от " +
      MIN_DATA_RELIABILITY + "/100)",
    "Матчей, которые можно было оценить: " + stats.evaluated,
    ...formatCalibration("Калибровка исходной модели:", stats.calibration.baseline),
    ...formatCalibration("Калибровка с поправкой на силу соперников:", stats.calibration.opponentAdjusted),
    "Brier score по всей выборке — исходная: " +
      (stats.opponentAdjustment.baselineBrier === null
        ? "н/д" : stats.opponentAdjustment.baselineBrier.toFixed(4)),
    "Brier score с поправкой: " +
      (stats.opponentAdjustment.adjustedBrier === null
        ? "н/д" : stats.opponentAdjustment.adjustedBrier.toFixed(4)),
    "Разница Brier (отрицательная — лучше): " +
      (stats.opponentAdjustment.deltaBrier === null
        ? "н/д" : (stats.opponentAdjustment.deltaBrier > 0 ? "+" : "") +
          stats.opponentAdjustment.deltaBrier.toFixed(4)),
    "Это ретротест, не гарантия будущей доходности; исторические букмекерские коэффициенты не учитываются."
  ].join("\n");
}
function formatDiagnostics(stats) {
  return [
    "🔬 Диагностика отбора матчей",
    "Предстоящих матчей: " + stats.upcoming,
    "Хватило данных для модели: " + stats.analysable,
    "Не хватило истории команд: " + stats.insufficientData,
    "Ниже порога вероятности " + (MIN_DRAW_PROBABILITY * 100).toFixed(0) +
      "%: " + stats.belowProbability,
    "Ниже покрытия " + MIN_DATA_RELIABILITY + "/100: " + stats.belowReliability,
    "Максимальная вероятность среди оценённых: " +
      (stats.bestProbability === null ? "н/д" :
        (stats.bestProbability * 100).toFixed(1).replace(".", ",") + "%"),
    "Прошли оба фильтра: " + stats.passed
  ].join("\\n");
}

function formatHistoryStats(stats) {
  return [
    "📚 История прогнозов",
    "Всего записано: " + stats.total + " | ожидают результата: " + stats.pending,
    "Завершено: " + stats.settled +
      (stats.hitRate === null ? "" : " | ничьи: " + stats.wins +
        " (" + stats.hitRate.toFixed(1).replace(".", ",") + "%)"),
    "ROI по прогнозам с сохранённым коэффициентом: " +
      (stats.roi === null ? "пока недостаточно завершённых матчей" :
        (stats.roi >= 0 ? "+" : "") + stats.roi.toFixed(1).replace(".", ",") + "%")
  ].join("\n");
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
    (pick.probability < 0.50
      ? "⚠️ Диапазон 45–49%: низкая вероятность, только кандидат для наблюдения"
      : pick.probability < 0.60
        ? "🟡 Диапазон 50–59%: умеренный кандидат, не гарантия"
        : "🟢 Диапазон 60%+: повышенный модельный показатель, не гарантия"),
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
  await configureTelegramProfile();
  const now = new Date();
  // Load a full year so teams have a warm-up history before the 270-day test window.
  const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const testFrom = new Date(now.getTime() - 270 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

  console.log("Загрузка матчей по " + LEAGUES.length + " турнирам...");
  const leagueResults = await Promise.all(
    LEAGUES.map(league => getLeagueEvents(league, from, to))
  );
  const events = leagueResults.flat();
  const unique = new Map(events.map(event => [event.id, event]));
  const allEvents = [...unique.values()];

  const completed = allEvents.filter(event =>
    event.completed && Number.isFinite(event.homeScore) && Number.isFinite(event.awayScore)
  );
  const backtestStats = runHistoricalBacktest(completed, testFrom);
  console.log("Исторический тест: " + JSON.stringify(backtestStats));
  const upcoming = allEvents.filter(event =>
    !event.completed && event.date > now && event.date <= to
  );

  console.log("Получено событий: " + allEvents.length +
    "; завершено: " + completed.length + "; впереди: " + upcoming.length);

  const upcomingAnalyses = upcoming.map(match =>
    analyseMatch(match, completed.filter(result => result.leagueId === match.leagueId))
  );
  const analysable = upcomingAnalyses.filter(Boolean);
  const insufficientData = upcomingAnalyses.length - analysable.length;
  const belowProbability = analysable.filter(pick =>
    pick.probability < MIN_DRAW_PROBABILITY
  ).length;
  const belowReliability = analysable.filter(pick =>
    pick.reliability.score < MIN_DATA_RELIABILITY
  ).length;
  const statisticalCandidates = analysable
    .filter(pick => pick.probability >= MIN_DRAW_PROBABILITY)
    .filter(pick => pick.reliability.score >= MIN_DATA_RELIABILITY)
    .sort((a, b) => b.probability - a.probability);
  const diagnostics = {
    upcoming: upcoming.length,
    analysable: analysable.length,
    insufficientData,
    belowProbability,
    belowReliability,
    bestProbability: analysable.length ? Math.max(...analysable.map(pick => pick.probability)) : null,
    passed: statisticalCandidates.length
  };

  console.log("Диагностика отбора: " + JSON.stringify(diagnostics));
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

  const historyStats = await updateForecastHistory(completed, picks);
  console.log("Итоговых прогнозов: " + picks.length);
  for (const pick of picks) {
    console.log(pick.homeName + " — " + pick.awayName + ": " +
      (pick.probability * 100).toFixed(1) + "%" +
      (pick.odds ? "; EV " + (pick.odds.expectedValue * 100).toFixed(1) + "%" : ""));
  }

  const header = "⚽ X-FACTOR | ПРОГНОЗЫ НА НИЧЬЮ\n" +
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
    await sendTelegram(header + reason + "\n\n" + formatDiagnostics(diagnostics) +
      "\n\n" + formatHistoryStats(historyStats) + "\n\n" +
      formatBacktest(backtestStats) + "\n\n" +
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
  await sendTelegram(header + "Найдено кандидатов: " + picks.length + "\n\n" + body +
    "\n\n" + formatDiagnostics(diagnostics) + "\n\n" +
    formatHistoryStats(historyStats) + "\n\n" + formatBacktest(backtestStats) + footer);
}

main().catch(async error => {
  console.error(error);
  try {
    await sendTelegram("⚠️ X-FACTOR: ошибка анализа.\n" +
      error.message.slice(0, 500) + "\nПроверь GitHub Actions.");
  } catch (telegramError) {
    console.error("Не удалось отправить сообщение об ошибке:", telegramError.message);
  }
  process.exitCode = 1;
});
