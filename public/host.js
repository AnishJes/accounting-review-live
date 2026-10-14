// Host (projector) screen
const socket = io();
const $ = (id) => document.getElementById(id);
const SAVE = "arl-host";
let state = null;
let tick = null;
let lastPhaseKey = "";

const sections = ["setup", "lobby", "question", "leader", "final"];
function show(id) { sections.forEach((s) => $(s).classList.toggle("hidden", s !== id)); }

// ---------- setup ----------
try {
  const saved = JSON.parse(localStorage.getItem(SAVE) || "null");
  if (saved && saved.pin) { $("resume").classList.remove("hidden"); $("resume").textContent = `Resume game ${saved.pin}`; }
} catch {}

$("create").onclick = () => {
  const chapters = [...document.querySelectorAll("input[name=ch]:checked")].map((c) => Number(c.value));
  if (!chapters.length) { $("setup-err").textContent = "Pick at least one chapter."; return; }
  $("create").disabled = true;
  socket.emit("host:create", { password: $("pw").value, settings: { chapters, timeScale: $("speed").value } }, (r) => {
    $("create").disabled = false;
    if (r.error) { $("setup-err").textContent = r.error; return; }
    try { localStorage.setItem(SAVE, JSON.stringify(r)); } catch {}
  });
};
$("resume").onclick = () => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE) || "null"); } catch {}
  if (!saved) return;
  socket.emit("host:resume", saved, (r) => {
    if (r.error) { $("setup-err").textContent = "That game has ended or the server restarted. Create a new one."; $("resume").classList.add("hidden"); }
  });
};
// If the connection drops mid-game, rejoin our game automatically
socket.on("connect", () => {
  if (!state) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE) || "null"); } catch {}
  if (saved) socket.emit("host:resume", saved, () => {});
});

// ---------- controls ----------
const next = () => socket.emit("host:next");
$("start").onclick = next;
$("next-q").onclick = next;
$("next-l").onclick = next;
$("addtime").onclick = () => socket.emit("host:addTime");
$("newgame").onclick = () => { try { localStorage.removeItem(SAVE); } catch {} location.reload(); };
document.addEventListener("keydown", (e) => {
  if (!state || e.target.tagName === "INPUT") return;
  if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") {
    e.preventDefault();
    if (state.phase === "lobby" && !state.playerCount) return;
    if (state.phase !== "final") next();
  }
});

// ---------- rendering ----------
socket.on("host:state", (s) => { state = s; render(); });
socket.on("host:count", (c) => {
  if (!state) return;
  state.playerCount = c.playerCount;
  if (state.phase === "question") { state.answered = c.answered; $("answered").textContent = c.answered; }
  $("hdr-right").textContent = `${c.playerCount} players`;
});

function render() {
  const s = state;
  $("hdr-right").classList.remove("hidden");
  $("hdr-right").textContent = s.phase === "lobby" ? `${s.totalQuestions} questions` : `PIN ${s.pin} · ${s.playerCount} players`;
  clearInterval(tick);
  if (s.phase === "lobby") return renderLobby(s);
  if (s.phase === "question" || s.phase === "reveal") return renderQuestion(s);
  if (s.phase === "leaderboard") return renderLeader(s);
  if (s.phase === "final") return renderFinal(s);
}

function renderLobby(s) {
  show("lobby");
  $("join-url").textContent = location.host;
  $("pin").textContent = s.pin.replace(/(\d{3})(\d{3})/, "$1 $2");
  if (!$("qr").src.includes(s.pin)) $("qr").src = `/qr.svg?pin=${s.pin}`;
  $("lobby-count").textContent = s.playerCount;
  $("start").disabled = !s.playerCount;
  const box = $("names");
  box.replaceChildren(...s.players.map((p) => el("button", {
    class: "name", title: "Remove player",
    onclick: () => { if (confirm(`Remove "${p.name}" from the game?`)) socket.emit("host:kick", { id: p.id }); },
  }, p.name)));
}

function renderQuestion(s) {
  show("question");
  const q = s.question;
  const reveal = s.phase === "reveal";
  const key = `${q.index}-${s.phase}`;
  const fresh = key !== lastPhaseKey;
  lastPhaseKey = key;

  $("qmeta").replaceChildren(...[
    el("span", { class: "pill" }, `Question ${q.index + 1} of ${q.total}`),
    el("span", { class: "pill" }, `Ch. ${q.ch} · ${q.topic}`),
    q.type === "ms" ? el("span", { class: "pill ms-note" }, "Select ALL that apply") : null,
  ].filter(Boolean));
  // Questions with a data table use a side-by-side layout so everything fits on a projector
  $("question").classList.toggle("withdata", !!(q.data && q.data.length));
  $("qtext").textContent = q.prompt;
  $("qdata").replaceChildren(dataTable(q.dataHeader, q.data) || "");

  const counts = reveal ? s.result.counts : null;
  const right = reveal ? new Set(s.result.correct) : null;
  $("tiles").replaceChildren(...q.options.map((o, i) => {
    const c = tileColor(q, i);
    const cls = ["tile", `c${c}`];
    if (reveal) cls.push(right.has(i) ? "right" : "dim");
    return el("div", { class: cls.join(" ") },
      el("span", { html: SHAPES[c] }), el("span", {}, o),
      reveal ? el("span", { class: "cnt" }, (right.has(i) ? "✓ " : "") + counts[i]) : null);
  }));

  $("bars").classList.toggle("hidden", !reveal);
  $("timer").classList.toggle("hidden", reveal);
  $("addtime").classList.toggle("hidden", reveal);
  $("explain").classList.toggle("hidden", !reveal);
  $("next-q").textContent = reveal ? "Show scoreboard" : "End question";

  if (reveal) {
    const r = s.result;
    const max = Math.max(1, ...r.counts);
    $("bars").replaceChildren(...q.options.map((_, i) => {
      const c = tileColor(q, i);
      return el("div", { class: "bar" },
        el("div", { class: "n" }, r.counts[i]),
        el("div", { class: `fill c${c}`, style: `height:${Math.round((r.counts[i] / max) * 110)}px;${right.has(i) ? "" : "opacity:.35"}` }),
        el("div", { class: "tick", html: SHAPES[c].replace("<svg", '<svg width="22" height="22"') }));
    }));
    const pct = s.playerCount ? Math.round((100 * r.correctN) / s.playerCount) : 0;
    $("answered-box").replaceChildren(el("b", {}, `${pct}%`), el("span", {}, "got it right"));
    $("explain").replaceChildren(el("b", {}, "Why: "), r.explain);
    return;
  }

  $("answered-box").replaceChildren(el("b", { id: "answered" }, s.answered), el("span", {}, `of ${s.playerCount} answered`));
  const left = makeTimer(s.deadline, s.now);
  const draw = () => {
    const t = Math.ceil(left());
    $("timer").textContent = t;
    $("timer").classList.toggle("low", t <= 5);
  };
  draw();
  tick = setInterval(draw, 250);
  if (fresh) window.scrollTo(0, 0);
}

function renderLeader(s) {
  show("leader");
  const last = s.question.index + 1 >= s.question.total;
  $("next-l").textContent = last ? "Show final results" : "Next question";
  $("board").replaceChildren(...s.top.map((p, i) => el("div", { class: "lb", style: `animation-delay:${i * 80}ms` },
    el("span", {}, `${i + 1}. ${p.name}`, p.streak >= 3 ? el("span", { class: "streak" }, `🔥 ${p.streak} in a row`) : null),
    el("span", {}, p.score.toLocaleString()))));
  if (!s.top.length) $("board").append(el("div", { class: "lb" }, "No players yet"));
}

function renderFinal(s) {
  show("final");
  try { localStorage.removeItem(SAVE); } catch {}
  const st = s.standings;
  const order = [1, 0, 2]; // 2nd, 1st, 3rd
  const heights = [150, 200, 110];
  $("podium").replaceChildren(...order.filter((i) => st[i]).map((i) => el("div", { class: "step" },
    el("div", { class: "who" }, st[i].name),
    el("div", { class: "blk", style: `height:${heights[order.indexOf(i)]}px` }, String(i + 1)),
    el("div", { class: "pts" }, `${st[i].score.toLocaleString()} pts`))));
  $("top10").replaceChildren(...st.slice(0, 10).map((p) => el("li", {}, `${p.name} — ${p.score.toLocaleString()} (${p.correct} correct)`)));
  const hard = (s.questionStats || []).filter(Boolean).sort((a, b) => a.pctCorrect - b.pctCorrect).slice(0, 5);
  $("hard").replaceChildren(...(hard.length ? hard.map((h) => el("li", {}, `Q${h.n}: ${h.topic} `, el("span", {}, `(${h.pctCorrect}% correct)`))) : [el("li", {}, "No questions played")]));
  $("csv").onclick = () => {
    const rows = [["Rank", "Nickname", "Score", "Correct answers"], ...st.map((p) => [p.rank, p.name, p.score, p.correct])];
    rows.push([], ["Question", "Chapter", "Topic", "% of players correct"], ...(s.questionStats || []).filter(Boolean).map((h) => [h.n, h.ch, h.topic, h.pctCorrect]));
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `results-${s.pin}.csv` });
    document.body.append(a); a.click(); a.remove();
  };
}
