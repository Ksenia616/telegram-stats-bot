const express = require("express");
const fs = require("fs");
const app = express();
const PORT = 3000;

app.use(express.json());

// Загружаем статистику из файла или создаем пустую
let stats = { users: new Set(), events: 0 };
try {
  const data = fs.readFileSync("stats.json", "utf-8");
  const parsed = JSON.parse(data);
  stats.users = new Set(parsed.users);
  stats.events = parsed.events;
} catch {}

// Сохраняем статистику
function saveStats() {
  fs.writeFileSync("stats.json", JSON.stringify({ users: [...stats.users], events: stats.events }, null, 2));
}

// Регистрируем событие от пользователя
app.post("/track", (req, res) => {
  const { userId } = req.body;
  if (userId) stats.users.add(userId);
  stats.events++;
  saveStats();
  res.json({ message: "OK" });
});

// Страница статистики
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Статистика</title>
      </head>
      <body style="font-family:sans-serif;text-align:center;margin-top:50px;">
        <h1>📊 Статистика</h1>
        <p>Уникальных пользователей: ${stats.users.size}</p>
        <p>Всего событий: ${stats.events}</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
