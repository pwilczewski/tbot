import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";
import { randomQ } from "@/app/utils/randomQ";
import { addEmbeddings } from "./addEmbeddings";

export async function trainEnable(cuserStatus: userStatus, botId: number) {
    const answeredQs = await prismadb.answers.findMany({ where: {botId: botId} , 
        select: {questionId: true}, distinct: ['questionId']});
    const trainingStatus = await prismadb.trainingStatus.findMany({ where: {botId: botId} })
    const question = await randomQ(answeredQs, trainingStatus[0]);

    let resp: string = "No further questions.";

    if (question !== null) {
        await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {status: "train"} })
        await prismadb.trainingStatus.update({where: {id: trainingStatus[0].id}, 
        data: {status: "question", question: question.question as string, questionId: question.id}})
        resp = question.question as string;
    }
    return resp;
};

export async function trainSkip(botId: number) {
    const trainingStatus = await prismadb.trainingStatus.findMany({where: {botId: botId}})
    await prismadb.answers.create({ data: {botId: botId, questionId: trainingStatus[0].questionId, 
      question: trainingStatus[0].question, skipped: true }})
    const answeredQs = await prismadb.answers.findMany({ where: {botId: botId} , 
      select: {questionId: true}, distinct: ['questionId']})
    const question = await randomQ(answeredQs, trainingStatus[0]);

    let resp = "No further questions."
    if (question !== null) {
      if (trainingStatus[0].status==="followup") {
        await addEmbeddings(trainingStatus[0].questionId, botId)
      }
      await prismadb.trainingStatus.update({where: {id: trainingStatus[0].id}, 
        data: {status: "question", question: question.question as string, questionId: question.id}})
      resp = question.question as string;
    }

    return resp;
};