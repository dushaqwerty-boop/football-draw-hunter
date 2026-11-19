const WELCOME = [
  "⚽ X-FACTOR",
  "АНАЛИТИКА И ПРОГНОЗЫ НА НИЧЬЮ",
  "",
  "Добро пожаловать! Я анализирую футбольные матчи и ищу кандидатов на ничью.",
  "",
  "Что учитывает модель:",
  "• форму команд и последние матчи;",
  "• показатели дома и в гостях;",
  "• расчётную вероятность ничьей;",
  "• доступные букмекерские коэффициенты и их ценность.",
  "",
  "Важно:",
  "• прогнозы появляются не каждый день — если подходящих матчей нет, я не буду придумывать сигнал;",
  "• модельная вероятность не является гарантией результата;",
  "• проверяй составы, травмы и актуальные коэффициенты самостоятельно.",
  "",
  "Команды:",
  "/start — приветствие",
  "/help — как работает X-FACTOR",
  "/scan — запустить анализ сейчас",
  "",
  "Будь на шаг впереди! 🖤💛"
].join("\n");

const HELP = [
  "📊 КАК РАБОТАЕТ X-FACTOR",
  "",
  "Я ищу футбольные матчи, в которых статистическая модель видит повышенную вероятность ничьей.",
  "",
  "При анализе учитываются:",
  "• результаты и форма команд в последних матчах;",
  "• разница между домашними и гостевыми показателями;",
  "• ожидаемая результативность команд и расчёт вероятности ничьей;",
  "• букмекерские коэффициенты — чтобы оценить, есть ли потенциальная ценность у прогноза.",
  "",
  "Как читать прогноз:",
  "• вероятность — оценка модели, а не гарантия;",
  "• коэффициент — ориентир, который нужно перепроверить у букмекера;",
  "• отсутствие прогноза означает, что сейчас нет кандидатов, прошедших фильтры.",
  "",
  "Важно: даже высокая расчётная вероятность не исключает проигрыш. Проверяй составы, травмы и актуальные коэффициенты самостоятельно.",
  "",
  "Команды:",
  "/start — приветствие",
  "/help — эта справка",
  "/scan — запустить анализ сейчас",
  "",
  "X-FACTOR — только аналитика ничьих. 🖤💛"
].join("\n");

async function sendTelegram(token, chatId, text) {
  const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error("Telegram sendMessage failed: HTTP " + response.status + " " +
      (result.description || "Unknown error"));
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      res.status(200).json({ ok: false, tokenConfigured: false });
      return;
    }
    try {
      const [meResponse, webhookResponse] = await Promise.all([
        fetch("https://api.telegram.org/bot" + token + "/getMe"),
        fetch("https://api.telegram.org/bot" + token + "/getWebhookInfo")
      ]);
      const [me, webhook] = await Promise.all([meResponse.json(), webhookResponse.json()]);
      res.status(200).json({
        ok: true,
        tokenConfigured: true,
        bot: me.ok ? me.result.username : null,
        getMeOk: me.ok,
        webhookOk: webhook.ok,
        webhook: webhook.ok ? {
          url: webhook.result.url,
          hasCustomCertificate: webhook.result.has_custom_certificate,
          pendingUpdateCount: webhook.result.pending_update_count,
          lastErrorDate: webhook.result.last_error_date || null,
          lastErrorMessage: webhook.result.last_error_message || null,
          allowedUpdates: webhook.result.allowed_updates || null
        } : null,
        telegramError: !me.ok ? me.description : (!webhook.ok ? webhook.description : null)
      });
    } catch (error) {
      res.status(200).json({ ok: false, tokenConfigured: true, error: error.message });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  console.info("Telegram webhook update received");

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!expectedSecret || receivedSecret !== expectedSecret) {
    res.status(401).send("Unauthorized");
    return;
  }

  const message = req.body && req.body.message;
  const chatId = message && message.chat && message.chat.id;
  const messageText = typeof (message && message.text) === "string"
    ? message.text.trim()
    : "";

  if (!chatId || !messageText) {
    res.status(200).json({ ok: true });
    return;
  }

  const command = messageText.split(/\\s+/)[0].split("@")[0].toLowerCase();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    let replyText;
    if (command === "/start") {
      replyText = WELCOME;
    } else if (command === "/help") {
      replyText = HELP;
    } else if (command === "/scan") {
      const githubToken = process.env.GITHUB_ACTIONS_TOKEN;
      if (!githubToken) {
        replyText = [
          "⚙️ Ручной запуск почти готов.",
          "",
          "Нужно добавить в Vercel Production переменную GITHUB_ACTIONS_TOKEN — GitHub fine-grained token с доступом только к репозиторию dushaqwerty-boop/football-draw-hunter и разрешением Actions: Read and write.",
          "",
          "После добавления переменной команда /scan будет запускать полный анализ 9 турниров."
        ].join("\n");
      } else {
        const dispatchResponse = await fetch(
          "https://api.github.com/repos/dushaqwerty-boop/football-draw-hunter/actions/workflows/daily.yml/dispatches",
          {
            method: "POST",
            headers: {
              "Accept": "application/vnd.github+json",
              "Authorization": "Bearer " + githubToken,
              "X-GitHub-Api-Version": "2022-11-28",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ ref: "main" }),
            signal: AbortSignal.timeout(10000)
          }
        );
        if (dispatchResponse.status === 204) {
          replyText = "🔎 X-FACTOR: ручной анализ запущен!\n\nПроверяю 9 турниров и ближайшие 10 дней. Результат придёт сюда отдельным сообщением, как только анализ завершится. 🖤💛";
          console.info("Manual X-FACTOR scan dispatched by Telegram chat");
        } else {
          const details = await dispatchResponse.text();
          console.error("GitHub workflow dispatch failed:", dispatchResponse.status, details.slice(0, 500));
          replyText = "⚠️ Не удалось запустить анализ через GitHub (HTTP " +
            dispatchResponse.status + "). Проверь GITHUB_ACTIONS_TOKEN и права Actions: Read and write.";
        }
      }
    } else {
      res.status(200).json({ ok: true });
      return;
    }

    let delivered = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sendTelegram(token, chatId, replyText);
        console.info("Telegram reply sent successfully:", command);
        delivered = true;
        break;
      } catch (error) {
        console.error("Telegram reply attempt failed:", attempt, error.message);
      }
    }
    if (!delivered) console.error("Telegram reply was not delivered after retries:", command);
  } catch (error) {
    console.error("Webhook handler error:", error.message);
  }

  res.status(200).json({ ok: true });
}
