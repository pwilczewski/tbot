import prismadb from "@/lib/prismadb";
import { userStatus } from "@prisma/client";

export async function randomQ(answeredQs: {questionId: number | null}[], cuserStatus: userStatus | null) {

    let excludeQs: number[] = [];
    if (answeredQs!==null) {
      excludeQs = answeredQs.map(item => item.questionId).filter((id): id is number => id !== null);
    }
  
    let userQLevel: number = 0;
    if (cuserStatus!==null) {
      userQLevel = cuserStatus.questionLevel as number
    }
  
    let count = await prismadb.basedQuestions.count({where: {questionLevel: userQLevel, id: {notIn: excludeQs}}});
  
    // if all questions have been answered or skipped, advance level
    if (count===0) {
      if (cuserStatus!==null) {
        if (cuserStatus.questionLevel as number < 5) {
          await prismadb.userStatus.update({ where: {id: cuserStatus.id}, data: {questionLevel: cuserStatus.questionLevel as number + 1} })
        }
        userQLevel = cuserStatus.questionLevel as number
        count = await prismadb.basedQuestions.count({where: {questionLevel: userQLevel, id: {notIn: excludeQs}}})
      }
    }
  
    const randomOffset = Math.floor(Math.random() * count);
    const question = await prismadb.basedQuestions.findFirst({ 
      where: {questionLevel: userQLevel, id: {notIn: excludeQs}}, skip: randomOffset})
  
    return question
  }