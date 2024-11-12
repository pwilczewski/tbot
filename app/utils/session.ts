import { Bot, Context, SessionFlavor } from 'grammy';

// Define the structure of your session
interface SessionData {
  conversationHistory: string[];
}

// Create a custom context type
type MyContext = Context & SessionFlavor<SessionData>;

// Create the bot with the custom context
const bot = new Bot<MyContext>('YOUR_BOT_TOKEN');

// Use grammY's built-in session feature
import { session } from 'grammy';

// Initialize the session middleware
bot.use(session({
  initial: (): SessionData => ({
    conversationHistory: [],
  }),
}));

// Middleware to store messages in conversation history
bot.use(async (ctx, next) => {
  if (ctx.message?.text) {
    ctx.session.conversationHistory.push(ctx.message.text);
  }
  await next();
});

// Handle /history command
bot.command('history', async (ctx) => {
  const history = ctx.session.conversationHistory.join('\n');
  await ctx.reply(
    history.length > 0 
      ? `Your conversation history:\n${history}`
      : 'No conversation history yet.'
  );
});

// Handle text messages
bot.on('message:text', async (ctx) => {
  await ctx.reply(`Received: ${ctx.message.text}`);
});

// Error handler
bot.catch((err) => {
  console.error('Error in bot:', err);
});

// Start the bot
bot.start();