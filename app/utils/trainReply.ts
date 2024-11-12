import prismadb from "@/lib/prismadb";
import { trainingStatus } from "@prisma/client";
import { Bot } from "grammy";
import OpenAI from 'openai';
import { randomQ } from "./randomQ";
import { addEmbeddings } from "./addEmbeddings";
``
export async function trainReply(message: string, trainingStatus: trainingStatus, 
    chatId: number, bot: Bot, botId: number) {

    const openai = new OpenAI();

    if (trainingStatus.status==="question") {
        // use AI to ask a follow up question
        const fuQ = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Ask a follow up question to the user's answer. Respond with just the question."},
                {role: "user", content: "Question: " +  trainingStatus.question + "\n " + "Answer: " + message }],
            model: 'gpt-4o-mini', })
        const resp = fuQ.choices[0].message.content as string
        await bot.api.sendMessage(chatId, resp)

        await prismadb.answers.create({data: {botId: botId, questionId: trainingStatus.questionId, 
            question: trainingStatus.question, answer: message, skipped: false}})
        await prismadb.trainingStatus.update({where: {id: trainingStatus.id}, data: {question: resp}})

    } else if (trainingStatus.status==="followup") {
        const answeredQs = await prismadb.answers.findMany({ where: {botId: botId} , 
            select: {questionId: true}, distinct: ['questionId']})
        const question = await randomQ(answeredQs, trainingStatus);

        if (question!==null) {
            await bot.api.sendMessage(chatId, question.question as string)
            await prismadb.answers.create({data: {botId: botId, questionId: trainingStatus.questionId, 
                question: trainingStatus.question, answer: message, skipped: false}})
            await addEmbeddings(trainingStatus.questionId, botId) // embed the entire convo id here
            await prismadb.trainingStatus.update({where: {id: trainingStatus.id}, data: {questionId: question.id, question: question.question}})
        } else {
        await bot.api.sendMessage(chatId, "No further questions")
        }
    }

    // switch status out here to avoid weird loops that were happening
    if (trainingStatus.status==="followup") {
        await prismadb.trainingStatus.update({where: {id: trainingStatus.id}, data: {status: "question"}})
    } else if (trainingStatus.status==="question") {
        await prismadb.trainingStatus.update({where: {id: trainingStatus.id}, data: {status: "followup"}})
    }
}