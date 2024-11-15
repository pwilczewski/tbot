import { Bot, Context, GrammyError, HttpError, NextFunction, webhookCallback } from "grammy";
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { NextRequest } from "next/server";

import { chatReply } from "@/app/utils/chatReply";
import { suggestTopics } from "@/app/utils/suggestTopics";
import { trainReply } from "@/app/utils/trainReply";
import { trainEnable, trainSkip } from "@/app/utils/trainEnable";

export const POST = async (req: NextRequest) => {

  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0] as string; // parse url to get BOT_TOKEN

  const bot = new Bot(token as string);
  const botInfo = await prismadb.bots.findMany({where: {token: token}, select: {id: true, name: true, aboutMe: true}})
  bot.use(limit());

  // for managing the state of the chatbot
  let cuserStatus: userStatus;

  async function setStatus(ctx: Context, next: NextFunction) {
    const user = await ctx.getAuthor();
    // add username if it's present?
    const dbUser = await prismadb.users.findFirst({where: {telegramId: user.user.id}}) // just for auth?
    // not yet allowing users to create their own bots
    const checkOwner = await prismadb.bots.findFirst({ where: {token: token, ownerId: user.user.id} })

    // if user does not exist, create user and initialize status
    if (dbUser===null) {
      const newUser = await prismadb.users.create({data: {telegramId: user.user.id}})
      cuserStatus = await prismadb.userStatus.create({data: {status: "chat", userId: newUser.id, 
        botId: botInfo[0].id, isOwner: false}})
    } else {
      cuserStatus = await prismadb.userStatus.findFirst({where: {userId: dbUser.id, botId: botInfo[0].id}}) as userStatus
    }

    await next();
  };
  bot.use(setStatus);

  bot.command("start", 
    async (ctx) => {
      const chatId = ctx.chatId;
      const botName = botInfo[0].name

      const userStart = `Welcome! I'm a bot trained to chat on behalf of ` + botName + `. The following commands are available
    /about for information about this bot.
    /topics to suggest conversation topics.`
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

    if (cuserStatus.isOwner===false) {
      await bot.api.sendMessage(chatId, "Only the bot's owner can train.")
    } else {
      await bot.api.sendMessage(chatId, "Training mode enabled")
      const resp = await trainEnable(cuserStatus, botInfo[0].id)
      await bot.api.sendMessage(chatId, resp)
    }
  });

  bot.command("skip", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus.status==="train") {
      await bot.api.sendMessage(chatId, "Retrieving new question")
      const resp = await trainSkip(botInfo[0].id);
      await bot.api.sendMessage(chatId, resp);
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
    const userStart = `The following commands are available
    /about for information about this bot.
    /topics to suggest conversation topics.`
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
