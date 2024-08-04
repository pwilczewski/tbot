import { NextRequest, NextResponse } from "next/server";
import { Bot, webhookCallback } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN as string

export const POST = async (req: NextRequest) => {

  const bot = new Bot(token)

  bot.on("message", async (ctx) => {
    await ctx.reply("...");
  });

  console.log("test")

  const handleUpdate = webhookCallback(bot, "std/http");

  return handleUpdate(req);
};


// probably the missing piece - how does telegram know where to go?
// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot