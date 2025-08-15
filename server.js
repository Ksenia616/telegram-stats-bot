// server.js — ЛЁГКАЯ СТАТИСТИКА (за сегодня: уникальные и всего)
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "256kb" }));

// На всякий случай — доверять прокси (Render и пр.)
app.set("trust proxy", 1);

// ===== ФАЙЛ-ХРАНИЛИЩЕ =====
const DB_PATH = path.join(__dirname, "stats.json");
// структура: { days: { "YYYY-MM-DD": { total: number, uniques: string[] } } }
let store = { days: {} };
try {
  if (fs.existsSync(DB_PATH)) {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    store = JSON.parse(raw);
  }
} catch (e) {
  console.error("Не удалось прочитать stats.json:", e.message);
  store = { days: {} };
}
function save() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Не удалось записать stats.json:", e.message);
  }
}

const todayKey = () =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split(".")
    .reverse()
    .join("-"); // YYYY-MM-DD

// ===== ПРИЁМ ВИЗИТА =====
app.post("/track", (req, res) => {
  try {
    const { userId } = req.body || {};
    const day = todayKey();
    if (!store.days[day]) store.days[day] = { total: 0, uniques: [] };

    // все открытия
    store.days[day].total += 1;

    // уникальность по userId (если есть)
    if (userId) {
      const u = String(userId);
      if (!store.days[day].uniques.includes(u)) {
        store.days[day].uniques.push(u);
      }
    }

    save();
    res.json({ ok: true });
  } catch (e) {
    console.error("Ошибка в /track:", e);
    res.status(500).json({ ok: false });
  }
});

// ===== КОЛИЧЕСТВО ЗА СЕГОДНЯ (JSON) =====
app.get("/count", (_req, res) => {
  const day = todayKey();
  const d = store.days[day] || { total: 0, uniques: [] };
  res.json({
    date: day,
    unique: d.uniques.length || d.total,
    total: d.total,
  });
});

// ===== ТЕКСТ ДЛЯ БРАУЗЕРА/БОТА (GET /stats) =====
app.get("/stats", (_req, res) => {
  const day = todayKey();
  const d = store.days[day] || { total: 0, uniques: [] };
  const unique = d.uniques.length || d.total;
  res
    .type("text/plain; charset=utf-8")
    .send(
      `📅 Сегодня (${day})
👤 Уникальных посетителей: ${unique}
↻ Всего открытий: ${d.total}`
    );
});

// ===== ПРОСТАЯ HTML-СТРАНИЦА НА КОРНЕ =====
app.get("/", (_req, res) => {
  const day = todayKey();
  const d = store.days[day] || { total: 0, uniques: [] };
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .send(`
    <html><head><meta charset="utf-8"/><title>Статистика</title>
    <style>body{background:#111;color:#fff;font:16px/1.5 system-ui;padding:40px}</style></head>
    <body>
      <h2>Сегодня (${day})</h2>
      <p>👤 Уникальных посетителей: <b>${d.uniques.length || d.total}</b></p>
      <p>↻ Всего открытий: <b>${d.total}</b></p>
      <p><a style="color:#9cf" href="/stats">/stats (текст)</a> | <a style="color:#9cf" href="/count">/count (JSON)</a></p>
    </body></html>
  `);
});

// Служебный живой пинг
app.get("/ping", (_req, res) => res.send("pong"));

// ===== БОТ: /stats =====
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? String(process.env.ADMIN_ID) : null;

// В Node < 18 может не быть fetch — полифилл
(async () => {
  if (typeof fetch === "undefined") {
    try {
      const { default: f } = await import("node-fetch");
      global.fetch = f;
    } catch (e) {
      console.error("fetch недоступен и полифилл не установился:", e.message);
    }
  }
})();

if (!BOT_TOKEN) {
  console.error("❗ В .env не задан TELEGRAM_BOT_TOKEN");
} else {
  let lastUpdateId = 0;

  async function tg(method, body) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }
  async function sendMessage(chatId, text) {
    return tg("sendMessage", { chat_id: chatId, text });
  }

  async function poll() {
    try {
      const res = await tg("getUpdates", {
        offset: lastUpdateId + 1,
        timeout: 30,
        allowed_updates: ["message"],
      });

      if (res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          lastUpdateId = upd.update_id;
          const msg = upd.message;
          if (!msg) continue;

          const chatId = msg.chat.id;
          const text = (msg.text || "").trim();

          if (text === "/start") {
            await sendMessage(
              chatId,
              "Привет! Команда /stats покажет, сколько человек за сегодня открыли приложение."
            );
          } else if (text === "/stats") {
            if (ADMIN_ID && String(chatId) !== ADMIN_ID) {
              await sendMessage(chatId, "⛔ Команда доступна только администратору.");
              continue;
            }
            const day = todayKey();
            const d = store.days[day] || { total: 0, uniques: [] };
            const unique = d.uniques.length || d.total;
            await sendMessage(
              chatId,
              `📅 Сегодня (${day})\n👤 Уникальных посетителей: ${unique}\n↻ Всего открытий: ${d.total}`
            );
          }
        }
      }
    } catch (e) {
      console.error("Polling error:", e.message);
    } finally {
      setTimeout(poll, 1500);
    }
  }

  console.log("Bot polling started");
  poll();
}

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
