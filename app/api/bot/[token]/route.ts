import { Bot, Context, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { NextRequest } from "next/server";

const openai = new OpenAI();

async function randomQ() {
  const count = await prismadb.basedQuestions.count({where: {questionCategory: "intro"}});
  const randomOffset = Math.floor(Math.random() * count);
  const question = await prismadb.basedQuestions.findFirst({ 
        where: {questionCategory: "intro"}, skip: randomOffset})
  return question
}

export const POST = async (req: NextRequest) => {

  // parse url to get BOT_TOKEN
  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0];
  const bot = new Bot(token as string);
  let cuserStatus: userStatus | null;
  
  bot.use(limit());
  
  // user.user.username is not required, but id is required hmm...
  async function setStatus(ctx: Context, next: NextFunction) {
    const user = await ctx.getAuthor();
    cuserStatus = await prismadb.userStatus.findFirst({
      where: {userName: user.user.username, botId: token}})
    // if the user doesn't have a status here, create it... with chat status?
    await next();
  }
  
  bot.use(setStatus);
  
  bot.command("start", 
    async (ctx) => {
      const chatId = ctx.chatId;
      // add isOwner check here
      if ( cuserStatus !== null && cuserStatus.isOwner===true ) {
        await bot.api.sendMessage(chatId, "Creator start")
      } else {
        await bot.api.sendMessage(chatId, "Other start")
      }
  });
  
  bot.command("train", async (ctx) => {
    const chatId = ctx.chatId;
    await bot.api.sendMessage(chatId, "Retrieving questions")
    const question = await randomQ();

    if (question !== null) {
      if (cuserStatus!==null) {
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "question"}})
      }
      await bot.api.sendMessage(chatId, question.question as string)
    } else {
      await bot.api.sendMessage(chatId, "No further questions")
    }
  });
  
  bot.on("message", async (ctx) => {
    // await ctx.reply("...");
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;

    if (cuserStatus!==null) {
      if (cuserStatus.status==="question") {

        // different behavior for new questions and follow ups

        // create a new answer
        await prismadb.answers.create({data: {botId: 1, questionId: cuserStatus.questionId, 
                                              answer: message}})
        
        // ask a follow up question
        // update status to followup
        // await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "followup"}})
        // write a follow up question

        // reply with a new question
        const question = await randomQ();
        if (question!==null) {
          await bot.api.sendMessage(chatId, question.question as string)
          await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
                                            data: {questionId: question.id}})
        }
      }
    }
    
    if (false) {
      const resp = await openai.chat.completions.create({model: 'gpt-4o-mini', 
          messages: [{ role: 'user', content: message }]
      });
      await bot.api.sendMessage(chatId, resp.choices[0].message.content as string);
    } else {
      await bot.api.sendMessage(chatId, "Nothing to see");
    }
  });

  const handler = webhookCallback(bot, "std/http");
  return handler(req)
};

// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// [token]/route.ts
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs
