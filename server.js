// Accounting Review Live — a Kahoot-style classroom game.
// One Node process holds every game in memory. Students join from their phones with a PIN.
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || ""; // optional: require a password to start a game
const QUESTION_FILE = process.env.QUESTION_FILE || path.join(__dirname, "questions.json");
const BANK = JSON.parse(fs.readFileSync(QUESTION_FILE, "utf8"));

const MAX_PLAYERS = 500;
const GRACE_MS = 600;           // late-arriving answers still count within this window
const IDLE_GAME_MS = 4 * 3600e3; // forget games untouched for 4 hours

const app = express();
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/qr.svg", async (req, res) => {
  const pin = String(req.query.pin || "").replace(/\D/g, "").slice(0, 6);
  const base = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}`;
  const svg = await QRCode.toString(`${base}/?pin=${pin}`, { type: "svg", margin: 1, color: { dark: "#1d1033", light: "#ffffff" } });
  res.type("image/svg+xml").send(svg);
});
app.get("/healthz", (_req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5, pingInterval: 20000, pingTimeout: 25000 });

/** @type {Map<string, any>} */
const games = new Map();

const newPin = () => {
  let pin;
  do pin = String(crypto.randomInt(100000, 1000000)); while (games.has(pin));
  return pin;
};
const token = () => crypto.randomBytes(16).toString("hex");
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
const publicQ = (q, i, total) => ({
  index: i, total, ch: q.ch, topic: q.topic, type: q.type, prompt: q.prompt,
  data: q.data, dataHeader: q.dataHeader, options: q.options, time: q.time,
});

function makeGame(settings) {
  const chapters = Array.isArray(settings.chapters) && settings.chapters.length ? settings.chapters.map(Number) : null;
  const scale = [0.5, 0.75, 1, 1.5, 2].includes(Number(settings.timeScale)) ? Number(settings.timeScale) : 1;
  const questions = BANK.questions
    .filter((q) => !chapters || chapters.includes(q.ch))
    .map((q) => ({ ...q, time: Math.max(10, Math.round(q.time * scale)) }));
  return {
    pin: newPin(), hostToken: token(), title: BANK.title, questions,
    players: new Map(), // playerId -> {id, name, score, correct, streak, socketId, connected, answers: {}}
    banned: new Set(),
    phase: "lobby", qi: -1, startedAt: 0, deadline: 0, timer: null,
    lastResult: null, touched: Date.now(), countTimer: null,
  };
}

// ---------- state broadcast ----------
function rankList(g) {
  return [...g.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
function hostView(g) {
  const base = {
    pin: g.pin, title: g.title, phase: g.phase, totalQuestions: g.questions.length,
    playerCount: g.players.size,
  };
  if (g.phase === "lobby") base.players = [...g.players.values()].map((p) => ({ id: p.id, name: p.name }));
  if (g.phase === "question") {
    base.question = publicQ(g.questions[g.qi], g.qi, g.questions.length);
    base.deadline = g.deadline; base.now = Date.now();
    base.answered = answeredCount(g);
  }
  if (g.phase === "reveal" || g.phase === "leaderboard") {
    base.question = publicQ(g.questions[g.qi], g.qi, g.questions.length);
    base.result = g.lastResult;
    base.top = rankList(g).slice(0, 5).map((p) => ({ name: p.name, score: p.score, streak: p.streak }));
  }
  if (g.phase === "final") {
    base.standings = rankList(g).map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, correct: p.correct }));
    base.questionStats = g.questionStats || [];
  }
  return base;
}
function playerView(g, p) {
  const v = { phase: g.phase, title: g.title, name: p.name, score: p.score, totalQuestions: g.questions.length };
  if (g.phase === "question") {
    v.question = publicQ(g.questions[g.qi], g.qi, g.questions.length);
    v.deadline = g.deadline; v.now = Date.now();
    v.answered = p.answers[g.qi] !== undefined;
  }
  if (g.phase === "reveal" || g.phase === "leaderboard") {
    const a = p.answers[g.qi];
    const ranked = rankList(g);
    v.question = { index: g.qi, total: g.questions.length };
    v.you = {
      answered: a !== undefined, correct: !!(a && a.correct), points: a ? a.points : 0,
      streak: p.streak, rank: ranked.indexOf(p) + 1, of: ranked.length,
    };
    v.correctText = g.lastResult ? g.lastResult.correctText : "";
  }
  if (g.phase === "final") {
    const ranked = rankList(g);
    v.you = { rank: ranked.indexOf(p) + 1, of: ranked.length, correct: p.correct };
  }
  return v;
}
function pushHost(g) { io.to(`host:${g.pin}`).emit("host:state", hostView(g)); }
function pushPlayers(g) {
  for (const p of g.players.values()) if (p.socketId) io.to(p.socketId).emit("player:state", playerView(g, p));
}
function pushAll(g) { g.touched = Date.now(); pushHost(g); pushPlayers(g); }

function answeredCount(g) {
  let n = 0;
  for (const p of g.players.values()) if (p.answers[g.qi] !== undefined) n++;
  return n;
}
// Answer counts change fast with 300 players; send at most ~4 updates a second to the host.
function scheduleCount(g) {
  if (g.countTimer) return;
  g.countTimer = setTimeout(() => {
    g.countTimer = null;
    io.to(`host:${g.pin}`).emit("host:count", { answered: answeredCount(g), playerCount: g.players.size });
  }, 250);
}

// ---------- game flow ----------
function startQuestion(g, i) {
  clearTimeout(g.timer);
  g.qi = i; g.phase = "question";
  const q = g.questions[i];
  g.startedAt = Date.now();
  g.deadline = g.startedAt + q.time * 1000;
  g.timer = setTimeout(() => endQuestion(g), q.time * 1000 + GRACE_MS);
  pushAll(g);
}
function endQuestion(g) {
  if (g.phase !== "question") return;
  clearTimeout(g.timer);
  const q = g.questions[g.qi];
  const counts = q.options.map(() => 0);
  let correctN = 0, answeredN = 0;
  for (const p of g.players.values()) {
    const a = p.answers[g.qi];
    if (a === undefined) { p.streak = 0; continue; }
    answeredN++;
    (Array.isArray(a.choice) ? a.choice : [a.choice]).forEach((c) => { if (counts[c] !== undefined) counts[c]++; });
    if (a.correct) correctN++;
  }
  const correctIdx = Array.isArray(q.answer) ? q.answer : [q.answer];
  g.lastResult = {
    counts, correct: correctIdx, correctN, answeredN, explain: q.explain,
    correctText: correctIdx.map((i) => q.options[i]).join(" · "),
  };
  g.questionStats = g.questionStats || [];
  g.questionStats[g.qi] = { n: g.qi + 1, topic: q.topic, ch: q.ch, pctCorrect: Math.round((100 * correctN) / Math.max(1, g.players.size)) };
  g.phase = "reveal";
  pushAll(g);
}
function checkAnswer(q, choice) {
  if (q.type === "ms") {
    if (!Array.isArray(choice)) return { ok: false };
    const set = [...new Set(choice.map(Number))].filter((c) => c >= 0 && c < q.options.length).sort();
    if (!set.length) return { ok: false };
    const ans = [...q.answer].sort();
    return { ok: true, choice: set, correct: set.length === ans.length && set.every((c, i) => c === ans[i]) };
  }
  const c = Number(choice);
  if (!Number.isInteger(c) || c < 0 || c >= q.options.length) return { ok: false };
  return { ok: true, choice: c, correct: c === q.answer };
}

// ---------- sockets ----------
io.on("connection", (socket) => {
  // HOST
  socket.on("host:create", (msg = {}, ack = () => {}) => {
    if (HOST_PASSWORD && msg.password !== HOST_PASSWORD) return ack({ error: "Wrong host password." });
    const g = makeGame(msg.settings || {});
    if (!g.questions.length) return ack({ error: "No questions match those chapters." });
    games.set(g.pin, g);
    socket.join(`host:${g.pin}`);
    socket.data.hostPin = g.pin;
    ack({ pin: g.pin, hostToken: g.hostToken });
    pushHost(g);
  });
  socket.on("host:resume", ({ pin, hostToken } = {}, ack = () => {}) => {
    const g = games.get(String(pin));
    if (!g || g.hostToken !== hostToken) return ack({ error: "Game not found." });
    socket.join(`host:${g.pin}`);
    socket.data.hostPin = g.pin;
    ack({ ok: true });
    pushHost(g);
  });
  const hostGame = () => {
    const g = games.get(socket.data.hostPin);
    if (g) g.touched = Date.now();
    return g;
  };
  socket.on("host:next", () => {
    const g = hostGame(); if (!g) return;
    if (g.phase === "lobby") return startQuestion(g, 0);
    if (g.phase === "question") return endQuestion(g);
    if (g.phase === "reveal") { g.phase = "leaderboard"; return pushAll(g); }
    if (g.phase === "leaderboard") {
      if (g.qi + 1 < g.questions.length) return startQuestion(g, g.qi + 1);
      g.phase = "final"; return pushAll(g);
    }
  });
  socket.on("host:addTime", () => {
    const g = hostGame(); if (!g || g.phase !== "question") return;
    clearTimeout(g.timer);
    g.deadline += 30000;
    g.timer = setTimeout(() => endQuestion(g), g.deadline - Date.now() + GRACE_MS);
    pushAll(g);
  });
  socket.on("host:skipToEnd", () => {
    const g = hostGame(); if (!g) return;
    clearTimeout(g.timer);
    g.phase = "final"; pushAll(g);
  });
  socket.on("host:kick", ({ id } = {}) => {
    const g = hostGame(); if (!g) return;
    const p = g.players.get(id); if (!p) return;
    g.banned.add(id);
    g.players.delete(id);
    if (p.socketId) io.to(p.socketId).emit("player:kicked");
    pushAll(g);
  });

  // PLAYER
  socket.on("player:join", ({ pin, name, playerId } = {}, ack = () => {}) => {
    const g = games.get(String(pin || "").trim());
    if (!g) return ack({ error: "No game with that PIN. Check the number on the screen." });
    if (playerId && g.banned.has(playerId)) return ack({ error: "You were removed from this game." });
    let p = playerId && g.players.get(playerId);
    if (!p) {
      if (g.phase === "final") return ack({ error: "This game has ended." });
      if (g.players.size >= MAX_PLAYERS) return ack({ error: "This game is full." });
      let nm = cleanName(name);
      if (nm.length < 2) return ack({ error: "Please enter a nickname (at least 2 characters)." });
      const taken = new Set([...g.players.values()].map((x) => x.name.toLowerCase()));
      if (taken.has(nm.toLowerCase())) {
        let k = 2; while (taken.has(`${nm} ${k}`.toLowerCase())) k++;
        nm = `${nm.slice(0, 17)} ${k}`;
      }
      p = { id: token(), name: nm, score: 0, correct: 0, streak: 0, answers: {}, socketId: null };
      g.players.set(p.id, p);
    }
    p.socketId = socket.id;
    socket.data.pin = g.pin; socket.data.playerId = p.id;
    socket.join(`game:${g.pin}`);
    ack({ ok: true, playerId: p.id, name: p.name, pin: g.pin });
    socket.emit("player:state", playerView(g, p));
    if (g.phase === "lobby") pushHost(g); else scheduleCount(g);
  });
  socket.on("player:answer", ({ index, choice } = {}, ack = () => {}) => {
    const g = games.get(socket.data.pin);
    const p = g && g.players.get(socket.data.playerId);
    if (!g || !p) return ack({ error: "Not in a game." });
    if (g.phase !== "question" || index !== g.qi) return ack({ error: "Too late for this question." });
    if (p.answers[g.qi] !== undefined) return ack({ error: "Already answered." });
    const now = Date.now();
    if (now > g.deadline + GRACE_MS) return ack({ error: "Time's up." });
    const q = g.questions[g.qi];
    const r = checkAnswer(q, choice);
    if (!r.ok) return ack({ error: "Invalid answer." });
    // Kahoot-style: 500–1000 points for a correct answer, more for answering faster
    const frac = Math.min(1, Math.max(0, (now - g.startedAt) / (g.deadline - g.startedAt)));
    let points = r.correct ? Math.round(1000 * (1 - frac / 2)) : 0;
    if (r.correct) { p.streak++; p.correct++; if (p.streak >= 3) points += 100; } else p.streak = 0;
    p.score += points;
    p.answers[g.qi] = { choice: r.choice, correct: r.correct, points };
    ack({ ok: true });
    socket.emit("player:state", playerView(g, p));
    scheduleCount(g);
    // End early once every connected player has answered
    let waiting = 0;
    for (const x of g.players.values()) if (x.socketId && x.answers[g.qi] === undefined) waiting++;
    if (waiting === 0) endQuestion(g);
  });
  socket.on("disconnect", () => {
    const g = games.get(socket.data.pin);
    const p = g && g.players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) p.socketId = null;
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [pin, g] of games) if (now - g.touched > IDLE_GAME_MS) { clearTimeout(g.timer); games.delete(pin); }
}, 10 * 60e3).unref();

server.listen(PORT, () => console.log(`Accounting Review Live running on http://localhost:${PORT}  (host screen: /host)`));
