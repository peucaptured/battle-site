// =============================================================================
// BATTLE EFFECTS — weather_effects.js
// Adicione este bloco ao main.js, logo ANTES da função draw()
// =============================================================================

// -------------------------
// Partículas de clima (estado persistente entre frames)
// -------------------------
const weatherParticles = {
  rain:   [],  // gotas de chuva
  snow:   [],  // flocos de neve
  sand:   [],  // grãos de areia
  sun:    [],  // raios de sol / partículas de calor
  hail:   [],  // pedras de granizo (tempestade de neve)
};

// Inicializa partículas de chuva
function initRainParticles(count = 120) {
  weatherParticles.rain = [];
  for (let i = 0; i < count; i++) {
    weatherParticles.rain.push({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      speed: 6 + Math.random() * 6,
      len: 10 + Math.random() * 8,
      alpha: 0.3 + Math.random() * 0.4,
    });
  }
}

// Inicializa flocos de neve / granizo
function initSnowParticles(count = 80, isHail = false) {
  const arr = isHail ? weatherParticles.hail : weatherParticles.snow;
  arr.length = 0;
  for (let i = 0; i < count; i++) {
    arr.push({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      r: isHail ? (2 + Math.random() * 3) : (2 + Math.random() * 4),
      speed: isHail ? (4 + Math.random() * 4) : (0.8 + Math.random() * 1.5),
      phase: Math.random() * Math.PI * 2,
      alpha: 0.5 + Math.random() * 0.5,
    });
  }
}

// Inicializa partículas de areia
function initSandParticles(count = 90) {
  weatherParticles.sand = [];
  for (let i = 0; i < count; i++) {
    weatherParticles.sand.push({
      x: Math.random() * 1600,
      y: Math.random() * 1200,
      speed: 5 + Math.random() * 8,
      len: 6 + Math.random() * 12,
      alpha: 0.15 + Math.random() * 0.25,
      r: 190 + Math.random() * 40 | 0,
      g: 150 + Math.random() * 30 | 0,
    });
  }
}

// Garante que as partículas existam para o clima ativo
function ensureWeatherParticles(weather) {
  if (weather === 'rain'  && weatherParticles.rain.length  === 0) initRainParticles();
  if (weather === 'snow'  && weatherParticles.snow.length  === 0) initSnowParticles(80, false);
  if (weather === 'hail'  && weatherParticles.hail.length  === 0) initSnowParticles(60, true);
  if (weather === 'sand'  && weatherParticles.sand.length  === 0) initSandParticles();
}

// =============================================================================
// FUNÇÃO PRINCIPAL: drawWeatherOverlay
// Chame dentro de draw(), DEPOIS do mapa e ANTES das peças
// Parâmetros: ctx, ox, oy, gs (grid size), tile (tile size em px), w, h (canvas)
// =============================================================================
function drawWeatherOverlay(ctx, ox, oy, gs, tile, w, h) {
  // Lê o clima e terreno do Firestore (public_state/battle)
  const weather = safeStr(appState.battle?.weather  || appState.board?.weather  || '').toLowerCase();
  const terrain = safeStr(appState.battle?.terrain  || appState.board?.terrain  || '').toLowerCase();

  const t = Date.now() / 1000; // segundos
  const gridW = gs * tile;
  const gridH = gs * tile;

  // Salva o estado do canvas para restaurar depois
  ctx.save();
  // Recorta os efeitos dentro do grid
  ctx.beginPath();
  ctx.rect(ox, oy, gridW, gridH);
  ctx.clip();

  // -------------------------------------------------------------------
  // ☀️  DIA ENSOLARADO (sun / harsh_sun / sunny)
  // -------------------------------------------------------------------
  if (weather === 'sun' || weather === 'sunny' || weather === 'harsh_sun' || weather === 'harshsun') {
    // Overlay amarelo pulsante
    const pulse = 0.07 + Math.abs(Math.sin(t * 0.9)) * 0.06;
    ctx.fillStyle = `rgba(255,220,60,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Raios de luz saindo do canto superior direito
    const cx = ox + gridW * 1.1;
    const cy = oy - gridH * 0.15;
    const rayCount = 9;
    for (let i = 0; i < rayCount; i++) {
      const angle = Math.PI * 0.55 + (i / (rayCount - 1)) * Math.PI * 0.45;
      const len = Math.min(gridW, gridH) * (0.7 + Math.sin(t * 0.7 + i) * 0.15);
      const alpha = 0.04 + Math.abs(Math.sin(t * 0.5 + i * 0.7)) * 0.04;
      ctx.strokeStyle = `rgba(255,240,100,${alpha})`;
      ctx.lineWidth = tile * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
      ctx.stroke();
    }

    // Brilho de calor (shimmer) — linhas horizontais onduladas
    ctx.strokeStyle = 'rgba(255,200,50,0.07)';
    ctx.lineWidth = 1;
    for (let row = 0; row < gs; row++) {
      const y = oy + row * tile + tile * 0.5;
      const shimmer = Math.sin(t * 2 + row * 0.7) * tile * 0.08;
      ctx.beginPath();
      ctx.moveTo(ox, y + shimmer);
      ctx.lineTo(ox + gridW, y - shimmer);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------------
  // 🌧️  CHUVA (rain / heavy_rain)
  // -------------------------------------------------------------------
  else if (weather === 'rain' || weather === 'heavy_rain' || weather === 'heavyrain') {
    ensureWeatherParticles('rain');
    const heavy = weather !== 'rain';

    // Overlay azul levemente escurecido
    ctx.fillStyle = heavy ? 'rgba(30,60,120,0.12)' : 'rgba(30,60,100,0.07)';
    ctx.fillRect(ox, oy, gridW, gridH);

    // Desenha e move as gotas
    ctx.lineCap = 'round';
    for (const d of weatherParticles.rain) {
      ctx.strokeStyle = `rgba(147,210,255,${d.alpha})`;
      ctx.lineWidth = heavy ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(ox + d.x,              oy + d.y);
      ctx.lineTo(ox + d.x - d.len * 0.3, oy + d.y + d.len);
      ctx.stroke();

      // Avança a gota
      d.x -= d.speed * 0.3;
      d.y += d.speed;

      // Reseta quando sai do grid
      if (d.y > gridH + d.len || d.x < -d.len) {
        d.x = Math.random() * gridW + d.len;
        d.y = -d.len;
      }
    }
  }

  // -------------------------------------------------------------------
  // ❄️  TEMPESTADE DE NEVE (snow / blizzard)
  // -------------------------------------------------------------------
  else if (weather === 'snow' || weather === 'blizzard') {
    ensureWeatherParticles('snow');

    // Overlay azul-gelo
    ctx.fillStyle = 'rgba(200,230,255,0.08)';
    ctx.fillRect(ox, oy, gridW, gridH);

    for (const f of weatherParticles.snow) {
      ctx.beginPath();
      ctx.arc(ox + f.x, oy + f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,240,255,${f.alpha})`;
      ctx.fill();

      // Flocos caem com oscilação suave
      f.y += f.speed;
      f.x += Math.sin(t * 0.8 + f.phase) * 0.6;

      if (f.y > gridH + f.r * 2) {
        f.y = -f.r * 2;
        f.x = Math.random() * gridW;
      }
      if (f.x < 0) f.x += gridW;
      if (f.x > gridW) f.x -= gridW;
    }

    // Névoa branca no fundo para dar sensação de blizzard
    if (weather === 'blizzard') {
      const fogAlpha = 0.06 + Math.abs(Math.sin(t * 0.4)) * 0.05;
      ctx.fillStyle = `rgba(220,235,255,${fogAlpha})`;
      ctx.fillRect(ox, oy, gridW, gridH);
    }
  }

  // -------------------------------------------------------------------
  // 🌪️  TEMPESTADE DE AREIA (sandstorm / sand)
  // -------------------------------------------------------------------
  else if (weather === 'sand' || weather === 'sandstorm') {
    ensureWeatherParticles('sand');

    // Overlay bege-laranja
    const sandBase = 0.06 + Math.abs(Math.sin(t * 0.6)) * 0.04;
    ctx.fillStyle = `rgba(180,130,60,${sandBase})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    ctx.lineCap = 'round';
    for (const s of weatherParticles.sand) {
      ctx.strokeStyle = `rgba(${s.r},${s.g},80,${s.alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox + s.x,          oy + s.y);
      ctx.lineTo(ox + s.x + s.len,  oy + s.y + s.len * 0.15);
      ctx.stroke();

      s.x += s.speed;
      s.y += (Math.random() - 0.5) * 1.5;

      if (s.x > gridW + s.len) {
        s.x = -s.len;
        s.y = Math.random() * gridH;
      }
    }
  }

  // -------------------------------------------------------------------
  // 🌨️  GRANIZO (hail — Tempestade de Neve com granizo)
  // -------------------------------------------------------------------
  else if (weather === 'hail') {
    ensureWeatherParticles('hail');

    ctx.fillStyle = 'rgba(180,210,240,0.08)';
    ctx.fillRect(ox, oy, gridW, gridH);

    for (const f of weatherParticles.hail) {
      // Granizo: hexágono simples
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2 - Math.PI / 6;
        const px = ox + f.x + Math.cos(ang) * f.r;
        const py = oy + f.y + Math.sin(ang) * f.r;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(200,225,255,${f.alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(150,200,255,${f.alpha * 0.5})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      f.y += f.speed;
      f.x += Math.sin(t + f.phase) * 0.3;

      if (f.y > gridH + f.r * 2) {
        f.y = -f.r * 2;
        f.x = Math.random() * gridW;
      }
    }
  }

  // -------------------------------------------------------------------
  // ⚡  TERRENO ELÉTRICO (electric_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'electric' || terrain === 'electric_terrain') {
    // Overlay amarelo-elétrico pulsante
    const pulse = 0.08 + Math.abs(Math.sin(t * 2.5)) * 0.06;
    ctx.fillStyle = `rgba(250,230,0,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda elétrica ao redor do grid
    const borderGlow = 1 + Math.abs(Math.sin(t * 3));
    ctx.strokeStyle = `rgba(255,240,0,${0.5 + Math.sin(t * 4) * 0.3})`;
    ctx.lineWidth = borderGlow * 2;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Mini-raios aleatórios (flickering)
    // Usamos t como seed discreta para variar os raios a cada ~0.3s
    const seed = Math.floor(t * 3);
    const pseudo = (n) => ((Math.sin(n * 127.1 + seed * 311.7) * 43758.5453) % 1 + 1) % 1;
    const boltCount = 4;
    for (let b = 0; b < boltCount; b++) {
      const bx = ox + pseudo(b * 7 + 1) * gridW;
      const by = oy + pseudo(b * 7 + 2) * gridH;
      const blen = tile * (0.4 + pseudo(b * 7 + 3) * 0.6);
      const bang = pseudo(b * 7 + 4) * Math.PI * 2;
      const alpha = 0.4 + pseudo(b * 7 + 5) * 0.5;

      ctx.strokeStyle = `rgba(255,255,100,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      // zigue-zague de 3 segmentos
      const mid1x = bx + Math.cos(bang + 0.5) * blen * 0.4;
      const mid1y = by + Math.sin(bang + 0.5) * blen * 0.4;
      const mid2x = bx + Math.cos(bang - 0.4) * blen * 0.7;
      const mid2y = by + Math.sin(bang - 0.4) * blen * 0.7;
      const endx  = bx + Math.cos(bang) * blen;
      const endy  = by + Math.sin(bang) * blen;
      ctx.lineTo(mid1x, mid1y);
      ctx.lineTo(mid2x, mid2y);
      ctx.lineTo(endx, endy);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------------
  // 🌸  TERRENO DAS FADAS (fairy_terrain / misty_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'fairy' || terrain === 'fairy_terrain' || terrain === 'misty' || terrain === 'misty_terrain') {
    // Overlay rosado suave
    const pulse = 0.06 + Math.abs(Math.sin(t * 1.2)) * 0.04;
    ctx.fillStyle = `rgba(255,180,220,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda rosa brilhante
    ctx.strokeStyle = `rgba(255,130,200,${0.4 + Math.sin(t * 2) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Partículas de brilho subindo (sparkles)
    // Posições geradas por seed baseada no tempo — evita alocar array
    const sparkCount = 20;
    for (let s = 0; s < sparkCount; s++) {
      // Progresso cíclico de cada sparkle (0..1)
      const cycleLen = 2.5 + (s % 5) * 0.4;
      const prog = ((t / cycleLen) + s / sparkCount) % 1;
      const sx = ox + (((s * 173.17) % gridW + gridW) % gridW);
      const sy = oy + gridH * (1 - prog);
      const sr = 1.5 + Math.sin(prog * Math.PI) * 2;
      const alpha = Math.sin(prog * Math.PI) * 0.8;

      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,200,240,${alpha})`;
      ctx.fill();

      // Cruz brilhante pequena
      if (sr > 2.5) {
        ctx.strokeStyle = `rgba(255,240,255,${alpha * 0.7})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - sr * 1.5, sy);
        ctx.lineTo(sx + sr * 1.5, sy);
        ctx.moveTo(sx, sy - sr * 1.5);
        ctx.lineTo(sx, sy + sr * 1.5);
        ctx.stroke();
      }
    }
  }

  // -------------------------------------------------------------------
  // 🔮  TERRENO PSÍQUICO (psychic_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'psychic' || terrain === 'psychic_terrain') {
    // Overlay roxo suave
    const pulse = 0.07 + Math.abs(Math.sin(t * 1.5)) * 0.05;
    ctx.fillStyle = `rgba(180,100,255,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda roxo vibrante
    ctx.strokeStyle = `rgba(200,120,255,${0.5 + Math.sin(t * 2.5) * 0.3})`;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Ondas concêntricas expandindo do centro
    const centerX = ox + gridW / 2;
    const centerY = oy + gridH / 2;
    const maxR = Math.max(gridW, gridH) * 0.75;
    const waveCount = 3;
    for (let w = 0; w < waveCount; w++) {
      const phase = (t * 0.5 + w / waveCount) % 1;
      const r = phase * maxR;
      const alpha = (1 - phase) * 0.25;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(210,150,255,${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------------
  // 🌿  TERRENO DE GRAMA (grassy_terrain)
  // -------------------------------------------------------------------
  if (terrain === 'grass' || terrain === 'grassy' || terrain === 'grassy_terrain') {
    // Overlay verde suave
    const pulse = 0.06 + Math.abs(Math.sin(t * 1.0)) * 0.04;
    ctx.fillStyle = `rgba(80,200,100,${pulse})`;
    ctx.fillRect(ox, oy, gridW, gridH);

    // Borda verde brilhante
    ctx.strokeStyle = `rgba(60,180,80,${0.45 + Math.sin(t * 1.8) * 0.2})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, gridW - 2, gridH - 2);

    // Partículas de folhas / pontos subindo
    const leafCount = 18;
    for (let l = 0; l < leafCount; l++) {
      const cycleLen = 3.0 + (l % 6) * 0.5;
      const prog = ((t / cycleLen) + l / leafCount) % 1;
      const lx = ox + (((l * 211.31) % gridW + gridW) % gridW);
      const ly = oy + gridH * (1 - prog);
      const lr = 1.5 + Math.sin(prog * Math.PI) * 2.5;
      const alpha = Math.sin(prog * Math.PI) * 0.7;
      const sway = Math.sin(t * 1.2 + l * 0.8) * tile * 0.1;

      // Folha: elipse pequena inclinada
      ctx.save();
      ctx.translate(lx + sway, ly);
      ctx.rotate(Math.sin(t * 0.8 + l) * 0.4);
      ctx.beginPath();
      ctx.ellipse(0, 0, lr * 0.7, lr * 1.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(50,200,80,${alpha})`;
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

// =============================================================================
// FUNÇÃO: drawCellEffects
// Desenha efeitos por CÉLULA (Stealth Rock, Spikes, Toxic Spikes, etc.)
// Substitui os PNGs por shapes desenhados no canvas
// Chame DEPOIS do drawWeatherOverlay e ANTES das peças
// =============================================================================
function drawCellEffects(ctx, ox, oy, tile) {
  const effects = appState.board?.effects;
  if (!Array.isArray(effects) || effects.length === 0) return;

  const t = Date.now() / 1000;

  for (const eff of effects) {
    const row = Number(eff?.row);
    const col = Number(eff?.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;

    const x = ox + col * tile;
    const y = oy + row * tile;
    const cx = x + tile * 0.5;
    const cy = y + tile * 0.5;
    const icon = safeStr(eff?.icon || '');

    ctx.save();

    // ---------------------------------------------------------------
    // Efeitos de TERRENO / CLIMA (usam ícone emoji do app.py antigo)
    // Esses agora são campo todo → só mostra indicador pequeno na célula
    // se quiser manter retrocompatibilidade com efeitos antigos por célula
    // ---------------------------------------------------------------

    // 🪨 Stealth Rock
    if (icon === '🪨' || icon.toLowerCase().includes('rock')) {
      _drawStealthRock(ctx, x, y, cx, cy, tile, t);
    }
    // ⬇️ Spikes (normal)
    else if (icon === '🔺' || icon.toLowerCase() === 'spikes' || icon === '△') {
      _drawSpikes(ctx, x, y, cx, cy, tile, 3, '#c8a96e', '#8a6a3c');
    }
    // ☠️ Toxic Spikes
    else if (icon === '☠️' || icon.toLowerCase().includes('toxic') || icon === '💜') {
      _drawSpikes(ctx, x, y, cx, cy, tile, 3, '#c084fc', '#7e22ce');
    }
    // 🕸️ Sticky Web
    else if (icon === '🕸️' || icon.toLowerCase().includes('web')) {
      _drawStickyWeb(ctx, cx, cy, tile, t);
    }
    // 🔥 Fogo / Fire Spin
    else if (icon === '🔥') {
      _drawFireCell(ctx, cx, cy, tile, t);
    }
    // 🧊 Gelo
    else if (icon === '🧊') {
      _drawIceCell(ctx, x, y, cx, cy, tile);
    }
    // 💧 Água
    else if (icon === '💧') {
      _drawWaterCell(ctx, cx, cy, tile, t);
    }
    // ☁️ Nuvem (ex: Haze local ou efeito legado)
    else if (icon === '☁️') {
      _drawCloudCell(ctx, cx, cy, tile, t);
    }
    // ⚡ Raio (terreno elétrico por célula — legado)
    else if (icon === '⚡') {
      _drawElectricCell(ctx, cx, cy, tile, t);
    }
    // ☀️ Sol (terreno sol por célula — legado)
    else if (icon === '☀️') {
      _drawSunCell(ctx, cx, cy, tile, t);
    }
    // 🍃 Grama (terreno grama por célula — legado)
    else if (icon === '🍃') {
      _drawGrassCell(ctx, cx, cy, tile, t);
    }
    // Fallback: exibe o emoji diretamente no canvas
    else if (icon) {
      ctx.font = `${Math.max(10, tile * 0.38)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.85;
      ctx.fillText(icon, cx, cy);
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------
// Helpers de shapes por célula
// ---------------------------------------------------------------

// 🪨 Stealth Rock — fragmentos de rocha flutuando no canto
function _drawStealthRock(ctx, x, y, cx, cy, tile, t) {
  const positions = [
    { dx: -0.28, dy: -0.28, r: 0.10, rot: 0.3 },
    { dx:  0.25, dy: -0.22, r: 0.08, rot: -0.6 },
    { dx: -0.18, dy:  0.25, r: 0.09, rot: 1.0 },
    { dx:  0.28, dy:  0.22, r: 0.07, rot: 0.5 },
  ];
  for (const p of positions) {
    const px = cx + p.dx * tile + Math.sin(t * 0.8 + p.rot * 5) * tile * 0.02;
    const py = cy + p.dy * tile + Math.cos(t * 0.7 + p.rot * 3) * tile * 0.02;
    const pr = p.r * tile;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(p.rot + t * 0.2);

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(pr * 0.2, pr * 0.2, pr, pr * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rocha principal (polígono irregular)
    ctx.fillStyle = '#7c6550';
    ctx.beginPath();
    ctx.moveTo(-pr, 0);
    ctx.lineTo(-pr * 0.3, -pr * 0.9);
    ctx.lineTo(pr * 0.6, -pr * 0.7);
    ctx.lineTo(pr, 0);
    ctx.lineTo(pr * 0.5, pr * 0.8);
    ctx.lineTo(-pr * 0.5, pr * 0.6);
    ctx.closePath();
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(200,170,130,0.4)';
    ctx.beginPath();
    ctx.moveTo(-pr * 0.3, -pr * 0.7);
    ctx.lineTo(pr * 0.3, -pr * 0.5);
    ctx.lineTo(-pr * 0.1, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Label pequeno no canto
  ctx.fillStyle = 'rgba(200,180,140,0.7)';
  ctx.font = `bold ${Math.max(7, tile * 0.12)}px system-ui`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('SR', x + tile * 0.05, y + tile * 0.04);
}

// 🔺 Spikes / Toxic Spikes — triângulos apontados para cima
function _drawSpikes(ctx, x, y, cx, cy, tile, count, colorFill, colorStroke) {
  const spacing = tile / (count + 1);
  const h = tile * 0.30;
  const base = tile * 0.18;

  for (let i = 0; i < count; i++) {
    const sx = x + spacing * (i + 1);
    const sy = cy + tile * 0.15;

    // Sombra
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + h * 0.15, base * 0.5, base * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Triângulo principal
    ctx.fillStyle = colorFill;
    ctx.strokeStyle = colorStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + base, sy);
    ctx.lineTo(sx - base, sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Brilho no triângulo
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(sx, sy - h);
    ctx.lineTo(sx + base * 0.4, sy - h * 0.4);
    ctx.lineTo(sx, sy - h * 0.5);
    ctx.closePath();
    ctx.fill();
  }
}

// 🕸️ Sticky Web — teia de aranha
function _drawStickyWeb(ctx, cx, cy, tile, t) {
  const r = tile * 0.38;
  const rings = 3;
  const spokes = 8;

  ctx.strokeStyle = 'rgba(200,200,200,0.55)';
  ctx.lineWidth = 0.8;

  // Raios (spokes)
  for (let s = 0; s < spokes; s++) {
    const ang = (s / spokes) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.stroke();
  }

  // Anéis concêntricos
  for (let ring = 1; ring <= rings; ring++) {
    const rr = r * (ring / rings);
    ctx.beginPath();
    for (let s = 0; s <= spokes; s++) {
      const ang = (s / spokes) * Math.PI * 2;
      const px = cx + Math.cos(ang) * rr;
      const py = cy + Math.sin(ang) * rr;
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Brilho central
  const pulse = 0.3 + Math.abs(Math.sin(t * 1.5)) * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220,220,220,${pulse})`;
  ctx.fill();
}

// 🔥 Fogo
function _drawFireCell(ctx, cx, cy, tile, t) {
  const flicker = Math.sin(t * 8) * tile * 0.02;
  ctx.fillStyle = 'rgba(255,80,0,0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // Chamas
  const flames = [
    { dx: 0,     h: 0.30, w: 0.12, color: 'rgba(255,200,0,0.8)'  },
    { dx: -0.12, h: 0.22, w: 0.09, color: 'rgba(255,120,0,0.7)'  },
    { dx:  0.12, h: 0.20, w: 0.09, color: 'rgba(255,60,0,0.7)'   },
  ];
  for (const f of flames) {
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(cx + f.dx * tile, cy + tile * 0.15);
    ctx.quadraticCurveTo(
      cx + (f.dx + 0.08) * tile,
      cy - (f.h * 0.5 + flicker * 0.5) * tile,
      cx + f.dx * tile,
      cy - (f.h + flicker) * tile
    );
    ctx.quadraticCurveTo(
      cx + (f.dx - 0.08) * tile,
      cy - (f.h * 0.5) * tile,
      cx + f.dx * tile,
      cy + tile * 0.15
    );
    ctx.fill();
  }
}

// 🧊 Gelo
function _drawIceCell(ctx, x, y, cx, cy, tile) {
  // Cristais de gelo nos cantos
  ctx.fillStyle = 'rgba(180,230,255,0.35)';
  ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);

  ctx.strokeStyle = 'rgba(150,210,255,0.6)';
  ctx.lineWidth = 1;

  // Cruz central (cristal)
  const arms = 4;
  const r = tile * 0.35;
  for (let a = 0; a < arms; a++) {
    const ang = (a / arms) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(ang) * r, cy - Math.sin(ang) * r);
    ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.stroke();

    // Ramificações
    const bLen = r * 0.35;
    for (const side of [-1, 1]) {
      const bAng = ang + side * Math.PI / 4;
      for (const frac of [0.4, 0.65]) {
        const bx = cx + Math.cos(ang) * r * frac;
        const by = cy + Math.sin(ang) * r * frac;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(bAng) * bLen, by + Math.sin(bAng) * bLen);
        ctx.stroke();
      }
    }
  }
}

// 💧 Água (onda)
function _drawWaterCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(60,130,200,0.20)';
  ctx.beginPath();
  ctx.arc(cx, cy, tile * 0.38, 0, Math.PI * 2);
  ctx.fill();

  // Onda animada
  ctx.strokeStyle = 'rgba(100,180,255,0.7)';
  ctx.lineWidth = 1.5;
  const waveW = tile * 0.6;
  const amp = tile * 0.06;
  const waveY = cy + Math.sin(t * 2) * tile * 0.04;
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const wx = cx - waveW / 2 + (i / 20) * waveW;
    const wy = waveY + Math.sin((i / 20) * Math.PI * 2 + t * 3) * amp;
    i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
  }
  ctx.stroke();
}

// ☁️ Nuvem
function _drawCloudCell(ctx, cx, cy, tile, t) {
  const drift = Math.sin(t * 0.8) * tile * 0.04;
  ctx.fillStyle = 'rgba(200,215,230,0.55)';

  const puffs = [
    { dx: 0,     dy: 0.04, r: 0.20 },
    { dx: -0.15, dy: 0.10, r: 0.14 },
    { dx:  0.16, dy: 0.10, r: 0.13 },
    { dx:  0.06, dy: 0.14, r: 0.12 },
    { dx: -0.06, dy: 0.14, r: 0.11 },
  ];
  for (const p of puffs) {
    ctx.beginPath();
    ctx.arc(cx + p.dx * tile + drift, cy + p.dy * tile, p.r * tile, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ⚡ Elétrico (célula)
function _drawElectricCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(255,230,0,0.18)';
  ctx.fillRect(cx - tile / 2, cy - tile / 2, tile, tile);

  // Raio central
  ctx.strokeStyle = `rgba(255,240,80,${0.6 + Math.sin(t * 6) * 0.3})`;
  ctx.lineWidth = 2;
  const bh = tile * 0.38;
  ctx.beginPath();
  ctx.moveTo(cx + tile * 0.05, cy - bh);
  ctx.lineTo(cx - tile * 0.06, cy - bh * 0.1);
  ctx.lineTo(cx + tile * 0.04, cy - bh * 0.1);
  ctx.lineTo(cx - tile * 0.05, cy + bh);
  ctx.stroke();
}

// ☀️ Sol (célula)
function _drawSunCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(255,220,0,0.18)';
  ctx.fillRect(cx - tile / 2, cy - tile / 2, tile, tile);

  const r = tile * 0.16;
  const rayLen = tile * 0.10;
  const rayCount = 8;
  ctx.strokeStyle = `rgba(255,200,0,${0.5 + Math.sin(t * 2) * 0.2})`;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < rayCount; i++) {
    const ang = (i / rayCount) * Math.PI * 2 + t * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    ctx.lineTo(cx + Math.cos(ang) * (r + rayLen), cy + Math.sin(ang) * (r + rayLen));
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,220,50,${0.6 + Math.sin(t * 2) * 0.2})`;
  ctx.fill();
}

// 🍃 Grama (célula)
function _drawGrassCell(ctx, cx, cy, tile, t) {
  ctx.fillStyle = 'rgba(50,180,80,0.15)';
  ctx.fillRect(cx - tile / 2, cy - tile / 2, tile, tile);

  const bladeCount = 5;
  ctx.strokeStyle = 'rgba(60,190,90,0.75)';
  ctx.lineWidth = 1.5;
  for (let b = 0; b < bladeCount; b++) {
    const bx = cx - tile * 0.3 + b * tile * (0.6 / (bladeCount - 1));
    const sway = Math.sin(t * 1.5 + b * 0.9) * tile * 0.07;
    ctx.beginPath();
    ctx.moveTo(bx, cy + tile * 0.22);
    ctx.quadraticCurveTo(bx + sway, cy - tile * 0.02, bx + sway * 1.3, cy - tile * 0.22);
    ctx.stroke();
  }
}


// =============================================================================
// INTEGRAÇÃO: Adicione estas duas chamadas dentro da função draw()
// no main.js, logo APÓS as linhas do grid e ANTES do loop de pieces.
//
// Encontre o trecho:
//   // grid lines
//   ...
//   // pieces
//
// E insira:
//   // efeitos de clima (overlay animado sobre o mapa)
//   drawWeatherOverlay(ctx, ox, oy, gs, tile, w, h);
//   // efeitos por célula (Spikes, Stealth Rock, etc.)
//   drawCellEffects(ctx, ox, oy, tile);
//
// =============================================================================
