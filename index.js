import express from "express";
import { Telegraf, Markup } from "telegraf";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// =======================
// PATH FIX (for images folder)
// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
// INIT
// =======================
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const MODEL_CHAT = "mistralai/mistral-nemo"; // Chat model
const MODEL_IMAGE = "openai/dall-e-mini"; // Image model

// =======================
// Fetch last 5 messages (memory)
// =======================
async function getConversationMemory(user_id) {
  const { data } = await supabase
    .from("messages")
    .select("role, content")
    .eq("user_id", user_id)
    .order("id", { ascending: false })
    .limit(5);

  return data?.reverse() || [];
}

// =======================
// Generate AI Response
// =======================
async function generateAIResponse(user_id, text) {
  try {
    const memory = await getConversationMemory(user_id);

    const messages = [
      { role: "system", content: "You are PlutoxAI, a helpful friendly assistant." },
      ...memory.map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: text }
    ];

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: MODEL_CHAT, messages },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data?.choices?.[0]?.message?.content || "⚠️ AI returned no response.";
  } catch (err) {
    console.error("AI ERROR:", err.response?.data || err);
    return "⚠️ AI encountered an issue. Please try again.";
  }
}

// =======================
// Generate AI Image
// =======================
async function generateAIImage(prompt) {
  try {
    const response = await axios.post(
      "https://openrouter.ai/v1/images/generate",
      {
        model: MODEL_IMAGE,
        prompt,
        size: "1024x1024",
        n: 1
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data?.data?.[0]?.url || null;
  } catch (err) {
    console.error("Image generation error:", err.response?.data || err);
    return null;
  }
}

// =======================
// Save Message
// =======================
async function saveMessage(user_id, role, content) {
  await supabase.from("messages").insert({ user_id, role, content });
}

// =======================
// Register User
// =======================
async function registerUser(ctx) {
  const user = ctx.from;
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!data) {
    await supabase.from("users").insert({
      id: user.id,
      username: user.username,
      first_name: user.first_name
    });
  }
}

// =======================
// /start → Welcome + Local Image + Buttons
// =======================
bot.start(async (ctx) => {
  await registerUser(ctx);

  const bannerPath = path.join(__dirname, "images/banner.png");

  await ctx.replyWithPhoto(
    { source: bannerPath },
    {
      caption: `👋 *Welcome to PlutoxAI!*\n\nYour smart AI assistant.\nTap the button below to begin:`,
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🚀 Start Conversation", "start_convo")],
        [Markup.button.url("🌐 Join Community", "https://t.me/+CkHQ8D_Ie0IzYjg0")] // <-- Your TG channel
      ])
    }
  );
});

// =======================
// Start Conversation Button
// =======================
bot.action("start_convo", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🤖 *PlutoxAI is ready!*\nAsk me anything — text or request an image. 🚀`,
    { parse_mode: "Markdown" }
  );
});

// =======================
// Main Message Handler with AI Image Detection & Creator Response
// =======================
bot.on("text", async (ctx) => {
  const user_id = ctx.from.id;
  const text = ctx.message.text;

  await registerUser(ctx);
  await saveMessage(user_id, "user", text);

  await ctx.sendChatAction("typing");

  const lowerText = text.toLowerCase();

  // ---- Custom creator response ----
  if (
    lowerText.includes("who created you") ||
    lowerText.includes("creator") ||
    lowerText.includes("who made you")
  ) {
    const creatorReply = `🤖 I was created by *PlutoxofWeb3*.\n\nConnect with the creator:\n• X: @Plutoxofweb3\n• Telegram: @PlutoxWeb3`;
    await ctx.reply(creatorReply, { parse_mode: "Markdown" });
    await saveMessage(user_id, "bot", creatorReply);
    return;
  }

  // ---- Detect if user wants an image ----
  const imageKeywords = ["image", "photo", "picture", "show me", "draw", "generate"];
  const wantsImage = imageKeywords.some(word => lowerText.includes(word));

  if (wantsImage) {
    const imageUrl = await generateAIImage(text);

    if (imageUrl) {
      await ctx.replyWithPhoto(imageUrl, { caption: "🖼 Here’s your AI-generated image!" });
      await saveMessage(user_id, "bot", imageUrl);
    } else {
      await ctx.reply("⚠️ Failed to generate the image. Try again later.");
      await saveMessage(user_id, "bot", "⚠️ Failed to generate image");
    }

    return; // Skip text reply
  }

  // ---- Normal AI response ----
  const reply = await generateAIResponse(user_id, text);
  await saveMessage(user_id, "bot", reply);
  ctx.reply(reply);
});

// =======================
// Start Bot + API
// =======================
bot.launch();
app.listen(5000, () => console.log("🔥 PlutoxAI Backend Running on port 5000"));
