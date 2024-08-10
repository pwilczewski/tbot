import { Bot, Context, NextFunction, webhookCallback } from "grammy";
import OpenAI from 'openai';
import { limit } from "@grammyjs/ratelimiter";
import prismadb from "@/lib/prismadb";

const token = process.env.TELEGRAM_BOT_TOKEN as string;
const bot = new Bot(token);
const openai = new OpenAI();

// ratelimiter
bot.use(limit());

/*
// middleware example - logs reponse time to console
async function responseTime(
  ctx: Context,
  next: NextFunction, // is an alias for: () => Promise<void>
): Promise<void> {
  const before = Date.now();
  // invoke downstream middleware
  await next(); // make sure to `await`!
  const after = Date.now();
  console.log(`Response time: ${after - before} ms`);
}

bot.use(responseTime);
*/

bot.command("start", 
  async (ctx) => {
    const user = await ctx.getAuthor();
    const chatId = ctx.chatId;
    console.log(user.user)
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
  const question = await prismadb.basedQuestions.findFirst()
  if (question!==null) {
    await bot.api.sendMessage(chatId, question.question as string);
  } else {
    await bot.api.sendMessage(chatId, "Nothing found");
  }
  // go to supabase and get a question
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

export const POST = webhookCallback(bot, "std/http");

/*
export const POST = async (req: NextRequest) => {
  const token = process.env.TELEGRAM_BOT_TOKEN as string
  const bot = new Bot(token)
  const openai = new OpenAI();

  bot.on("message", async (ctx) => {
    // await ctx.reply("...");
    const message = ctx.message.text as string;
    const chatId = ctx.chatId;

    const resp = await openai.chat.completions.create({model: 'gpt-4o-mini', 
        messages: [{ role: 'user', content: message }]
    });
    await bot.api.sendMessage(chatId, resp.choices[0].message.content as string);
  });
  const handleUpdate = webhookCallback(bot, "std/http");
  return handleUpdate(req);
};
*/


// curl https://api.telegram.org/bot<telegram_bot_token>/setWebhook?url=https://<your-deployment.vercel>.app/api/bot
// curl https://api.telegram.org/bot6893250826:AAEdaWjzGzFN8-vrnrTLhJ7DybU--FVGzzs/setWebhook?url=https://tbot-tau.vercel.app/api/bot
