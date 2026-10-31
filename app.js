const express = require('express');
const app = express();
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Palu57</title>
      <style>
        body { font-family: system-ui; background: #08090d; color: #fff; margin: 0; text-align: center; }
        header { padding: 20px; background: #12151d; border-bottom: 1px solid #333; }
        h1 { color: #f5c542; margin: 0; }
        .hero { padding: 40px 20px; background: radial-gradient(circle at 50% 0%, #2a1f07 0%, #08090d 60%); }
        .big { font-size: 48px; font-weight: 900; color: #f5c542; margin: 10px 0; }
        .btn { padding: 10px 20px; border-radius: 8px; font-weight: bold; text-decoration: none; display: inline-block; margin: 5px; }
        .btn.gold { background: #f5c542; color: #111; }
        .btn.ghost { border: 1px solid #f5c542; color: #f5c542; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 20px; }
        .card { background: #12151d; border: 1px solid #333; padding: 10px; border-radius: 10px; }
        .card img { width: 100%; border-radius: 5px; }
        .card h4 { margin: 10px 0 5px; font-size: 14px; }
        .card small { color: #888; }
      </style>
    </head>
    <body>
      <header><h1>PALU57</h1></header>
      <div class="hero">
        <p style="color:#f5c542; font-weight:bold; letter-spacing:2px;">SELAMAT DATANG DI</p>
        <h1>PALU57</h1>
        <div class="big">1.000.000K</div>
        <p>Bonus harian 600K · Kode tukar 88K</p>
        <div style="margin-top:20px;">
          <a href="#" class="btn gold">Daftar</a>
          <a href="#" class="btn ghost">Masuk</a>
        </div>
      </div>
      <div style="padding: 10px 20px; font-size: 16px; font-weight: bold; text-align: left;">Lobi Permainan</div>
      <div class="grid">
        <div class="card"><img src="https://picsum.photos/seed/p1/200/200"><h4>Gates of Olympus</h4><small>PG</small></div>
        <div class="card"><img src="https://picsum.photos/seed/p2/200/200"><h4>Sweet Bonanza</h4><small>PG</small></div>
        <div class="card"><img src="https://picsum.photos/seed/p3/200/200"><h4>Mahjong Ways</h4><small>PG</small></div>
        <div class="card"><img src="https://picsum.photos/seed/p4/200/200"><h4>Starlight Princess</h4><small>PG</small></div>
      </div>
    </body>
    </html>
  `);
});
app.get('/login', (req, res) => {
  res.send('<h1 style="color:white; text-align:center; margin-top:50px;">Halaman Login Admin</h1>');
});
app.listen(process.env.PORT || 3000, () => console.log('Ready'));
