import { bot } from "@/bot/bot";

const WEBAPP_URL = "" // URL to your production main site(eg. https://my-secrete-webapp.tld)

const handleGracefulShutdown = async () => {
  await bot.stop();
  process.exit();
};

if (process.env.NODE_ENV==="development") {
  // Graceful shutdown handlers
  process.once("SIGTERM", handleGracefulShutdown);
  process.once("SIGINT", handleGracefulShutdown);
}


export const startTelegramBotInDev = async () => {
  if (!bot.isInited()) {
   await bot.start();
  }
};

export const startTelegramBotInProduction = async () => {
    const webhookUrl = `${WEBAPP_URL}/api/telegram-webhook?token=${process.env.TELEGRAM_BOT_WEBHOOK_TOKEN}`;

    try {
        const webhookInfo = await bot.api.getWebhookInfo();

        if (webhookInfo.url !== webhookUrl) {
          await bot.api.deleteWebhook();
          await bot.api.setWebhook(webhookUrl);
        }
    } catch (_) { }
};