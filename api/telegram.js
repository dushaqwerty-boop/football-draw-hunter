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
  // Temporary, one-time setup route; removed immediately after webhook registration.
  if (req.method === "GET" && req.query && req.query.setup === "f191cdbd53b8f9e1b0ab1bb5a704812921ca64db29daae81") {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (!token || !secret) return res.status(500).json({ ok: false, error: "Missing server configuration" });
      const response = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://x-factor-telegram-bot.vercel.app/api/telegram",
          secret_token: secret,
          allowed_updates: ["message"],
          drop_pending_updates: false
        })
      });
      const result = await response.json();
      return res.status(response.ok && result.ok ? 200 : 502).json({
        ok: !!result.ok,
        description: result.description || null
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: "Webhook setup request failed" });
    }
  }

  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

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
