import { Bot, Context, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";
import { userStatus, users } from "@prisma/client";
import { NextRequest } from "next/server";
import { createClient } from '@supabase/supabase-js'
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import type { Document } from "@langchain/core/documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

const openai = new OpenAI();

// definitely possible that there are no questions answered and answeredQs comes in as null
async function randomQ(answeredQs: {questionId: bigint | null}[]) {

  let excludeQs: bigint[] = [];
  if (answeredQs!==null) {
    excludeQs = answeredQs.map(item => item.questionId).filter((id): id is bigint => id !== null);
  }
  const count = await prismadb.basedQuestions.count({where: {questionCategory: "intro", id: {notIn: excludeQs}}});
  const randomOffset = Math.floor(Math.random() * count);
  const question = await prismadb.basedQuestions.findFirst({ 
    where: {questionCategory: "intro", id: {notIn: excludeQs}}, skip: randomOffset})

  return question
}

async function addEmbeddings (questionId: bigint) {

  const qanda = await prismadb.answers.findMany({where: {questionId: questionId}, select: {question: true, answer: true}})
  const convo = qanda[0].question as string + " " + qanda[0].answer + " " + qanda[1].question + " " + qanda[1].answer

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)

  const embeddings = new OpenAIEmbeddings({model: "text-embedding-3-small",});
  const vectorStore = new SupabaseVectorStore(embeddings, {
    client: client, tableName: "documents", queryName: "match_documents",
  });

  const doc1: Document = {pageContent: convo, metadata: {source: "testing"}}
  await vectorStore.addDocuments([doc1]);

  // await prismadb.documents.create({data: {botId: 1, questionId: questionId, body: convo}})
  // use prismadb to update botid and questionid
}

export const POST = async (req: NextRequest) => {

  // parse url to get BOT_TOKEN
  const token = req.nextUrl.href.match(/([^\/]+)$/)?.[0];
  const bot = new Bot(token as string);
  let dbUser: users | null;
  let cuserStatus: userStatus | null;
  let isOwner: boolean | null;
  const botId = await prismadb.bots.findMany({where: {token: token}, select: {id: true}})
  
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

  // add documentation for available commands here
  bot.command("start", 
    async (ctx) => {
      const chatId = ctx.chatId;

      if ( isOwner===false ) {
        await bot.api.sendMessage(chatId, "User start")
      } else {
        await bot.api.sendMessage(chatId, "Owner start")
      }
  });

  // switch to chat status, user is always in chat status
  bot.command("chat", async (ctx) => {
    const chatId = ctx.chatId;
    if (cuserStatus!==null) {
      // should I clear questions here?
      await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {status: "chat"} })
    }
  });
  
  // only owner can enter train status
  bot.command("train", async (ctx) => {
    const chatId = ctx.chatId;

    if (isOwner===false) {
      await bot.api.sendMessage(chatId, "Only the bot's owner can train")
    } else {
      await bot.api.sendMessage(chatId, "Retrieving questions")
      const answeredQs = await prismadb.answers.findMany({ where: {botId: botId[0].id} , 
        select: {questionId: true}, distinct: ['questionId']})      
      const question = await randomQ(answeredQs);
  
      if (question !== null) {
        if (cuserStatus!==null) {
          await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
            data: {status: "question", question: question.question as string, questionId: question.id}})
        }
        await bot.api.sendMessage(chatId, question.question as string)
      }
    }
  });

  // what other commands? help? restart? chat? info? clear?
  // don't do too many commands! can show diff info for train / chat
  bot.command("skip", async (ctx) => {
    const chatId = ctx.chatId;
    await bot.api.sendMessage(chatId, "Retrieving questions")
    const answeredQs = await prismadb.answers.findMany({ where: {botId: botId[0].id} , 
      select: {questionId: true}, distinct: ['questionId']})
    const question = await randomQ(answeredQs);

    if (question !== null) {
      if (cuserStatus!==null) {
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, 
          data: {status: "question", question: question.question as string, questionId: question.id}})
      }
      await bot.api.sendMessage(chatId, question.question as string)
    } else {
      await bot.api.sendMessage(chatId, "No further questions")
    }
  })
  
  // move a lot of this stuff into functions to get my code cleaner
  bot.on("message", async (ctx) => {
    // await ctx.reply("...");
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;

    // const botinfo = await bot.api.getMe()

    if (cuserStatus!==null) {
      // use AI to ask a follow up question
      if (cuserStatus.status==="question") {
        const fuQ = await openai.chat.completions.create({
          messages: [{ role: "system", content: "Ask a follow up question to the user's answer. Respond with just the question."},
              {role: "user", content: "Question: " +  cuserStatus.question + "\n " + "Answer: " + message }],
          model: 'gpt-4o-mini', })
        const resp = fuQ.choices[0].message.content as string
        await bot.api.sendMessage(chatId, resp)

        await prismadb.answers.create({data: {botId: 1, questionId: cuserStatus.questionId, 
          question: cuserStatus.question, answer: message}})
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {question: resp}})

      } else if (cuserStatus.status==="followup") {
        const answeredQs = await prismadb.answers.findMany({ where: {botId: botId[0].id} , 
          select: {questionId: true}, distinct: ['questionId']})
        const question = await randomQ(answeredQs);

        if (question!==null) {
          await bot.api.sendMessage(chatId, question.question as string)
          await prismadb.answers.create({data: {botId: 1, questionId: cuserStatus.questionId, 
            question: cuserStatus.question, answer: message}})

          if (cuserStatus.questionId!==null) {
            await addEmbeddings(cuserStatus.questionId) // embed the entire convo id here
          }

          await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {questionId: question.id, question: question.question}})
        }
      } else if (cuserStatus.status==="chat") {

        const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, 
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
        const embeddings = new OpenAIEmbeddings();
        const vectorStore = new SupabaseVectorStore(embeddings, {client, tableName: "documents",});
        const retriever = vectorStore.asRetriever();

        //           So far the user {name} has discussed with you (system) {chatHistory}
        const prompt = ChatPromptTemplate.fromTemplate(
          `You are answering questions on behalf of Paul.
          Now answer the user's questions in the first person using the context available. 
          If the answer is not available in the context don't make up an answer just reply: I don't know. \n
          Context\n{context}\n Question:\n{question}`
        );

        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
        const retrievedDocs = await retriever.invoke(message);

        console.log(retrievedDocs)

        const ragChain = await createStuffDocumentsChain({
          llm, prompt,
          outputParser: new StringOutputParser(),
        });

        const resp = await ragChain.invoke({
          question: message,
          context: retrievedDocs,
        });

        // const retriever = vectorStore.asRetriever({filter: (rpc: SupabaseFilter) => rpc.filter("metadata->>repHandle", "eq", rep.repHandle)});

        /*
        const repQ = await openai.chat.completions.create({
          messages: [{ role: "system", content: "Give a very short reply to the user's question."},
              {role: "user", content: message }],
          model: 'gpt-4o-mini', })
        const resp = repQ.choices[0].message.content as string
        */
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

  const handler = webhookCallback(bot, "std/http");
  return handler(req)
};

// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// [token]/route.ts
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot/6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs
