import { Bot, Context, GrammyError, HttpError, NextFunction, session, SessionFlavor, webhookCallback } from "grammy";
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { NextRequest } from "next/server";

import { chatReply } from "@/app/utils/chatReply";
import { suggestTopics } from "@/app/utils/suggestTopics";
import { randomQ } from "@/app/utils/randomQ";
import { addEmbeddings } from "@/app/utils/addEmbeddings";
import { trainReply } from "@/app/utils/trainReply";

interface SessionData {
  conversationHistory: string[];
}

export const POST = async (req: NextRequest) => {

  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0] as string; // parse url to get BOT_TOKEN

  type MyContext = Context & SessionFlavor<SessionData>;
  const bot = new Bot<MyContext>(token as string);
  const botInfo = await prismadb.bots.findMany({where: {token: token}, select: {id: true, name: true, aboutMe: true}})
  bot.use(limit());

  // for managing the state of the chatbot
  let cuserStatus: userStatus;

  // user.user.username is not required, but id is required hmm...
  async function setStatus(ctx: Context, next: NextFunction) {
    const user = await ctx.getAuthor();
    console.log(user.user.id)
    // am I just using it for auth?
    const dbUser = await prismadb.users.findFirst({where: {userName: user.user.username}})
    const checkOwner = await prismadb.bots.findFirst({ where: {token: token, owner: user.user.username} })

    // if user does not exist, create user and initialize status
    // not yet allowing users to create their own bots
    if (dbUser===null) {
      await prismadb.users.create({data: {userName: user.user.username as string, telegramId: user.user.id}})
      cuserStatus = await prismadb.userStatus.create({data: {status: "start", userName: user.user.username as string, 
        botId: botInfo[0].id, isOwner: false
      }})
    } else {
      cuserStatus = await prismadb.userStatus.findFirst({
        where: {userName: user.user.username, botId: botInfo[0].id}}) as userStatus
    }

    await next();
  };
  bot.use(setStatus);

  bot.use(session({
    initial: (): SessionData => ({
      conversationHistory: [],
    }),
  }));

  bot.use(async (ctx, next) => {
    if (ctx.message?.text) {
      ctx.session.conversationHistory.push(ctx.message.text);
    }
    await next();
  });

  bot.command('history', async (ctx) => {
    const history = ctx.session.conversationHistory.join('\n');
    await ctx.reply(
      history.length > 0 
        ? `Your conversation history:\n${history}`
        : 'No conversation history yet.'
    );
  });

  bot.command("start", 
    async (ctx) => {
      const chatId = ctx.chatId;
      const botName = botInfo[0].name

      const userStart = `Welcome to` + botName + `'s bot. I've been trained to chat on behalf of` + botName + `.\nYou can use the /topics command to suggest conversation topics.`
      const ownerStart = `Welcome to your bot. You are currently in chat model. You can use the /train command to switch to training mode.`

      if ( cuserStatus.isOwner===false ) {
        await bot.api.sendMessage(chatId, userStart)
      } else {
        await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {status: "chat"} })
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
      const topics = await suggestTopics(botInfo[0].id);
      await bot.api.sendMessage(chatId, "Here are some topics you might want to ask about:\n" + topics);
    }
  })
  
  bot.command("train", async (ctx) => {
    const chatId = ctx.chatId;
    // get and update the training status here

    if (cuserStatus.isOwner===false) {
      await bot.api.sendMessage(chatId, "Only the bot's owner can train")
    } else {
      const trainingStatus = await prismadb.trainingStatus.findMany({ where: {botId: botInfo[0].id} })
      await bot.api.sendMessage(chatId, "Training mode enabled")
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botInfo[0].id} , 
        select: {questionId: true}, distinct: ['questionId']});
      const question = await randomQ(answeredQs, trainingStatus[0]);
  
      if (question !== null) {
        await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {status: "train"} })
        await prismadb.trainingStatus.update({where: {id: trainingStatus[0].id}, 
          data: {status: "question", question: question.question as string, questionId: question.id}})
        await bot.api.sendMessage(chatId, question.question as string)
      }
    }
  });

  bot.command("skip", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus.status==="train") {
      const trainingStatus = await prismadb.trainingStatus.findMany({where: {botId: botInfo[0].id}})
      await bot.api.sendMessage(chatId, "Retrieving new question")
      await prismadb.answers.create({ data: {botId: botInfo[0].id, questionId: trainingStatus[0].questionId, 
        question: trainingStatus[0].question, skipped: true }})
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botInfo[0].id} , 
        select: {questionId: true}, distinct: ['questionId']})
      const question = await randomQ(answeredQs, trainingStatus[0]);

      if (question !== null) {
        if (trainingStatus[0].status==="followup") {
          await addEmbeddings(trainingStatus[0].questionId, botInfo[0].id)
        }
        await prismadb.trainingStatus.update({where: {id: trainingStatus[0].id}, 
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
      bot.api.sendMessage(chatId, `A message from my creator... \n\n` + aboutMe);
    } else {
      bot.api.sendMessage(chatId, `My creator has nothing to say here.`);
    }
    
  })

  bot.command("help", async(ctx) => {
    const chatId = ctx.chatId;
    const userStart = `Type /topics to suggest conversation topics.\nType /about for information about this bot.`
    bot.api.sendMessage(chatId, userStart)
  })
  
  bot.on("message", async (ctx) => {
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;

    if (message.startsWith('/')) {
      const command = message.split(' ')[0];
      await ctx.reply(`Sorry, '${command}' is not a valid command. Type /help for a list of available commands.`);
      return
    }

    if (cuserStatus.status==="chat") {
      const resp = await chatReply(message, botInfo[0].id, botInfo[0].name as string)
      await bot.api.sendMessage(chatId, resp);
    } else {
      const trainingStatus = await prismadb.trainingStatus.findMany({ where: {botId: botInfo[0].id} })
      const resp = await trainReply(message, trainingStatus[0], chatId)
      await bot.api.sendMessage(chatId, resp);
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
