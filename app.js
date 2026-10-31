const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia-palu57-ganti-di-production-12345';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

const db = new Database('/tmp/judol.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, provider TEXT NOT NULL,
  category TEXT DEFAULT 'slot', thumbnail TEXT,
  rtp REAL DEFAULT 95.0, active INTEGER DEFAULT 1,
  target_rtp REAL DEFAULT 95.0, win_mode TEXT DEFAULT 'normal',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT NOT NULL,
  link TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL,
  type TEXT NOT NULL, amount REAL NOT NULL, method TEXT,
  status TEXT DEFAULT 'pending', note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS player_rtp (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL,
  game_id INTEGER, target_rtp REAL DEFAULT 50.0,
  win_mode TEXT DEFAULT 'tight', note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(player_id, game_id)
);
CREATE TABLE IF NOT EXISTS play_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL,
  game_id INTEGER NOT NULL, bet REAL NOT NULL, win REAL NOT NULL,
  rolled REAL NOT NULL, decision TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

const seed = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
seed.run('site_name', 'Palu57');
seed.run('min_deposit', '10000');
seed.run('whatsapp', '6281234567890');
seed.run('livechat_url', '#');
db.prepare("UPDATE settings SET value='Palu57' WHERE key='site_name'").run();

const gameCount = db.prepare('SELECT COUNT(*) c FROM games').get().c;
if (gameCount === 0) {
  const ins = db.prepare(`INSERT INTO games (name,provider,category,thumbnail,rtp,target_rtp,win_mode) VALUES (?,?,?,?,?,?,?)`);
  const games = [
    ['Gates of Olympus','PG','slot','https://picsum.photos/seed/p1/300/300',97.5],
    ['Sweet Bonanza','PG','slot','https://picsum.photos/seed/p2/300/300',96.5],
    ['Mahjong Ways','PG','slot','https://picsum.photos/seed/p3/300/300',96.9],
    ['Starlight Princess','PG','slot','https://picsum.photos/seed/p4/300/300',96.1],
    ['Wild Bandito','PG','slot','https://picsum.photos/seed/p5/300/300',96.7],
    ['Fortune Tiger','PP','slot','https://picsum.photos/seed/p6/300/300',96.8],
    ['Fortune Ox','PP','slot','https://picsum.photos/seed/p7/300/300',96.7],
    ['Big Bass Bonanza','PP','slot','https://picsum.photos/seed/p8/300/300',96.7],
    ['Sugar Rush','PP','slot','https://picsum.photos/seed/p9/300/300',96.5],
    ['Zeus','HABANERO','slot','https://picsum.photos/seed/p10/300/300',97.0],
    ['Lucky Neko','PG','slot','https://picsum.photos/seed/p11/300/300',97.2],
    ['Mines','JILI','arcade','https://picsum.photos/seed/p12/300/300',97.0],
  ];
  for (const g of games) ins.run(g[0], g[1], g[2], g[3], g[4], 95.0, 'normal');
}

const cache = new Map();
function cached(key, fn, ttl = 30000) {
  const now = Date.now(); const c = cache.get(key);
  if (c && now - c.t < ttl) return c.v;
  const v = fn(); cache.set(key, { v, t: now }); return v;
}
function getRule(playerId, gameId) {
  const exact = cached(`p:${playerId}:${gameId}`, () =>
    db.prepare('SELECT target_rtp, win_mode FROM player_rtp WHERE player_id=? AND game_id=?').get(playerId, gameId));
  if (exact) return { rtp: exact.target_rtp, mode: exact.win_mode, source: 'player+game' };
  const byPlayer = cached(`p:${playerId}`, () =>
    db.prepare('SELECT target_rtp, win_mode FROM player_rtp WHERE player_id=? AND game_id IS NULL').get(playerId));
  if (byPlayer) return { rtp: byPlayer.target_rtp, mode: byPlayer.win_mode, source: 'player' };
  const game = cached(`g:${gameId}`, () =>
    db.prepare('SELECT target_rtp, win_mode FROM games WHERE id=?').get(gameId));
  if (game) return { rtp: game.target_rtp ?? 95, mode: game.win_mode ?? 'normal', source: 'game' };
  return { rtp: 95, mode: 'normal', source: 'default' };
}
function decide(playerId, gameId, bet) {
  const rule = getRule(playerId, gameId);
  let rtp = rule.rtp, mode = rule.mode;
  if (mode === 'lose') rtp = 0;
  if (mode === 'win') rtp = 100;
  const roll = Math.random() * 100;
  const isWin = roll < rtp;
  let win = 0;
  if (isWin) {
    const mult = 1 + Math.random() * 4;
    win = +(bet * mult * (rtp / 100)).toFixed(2);
  }
  db.prepare('INSERT INTO play_log (player_id,game_id,bet,win,rolled,decision) VALUES (?,?,?,?,?,?)')
    .run(playerId, gameId, bet, win, +roll.toFixed(2), isWin ? 'win' : 'lose');
  return { win, rolled: +roll.toFixed(2), target_rtp: rtp, mode, source: rule.source };
}

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, max: 300 }));

function auth(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'no token' });
  try { req.admin = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'bad token' }); }
}

app.get('/api/site', (req, res) => {
  const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
  const games = db.prepare('SELECT id,name,provider,category,thumbnail,rtp,active FROM games WHERE active=1 ORDER BY id DESC').all();
  const banners = db.prepare('SELECT * FROM banners WHERE active=1').all();
  res.json({ settings, games, banners });
});

app.post('/api/transaction', (req, res) => {
  const { player_id, type, amount, method } = req.body;
  if (!player_id || !['deposit', 'withdraw'].includes(type) || !(amount > 0))
    return res.status(400).json({ error: 'invalid' });
  const info = db.prepare('INSERT INTO transactions (player_id,type,amount,method) VALUES (?,?,?,?)')
    .run(player_id, type, amount, method || null);
  res.json({ id: info.lastInsertRowid, status: 'pending' });
});

app.post('/api/play', (req, res) => {
  const { player_id, game_id, bet } = req.body;
  if (!player_id || !game_id || !(bet > 0)) return res.status(400).json({ error: 'invalid' });
  const g = db.prepare('SELECT id FROM games WHERE id=? AND active=1').get(game_id);
  if (!g) return res.status(404).json({ error: 'game not found' });
  res.json(decide(player_id, game_id, bet));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || password !== ADMIN_PASS)
    return res.status(401).json({ error: 'auth' });
  const token = jwt.sign({ u: username }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/admin/stats', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
      SUM(CASE WHEN status='success' AND type='deposit' THEN amount ELSE 0 END) dep_sum,
      SUM(CASE WHEN status='success' AND type='withdraw' THEN amount ELSE 0 END) wd_sum
    FROM transactions`).get());
});

app.get('/api/admin/transactions', auth, (req, res) => {
  const { status = '', type = '' } = req.query;
  let q = 'SELECT * FROM transactions WHERE 1=1'; const p = [];
  if (status) { q += ' AND status=?'; p.push(status); }
  if (type) { q += ' AND type=?'; p.push(type); }
  q += ' ORDER BY id DESC LIMIT 500';
  res.json(db.prepare(q).all(...p));
});
app.patch('/api/admin/transactions/:id', auth, (req, res) => {
  const { status, note } = req.body;
  if (!['pending', 'success', 'rejected'].includes(status)) return res.status(400).end();
  db.prepare('UPDATE transactions SET status=?, note=? WHERE id=?').run(status, note || null, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/games', auth, (req, res) => res.json(db.prepare('SELECT * FROM games ORDER BY id DESC').all()));
app.post('/api/admin/games', auth, (req, res) => {
  const { name, provider, category, thumbnail, rtp, active, target_rtp, win_mode } = req.body;
  const info = db.prepare(`INSERT INTO games (name,provider,category,thumbnail,rtp,active,target_rtp,win_mode)
    VALUES (?,?,?,?,?,?,?,?)`).run(name, provider, category || 'slot', thumbnail || null,
    rtp || 95, active ? 1 : 0, target_rtp ?? 95, win_mode ?? 'normal');
  res.json({ id: info.lastInsertRowid });
});
app.patch('/api/admin/games/:id', auth, (req, res) => {
  const { name, provider, category, thumbnail, rtp, active, target_rtp, win_mode } = req.body;
  db.prepare(`UPDATE games SET name=?,provider=?,category=?,thumbnail=?,rtp=?,active=?,target_rtp=?,win_mode=? WHERE id=?`)
    .run(name, provider, category, thumbnail, rtp, active ? 1 : 0, target_rtp ?? 95, win_mode ?? 'normal', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/games/:id', auth, (req, res) => {
  db.prepare('DELETE FROM games WHERE id=?').run(req.params.id); res.json({ ok: true });
});
app.patch('/api/admin/games/:id/rtp', auth, (req, res) => {
  const { target_rtp, win_mode } = req.body;
  if (target_rtp != null && (target_rtp < 0 || target_rtp > 100)) return res.status(400).json({ error: 'rtp 0-100' });
  if (win_mode && !['normal', 'tight', 'lose', 'win'].includes(win_mode)) return res.status(400).json({ error: 'bad mode' });
  db.prepare('UPDATE games SET target_rtp=COALESCE(?,target_rtp), win_mode=COALESCE(?,win_mode) WHERE id=?')
    .run(target_rtp ?? null, win_mode ?? null, req.params.id);
  cache.clear();
  res.json({ ok: true });
});

app.get('/api/admin/player-rtp', auth, (req, res) => res.json(db.prepare('SELECT * FROM player_rtp ORDER BY id DESC').all()));
app.post('/api/admin/player-rtp', auth, (req, res) => {
  const { player_id, game_id, target_rtp, win_mode, note } = req.body;
  if (!player_id) return res.status(400).json({ error: 'player_id required' });
  try {
    db.prepare(`INSERT INTO player_rtp (player_id,game_id,target_rtp,win_mode,note) VALUES (?,?,?,?,?)
      ON CONFLICT(player_id,game_id) DO UPDATE SET
      target_rtp=excluded.target_rtp, win_mode=excluded.win_mode, note=excluded.note`)
      .run(player_id, game_id ?? null, target_rtp ?? 50, win_mode ?? 'tight', note ?? null);
    cache.clear();
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/admin/player-rtp/:id', auth, (req, res) => {
  db.prepare('DELETE FROM player_rtp WHERE id=?').run(req.params.id); cache.clear(); res.json({ ok: true });
});

app.get('/api/admin/play-log', auth, (req, res) => {
  const { player_id, game_id } = req.query;
  let q = 'SELECT * FROM play_log WHERE 1=1'; const p = [];
  if (player_id) { q += ' AND player_id=?'; p.push(player_id); }
  if (game_id) { q += ' AND game_id=?'; p.push(game_id); }
  q += ' ORDER BY id DESC LIMIT 500';
  res.json(db.prepare(q).all(...p));
});
app.get('/api/admin/rtp-actual', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT game_id, COUNT(*) plays, SUM(bet) total_bet, SUM(win) total_win,
      ROUND(SUM(win)*100.0/NULLIF(SUM(bet),0), 2) actual_rtp
    FROM play_log GROUP BY game_id`).all());
});

app.get('/api/admin/banners', auth, (req, res) => res.json(db.prepare('SELECT * FROM banners ORDER BY id DESC').all()));
app.post('/api/admin/banners', auth, (req, res) => {
  const { image_url, link } = req.body;
  const info = db.prepare('INSERT INTO banners (image_url,link) VALUES (?,?)').run(image_url, link || null);
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/admin/banners/:id', auth, (req, res) => {
  db.prepare('DELETE FROM banners WHERE id=?').run(req.params.id); res.json({ ok: true });
});

app.get('/api/admin/settings', auth, (req, res) => {
  res.json(Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value])));
});
app.patch('/api/admin/settings', auth, (req, res) => {
  const stmt = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(req.body)) stmt.run(k, String(v));
  res.json({ ok: true });
});

const LANDING = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palu57</title><style>
:root{--bg:#08090d;--card:#12151d;--line:#1e2432;--gold:#f5c542;--gold2:#ffdd7a;--red:#e23a3a;--txt:#e8ecf5;--mut:#8a93a8;--green:#25c26e}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--txt);padding-bottom:70px}
header{position:sticky;top:0;z-index:20;background:rgba(8,9,13,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.hbar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;gap:12px}
.logo{font-weight:900;font-size:20px;color:var(--gold)}.logo span{color:var(--txt)}
.hbtns{display:flex;gap:8px;align-items:center}
.btn{padding:8px 14px;border-radius:8px;font-weight:700;font-size:13px;border:0;cursor:pointer}
.btn.ghost{background:transparent;border:1px solid var(--gold);color:var(--gold)}
.btn.gold{background:linear-gradient(180deg,var(--gold2),var(--gold));color:#111}
.hero{padding:36px 20px;text-align:center;background:radial-gradient(circle at 50% 0%,#2a1f07 0%,#08090d 60%)}
.hero h1{font-size:28px;font-weight:900}.hero h1 .hl{color:var(--gold)}
.hero .big{font-size:44px;font-weight:900;color:var(--gold);text-shadow:0 0 24px rgba(245,197,66,.4);margin:6px 0}
.hero p{color:var(--mut);font-size:14px}.hero .cta{margin-top:16px;display:inline-flex;gap:10px}
.ticker{overflow:hidden;background:#0f1219;border-block:1px solid var(--line);padding:8px 0}
.ticker .track{display:inline-block;white-space:nowrap;animation:slide 30s linear infinite;font-size:13px;color:var(--gold)}
.ticker .track span{margin:0 32px}@keyframes slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.providers{display:flex;gap:10px;overflow-x:auto;padding:12px 16px;scrollbar-width:none}.providers::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:12px;font-weight:700;color:var(--mut);cursor:pointer;white-space:nowrap}
.chip.on{background:var(--gold);color:#111;border-color:var(--gold)}
.sec{padding:16px}.sec h2{font-size:15px;font-weight:800;margin-bottom:10px;display:flex;justify-content:space-between}
.lobby{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;position:relative;aspect-ratio:1/1.15;display:flex;flex-direction:column;cursor:pointer}
.tile .thumb{flex:1;background:#1a1f2c center/cover}
.tile .meta{padding:6px 8px;font-size:11px}.tile .meta b{display:block;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tile .meta small{color:var(--mut);font-size:10px}
.tile .rtp{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.7);color:var(--green);font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px}
.dep{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:16px}
.dep h3{font-size:14px;margin-bottom:10px;color:var(--gold)}
.dep .methods{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.dep .m{padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:11px;cursor:pointer;background:#0f1219}
.dep .m.on{border-color:var(--gold);color:var(--gold)}
.dep .quick{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.dep .q{padding:6px 10px;border-radius:6px;background:#0f1219;border:1px solid var(--line);font-size:11px;cursor:pointer}
.dep input{width:100%;padding:10px;background:#0a0d13;border:1px solid var(--line);border-radius:8px;color:var(--txt);margin-bottom:10px}
.dep .recv{font-size:12px;color:var(--mut);margin-bottom:10px}.dep .recv b{color:var(--green)}
.dep button{width:100%}
.promos{display:flex;gap:10px;overflow-x:auto;padding:0 16px 16px;scrollbar-width:none}.promos::-webkit-scrollbar{display:none}
.promo{flex:0 0 240px;background:linear-gradient(135deg,#1a1406,#12151d);border:1px solid #3a2d0a;border-radius:12px;padding:14px}
.promo h4{font-size:13px;color:var(--gold);margin-bottom:4px}.promo p{font-size:11px;color:var(--mut);margin-bottom:8px}
.promo .tag{font-size:10px;background:#25c26e22;color:var(--green);padding:2px 8px;border-radius:999px;font-weight:700}
.bnav{position:fixed;bottom:0;left:0;right:0;background:#0c0f16;border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(5,1fr);padding:8px 0 10px;z-index:30}
.bnav a{display:flex;flex-direction:column;align-items:center;font-size:10px;color:var(--mut);gap:3px;text-decoration:none}.bnav a.on{color:var(--gold)}.bnav .ic{font-size:18px}
footer{padding:24px 16px;text-align:center;font-size:11px;color:var(--mut);border-top:1px solid var(--line);margin-top:20px}
.float{position:fixed;bottom:80px;right:14px;background:var(--green);color:#fff;padding:12px 14px;border-radius:999px;font-weight:700;font-size:13px;z-index:25;text-decoration:none}
@media(min-width:768px){.bnav{display:none}body{padding-bottom:0}.hero h1{font-size:36px}.hero .big{font-size:56px}}
.playbox{position:fixed;inset:0;background:rgba(0,0,0,.9);display:none;place-items:center;z-index:99;padding:20px}
.playbox.on{display:grid}
.pcard{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;max-width:360px;width:100%}
.pcard h3{color:var(--gold);margin-bottom:10px}.pcard input{width:100%;padding:10px;background:#0a0d13;border:1px solid var(--line);border-radius:8px;color:var(--txt);margin-bottom:8px}
.pcard .res{padding:12px;background:#0a0d13;border-radius:8px;margin:10px 0;text-align:center;font-size:14px}
</style></head><body>
<header><div class="hbar"><div class="logo" id="siteName">PALU<span>57</span></div>
<div class="hbtns"><button class="btn ghost" onclick="location.href='/login'">Masuk</button><button class="btn gold" onclick="location.href='/login'">Daftar</button></div></div></header>
<section class="hero"><p style="color:var(--gold);font-weight:700;font-size:12px;letter-spacing:2px">SELAMAT DATANG DI</p>
<h1 id="heroTitle">PALU<span class="hl">57</span></h1>
<div class="big">1.000.000K</div>
<p id="heroSub">Bonus harian 600K · Kode tukar 88K · Angpao sampai 5000K</p>
<div class="cta"><button class="btn gold" onclick="location.href='/login'">Daftar</button><button class="btn ghost" onclick="location.href='/login'">Masuk</button></div></section>
<div class="ticker"><div class="track"><span>🔥 Gaji VIP 100000K</span><span>💰 Bonus harian 600K</span><span>🎁 Kode tukar 88K</span><span>🧧 Angpao 5000K</span><span>🔥 Gaji VIP 100000K</span><span>💰 Bonus harian 600K</span><span>🎁 Kode tukar 88K</span><span>🧧 Angpao 5000K</span></div></div>
<div class="providers" id="providerStrip"></div>
<div class="sec"><h2>Lobi Permainan <a href="#" style="font-size:12px;color:var(--gold)">Semua →</a></h2><div class="lobby" id="lobby"></div></div>
<div class="dep"><h3>Deposit Cepat</h3>
<div class="methods" id="methods"><div class="m on" data-m="qris">QRIS</div><div class="m" data-m="bca">BCA</div><div class="m" data-m="dana">DANA</div><div class="m" data-m="gopay">GOPAY</div><div class="m" data-m="usdt">USDT</div></div>
<div class="quick" id="quick"><div class="q" data-a="10000">10K</div><div class="q" data-a="50000">50K</div><div class="q" data-a="100000">100K</div><div class="q" data-a="500000">500K</div><div class="q" data-a="1000000">1JT</div></div>
<input id="amount" type="number" placeholder="Jumlah deposit (min 10000)">
<div class="recv">Yang akan Anda terima: <b id="recv">0</b></div>
<button class="btn gold" onclick="doDeposit()">Konfirmasi Deposit</button></div>
<div class="sec" style="padding-bottom:0"><h2>Promosi</h2></div>
<div class="promos">
<div class="promo"><h4>Roda Keberuntungan</h4><p>Menang sampai 500K</p><span class="tag">Berlangsung</span></div>
<div class="promo"><h4>Bonus Ajak Teman</h4><p>Komisi 5% downline</p><span class="tag">Berlangsung</span></div>
<div class="promo"><h4>Hujan Angpao</h4><p>Klaim 5000K</p><span class="tag">Berlangsung</span></div>
<div class="promo"><h4>Cashback Mingguan</h4><p>Sampai 10%</p><span class="tag">Berlangsung</span></div></div>
<footer><p id="footerText">© Palu57</p><p style="margin-top:6px">Support: <a id="waLink" href="#" style="color:var(--gold)">WhatsApp</a> · <a id="chatLink" href="#" style="color:var(--gold)">Live Chat</a></p></footer>
<a class="float" id="waBtn" href="#">💬 WA</a>
<nav class="bnav"><a class="on" href="#"><span class="ic">🏠</span>Beranda</a><a href="#" onclick="document.querySelector('.dep').scrollIntoView({behavior:'smooth'})"><span class="ic">💰</span>Deposit</a><a href="#" onclick="location.href='/login'"><span class="ic">🎰</span>Game</a><a href="#promos"><span class="ic">🎁</span>Promo</a><a href="#" onclick="location.href='/login'"><span class="ic">👤</span>Saya</a></nav>
<div class="playbox" id="playbox"><div class="pcard">
<h3 id="pTitle">Main Game</h3>
<input id="pPlayer" placeholder="player_id (bebas)" value="demo_user">
<input id="pBet" type="number" placeholder="bet" value="1000">
<div class="res" id="pRes">Tekan PUTAR</div>
<button class="btn gold" style="width:100%;margin-bottom:6px" onclick="doPlay()">PUTAR</button>
<button class="btn ghost" style="width:100%" onclick="document.getElementById('playbox').classList.remove('on')">Tutup</button>
</div></div>
<script>
let state={method:'qris',currentGame:null};
document.querySelectorAll('#methods .m').forEach(m=>m.onclick=()=>{document.querySelectorAll('#methods .m').forEach(x=>x.classList.remove('on'));m.classList.add('on');state.method=m.dataset.m;});
document.querySelectorAll('#quick .q').forEach(q=>q.onclick=()=>{document.getElementById('amount').value=q.dataset.a;updateRecv();});
document.getElementById('amount').oninput=updateRecv;
function updateRecv(){const a=parseFloat(document.getElementById('amount').value)||0;document.getElementById('recv').textContent=a>0?'Rp '+a.toLocaleString('id-ID'):'0';}
async function load(){
  const r=await fetch('/api/site').then(r=>r.json());
  const s=r.settings;
  document.getElementById('siteName').innerHTML=(s.site_name||'PALU').toUpperCase().replace(/(\\d+)$/,'<span>$1</span>');
  document.getElementById('footerText').textContent='© '+s.site_name;
  document.getElementById('waBtn').href='https://wa.me/'+s.whatsapp;
  document.getElementById('waLink').href='https://wa.me/'+s.whatsapp;
  document.getElementById('chatLink').href=s.livechat_url||'#';
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
  document.getElementById('lobby').innerHTML=games.map(g=>`<div class="tile" onclick="openPlay(${g.id},'${g.name.replace(/'/g,"\\\\'")}')"><div class="thumb" style="background-image:url('${g.thumbnail||''}')"></div><div class="rtp">${g.rtp}%</div><div class="meta"><b>${g.name}</b><small>${g.provider}</small></div></div>`).join('')||'<p style="color:var(--mut);font-size:12px">Belum ada game</p>';
}
function openPlay(id,name){state.currentGame=id;document.getElementById('pTitle').textContent=name;document.getElementById('pRes').textContent='Tekan PUTAR';document.getElementById('playbox').classList.add('on');}
async function doPlay(){
  const pid=document.getElementById('pPlayer').value.trim()||'demo_user';
  const bet=parseFloat(document.getElementById('pBet').value)||1000;
  const r=await fetch('/api/play',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({player_id:pid,game_id:state.currentGame,bet})}).then(r=>r.json());
  const el=document.getElementById('pRes');
  if(r.win>0){el.innerHTML='<span style="color:var(--green);font-weight:800">MENANG Rp '+r.win.toLocaleString
                const el=document.getElementById('pRes');
  if(r.win>0){el.innerHTML='<span style="color:var(--green);font-weight:800">MENANG Rp '+r.win.toLocaleString('id-ID')+'</span><br><small style="color:var(--mut)">roll '+r.rolled+' · rtp '+r.target_rtp+'% ('+r.source+')</small>';}
  else{el.innerHTML='<span style="color:var(--red);font-weight:800">KALAH</span><br><small style="color:var(--mut)">roll '+r.rolled+' · rtp '+r.target_rtp+'% ('+r.source+')</small>';}
}
async function doDeposit(){
  const a=parseFloat(document.getElementById('amount').value)||0;
  if(a<10000)return alert('Minimal deposit 10.000');
  const pid=localStorage.getItem('player_id')||'guest_'+Date.now().toString(36);
  localStorage.setItem('player_id',pid);
  const r=await fetch('/api/transaction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({player_id:pid,type:'deposit',amount:a,method:state.method})}).then(r=>r.json());
  if(r.id)alert('Deposit #'+r.id+' dibuat. Status: pending.');
}
load();
</script></body></html>`;

const LOGIN = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palu57 - Admin Login</title><style>
body{font-family:system-ui;background:#08090d;color:#e8ecf5;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#12151d;border:1px solid #1e2432;padding:28px;border-radius:14px;width:320px}
h2{color:#f5c542;margin:0 0 16px}
input{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:1px solid #1e2432;background:#0a0d13;color:#fff;box-sizing:border-box}
button{width:100%;padding:11px;background:linear-gradient(180deg,#ffdd7a,#f5c542);color:#111;border:0;border-radius:8px;font-weight:700;cursor:pointer;margin-top:8px}
.msg{color:#f66;font-size:12px;margin-top:8px;min-height:14px}
a{color:#f5c542;font-size:12px;display:block;text-align:center;margin-top:12px;text-decoration:none}
</style></head><body>
<form onsubmit="return doLogin(event)">
<h2>Admin Login Palu57</h2>
<input id="u" placeholder="username" required>
<input id="p" type="password" placeholder="password" required>
<button>Masuk</button>
<div class="msg" id="msg"></div>
<a href="/">← Kembali ke situs</a>
</form>
<script>
async function doLogin(e){
  e.preventDefault();
  const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.getElementById('u').value,password:document.getElementById('p').value})});
  if(r.ok){location.href='/admin';}
  else{document.getElementById('msg').textContent='Login gagal';}
  return false;
}
</script></body></html>`;

const ADMIN = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palu57 - Admin</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#08090d;color:#e8ecf5}
header{padding:12px 20px;background:#12151d;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e2432}
h1{font-size:16px;color:#f5c542}
button{cursor:pointer;padding:6px 12px;border:0;border-radius:6px;background:#1e2432;color:#e8ecf5;font-size:12px}
button.primary{background:linear-gradient(180deg,#ffdd7a,#f5c542);color:#111;font-weight:700}
button.danger{background:#a33}
.tabs{display:flex;gap:6px;padding:10px 20px;background:#0c0f16;border-bottom:1px solid #1e2432;overflow-x:auto}
.tab{padding:6px 12px;border-radius:6px;background:#1e2432;font-size:12px;cursor:pointer;white-space:nowrap}
.tab.active{background:#f5c542;color:#111;font-weight:700}
section{display:none;padding:20px}section.active{display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:#12151d;padding:14px;border-radius:10px;border:1px solid #1e2432}
.kpi b{display:block;color:#f5c542;font-size:20px;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:8px;border-bottom:1px solid #1e2432;text-align:left}
th{color:#8a93a8;font-weight:500;background:#0c0f16}
input,select,textarea{padding:8px;background:#0a0d13;color:#e8ecf5;border:1px solid #1e2432;border-radius:6px;width:100%;font-size:12px}
.form{max-width:560px;background:#12151d;padding:16px;border-radius:10px;margin-bottom:16px}
.form h3{color:#f5c542;margin-bottom:8px;font-size:14px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.status-pending{color:#f5c542}.status-success{color:#25c26e}.status-rejected{color:#e23a3a}
.win{color:#25c26e;font-weight:700}.lose{color:#e23a3a;font-weight:700}
h3.section-title{color:#f5c542;margin:20px 0 10px;font-size:14px}
</style></head><body>
<header><h1>Admin Panel - Palu57</h1><div><a href="/" style="color:#8a93a8;font-size:12px;text-decoration:none;margin-right:12px">Lihat Situs</a><button onclick="logout()">Logout</button></div></header>
<div class="tabs">
<div class="tab active" data-tab="dash">Dashboard</div>
<div class="tab" data-tab="trx">Transaksi</div>
<div class="tab" data-tab="games">Games</div>
<div class="tab" data-tab="rtp">RTP Control</div>
<div class="tab" data-tab="playlog">Play Log</div>
<div class="tab" data-tab="banners">Banner</div>
<div class="tab" data-tab="settings">Settings</div>
</div>

<section id="dash" class="active"><div class="cards" id="kpi"></div></section>

<section id="trx">
<div class="row" style="max-width:520px;margin-bottom:12px">
<select id="fStatus" onchange="loadTrx()"><option value="">Semua Status</option><option value="pending">Pending</option><option value="success">Success</option><option value="rejected">Rejected</option></select>
<select id="fType" onchange="loadTrx()"><option value="">Semua Tipe</option><option value="deposit">Deposit</option><option value="withdraw">Withdraw</option></select>
</div>
<table id="trxTable"><thead><tr><th>ID</th><th>Player</th><th>Tipe</th><th>Amount</th><th>Method</th><th>Status</th><th>Aksi</th></tr></thead><tbody></tbody></table>
</section>

<section id="games">
<div class="form"><h3>Tambah Game</h3>
<div class="row"><input id="gName" placeholder="Nama game"><input id="gProvider" placeholder="Provider"></div>
<div class="row"><input id="gThumb" placeholder="URL thumbnail"><input id="gRtp" placeholder="RTP display (95.0)" type="number" step="0.1"></div>
<button class="primary" onclick="addGame()">Tambah</button></div>
<table id="gamesTable"><thead><tr><th>ID</th><th>Nama</th><th>Provider</th><th>RTP</th><th>Aktif</th><th>Aksi</th></tr></thead><tbody></tbody></table>
</section>

<section id="rtp">
<h3 class="section-title">RTP per Game</h3>
<table id="rtpTable"><thead><tr><th>ID</th><th>Game</th><th>Target RTP</th><th>Mode</th><th>Simpan</th></tr></thead><tbody></tbody></table>

<h3 class="section-title">Override per Player</h3>
<div class="form">
<div class="row"><input id="prPlayer" placeholder="player_id"><input id="prGame" placeholder="game_id (kosong = semua)" type="number"></div>
<div class="row"><input id="prRtp" placeholder="target RTP 0-100" type="number" min="0" max="100"><select id="prMode"><option value="tight">tight</option><option value="normal">normal</option><option value="lose">lose (paksa kalah)</option><option value="win">win (paksa menang)</option></select></div>
<input id="prNote" placeholder="catatan (opsional)" style="margin-bottom:8px">
<button class="primary" onclick="savePlayerRtp()">Simpan Override</button>
</div>
<table id="prTable"><thead><tr><th>ID</th><th>Player</th><th>Game</th><th>RTP</th><th>Mode</th><th>Note</th><th>Aksi</th></tr></thead><tbody></tbody></table>

<h3 class="section-title">Aktual RTP vs Target</h3>
<table id="actualTable"><thead><tr><th>Game ID</th><th>Plays</th><th>Total Bet</th><th>Total Win</th><th>Actual RTP %</th></tr></thead><tbody></tbody></table>
</section>

<section id="playlog">
<div class="row" style="max-width:520px;margin-bottom:12px">
<input id="plPlayer" placeholder="filter player_id (kosong = semua)" oninput="loadPlayLog()">
<input id="plGame" placeholder="filter game_id" type="number" oninput="loadPlayLog()">
</div>
<table id="plTable"><thead><tr><th>ID</th><th>Waktu</th><th>Player</th><th>Game</th><th>Bet</th><th>Win</th><th>Roll</th><th>Hasil</th></tr></thead><tbody></tbody></table>
</section>

<section id="banners">
<div class="form"><h3>Tambah Banner</h3>
<input id="bImg" placeholder="URL gambar banner" style="margin-bottom:8px">
<input id="bLink" placeholder="Link tujuan (opsional)" style="margin-bottom:8px">
<button class="primary" onclick="addBanner()">Tambah</button></div>
<table id="bannerTable"><thead><tr><th>ID</th><th>URL</th><th>Link</th><th>Aksi</th></tr></thead><tbody></tbody></table>
</section>

<section id="settings">
<div class="form" id="settingsForm"><h3>Site Settings</h3>
<label style="font-size:11px;color:#8a93a8">Nama Situs</label><input id="sSiteName" style="margin-bottom:8px">
<label style="font-size:11px;color:#8a93a8">Min Deposit</label><input id="sMinDep" style="margin-bottom:8px">
<label style="font-size:11px;color:#8a93a8">WhatsApp</label><input id="sWa" style="margin-bottom:8px">
<label style="font-size:11px;color:#8a93a8">Livechat URL</label><input id="sChat" style="margin-bottom:8px">
<button class="primary" onclick="saveSettings()">Simpan</button>
</div></section>

<script>
const api=(p,o={})=>fetch(p,{headers:{'content-type':'application/json'},...o});
const loaders={dash:loadDash,trx:loadTrx,games:loadGames,rtp:loadRtp,playlog:loadPlayLog,banners:loadBanners,settings:loadSettings};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('section').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');document.getElementById(t.dataset.tab).classList.add('active');
  loaders[t.dataset.tab]();
});
async function logout(){await api('/api/logout',{method:'POST'});location.href='/login';}

async function loadDash(){
  const r=await api('/api/admin/stats').then(r=>r.json());
  document.getElementById('kpi').innerHTML=\`
    <div class="kpi">Total Transaksi<b>\${r.total||0}</b></div>
    <div class="kpi">Pending<b>\${r.pending||0}</b></div>
    <div class="kpi">Success<b>\${r.success||0}</b></div>
    <div class="kpi">Total Deposit<b>Rp \${(r.dep_sum||0).toLocaleString('id-ID')}</b></div>
    <div class="kpi">Total Withdraw<b>Rp \${(r.wd_sum||0).toLocaleString('id-ID')}</b></div>\`;
}

async function loadTrx(){
  const s=document.getElementById('fStatus').value,t=document.getElementById('fType').value;
  const r=await api('/api/admin/transactions?status='+s+'&type='+t).then(r=>r.json());
  document.querySelector('#trxTable tbody').innerHTML=r.map(x=>\`
    <tr><td>\${x.id}</td><td>\${x.player_id}</td><td>\${x.type}</td>
    <td>Rp \${x.amount.toLocaleString('id-ID')}</td><td>\${x.method||'-'}</td>
    <td class="status-\${x.status}">\${x.status}</td>
    <td>\${x.status==='pending'?\`<button onclick="setTrx(\${x.id},'success')">✓</button> <button class="danger" onclick="setTrx(\${x.id},'rejected')">✕</button>\`:'-'}</td></tr>\`).join('');
}
async function setTrx(id,s){await api('/api/admin/transactions/'+id,{method:'PATCH',body:JSON.stringify({status:s})});loadTrx();loadDash();}

async function loadGames(){
  const r=await api('/api/admin/games').then(r=>r.json());
  document.querySelector('#gamesTable tbody').innerHTML=r.map(g=>\`
    <tr><td>\${g.id}</td><td>\${g.name}</td><td>\${g.provider}</td><td>\${g.rtp}%</td>
    <td>\${g.active?'Ya':'Tidak'}</td>
    <td><button class="danger" onclick="delGame(\${g.id})">Hapus</button></td></tr>\`).join('');
}
async function addGame(){
  await api('/api/admin/games',{method:'POST',body:JSON.stringify({
    name:gName.value,provider:gProvider.value,thumbnail:gThumb.value,
    rtp:parseFloat(gRtp.value)||95,active:1
  })});
  gName.value=gProvider.value=gThumb.value=gRtp.value='';loadGames();
}
async function delGame(id){await api('/api/admin/games/'+id,{method:'DELETE'});loadGames();}

async function loadRtp(){
  const games=await api('/api/admin/games').then(r=>r.json());
  document.querySelector('#rtpTable tbody').innerHTML=games.map(g=>\`
    <tr><td>\${g.id}</td><td>\${g.name}</td>
    <td><input type="number" value="\${g.target_rtp??95}" min="0" max="100" id="r-\${g.id}" style="width:80px"></td>
    <td><select id="m-\${g.id}">\${['normal','tight','lose','win'].map(x=>\`<option \${g.win_mode===x?'selected':''}>\${x}</option>\`).join('')}</select></td>
    <td><button onclick="saveGameRtp(\${g.id})">Simpan</button></td></tr>\`).join('');

  const pr=await api('/api/admin/player-rtp').then(r=>r.json());
  document.querySelector('#prTable tbody').innerHTML=pr.map(p=>\`
    <tr><td>\${p.id}</td><td>\${p.player_id}</td><td>\${p.game_id??'semua'}</td>
    <td>\${p.target_rtp}%</td><td>\${p.win_mode}</td><td>\${p.note||'-'}</td>
    <td><button class="danger" onclick="delPr(\${p.id})">Hapus</button></td></tr>\`).join('');

  const ac=await api('/api/admin/rtp-actual').then(r=>r.json());
  document.querySelector('#actualTable tbody').innerHTML=ac.map(a=>\`
    <tr><td>\${a.game_id}</td><td>\${a.plays}</td>
    <td>Rp \${(a.total_bet||0).toLocaleString('id-ID')}</td>
    <td>Rp \${(a.total_win||0).toLocaleString('id-ID')}</td>
    <td style="color:\${a.actual_rtp>95?'#e23a3a':'#25c26e'}">\${a.actual_rtp}%</td></tr>\`).join('');
}
async function saveGameRtp(id){
  await api('/api/admin/games/'+id+'/rtp',{method:'PATCH',body:JSON.stringify({
    target_rtp:parseFloat(document.getElementById('r-'+id).value),
    win_mode:document.getElementById('m-'+id).value
  })});
  alert('Tersimpan');loadRtp();
}
async function savePlayerRtp(){
  if(!prPlayer.value.trim())return alert('player_id wajib');
  await api('/api/admin/player-rtp',{method:'POST',body:JSON.stringify({
    player_id:prPlayer.value.trim(),game_id:prGame.value?+prGame.value:null,
    target_rtp:parseFloat(prRtp.value)||50,win_mode:prMode.value,note:prNote.value
  })});
  prPlayer.value=prGame.value=prRtp.value=prNote.value='';loadRtp();
}
async function delPr(id){await api('/api/admin/player-rtp/'+id,{method:'DELETE'});loadRtp();}

async function loadPlayLog(){
  const p=document.getElementById('plPlayer').value,g=document.getElementById('plGame').value;
  const r=await api('/api/admin/play-log?player_id='+p+'&game_id='+g).then(r=>r.json());
  document.querySelector('#plTable tbody').innerHTML=r.map(x=>\`
    <tr><td>\${x.id}</td><td>\${x.created_at}</td><td>\${x.player_id}</td><td>\${x.game_id}</td>
    <td>Rp \${x.bet.toLocaleString('id-ID')}</td><td>Rp \${x.win.toLocaleString('id-ID')}</td>
    <td>\${x.rolled}</td><td class="\${x.decision}">\${x.decision}</td></tr>\`).join('');
}

async function loadBanners(){
  const r=await api('/api/admin/banners').then(r=>r.json());
  document.querySelector('#bannerTable tbody').innerHTML=r.map(b=>\`
    <tr><td>\${b.id}</td><td>\${b.image_url}</td><td>\${b.link||'-'}</td>
    <td><button class="danger" onclick="delBanner(\${b.id})">Hapus</button></td></tr>\`).join('');
}
async function addBanner(){
  await api('/api/admin/banners',{method:'POST',body:JSON.stringify({image_url:bImg.value,link:bLink.value})});
  bImg.value=bLink.value='';loadBanners();
}
async function delBanner(id){await api('/api/admin/banners/'+id,{method:'DELETE'});loadBanners();}

async function loadSettings(){
  const r=await api('/api/admin/settings').then(r=>r.json());
  sSiteName.value=r.site_name||'';sMinDep.value=r.min_deposit||'';sWa.value=r.whatsapp||'';sChat.value=r.livechat_url||'';
}
async function saveSettings(){
  await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify({
    site_name:sSiteName.value,min_deposit:sMinDep.value,whatsapp:sWa.value,livechat_url:sChat.value
  })});
  alert('Tersimpan');
}

loadDash();
</script></body></html>`;

app.get('/', (req, res) => res.type('html').send(LANDING));
app.get('/login', (req, res) => res.type('html').send(LOGIN));
app.get('/admin', (req, res) => res.type('html').send(ADMIN));

app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
});