import prismadb from "@/lib/prismadb";
import { OpenAIEmbeddings } from "@langchain/openai";
import { createClient } from '@supabase/supabase-js'
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import type { Document } from "@langchain/core/documents";

export async function addEmbeddings (questionId: number, botId: number) {

    const qanda = await prismadb.answers.findMany({where: {questionId: questionId, skipped: false}, 
      select: {question: true, answer: true}})
  
    // temporary solution, it should really handle a qanda of arbitrary length
    let convo: string;
    if (qanda.length===1) {
      convo = qanda[0].question as string + " " + qanda[0].answer
    } else {
      convo = qanda[0].question as string + " " + qanda[0].answer + " " + qanda[1].question + " " + qanda[1].answer
    }
  
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, 
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
  
    const embeddings = new OpenAIEmbeddings({model: "text-embedding-3-small",});
    const vectorStore = new SupabaseVectorStore(embeddings, {
      client: client, tableName: "documents", queryName: "match_documents",
    });
  
    const doc1: Document = {pageContent: convo, metadata: {botId: botId, questionId: questionId}}
    const newIds = await vectorStore.addDocuments([doc1]);
  
    await prismadb.documents.update({where: {id: Number(newIds[0])}, data: {botId: botId, questionId: questionId}})
  }