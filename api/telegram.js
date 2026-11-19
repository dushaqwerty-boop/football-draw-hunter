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
  "",
  "Будь на шаг впереди! 🖤💛"
].join("\n");

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

  res.status(200).json({ ok: true });

  try {
    const message = req.body && req.body.message;
    const chatId = message && message.chat && message.chat.id;
    const messageText = typeof (message && message.text) === "string"
      ? message.text.trim()
      : "";
    if (!chatId || !messageText) return;

    const command = messageText.split(/\s+/)[0].split("@")[0].toLowerCase();
    if (command !== "/start" && command !== "/help") return;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: WELCOME,
        disable_web_page_preview: true
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      console.error("Telegram sendMessage failed:", result.description || response.status);
    }
  } catch (error) {
    console.error("Webhook handler error:", error.message);
  }
};
