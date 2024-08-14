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

    const botinfo = await bot.api.getMe()
    console.log(botinfo)

    if (cuserStatus!==null) {
      if (cuserStatus.status==="question") {
        // create a new answer, should I write a Q/A pair here? 

        // get the question!
        const question = await prismadb.basedQuestions.findFirst({where: {id: cuserStatus.questionId as bigint}})

        // ask a follow up question
        if (question!==null) {
          const fuQ = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Ask a follow up question to the user's answer. Resopnd with just the question."},
                {role: "user", content: "Question: " +  question.question + "\n " + "Answer: " + message }],
            model: 'gpt-4o-mini', })
          await bot.api.sendMessage(chatId, fuQ.choices[0].message.content as string)

          await prismadb.answers.create({data: {botId: 1, questionId: cuserStatus.questionId, answer: message}})
          await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "followup"}})
        }
      } else if (cuserStatus.status==="followup") {

        // record answer from follow up
        await prismadb.answers.update({where: {id: cuserStatus.id}, data: {answer: message}})

        const question = await randomQ();
        if (question!==null) {
          await bot.api.sendMessage(chatId, question.question as string)
          await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
                                            data: {questionId: question.id}})
        }
      }
    }
  });

  const handler = webhookCallback(bot, "std/http");
  return handler(req)
};

// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// [token]/route.ts
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs
