import express from "express";
import './bot.js'; // your bot logic

const app = express();
app.use(express.json());

export default app;
