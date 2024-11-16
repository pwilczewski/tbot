import prismadb from "@/lib/prismadb";
import { trainingStatus } from "@prisma/client";

export async function randomQ(answeredQs: {questionId: number}[], trainingStatus: trainingStatus) {

    let excludeQs: number[] = answeredQs.map(item => 
      item.questionId).filter((id): id is number => id !== null);
    let userQLevel: number = trainingStatus.questionLevel as number;
    let count = await prismadb.basedQuestions.count({where: {questionLevel: userQLevel, id: {notIn: excludeQs}}});
  
    // if all questions have been answered or skipped, advance level
    if (count===0) {
      if (trainingStatus.questionLevel as number < 5) {
        await prismadb.trainingStatus.update({ where: {id: trainingStatus.id}, data: {questionLevel: trainingStatus.questionLevel as number + 1} })
      }
      userQLevel = trainingStatus.questionLevel as number + 1
      count = await prismadb.basedQuestions.count({where: {questionLevel: userQLevel, id: {notIn: excludeQs}}})
    }
  
    const randomOffset = Math.floor(Math.random() * count);
    const question = await prismadb.basedQuestions.findFirst({ 
      where: {questionLevel: userQLevel, id: {notIn: excludeQs}}, skip: randomOffset})
  
    return question
  }