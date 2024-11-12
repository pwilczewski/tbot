import { Bot, Context, GrammyError, HttpError, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus, users } from "@prisma/client";
import { NextRequest } from "next/server";

import { chatReply } from "@/app/utils/chatReply";
import { suggestTopics } from "@/app/utils/suggestTopics";
import { randomQ } from "@/app/utils/randomQ";
import { addEmbeddings } from "@/app/utils/addEmbeddings";

const openai = new OpenAI();

// move a lot of this stuff into functions to get my code cleaner

export const POST = async (req: NextRequest) => {

  // parse url to get BOT_TOKEN
  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0] as string;
  const bot = new Bot(token as string);
  bot.use(limit());

  let dbUser: users | null;
  let cuserStatus: userStatus;
  let isOwner: boolean;
  const botInfo = await prismadb.bots.findMany({where: {token: token}, select: {id: true, name: true, aboutMe: true}})
  
  // deny auth here based on users?
  // user.user.username is not required, but id is required hmm...
  async function setStatus(ctx: Context, next: NextFunction) {
    const user = await ctx.getAuthor();
    dbUser = await prismadb.users.findFirst({where: {userName: user.user.username}})

    const checkOwner = await prismadb.bots.findFirst({ where: {token: token, owner: user.user.username} })
    isOwner = checkOwner!==null;

    // if user does not exist, create user and initialize status
    if (dbUser===null) {
      await prismadb.users.create({data: {userName: user.user.username as string, telegramId: user.user.id}})
      dbUser = await prismadb.users.findFirst({ where: {userName: user.user.username} })
      cuserStatus = await prismadb.userStatus.create({data: {status: "start", userName: user.user.username as string, 
        botId: token, isOwner: isOwner, question: "", questionId: 0, questionLevel: 1
      }})
    } else {
      cuserStatus = await prismadb.userStatus.findFirst({
        where: {userName: user.user.username, botId: token}}) as userStatus
    }

    await next();
  }
  bot.use(setStatus);

  bot.command("start", 
    async (ctx) => {
      const chatId = ctx.chatId;

      const userStart = `Welcome to` + botInfo[0].name + `'s bot. I've been trained to chat on behalf of` + botInfo[0].name + `. You can use the /topics command to suggest conversation topics.`
      const ownerStart = `Welcome to your bot. You are currently in chat model. You can use the /train command to switch to training mode.`

      if ( isOwner===false ) {
        await bot.api.sendMessage(chatId, userStart)
      } else {
        // set userStatus to chat here
        await bot.api.sendMessage(chatId, ownerStart)
      }
  });

  bot.command("chat", async (ctx) => {
    const chatId = ctx.chatId;
    await bot.api.sendMessage(chatId, "Chat mode enabled")
    await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {status: "chat"} })
  });

  bot.command("topics", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus.status==="chat") {
      const topics = await suggestTopics(botInfo[0].id, openai);
      await bot.api.sendMessage(chatId, "Here are some topics you might want to ask about:\n" + topics);
    }
  })
  
  bot.command("train", async (ctx) => {
    const chatId = ctx.chatId;

    if (isOwner===false) {
      await bot.api.sendMessage(chatId, "Only the bot's owner can train")
    } else {
      await bot.api.sendMessage(chatId, "Training mode enabled")
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botInfo[0].id} , 
        select: {questionId: true}, distinct: ['questionId']})      
      const question = await randomQ(answeredQs, cuserStatus);
  
      if (question !== null) {
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
          data: {status: "question", question: question.question as string, questionId: question.id}})
        await bot.api.sendMessage(chatId, question.question as string)
      }
    }
  });

  bot.command("skip", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus.status!=="chat") {
      await bot.api.sendMessage(chatId, "Retrieving new question")
      await prismadb.answers.create({ data: {botId: botInfo[0].id, questionId: cuserStatus.questionId, 
        question: cuserStatus.question, skipped: true }})
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botInfo[0].id} , 
        select: {questionId: true}, distinct: ['questionId']})
      const question = await randomQ(answeredQs, cuserStatus);

      if (question !== null) {
        if (cuserStatus.status==="followup") {
          await addEmbeddings(cuserStatus.questionId, botInfo[0].id)
        }
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
          data: {status: "question", question: question.question as string, questionId: question.id}})
        await bot.api.sendMessage(chatId, question.question as string)
      } else {
        await bot.api.sendMessage(chatId, "No further questions")
      }
    }
  })

  bot.command("about", async(ctx) => {
    const chatId = ctx.chatId;
    const aboutMe = botInfo[0].aboutMe;
    if (aboutMe!==null) {
      bot.api.sendMessage(chatId, `A message from my creator... \n\n` + botInfo[0].aboutMe);
    } else {
      bot.api.sendMessage(chatId, `My creator has nothing to say here.`);
    }
    
  })

  bot.command("help", async(ctx) => {
    const chatId = ctx.chatId;
    const userStart = `Type /topics to suggest conversation topics.`
    bot.api.sendMessage(chatId, userStart)
  })
  
  bot.on("message", async (ctx) => {
    // await ctx.reply("...");
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;

    if (message.startsWith('/')) {
      const command = message.split(' ')[0];
      await ctx.reply(`Sorry, '${command}' is not a valid command. Type /help for a list of available commands.`);
      return
    }

    // use AI to ask a follow up question
    if (cuserStatus.status==="question") {
      const fuQ = await openai.chat.completions.create({
        messages: [{ role: "system", content: "Ask a follow up question to the user's answer. Respond with just the question."},
            {role: "user", content: "Question: " +  cuserStatus.question + "\n " + "Answer: " + message }],
        model: 'gpt-4o-mini', })
      const resp = fuQ.choices[0].message.content as string
      await bot.api.sendMessage(chatId, resp)

      await prismadb.answers.create({data: {botId: botInfo[0].id, questionId: cuserStatus.questionId, 
        question: cuserStatus.question, answer: message, skipped: false}})
      await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {question: resp}})

    } else if (cuserStatus.status==="followup") {
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botInfo[0].id} , 
        select: {questionId: true}, distinct: ['questionId']})
      const question = await randomQ(answeredQs, cuserStatus);

      if (question!==null) {
        await bot.api.sendMessage(chatId, question.question as string)
        await prismadb.answers.create({data: {botId: botInfo[0].id, questionId: cuserStatus.questionId, 
          question: cuserStatus.question, answer: message, skipped: false}})

        await addEmbeddings(cuserStatus.questionId, botInfo[0].id) // embed the entire convo id here

        await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {questionId: question.id, question: question.question}})
      }
    } else if (cuserStatus.status==="chat") {
      const resp = await chatReply(message, botInfo[0].id, botInfo[0].name as string)
      await bot.api.sendMessage(chatId, resp)
    }

    // switch status out here to avoid weird loops that were happening
    if (cuserStatus.status==="followup") {
      await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "question"}})
    } else if (cuserStatus.status==="question") {
      await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "followup"}})
    }
  });

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    
    if (err instanceof GrammyError) {
      console.error("Error in request:", err.description);
    } else if (err instanceof HttpError) {
      console.error("Could not contact Telegram:", err);
    } else {
      console.error("Unknown error:", err);
    }
  });  

  const handler = webhookCallback(bot, "std/http");
  return handler(req)
};

// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// [token]/route.ts
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs
