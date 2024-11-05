import { Bot, Context, GrammyError, HttpError, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus, users } from "@prisma/client";
import { NextRequest } from "next/server";
import { createClient } from '@supabase/supabase-js'
import { SupabaseFilter, SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import type { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

const openai = new OpenAI();

// move a lot of this stuff into functions to get my code cleaner

// select 3 random answers from documents and summarize them as bullet points
async function suggestTopics(botId: number) {

  const sugTopics = await prismadb.documents.findMany({where: {botId: botId}, select: {content: true}})
  const randTopics = sugTopics.sort(() => Math.random() - 0.5).slice(0,3);
  if (randTopics.length >= 3) {
    const qaPairs = randTopics[0].content + " \n" + randTopics[1].content + " \n" + randTopics[2].content

    // better prompting here
    const fuQ = await openai.chat.completions.create({
      messages: [{ role: "system", content:
          // "Summarize the user's question and answer pairs as three bullet points, give just a few words for each."},
          `You are a chatbot representing Paul.
            The user just asked for some interesting topics for conversation.
            Paul has answered a series of questions below.
            Based on these answers, suggest some topics that Paul might be interested in or have opinions about.
            Summarize these as three bullet points. 
            Be very brief, give just a few words for each topic.
            Keep the topics somewhat vague and illusive so that the user wants to know more.`},
          {role: "user", content: qaPairs}],
      model: 'gpt-4o-mini', })
    // Don't just summarize the questions and answers, you want to stimulate further discussion.
    const resp = fuQ.choices[0].message.content as string
    return resp
  } else {
    return "No suggestions available."
  }
}

async function chatReply (message: string, botId: number, botName: string) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
  const embeddings = new OpenAIEmbeddings({model: "text-embedding-3-small"});
  const vectorStore = new SupabaseVectorStore(embeddings, 
    {client, tableName: "documents", queryName: "match_documents",});
  const retriever = vectorStore.asRetriever({filter: (rpc: SupabaseFilter) => 
    rpc.filter("metadata->>botId", "eq", botId), k: 3});

  // add chat history
  const prompt = ChatPromptTemplate.fromTemplate(
    `You are answering questions on behalf of {name}.
    Answer in the first person using the context available. 
    If the answer is not available in the context don't make up an answer just reply: I don't know.
    Context\n{context}\n Question:\n{question}`
  );

  const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
  const retrievedDocs = await retriever.invoke(message);

  const ragChain = await createStuffDocumentsChain({
    llm, prompt, outputParser: new StringOutputParser(),
  });

  const resp = await ragChain.invoke({
    name: botName, question: message, context: retrievedDocs,
  });

  return resp
}

async function randomQ(answeredQs: {questionId: number | null}[], cuserStatus: userStatus | null) {

  let excludeQs: number[] = [];
  if (answeredQs!==null) {
    excludeQs = answeredQs.map(item => item.questionId).filter((id): id is number => id !== null);
  }

  let userQLevel: number = 0;
  if (cuserStatus!==null) {
    userQLevel = cuserStatus.questionLevel as number
  }

  let count = await prismadb.basedQuestions.count({where: {questionLevel: userQLevel, id: {notIn: excludeQs}}});

  // if all questions have been answered or skipped, advance level
  if (count===0) {
    if (cuserStatus!==null) {
      if (cuserStatus.questionLevel as number < 5) {
        await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {questionLevel: cuserStatus.questionLevel as number + 1} })
      }
      userQLevel = cuserStatus.questionLevel as number
      count = await prismadb.basedQuestions.count({where: {questionLevel: userQLevel, id: {notIn: excludeQs}}})
    }
  }

  const randomOffset = Math.floor(Math.random() * count);
  const question = await prismadb.basedQuestions.findFirst({ 
    where: {questionLevel: userQLevel, id: {notIn: excludeQs}}, skip: randomOffset})

  return question
}

async function addEmbeddings (questionId: number, botId: number) {

  const qanda = await prismadb.answers.findMany({where: {questionId: questionId, skipped: false}, 
    select: {question: true, answer: true}})

  // temporary solution, it should really handle a qanda of arbitrary length
  let convo: string;
  if (qanda.length===1) {
    convo = qanda[0].question as string + " " + qanda[0].answer
  } else {
    convo = qanda[0].question as string + " " + qanda[0].answer + " " + qanda[1].question + " " + qanda[1].answer
  }

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)

  const embeddings = new OpenAIEmbeddings({model: "text-embedding-3-small",});
  const vectorStore = new SupabaseVectorStore(embeddings, {
    client: client, tableName: "documents", queryName: "match_documents",
  });

  const doc1: Document = {pageContent: convo, metadata: {botId: botId, questionId: questionId}}
  const newIds = await vectorStore.addDocuments([doc1]);

  await prismadb.documents.update({where: {id: Number(newIds[0])}, data: {botId: botId, questionId: questionId}})
}

export const POST = async (req: NextRequest) => {

  // parse url to get BOT_TOKEN
  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0];
  const bot = new Bot(token as string);
  let dbUser: users | null;
  let cuserStatus: userStatus | null;
  let isOwner: boolean | null;
  const botInfo = await prismadb.bots.findMany({where: {token: token}, select: {id: true, name: true}})
  
  bot.use(limit());
  
  // deny auth here based on users?
  // user.user.username is not required, but id is required hmm...
  async function setStatus(ctx: Context, next: NextFunction) {
    const user = await ctx.getAuthor();
    dbUser = await prismadb.users.findFirst({where: {userName: user.user.username}})

    const checkOwner = await prismadb.bots.findFirst({ where: {token: token, owner: user.user.username} })
    isOwner = checkOwner!==null;

    // if user does not exist, create user and initialize status
    if (dbUser===null) {
      await prismadb.users.create({data: {userName: user.user.username, telegramId: user.user.id}})
      dbUser = await prismadb.users.findFirst({ where: {userName: user.user.username} })
      cuserStatus = await prismadb.userStatus.create({data: {status: "start", userName: user.user.username, 
        botId: token, isOwner: isOwner, question: "", questionId: null
      }})
    } else {
      cuserStatus = await prismadb.userStatus.findFirst({
        where: {userName: user.user.username, botId: token}})
    }

    await next();
  }
  
  bot.use(setStatus);

  bot.command("start", 
    async (ctx) => {
      const chatId = ctx.chatId;

      const userStart = `Welcome to` + botInfo[0].name + `'s bot. I've been trained to answer questions on behalf of` + botInfo[0].name + `. You can use the /topics command to suggest conversation topics.`

        const ownerStart = `Welcome to your bot. You are currently in chat model. You can use the /train command to switch to training mode.`

      if ( isOwner===false ) {
        await bot.api.sendMessage(chatId, userStart)
      } else {
        // set userStatus to chat here
        await bot.api.sendMessage(chatId, ownerStart)
      }
  });

  // switch to chat status, user is always in chat status
  bot.command("chat", async (ctx) => {
    const chatId = ctx.chatId;
    await bot.api.sendMessage(chatId, "Chat mode enabled")
    if (cuserStatus!==null) {
      // should I clear questions here?
      await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {status: "chat"} })
    }
  });

  bot.command("topics", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus!==null && cuserStatus.status==="chat") {
      const topics = await suggestTopics(botInfo[0].id);
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
        if (cuserStatus!==null) {
          await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
            data: {status: "question", question: question.question as string, questionId: question.id}})
        }
        await bot.api.sendMessage(chatId, question.question as string)
      }
    }
  });

  bot.command("skip", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus!==null && cuserStatus.status!=="chat") {
      await bot.api.sendMessage(chatId, "Retrieving new question")
      await prismadb.answers.create({ data: {botId: botInfo[0].id, questionId: cuserStatus.questionId, 
        question: cuserStatus.question, skipped: true }})
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botInfo[0].id} , 
        select: {questionId: true}, distinct: ['questionId']})
      const question = await randomQ(answeredQs, cuserStatus);

      if (question !== null) {
        if (cuserStatus!==null) {
          if (cuserStatus.status==="followup" && cuserStatus.questionId!==null) {
            await addEmbeddings(cuserStatus.questionId, botInfo[0].id)
          }
          await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
            data: {status: "question", question: question.question as string, questionId: question.id}})
        }
        await bot.api.sendMessage(chatId, question.question as string)
      } else {
        await bot.api.sendMessage(chatId, "No further questions")
      }
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

    if (cuserStatus!==null) {
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

          if (cuserStatus.questionId!==null) {
            await addEmbeddings(cuserStatus.questionId, botInfo[0].id) // embed the entire convo id here
          }

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
