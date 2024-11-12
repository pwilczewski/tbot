import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { SupabaseFilter, SupabaseVectorStore } from "@langchain/community/vectorstores/supabase";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { createClient } from '@supabase/supabase-js'

export async function chatReply (message: string, botId: number, botName: string) {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, 
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string)
    const embeddings = new OpenAIEmbeddings({model: "text-embedding-3-small"});
    const vectorStore = new SupabaseVectorStore(embeddings, 
      {client, tableName: "documents", queryName: "match_documents",});
    const retriever = vectorStore.asRetriever({filter: (rpc: SupabaseFilter) => 
      rpc.filter("metadata->>botId", "eq", botId), k: 3});
  
    // add chat history
    const prompt = ChatPromptTemplate.fromTemplate(
      `You are answering questions on behalf of {name}.
      Answer in the first person using the context available. 
      If the answer is not available in the context don't make up an answer just reply: I don't know.
      Context\n{context}\n Question:\n{question}`
    );
  
    const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0 });
    const retrievedDocs = await retriever.invoke(message);
  
    const ragChain = await createStuffDocumentsChain({
      llm, prompt, outputParser: new StringOutputParser(),
    });
  
    const resp = await ragChain.invoke({
      name: botName, question: message, context: retrievedDocs,
    });
  
    return resp
  }