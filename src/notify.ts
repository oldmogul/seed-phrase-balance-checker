import { config } from "./config.js";

export async function sendTelegram(message: string) {
  if (!config.telegramToken || !config.telegramChatId) {
    console.log("[Telegram disabled]", message);
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("Telegram error:", err);
  }
}