import { NextApiRequest, NextApiResponse } from "next";
import nc from "next-connect";
import { BotError } from "grammy";
import { startTelegramBotInDev } from "@/app/start";
import { createRouter, expressWrapper } from "next-connect";
// import cors from "cors";

const router = createRouter<NextApiRequest, NextApiResponse>();

router
  // Use express middleware in next-connect with expressWrapper function
  // .use(expressWrapper(passport.session()))
  // A middleware example
  .get((req, res, next) => {
    if (process.env.NODE_ENV==="development") {
        next();
      }
  })
  .get(async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      if (req.query && req.query.action !== "start") {
        res.status(500).send({ error: { message: "Wrong gateway." } });
        return;
      }

      await startTelegramBotInDev();
      res.status(200).send("ok");
    } catch (error) {
      res.status(500).json({ error });
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


// this is to test the bot locally by visiting http://localhost:3000/api/telegram-dev?action=start
