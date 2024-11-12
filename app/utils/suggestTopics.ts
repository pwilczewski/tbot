import prismadb from "@/lib/prismadb";
import OpenAI from 'openai';

export async function suggestTopics(botId: number) {

    const openai = new OpenAI();
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