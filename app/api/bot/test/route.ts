import { Bot, Context, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { NextApiRequest } from "next";
import { NextRequest } from "next/server";

// in the setup use [token] in the API route
// then each bot uses a unique API route
// and I get the bot token from the API route
// all interactions need to be BOT_TOKEN / user pairs

const openai = new OpenAI();

export const POST = async (req: NextRequest) => {

  console.log(req.nextUrl)

  // get token
  const token = process.env.TELEGRAM_BOT_TOKEN as string;
  const bot = new Bot(token as string);
  
  // ratelimiter
  bot.use(limit());
  
  bot.command("start", 
    async (ctx) => {
      const user = await ctx.getAuthor();
      const chatId = ctx.chatId;
      if ( user.user.id === 5013727719 ) {
        await bot.api.sendMessage(chatId, "Creator start")
      } else {
        await bot.api.sendMessage(chatId, "Other start")
      }
  });

  const handleUpdate = webhookCallback(bot, "std/http")

  return handleUpdate(req);
};

// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/test
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/alt/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs


