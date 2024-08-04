import { NextApiRequest, NextApiResponse } from "next";
import { BotError } from "grammy";
import { startTelegramBotInDev } from "@/app/start";
// import cors from "cors";

export const POST = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    if (process.env.NODE_ENV === "development" && req.query?.action !== "start") {
      return res.status(500).send({ error: { message: "Wrong gateway." } });
    }

    await startTelegramBotInDev(); // Ensure this function is correctly defined and imported
    res.status(200).send("ok");
  } catch (error) {
    if (error instanceof BotError) {
      res.status(200).send({});
    } else {
      console.error(error);
      res.status(500).end("Something broke!");
    }
  }
};


// this is to test the bot locally by visiting http://localhost:3000/api/telegram-dev?action=start
