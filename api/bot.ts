import { Bot, webhookCallback } from "grammy";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is unset");

const bot = new Bot(token);

bot.on("message", async (ctx) => {
    await ctx.reply("...");
});

export default webhookCallback(bot, "std/http");