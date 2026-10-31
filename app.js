const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia-palu57';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (id SERIAL PRIMARY KEY, name TEXT, provider TEXT, category TEXT DEFAULT 'slot', thumbnail TEXT, rtp REAL DEFAULT 95.0, active INTEGER DEFAULT 1, target_rtp REAL DEFAULT 95.0, win_mode TEXT DEFAULT 'normal');
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, player_id TEXT, type TEXT, amount REAL, method TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS player_rtp (id SERIAL PRIMARY KEY, player_id TEXT, game_id INTEGER, target_rtp REAL DEFAULT 50.0, win_mode TEXT DEFAULT 'tight', UNIQUE(player_id, game_id));
    CREATE TABLE IF NOT EXISTS play_log (id SERIAL PRIMARY KEY, player_id TEXT, game_id INTEGER, bet REAL, win REAL, rolled REAL, decision TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  `);
  await pool.query(`INSERT INTO settings (key,value) VALUES ('site_name','Palu57') ON CONFLICT (key) DO NOTHING`);
  const res = await pool.query('SELECT COUNT(*) c FROM games');
  if (parseInt(res.rows[0].c) === 0) {
    const games = [['Gates of Olympus','PG'],['Sweet Bonanza','PG'],['Mahjong Ways','PG'],['Starlight Princess','PG'],['Wild Bandito','PG'],['Fortune Tiger','PP'],['Fortune Ox','PP'],['Big Bass Bonanza','PP'],['Sugar Rush','PP'],['Zeus','HABANERO'],['Lucky Neko','PG'],['Mines','JILI']];
    for (let i = 0; i < games.length; i++) {
      await pool.query(`INSERT INTO games (name,provider,thumbnail) VALUES ($1,$2,$3)`, [games[i][0], games[i][1], `https://picsum.photos/seed/p${i}/300/300`]);
    }
  }
}

async function getRule(playerId, gameId) {
  let r = await pool.query('SELECT target_rtp, win_mode FROM player_rtp WHERE player_id=$1 AND game_id=$2', [playerId, gameId]);
  if (r.rows.length) return { rtp: r.rows[0].target_rtp, mode: r.rows[0].win_mode };
  r = await pool.query('SELECT target_rtp, win_mode FROM player_rtp WHERE player_id=$1 AND game_id IS NULL', [playerId]);
  if (r.rows.length) return { rtp: r.rows[0].target_rtp, mode: r.rows[0].win_mode };
  r = await pool.query('SELECT target_rtp, win_mode FROM games WHERE id=$1', [gameId]);
  if (r.rows.length) return { rtp: r.rows[0].target_rtp || 95, mode: r.rows[0].win_mode || 'normal' };
  return { rtp: 95, mode: 'normal' };
}

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60000, max: 300 }));

function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'no token' });
  try { req.admin = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'bad' }); }
}

app.get('/api/site', async (req, res) => {
  const s = await pool.query('SELECT key,value FROM settings');
  const g = await pool.query('SELECT * FROM games WHERE active=1 ORDER BY id DESC');
  res.json({ settings: Object.fromEntries(s.rows.map(r => [r.key, r.value])), games: g.rows });
});

app.post('/api/play', async (req, res) => {
  const { player_id, game_id, bet } = req.body;
  const rule = await getRule(player_id, game_id);
  let rtp = rule.rtp;
  if (rule.mode === 'lose') rtp = 0;
  if (rule.mode === 'win') rtp = 100;
  const roll = Math.random() * 100;
  const isWin = roll < rtp;
  let win = 0;
  if (isWin) win = +(bet * (1 + Math.random() * 4) * (rtp / 100)).toFixed(2);
  await pool.query('INSERT INTO play_log (player_id,game_id,bet,win,rolled,decision) VALUES ($1,$2,$3,$4,$5,$6)', [player_id, game_id, bet, win, roll, isWin ? 'win' : 'lose']);
  res.json({ win, rolled: roll, target_rtp: rtp });
});

app.post('/api/login', (req, res) => {
  if (req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS) {
    res.cookie('token', jwt.sign({ u: 'admin' }, JWT_SECRET, { expiresIn: '12h' }), { httpOnly: true });
    res.json({ ok: true });
  } else res.status(401).json({ error: 'auth' });
});

const HTML = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palu57</title><style>body{font-family:system-ui;background:#08090d;color:#fff;margin:0;text-align:center}header{padding:20px;background:#12151d;border-bottom:1px solid #333}h1{color:#f5c542}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:20px}.card{background:#12151d;border:1px solid #333;padding:10px;border-radius:10px;cursor:pointer}.card img{width:100%;border-radius:5px}</style></head><body><header><h1>PALU57</h1><p>Bonus Harian 600K</p></header><div class="grid" id="games"></div><script>fetch('/api/site').then(r=>r.json()).then(d=>{document.getElementById('games').innerHTML=d.games.map(g=>\`<div class="card" onclick="alert('Masuk ke game: '+'\${g.name}')"><img src="\${g.thumbnail}"><h4>\${g.name}</h4><small>\${g.provider}</small></div>\`).join('')})</script></body></html>`;

app.get('/', (req, res) => res.send(HTML));
app.get('/login', (req, res) => res.send('<h1>Login Admin</h1>'));

initDB().then(() => app.listen(PORT, () => console.log('Ready')));