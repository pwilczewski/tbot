import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { Bot } from "grammy";
import OpenAI from 'openai';
import { randomQ } from "./randomQ";
import { addEmbeddings } from "./addEmbeddings";

export async function trainReply(message: string, cuserStatus: userStatus, 
    openai: OpenAI, chatId: number, bot: Bot, botId: number) {

    if (cuserStatus.status==="question") {
        // use AI to ask a follow up question
        const fuQ = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Ask a follow up question to the user's answer. Respond with just the question."},
                {role: "user", content: "Question: " +  cuserStatus.question + "\n " + "Answer: " + message }],
            model: 'gpt-4o-mini', })
        const resp = fuQ.choices[0].message.content as string
        await bot.api.sendMessage(chatId, resp)

        await prismadb.answers.create({data: {botId: botId, questionId: cuserStatus.questionId, 
            question: cuserStatus.question, answer: message, skipped: false}})
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {question: resp}})

    } else if (cuserStatus.status==="followup") {
        const answeredQs = await prismadb.answers.findMany({ where: {botId: botId} , 
            select: {questionId: true}, distinct: ['questionId']})
        const question = await randomQ(answeredQs, cuserStatus);

        if (question!==null) {
            await bot.api.sendMessage(chatId, question.question as string)
            await prismadb.answers.create({data: {botId: botId, questionId: cuserStatus.questionId, 
                question: cuserStatus.question, answer: message, skipped: false}})
            await addEmbeddings(cuserStatus.questionId, botId) // embed the entire convo id here
            await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {questionId: question.id, question: question.question}})
        } else {
        await bot.api.sendMessage(chatId, "No further questions")
        }
    }

    // switch status out here to avoid weird loops that were happening
    if (cuserStatus.status==="followup") {
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "question"}})
    } else if (cuserStatus.status==="question") {
        await prismadb.userStatus.update({where: {id: cuserStatus.id}, data: {status: "followup"}})
    }
}