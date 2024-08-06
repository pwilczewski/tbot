import { NextRequest, NextResponse } from "next/server";
import { Bot, webhookCallback } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN as string

// add an openai call here

import OpenAI from 'openai';


export const POST = async (req: NextRequest) => {

  const bot = new Bot(token)
  const openai = new OpenAI();

  bot.on("message", async (ctx) => {
    // await ctx.reply("...");
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;

    const resp = await openai.completions.create({model: 'gpt-3.5-turbo', prompt: message, max_tokens: 50,temperature: 0,});
    await bot.api.sendMessage(chatId, resp.choices[0].text);
    // await bot.api.sendMessage(chatId, message)
    // await ctx.reply("...");
  });



  const handleUpdate = webhookCallback(bot, "std/http");

  return handleUpdate(req);
};


// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot
