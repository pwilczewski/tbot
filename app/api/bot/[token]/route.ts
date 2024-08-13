import { Bot, Context, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { NextRequest } from "next/server";

// all interactions need to be BOT_TOKEN / user pairs

const openai = new OpenAI();

export const POST = async (req: NextRequest) => {

  // parse url to get BOT_TOKEN
  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0];
  const bot = new Bot(token as string);
  
  bot.use(limit());
  
  // set the global status, but I still need bot/user pairs...
  // user.user.username is not required, but id is required hmm...
  async function setStatus(ctx: Context, next: NextFunction) {
    const user = await ctx.getAuthor();
    console.log(user)
    const cuserStatus = prismadb.userStatus.findFirst({
      where: {userName: user.user.username, botId: token}})
    //     select: {status: true, followUp: true}
    console.log(cuserStatus)
    await next();
  }
  
  bot.use(setStatus);
  
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
  
  bot.command("train", async (ctx) => {
    const chatId = ctx.chatId;
    await bot.api.sendMessage(chatId, "Training mode enabled")
    await bot.api.sendMessage(chatId, "Retrieving questions")
    const question = await prismadb.basedQuestions.findFirst({select: {question: true}})
    if (question !== null) {
      await bot.api.sendMessage(chatId, question.question as string)
    } else {
      await bot.api.sendMessage(chatId, "No further questions")
    }
  });
  
  bot.on("message", async (ctx) => {
    // await ctx.reply("...");
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;
  
    const resp = await openai.chat.completions.create({model: 'gpt-4o-mini', 
        messages: [{ role: 'user', content: message }]
    });
    await bot.api.sendMessage(chatId, resp.choices[0].message.content as string);
  });

  const handler = webhookCallback(bot, "std/http");
  return handler(req)
};

// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot
// [token]/route.ts
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs
// [token].ts
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/alt/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs


