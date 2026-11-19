const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (!TOKEN) throw new Error("Не задан TELEGRAM_BOT_TOKEN");

const API = "https://api.telegram.org/bot" + TOKEN + "/";
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

async function telegram(method, payload) {
  const response = await fetch(API + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error("Telegram " + method + ": HTTP " + response.status + " " + (data.description || ""));
  }
  return data.result;
}

async function main() {
  const updates = await telegram("getUpdates", {
    offset: 0,
    timeout: 0,
    allowed_updates: ["message"]
  });

  if (!updates.length) {
    console.log("Новых сообщений нет.");
    return;
  }

  let lastUpdateId = 0;
  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    const message = update.message;
    const chatId = message?.chat?.id;
    const text = (message?.text || "").trim();
    if (!chatId || !text) continue;

    const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
    if (command === "/start" || command === "/help") {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: WELCOME,
        disable_web_page_preview: true
      });
      console.log("Отправлено приветствие для chat_id=" + chatId);
    }
  }

  // Confirm only after all replies have been sent successfully.
  await telegram("getUpdates", {
    offset: lastUpdateId + 1,
    timeout: 0,
    allowed_updates: ["message"]
  });
  console.log("Обработано обновлений: " + updates.length);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
