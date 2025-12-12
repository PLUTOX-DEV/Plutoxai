import { Telegraf, Markup } from "telegraf";
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs";

dotenv.config();

// =======================
// INIT
// =======================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// =======================
// Conversation Memory
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
// Generate AI Response
// =======================
const MODEL_CHAT = "mistralai/mistral-nemo";

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
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
const MODEL_IMAGE = "openai/dall-e-mini";

async function generateAIImage(prompt) {
  try {
    const response = await axios.post(
      "https://openrouter.ai/v1/images/generate",
      { model: MODEL_IMAGE, prompt, size: "1024x1024", n: 1 },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
// Handlers
// =======================

// /start command
bot.start(async (ctx) => {
  await registerUser(ctx);

  // Banner image from local folder
  const bannerPath = path.join(process.cwd(), "/banner.png");

  if (!fs.existsSync(bannerPath)) {
    await ctx.reply("👋 Welcome to PlutoxAI!\nYour smart AI assistant.");
    return;
  }

  await ctx.replyWithPhoto(
    { source: bannerPath },
    {
      caption: `👋 *Welcome to PlutoxAI!*\n\nYour smart AI assistant.\nTap the button below to begin:`,
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🚀 Start Conversation", "start_convo")],
        [Markup.button.url("🌐 Join Community", "https://t.me/+CkHQ8D_Ie0IzYjg0")]
      ])
    }
  );
});

// Start conversation button
bot.action("start_convo", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🤖 *PlutoxAI is ready!*\nAsk me anything — text or request an image. 🚀`,
    { parse_mode: "Markdown" }
  );
});

// Text messages handler
bot.on("text", async (ctx) => {
  const user_id = ctx.from.id;
  const text = ctx.message.text;
  const lowerText = text.toLowerCase();

  await registerUser(ctx);
  await saveMessage(user_id, "user", text);

  await ctx.sendChatAction("typing");

  // Creator response
  if (lowerText.includes("who created you") || lowerText.includes("creator") || lowerText.includes("who made you")) {
    const creatorReply = `🤖 I was created by *PlutoxofWeb3*.\n\nConnect with the creator:\n• X: @Plutoxofweb3\n• Telegram: @PlutoxWeb3`;
    await ctx.reply(creatorReply, { parse_mode: "Markdown" });
    await saveMessage(user_id, "bot", creatorReply);
    return;
  }

  // Image detection
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
    return;
  }

  // Normal AI response
  const reply = await generateAIResponse(user_id, text);
  await saveMessage(user_id, "bot", reply);
  await ctx.reply(reply);
});

// =======================
// Express + Vercel Adapter
// =======================
const app = express();
app.use(express.json());

app.post("/api/bot", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

export default app;
