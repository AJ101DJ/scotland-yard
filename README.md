# Scotland Yard Online

## HOW TO DEPLOY (no coding knowledge needed)

You need to do 2 things:
1. Put the SERVER online (Railway — free)
2. Put the WEBSITE online (Netlify — free)

---

## STEP 1 — Put the server online (Railway)

1. Go to https://github.com and create a free account
2. Click the + icon → "New repository" → name it "scotland-yard" → click "Create repository"
3. On your computer, download GitHub Desktop: https://desktop.github.com
4. Open GitHub Desktop → File → Add local repository → pick this folder
5. Commit all files → Push to GitHub

6. Go to https://railway.app → Sign up with your GitHub account
7. Click "New Project" → "Deploy from GitHub repo" → pick "scotland-yard"
8. Railway will detect it automatically and deploy
9. Click your project → Settings → Networking → "Generate Domain"
10. Copy that URL — it will look like: `scotland-yard-production.up.railway.app`

---

## STEP 2 — Update the website URL

Open the file:  client/src/App.jsx

Find this line near the top:
  return `${proto}//${host}`

Replace the ENTIRE WS_URL block with just:
  const WS_URL = 'wss://YOUR-RAILWAY-URL-HERE'

(replace YOUR-RAILWAY-URL-HERE with what you copied from Railway)

Then rebuild: open a terminal in the client folder and run:  npm run build

---

## STEP 3 — Put the website online (Netlify)

1. Go to https://netlify.com → Sign up free
2. Drag the "client/dist" folder onto the Netlify homepage
3. Netlify gives you a URL like: https://amazing-name-123.netlify.app
4. Share that URL with your friends — done!

---

## Playing the game

1. Open your Netlify URL
2. Click "Create Room" → enter your name
3. Share the 4-letter code with friends (e.g. WOLF-42)
4. Friends open the same URL → "Join Room" → enter the code
5. Everyone picks a role (1 person picks Mr. X, rest pick Detective)
6. Host clicks "Start Game"
7. Click glowing stations on the board to move

## Rules reminder
- Mr. X moves in secret — detectives only see WHICH transport he used, not where
- Mr. X must reveal his location on turns: 3, 8, 13, 18, 24
- Detectives win by landing on Mr. X's station
- Mr. X wins by surviving all 24 turns
- Mr. X has 5 black tickets (hides transport type) and 2 double-move tickets
