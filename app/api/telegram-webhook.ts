import { NextApiRequest, NextApiResponse } from "next";
import nc from "next-connect";
import { BotError, webhookCallback } from "grammy";

import { bot } from "@/bot/bot";
import { startTelegramBotInProduction } from "@/app/start";

const isProd = process.env.NODE_ENV === "production"

import { createRouter, expressWrapper } from "next-connect";

const router = createRouter<NextApiRequest, NextApiResponse>();

router
  .post((req, _res, next) => {
    if (req.query && req.query.token === process.env.TELEGRAM_BOT_WEBHOOK_TOKEN) {
      next();
    }
  })
  .post(webhookCallback(bot, "next-js"))
  .get(async (req, res) => { 
  // this is used to automatically setup your webhook by visiting https://my-secrete-webapp.tld/api/telegram-webhook?token=[YOUR-BOT-TOKEN]
  // replace [YOUR-BOT-TOKEN] with your telegram bot token
  // only do so after you have deployed your bot in production
    try {
      if (process.env.NODE_ENV !=="production" || (req.query && req.query.token !== process.env.TELEGRAM_BOT_WEBHOOK_TOKEN)) {
        return res.status(500).send({ error: { message: "Wrong gateway." } });
      }

      await startTelegramBotInProduction();
    } finally {
      return res.status(200).send("ok");
    }
  });

export default router.handler({
    onError: (err, _req, res) => {
      if (err instanceof BotError) {
        res.status(200).send({});
      } else {
        console.error(err);
        res.status(500).end("Something broke!");
      }
    }
});
