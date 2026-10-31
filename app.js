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
});const HTML = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palu57</title><style>
:root{--bg:#08090d;--card:#12151d;--line:#1e2432;--gold:#f5c542;--gold2:#ffdd7a;--txt:#e8ecf5;--mut:#8a93a8;--green:#25c26e;--red:#e23a3a}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--txt);padding-bottom:70px}
header{position:sticky;top:0;z-index:20;background:rgba(8,9,13,.95);border-bottom:1px solid var(--line)}
.hbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px}
.logo{font-weight:900;font-size:20px;color:var(--gold)}.logo span{color:var(--txt)}
.btn{padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;border:0;cursor:pointer;text-decoration:none;color:#111}
.btn.ghost{background:transparent;border:1px solid var(--gold);color:var(--gold)}
.btn.gold{background:linear-gradient(180deg,var(--gold2),var(--gold))}
.hero{padding:36px 20px;text-align:center;background:radial-gradient(circle at 50% 0%,#2a1f07 0%,#08090d 60%)}
.hero h1{font-size:28px;font-weight:900}.hero h1 .hl{color:var(--gold)}
.hero .big{font-size:44px;font-weight:900;color:var(--gold);text-shadow:0 0 24px rgba(245,197,66,.4);margin:6px 0}
.hero p{color:var(--mut);font-size:14px}.hero .cta{margin-top:16px;display:inline-flex;gap:10px}
.providers{display:flex;gap:10px;overflow-x:auto;padding:12px 16px;scrollbar-width:none}.providers::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:12px;font-weight:700;color:var(--mut);cursor:pointer}
.chip.on{background:var(--gold);color:#111;border-color:var(--gold)}
.sec{padding:16px}.sec h2{font-size:15px;font-weight:800;margin-bottom:10px;display:flex;justify-content:space-between}
.lobby{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;aspect-ratio:1/1.15;display:flex;flex-direction:column;cursor:pointer}
.tile .thumb{flex:1;background:#1a1f2c center/cover}
.tile .meta{padding:6px 8px;font-size:11px}.tile .meta b{display:block;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tile .meta small{color:var(--mut);font-size:10px}
.tile .rtp{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.7);color:var(--green);font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px}
.bnav{position:fixed;bottom:0;left:0;right:0;background:#0c0f16;border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(5,1fr);padding:8px 0 10px;z-index:30}
.bnav a{display:flex;flex-direction:column;align-items:center;font-size:10px;color:var(--mut);gap:3px;text-decoration:none}.bnav a.on{color:var(--gold)}.bnav .ic{font-size:18px}
footer{padding:24px 16px;text-align:center;font-size:11px;color:var(--mut);border-top:1px solid var(--line);margin-top:20px}
.playbox{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;place-items:center;z-index:99;padding:20px}
.playbox.on{display:grid}
.pcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;max-width:360px;width:100%}
.pcard h3{color:var(--gold);margin-bottom:10px}.pcard input{width:100%;padding:10px;background:#0a0d13;border:1px solid var(--line);border-radius:8px;color:var(--txt);margin-bottom:8px}
.pcard .res{padding:12px;background:#0a0d13;border-radius:8px;margin:10px 0;text-align:center;font-size:14px}
</style></head><body>
<header><div class="hbar"><div class="logo">PALU<span>57</span></div>
<div style="display:flex;gap:8px"><a href="/login" class="btn ghost">Masuk</a><a href="/login" class="btn gold">Daftar</a></div></div></header>
<section class="hero"><p style="color:var(--gold);font-weight:700;font-size:12px;letter-spacing:2px">SELAMAT DATANG DI</p>
<h1>PALU<span class="hl">57</span></h1>
<div class="big">1.000.000K</div>
<p>Bonus harian 600K · Kode tukar 88K · Angpao sampai 5000K</p>
<div class="cta"><a href="/login" class="btn gold">Daftar Sekarang</a><a href="/login" class="btn ghost">Masuk</a></div></section>
<div class="providers" id="providerStrip"></div>
<div class="sec"><h2>Lobi Permainan <a href="#" style="font-size:12px;color:var(--gold)">Semua →</a></h2><div class="lobby" id="lobby"></div></div>
<footer><p>© Palu57</p></footer>
<nav class="bnav"><a class="on" href="#"><span class="ic">🏠</span>Beranda</a><a href="#"><span class="ic">💰</span>Deposit</a><a href="/login"><span class="ic">🎰</span>Game</a><a href="#"><span class="ic">🎁</span>Promo</a><a href="/login"><span class="ic">👤</span>Saya</a></nav>
<div class="playbox" id="playbox"><div class="pcard">
<h3 id="pTitle">Main Game</h3>
<input id="pPlayer" placeholder="player_id (bebas)" value="demo_user">
<input id="pBet" type="number" placeholder="bet" value="1000">
<div class="res" id="pRes">Tekan PUTAR</div>
<button class="btn gold" style="width:100%;margin-bottom:6px" onclick="doPlay()">PUTAR</button>
<button class="btn ghost" style="width:100%" onclick="document.getElementById('playbox').classList.remove('on')">Tutup</button>
</div></div>
<script>
let state={currentGame:null};
async function load(){
  const r=await fetch('/api/site').then(r=>r.json());
  const provs=[...new Set(r.games.map(g=>g.provider))];
  document.getElementById('providerStrip').innerHTML='<div class="chip on">SEMUA</div>'+provs.map(p=>'<div class="chip">'+p+'</div>').join('');
  renderLobby(r.games);
  document.querySelectorAll('.providers .chip').forEach(c=>c.onclick=()=>{
    document.querySelectorAll('.providers .chip').forEach(x=>x.classList.remove('on'));c.classList.add('on');
    const n=c.textContent.trim();
    renderLobby(n==='SEMUA'?r.games:r.games.filter(g=>g.provider===n));
  });
}
function renderLobby(games){
  document.getElementById('lobby').innerHTML=games.map(g=>`<div class="tile" onclick="openPlay(${g.id},'${g.name.replace(/'/g,"\\\\'")}')"><div class="thumb" style="background-image:url('${g.thumbnail||''}')"></div><div class="rtp">${g.rtp}%</div><div class="meta"><b>${g.name}</b><small>${g.provider}</small></div></div>`).join('');
}
function openPlay(id,name){state.currentGame=id;document.getElementById('pTitle').textContent=name;document.getElementById('pRes').textContent='Tekan PUTAR';document.getElementById('playbox').classList.add('on');}
async function doPlay(){
  const pid=document.getElementById('pPlayer').value.trim()||'demo_user';
  const bet=parseFloat(document.getElementById('pBet').value)||1000;
  const r=await fetch('/api/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({player_id:pid,game_id:state.currentGame,bet})}).then(r=>r.json());
  const el=document.getElementById('pRes');
  if(r.win>0){el.innerHTML='<span style="color:var(--green);font-weight:800">MENANG Rp '+r.win.toLocaleString('id-ID')+'</span>';}
  else{el.innerHTML='<span style="color:var(--red);font-weight:800">KALAH</span>';}
}
load();
</script></body></html>`;

app.get('/', (req, res) => res.send(HTML));
app.get('/login', (req, res) => res.send('<h2 style="color:white;text-align:center;margin-top:50px">Halaman Login Admin (Tinggal Dikembangkan)</h2>'));

initDB().then(() => app.listen(PORT, () => console.log('Ready')));