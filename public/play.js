// Player (phone) screen
const socket = io();
const $ = (id) => document.getElementById(id);
const SAVE = "arl-player";
let me = null;      // {pin, playerId, name}
let state = null;
let tick = null;
let picked = new Set();
let shownQ = -1;

const views = ["join", "wait", "play", "result", "done"];
function show(id) { views.forEach((v) => $(v).classList.toggle("hidden", v !== id)); }

// PIN from the QR code link (?pin=123456)
const urlPin = new URLSearchParams(location.search).get("pin");
if (urlPin) $("pin").value = urlPin;
try { const n = localStorage.getItem("arl-nick"); if (n) $("nick").value = n; } catch {}
if (urlPin && !$("nick").value) setTimeout(() => $("nick").focus(), 50);

function saved() { try { return JSON.parse(localStorage.getItem(SAVE) || "null"); } catch { return null; } }

function join(pin, name, playerId, auto) {
  $("join-btn").disabled = true;
  socket.emit("player:join", { pin, name, playerId }, (r) => {
    $("join-btn").disabled = false;
    if (r.error) {
      if (auto) { try { localStorage.removeItem(SAVE); } catch {} return; } // stale game from an earlier class
      if (playerId) { try { localStorage.removeItem(SAVE); } catch {} show("join"); }
      $("join-err").textContent = r.error;
      return;
    }
    me = { pin: r.pin, playerId: r.playerId, name: r.name };
    try { localStorage.setItem(SAVE, JSON.stringify(me)); localStorage.setItem("arl-nick", name || r.name); } catch {}
    $("bar").classList.remove("hidden");
    $("who").textContent = r.name;
  });
}

$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  $("join-err").textContent = "";
  const pin = $("pin").value.replace(/\D/g, "");
  if (pin.length !== 6) { $("join-err").textContent = "The game PIN has 6 digits."; return; }
  const prev = saved();
  join(pin, $("nick").value, prev && prev.pin === pin ? prev.playerId : undefined);
});

// Reconnect automatically (phone locked, Wi-Fi blip, page refresh)
socket.on("connect", () => {
  const prev = me || saved();
  if (prev && (!urlPin || urlPin === prev.pin)) join(prev.pin, prev.name, prev.playerId, true);
});
socket.on("player:kicked", () => {
  try { localStorage.removeItem(SAVE); } catch {}
  me = null; state = null;
  $("bar").classList.add("hidden");
  show("join");
  $("join-err").textContent = "The host removed you from the game.";
});

socket.on("player:state", (s) => { state = s; render(); });

function render() {
  const s = state;
  $("score").textContent = `${s.score.toLocaleString()} pts`;
  clearInterval(tick);
  if (s.phase === "lobby") {
    show("wait"); $("wait-title").textContent = "You're in!"; $("wait-text").textContent = "See your nickname on the screen? The game starts soon.";
    return;
  }
  if (s.phase === "question") return s.answered ? waitAnswered() : renderQuestion(s);
  if (s.phase === "reveal" || s.phase === "leaderboard") return renderResult(s);
  if (s.phase === "final") {
    show("done");
    $("done-rank").textContent = `#${s.you.rank}`;
    $("done-text").textContent = `out of ${s.you.of} players, with ${s.score.toLocaleString()} points and ${s.you.correct} of ${s.totalQuestions} correct. Nice work!`;
    try { localStorage.removeItem(SAVE); } catch {}
  }
}

function waitAnswered() {
  show("wait");
  $("wait-title").textContent = "Answer locked in";
  $("wait-text").textContent = "Waiting for everyone else…";
}

function renderQuestion(s) {
  const q = s.question;
  show("play");
  if (shownQ !== q.index) { picked = new Set(); shownQ = q.index; window.scrollTo(0, 0); $("submit-ms").disabled = false; }
  $("qnum").textContent = `Question ${q.index + 1} of ${q.total}`;
  $("qsum").textContent = q.type === "tf" ? "True or false?" : "Question";
  $("qtext").textContent = q.prompt;
  $("qdata").replaceChildren(dataTable(q.dataHeader, q.data) || "");

  const ms = q.type === "ms";
  $("ms-hint").classList.toggle("hidden", !ms);
  $("submit-ms").classList.toggle("hidden", !ms);
  $("answers").className = "answers" + (q.type === "tf" ? " two" : "");
  const drawTiles = () => $("answers").replaceChildren(...q.options.map((o, i) => {
    const c = tileColor(q, i);
    const on = picked.has(i);
    return el("button", {
      class: `tile c${c}${on ? " sel" : ""}`,
      onclick: () => {
        if (!ms) return send(i);
        on ? picked.delete(i) : picked.add(i);
        drawTiles();
      },
    }, el("span", { html: SHAPES[c] }), el("span", {}, o), ms ? el("span", { class: "box" }, on ? "✓" : "") : null);
  }));
  drawTiles();
  $("submit-ms").onclick = () => { if (picked.size) send([...picked]); };

  const left = makeTimer(s.deadline, s.now);
  const total = q.time;
  const draw = () => {
    const t = left();
    $("tfill").style.width = `${Math.min(100, (t / total) * 100)}%`;
    $("tleft").textContent = `${Math.ceil(t)}s`;
  };
  draw();
  tick = setInterval(draw, 250);
}

function send(choice) {
  [...document.querySelectorAll("#answers .tile, #submit-ms")].forEach((b) => (b.disabled = true));
  socket.emit("player:answer", { index: state.question.index, choice }, (r) => {
    if (r && r.error) {
      [...document.querySelectorAll("#answers .tile, #submit-ms")].forEach((b) => (b.disabled = false));
      $("tleft").textContent = r.error;
    }
  });
}

function renderResult(s) {
  show("result");
  const y = s.you;
  const box = $("res-box");
  box.className = "result " + (!y.answered ? "none" : y.correct ? "good" : "bad");
  $("res-title").textContent = !y.answered ? "Time's up" : y.correct ? "Correct!" : "Incorrect";
  $("res-pts").textContent = y.correct ? `+${y.points.toLocaleString()}` : "+0";
  $("res-fire").textContent = y.streak >= 2 ? `🔥 Answer streak: ${y.streak}` : "";
  $("res-ans").replaceChildren(el("b", {}, "Correct answer: "), s.correctText);
  $("res-rank").textContent = `You're #${y.rank} of ${y.of}`;
}
