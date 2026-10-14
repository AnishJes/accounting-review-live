# Accounting Review Live

A Kahoot-style review game for Mock Exam 3 (Chapters 7, 8 and 9). The game works like this:

- You project the **host screen**.
- Students open a link on their phones, type the **game PIN** and a nickname, and answer by tapping colored buttons.
- Faster correct answers earn more points: 500 to 1,000 per question, plus a 100-point bonus once a student gets 3 or more in a row.
- A scoreboard appears after every question.

There's no player limit like free Kahoot's. A test with 300 simulated students passed with no dropped answers and used about 100 MB of memory. The game allows up to 500 players.

---

## What's in the game

- All 40 Mock Exam 3 questions. Fill-in questions were turned into 4-choice questions, with wrong answers built from common mistakes.
- True/false, multiple-choice and select-all-that-apply questions. Select-all questions only score if every correct choice is checked.
- The full question and any data table appear on both the projector and each phone, so students in the back row can read along.
- After each question, the projector shows the answer counts, the percentage who got it right and a short explanation.
- Before the game you can choose which chapters to include and how fast the timer runs (from half time up to double time).
- On the projector, **+30 seconds** gives everyone more time and **End question** closes a question early. The question also ends on its own once every student has answered.
- Click a nickname in the lobby to remove that player.
- Students who lock their phone or lose Wi-Fi rejoin automatically and keep their score.
- At the end you get a podium, a top-10 list, the 5 hardest questions and a **Download results (CSV)** button, which saves every student's score and the percentage correct on each question.

---

## One-time setup: put it online for free (about 15 minutes)

You need two free accounts: **GitHub** (it stores the files) and **Render** (it runs the game).

### Step 1. Put the files on GitHub
1. Go to <https://github.com> and create a free account.
2. Click **+** (top right) and choose **New repository**. Name it `accounting-review-live`, keep it **Public** or **Private**, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `accounting-review-live.zip` on your computer. Drag **everything inside the folder** onto the GitHub upload page. That's the `public` and `tools` folders plus `server.js`, `questions.json`, `package.json`, `package-lock.json`, `.gitignore` and `README.md`.
   - Tip: `.gitignore` is a hidden file. If you can't see it, that's fine, because it's optional.
5. Click **Commit changes**.

### Step 2. Run it on Render
1. Go to <https://render.com> and click **Get Started**. Sign up with your GitHub account.
2. Click **New +** and choose **Web Service**, then pick the `accounting-review-live` repository. If you don't see it, click **Configure account** and give Render access to it.
3. Fill in these settings:
   - **Runtime / Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
4. (Optional) To stop anyone else from starting games on your site, open **Environment Variables** and add `HOST_PASSWORD` with a password of your choice. You'll type it on the host screen.
5. Click **Create Web Service**. After 2–3 minutes it says **Live**, and you get a web address like `https://accounting-review-live.onrender.com`.

That address is the one students use. Your host screen is the same address with **/host** at the end.

---

## Running a game in class

1. **About 5 minutes before class**, open `https://YOUR-ADDRESS.onrender.com/host` on the classroom computer.
   - Render's free plan puts the game to sleep after 15 minutes with no activity. The first visit wakes it up, which takes about a minute. Once a game is running, it stays awake.
2. Choose the chapters and timer speed, then click **Create game**.
3. Project the screen. Students scan the QR code, or go to the address and type the 6-digit PIN.
4. When everyone's name is on screen, click **Start game**.
5. To move through the game, click the yellow button or press **Space** or **→**. Each question goes from the question, to the answers and explanation, to the scoreboard.
6. At the end, click **Download results (CSV)** if you want to keep the scores.

If the classroom computer's browser closes by accident, reopen `/host` and click **Resume game**.

**Limits of the free plan to know about:**
- Render may occasionally restart free services, and a restart ends any game in progress. It's rare during a class.
- The free plan includes 750 running hours a month. Time spent asleep doesn't count, so classroom use stays well under the limit.
- If the free plan ever gives you trouble, Render's cheapest paid plan removes the sleep delay. Nothing in the game needs to change.

---

## Changing the questions

All questions live in **`questions.json`**. To edit one, open the file on GitHub, click the pencil icon, change the text and click **Commit changes**. Render updates the game on its own within a couple of minutes.

Each question looks like this:

```json
{
  "n": 34,
  "ch": 9,
  "topic": "Markup on cost vs. gross profit %",
  "type": "mc",
  "prompt": "Markup Your Mind Co. prices its goods at a 25% markup on cost. What is its gross profit percentage on sales?",
  "options": ["25%", "20%", "33.3%", "75%"],
  "answer": 1,
  "time": 40,
  "explain": "If cost = $100, the selling price is $125 and gross profit is $25. 25 ÷ 125 = 20%.",
  "data": null,
  "dataHeader": null
}
```

- `type`: `"mc"` (multiple choice), `"tf"` (true/false, with options `["True","False"]`) or `"ms"` (select all that apply).
- `answer`: the position of the correct option, **counting from 0**, so `1` means the second option. For `"ms"` questions, use a list such as `[0, 2, 5]`.
- `time`: seconds allowed at normal speed.
- `data` (optional): a table shown with the question, written as rows like `[["Cash", "$1,250"], ["Inventory", "$71,300"]]`. `dataHeader` gives the optional column titles.
- Up to 7 options are allowed. The colors and shapes are assigned automatically.

To make a game for a different exam, replace the questions in `questions.json`, or ask Claude to generate a new file from that exam's questions.

---

## For the curious: trying it on your own computer

If you have Node.js 18 or newer, open a terminal in this folder and run:

```
npm install
npm start
```

Then open <http://localhost:3000/host> to host and <http://localhost:3000> to join. This is good for testing. For class, use the Render address, because campus Wi-Fi usually blocks phones from reaching a laptop directly.

To repeat the 300-student load test locally, run `npm install` (which includes the test tool), start the server, then run `N=300 npm run loadtest` in a second terminal.
