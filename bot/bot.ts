import { Bot, Context } from "grammy";


export const bot = new Bot<Context>(process.env.TELEGRAM_BOT_TOKEN ?? "");