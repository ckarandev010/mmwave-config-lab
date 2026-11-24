/* mmWave Config Lab - UI. Engine is in engine.js (window.MCL), examples in presets.js. */
(() => {
  "use strict";
  const M = window.MCL;
  const PRESETS = window.MCL_PRESETS;
  const $ = (id) => document.getElementById(id);
  const ta = $("cfg");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mcl-" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mcl-" + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };
  const desktop = () => window.pywebview && window.pywebview.api;

  /* ---------------- state ---------------- */
  let A = null;         // current analysis
  let baseP = null;     // physics of the loaded file / example, for "was" deltas
  let fileName = null;
  let nextId = 1;
  const sim = { playing: !window.matchMedia("(prefers-reduced-motion: reduce)").matches, t: 0, frame: null, history: [], spec: [], tracks: {} };
  let targets = [];

  function defaultScene() {
    nextId = 1;
    return [
      mk({ type: "person", x: 0.4, y: 6, speed: 1.3, heading: 0, swing: 1.6, height: 1.75 }),
      mk({ type: "fan", x: -1.4, y: 3, z: 1.8, rpm: 300, radius: 0.25, rcs: 0.3 }),
      mk({ type: "static", x: 1.6, y: 4, z: 0.8, rcs: 5 }),
    ];
  }
  function mk(t) {
    const d = { person: { z: 0, speed: 1.3, heading: 0, swing: 1.6, height: 1.75, rcs: 1 }, mover: { z: 1, speed: 3, heading: 0, rcs: 2 }, fan: { z: 1.8, rpm: 300, radius: 0.25, rcs: 0.3 }, static: { z: 0.8, rcs: 5 } }[t.type];
    const o = Object.assign({ id: nextId++, x: 0, y: 4 }, d, t);
    o.x0 = o.x; o.y0 = o.y;
    return o;
  }

  /* ---------------- analysis ---------------- */
  function opts() {
    return {
      firmware: $("firmware").value, device: $("device").value,
      bandLo: parseFloat($("bandLo").value), bandHi: parseFloat($("bandHi").value),
      baud: Number($("baud").value), mountH: parseFloat($("mountH").value), mountTilt: parseFloat($("mountTilt").value),
      expectedPoints: sim.frame ? Math.max(10, sim.frame.points.length) : 50,
    };
  }
  function update() {
    A = M.analyze(ta.value, opts());
    renderGutter(); renderIssues(); renderMetrics(); syncControls(); renderSetup();
    drawChirp();
    if (!sim.playing) { stepSim(0); drawAll(); }
    store.set("text", ta.value);
  }

  /* ---------------- setup panel ---------------- */
  function renderSetup() {
    const fwSel = $("firmware");
    const auto = fwSel.options[0];
    const det = M.FIRMWARE[A.firmware].name;
    auto.textContent = fwSel.value === "auto" ? `Auto: ${det}` : "Auto-detect";
    const fromCfg = A.P && A.P.mountFromCfg;
    $("mountH").disabled = !!fromCfg; $("mountTilt").disabled = !!fromCfg;
    $("mountNote").textContent = fromCfg ? `Mount comes from sensorPosition in the config (${A.P.h} m, ${A.P.elTilt}° down).` : "This firmware's config has no mount line, so set the height and tilt here.";
    $("fileName").textContent = fileName || "no file open";
  }

  /* ---------------- editor ---------------- */
  function renderGutter() {
    const sev = {};
    for (const it of A.issues) if (it.line != null) sev[it.line] = sev[it.line] === "e" || it.sev === "e" ? "e" : it.sev === "w" ? "w" : sev[it.line];
    $("gutter").innerHTML = A.lines.map((l) => `<span class="${sev[l.i] || ""}">${l.i + 1}</span>`).join("");
    $("lineCount").textContent = `${A.lines.filter((l) => !l.skip).length} commands`;
    $("gutter").scrollTop = ta.scrollTop;
  }
  ta.addEventListener("scroll", () => { $("gutter").scrollTop = ta.scrollTop; });
  function jumpTo(i) {
    if (i == null) return;
    const l = ta.value.split(/\r?\n/); let pos = 0;
    for (let k = 0; k < i; k++) pos += l[k].length + 1;
    ta.focus(); ta.setSelectionRange(pos, pos + l[i].length);
    ta.scrollTop = Math.max(0, i * 20 - 100);
  }
  function applyOp(op) { ta.value = M.applyOp(ta.value, op); update(); }

  function renderIssues() {
    const nE = A.issues.filter((x) => x.sev === "e").length, nW = A.issues.filter((x) => x.sev === "w").length;
    $("verdict").className = "verdict " + (nE ? "err" : nW ? "warn" : "ok");
    $("verdictText").textContent = nE ? `Radar would reject ${nE} thing${nE > 1 ? "s" : ""}` : nW ? `Accepted, with ${nW} warning${nW > 1 ? "s" : ""}` : "Radar would accept every line";
    const box = $("issues");
    if (!A.issues.length) { box.innerHTML = `<div class="issue i"><span class="tag">OK</span><div>Every line has the right command and argument count, and the chirp, frame and output settings agree.</div></div>`; return; }
    box.innerHTML = "";
    for (const it of A.issues) {
      const d = document.createElement("div");
      d.className = "issue " + it.sev; d.tabIndex = 0;
      const tag = it.sev === "e" ? "REJECT" : it.sev === "w" ? "WARN" : "NOTE";
      d.innerHTML = `<span class="tag">${tag}${it.line != null ? " L" + (it.line + 1) : ""}</span><div>${it.msg}${it.fix ? `<div class="fix"><button class="btn" type="button">${M.esc(it.fix.label)}</button></div>` : ""}</div>`;
      d.addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") applyOp(it.fix.op); else jumpTo(it.line); });
      d.addEventListener("keydown", (e) => { if (e.key === "Enter") jumpTo(it.line); });
      box.appendChild(d);
    }
  }

  function delta(cur, base, dg, unit, betterHigh) {
    if (base == null || !isFinite(base) || Math.abs(cur - base) < Math.pow(10, -dg) / 2) return { t: "", c: "" };
    const good = betterHigh == null ? null : (cur > base) === betterHigh;
    return { t: `was ${base.toFixed(dg)}${unit}`, c: good == null ? "" : good ? "up" : "down" };
  }
  function renderMetrics() {
    const P = A.P, el = $("metrics");
    if (!P) { el.innerHTML = `<div class="m" style="grid-column:1/-1"><div class="k">Physics</div><div class="d">Needs a valid profileCfg and frameCfg.</div></div>`; return; }
    const B = baseP || {};
    const rows = [
      ["Range resolution", P.rangeRes * 100, "cm", 1, B.rangeRes && B.rangeRes * 100, false, P.rangeRes > 0.2 ? "meh" : ""],
      ["Max range", P.rUse, "m", 1, B.rUse, true, ""],
      ["Max speed", P.vMax, "m/s", 2, B.vMax, true, P.vMax < 2 ? "meh" : ""],
      ["Speed resolution", P.vRes, "m/s", 2, B.vRes, false, ""],
      ["Frame rate", P.fps, "fps", 1, B.fps, true, ""],
      ["Chirp time / frame", P.activeMs, "ms", 1, B.activeMs, null, P.activeMs >= P.period ? "bad" : P.duty > 0.5 ? "meh" : ""],
      ["Angle resolution", P.azRes, "°", 0, B.azRes, false, ""],
      ["Output / frame", P.outBytesTypical / 1024, "KB", 1, B.outBytesTypical && B.outBytesTypical / 1024, false, P.outBytesTypical > P.uartBytes ? "bad" : ""],
    ];
    el.innerHTML = rows.map(([k, v, u, dg, b, hi, cls]) => {
      const d = delta(v, b, dg, " " + u, hi);
      let sub = d.t;
      if (!sub && k === "Angle resolution") sub = `${P.virt} virtual antennas`;
      if (!sub && k === "Output / frame") sub = `port carries ${(P.uartBytes / 1024).toFixed(1)} KB`;
      if (!sub && k === "Max range") sub = `${P.f0.toFixed(2)}–${P.fEnd.toFixed(2)} GHz`;
      return `<div class="m ${cls}"><div class="k">${k}</div><div class="v">${v.toFixed(dg)}<small>${u}</small></div><div class="d ${d.c}">${sub || "&nbsp;"}</div></div>`;
    }).join("");
  }

  /* ---------------- quick controls ---------------- */
  const setArg = (cmd, idx, val) => applyOp({ type: "setArg", cmd, idx, val });
  const getArg = (cmd, idx) => Number(M.getArg(ta.value, cmd, idx));
  const CTRLS = [
    { id: "c_period", label: "Frame period", unit: "ms", min: 20, max: 250, step: 5, get: () => getArg("frameCfg", 4), set: (v) => setArg("frameCfg", 4, String(v)), why: "frameCfg · how often a frame starts" },
    { id: "c_loops", label: "Chirp loops", unit: "", min: 8, max: 256, step: 8, get: () => getArg("frameCfg", 2), set: (v) => setArg("frameCfg", 2, String(v)), why: "frameCfg · finer speed, more memory" },
    { id: "c_idle", label: "Idle time", unit: "µs", min: 3, max: 300, step: 1, get: () => getArg("profileCfg", 2), set: (v) => setArg("profileCfg", 2, String(v)), why: "profileCfg · longer chirps lower max speed" },
    { id: "c_slope", label: "Slope", unit: "MHz/µs", min: 5, max: 250, step: 1, get: () => getArg("profileCfg", 7), set: (v) => setArg("profileCfg", 7, String(v)), why: "profileCfg · steeper = finer range, shorter reach" },
    { id: "c_adc", label: "ADC samples", unit: "", min: 32, max: 512, step: 8, get: () => getArg("profileCfg", 9), set: (v) => setArg("profileCfg", 9, String(v)), why: "profileCfg · must fit inside the ramp" },
    { id: "c_fs", label: "Sample rate", unit: "ksps", min: 1000, max: 12500, step: 50, get: () => getArg("profileCfg", 10), set: (v) => setArg("profileCfg", 10, String(v)), why: "profileCfg · higher = longer reach" },
    { id: "c_ramp", label: "Ramp end", unit: "µs", min: 10, max: 200, step: 1, get: () => getArg("profileCfg", 4), set: (v) => setArg("profileCfg", 4, String(v)), why: "profileCfg · sets the swept bandwidth" },
  ];
  function buildControls() {
    $("controls").innerHTML = CTRLS.map((c) => `<div class="ctl"><label for="${c.id}"><span>${c.label}</span><output id="${c.id}_o"></output></label><input type="range" id="${c.id}" min="${c.min}" max="${c.max}" step="${c.step}"><div class="why">${c.why}</div></div>`).join("");
    for (const c of CTRLS) $(c.id).addEventListener("input", (e) => { c.set(Number(e.target.value)); });
  }
  function syncControls() {
    for (const c of CTRLS) {
      const v = c.get(), inp = $(c.id), out = $(c.id + "_o");
      if (isFinite(v)) { if (document.activeElement !== inp) inp.value = v; out.textContent = `${v}${c.unit ? " " + c.unit : ""}`; inp.disabled = false; }
      else { out.textContent = "—"; inp.disabled = true; }
    }
  }

  /* ---------------- scene editor ---------------- */
  const FIELDS = {
    person: [["x", "x"], ["y", "y"], ["height", "height"], ["speed", "speed m/s"], ["heading", "heading °"], ["swing", "limb swing m/s"]],
    mover: [["x", "x"], ["y", "y"], ["z", "z"], ["speed", "speed m/s"], ["heading", "heading °"], ["rcs", "size m²"]],
    fan: [["x", "x"], ["y", "y"], ["z", "z"], ["rpm", "rpm"], ["radius", "blade m"], ["rcs", "size m²"]],
    static: [["x", "x"], ["y", "y"], ["z", "z"], ["rcs", "size m²"]],
  };
  const TYPE_NAME = { person: "Walking person", mover: "Moving object", fan: "Spinning fan", static: "Static object" };
  function renderScene() {
    const t = $("sceneTable");
    t.innerHTML = `<thead><tr><th>Target</th><th>Settings</th><th>Seen as</th><th></th></tr></thead><tbody>` + targets.map((T) =>
      `<tr data-id="${T.id}"><td class="ty">${TYPE_NAME[T.type]} ${T.id}</td><td><div class="row">${FIELDS[T.type].map(([k, lab]) =>
        `<label class="inline" for="t${T.id}_${k}">${lab}<input id="t${T.id}_${k}" data-k="${k}" type="number" step="0.1" value="${T[k]}"></label>`).join("")}</div></td><td class="stat" id="stat${T.id}">–</td><td><button class="btn icon" type="button" data-del="${T.id}" aria-label="Remove target ${T.id}">Remove</button></td></tr>`).join("") + "</tbody>";
    t.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
      const id = Number(inp.closest("tr").dataset.id), T = targets.find((x) => x.id === id), k = inp.dataset.k, v = parseFloat(inp.value);
      if (!T || !isFinite(v)) return;
      T[k] = v; if (k === "x") T.x0 = v; if (k === "y") T.y0 = v;
      saveScene(); if (!sim.playing) { stepSim(0); drawAll(); }
    }));
    t.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      targets = targets.filter((x) => x.id !== Number(b.dataset.del)); delete sim.tracks[b.dataset.del]; saveScene(); renderScene();
    }));
  }
  function saveScene() { store.set("scene", targets); }

  /* ---------------- simulation ---------------- */
  function stepSim(dtMs) {
    if (!A || !A.P) return;
    const P = A.P, dt = dtMs / 1000;
    sim.t += dt;
    const far = Math.max(10, P.rUse + 2);
    for (const T of targets) {
      if (T.type !== "person" && T.type !== "mover") continue;
      const hd = (T.heading || 0) * Math.PI / 180;
      T.x += -Math.sin(hd) * T.speed * dt; T.y += -Math.cos(hd) * T.speed * dt;
      if (T.y < 0.3 || T.y > far + 2 || Math.abs(T.x) > 8) { T.x = T.x0; T.y = T.y0; sim.tracks[T.id] = null; }
    }
    const refRange = Math.max(2, parseFloat($("refRange").value) || 15);
    sim.frame = M.frame(P, targets, sim.t, Math.random, refRange);
    if (dtMs > 0) {
      sim.history.push(sim.frame.scat); if (sim.history.length > 8) sim.history.shift();
      pushSpec(P);
      trackStep(P);
    }
  }
  function trackStep(P) {
    if (P.firmware !== "pt" || !P.trkOn) { sim.tracks = {}; return; }
    for (const T of targets) {
      if (T.type === "static") continue;
      const mine = sim.frame.points.filter((p) => p.id === T.id && p.inBox && !p.isStatic);
      let tr = sim.tracks[T.id] || { frames: 0, on: false, startY: null, x: 0, y: 0 };
      if (!tr.on) {
        tr.frames = mine.length >= P.allocPts ? tr.frames + 1 : 0;
        if (tr.frames >= P.det2act) { tr.on = true; tr.startY = T.y; }
      }
      if (tr.on && mine.length) {
        const cx = mine.reduce((a, p) => a + p.x, 0) / mine.length, cy = mine.reduce((a, p) => a + p.y, 0) / mine.length;
        tr.x = tr.x ? tr.x * 0.6 + cx * 0.4 : cx; tr.y = tr.y ? tr.y * 0.6 + cy * 0.4 : cy;
      }
      sim.tracks[T.id] = tr;
    }
  }
  function pushSpec(P) {
    const nb = Math.max(8, Math.min(256, Math.round(2 * P.vMax / P.vRes)));
    const col = new Float32Array(nb); let aliased = false;
    for (const s of sim.frame.scat) {
      if (!s.inFov || s.r > P.rMax || Math.abs(s.vr) < 1e-3) continue;
      if (s.aliased) aliased = true;
      const k = Math.min(nb - 1, Math.max(0, Math.floor((s.vrSeen + P.vMax) / (2 * P.vMax) * nb)));
      const amp = Math.pow(10, Math.min(4, s.snr) / 10);
      col[k] += amp; if (k > 0) col[k - 1] += amp * 0.3; if (k < nb - 1) col[k + 1] += amp * 0.3;
    }
    sim.spec.push({ col, nb, aliased }); if (sim.spec.length > 200) sim.spec.shift();
  }

  /* ---------------- drawing ---------------- */
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let fontK = 1;   // canvas pixels per CSS pixel, so labels read at ~11-13 px on screen
  const font = (px, mono) => `${Math.round(px * fontK)}px ${mono ? css("--f-mono") : css("--f-body")}`;
  function canvas(id) {
    const cv = $(id), ctx = cv.getContext("2d");
    const shown = cv.getBoundingClientRect().width;
    fontK = shown > 0 ? Math.min(2.2, Math.max(1, cv.width / shown)) : 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    return { ctx, W: cv.width, H: cv.height };
  }
  function drawAll() { drawRoom(); drawRD(); drawSide(); drawSpec(); renderSceneStatus(); }

  function sceneYMax(P) { return Math.max(7, Math.min(30, Math.max(P.rUse, ...targets.map((t) => t.y0 || t.y)) + 1)); }

  function drawRoom() {
    const { ctx, W, H } = canvas("room");
    const P = A && A.P; if (!P) return;
    const ymax = sceneYMax(P), xmax = Math.max(3, ymax * 0.55);
    const pad = 34, sc = Math.min((W - 2 * pad) / (2 * xmax), (H - 2 * pad) / ymax);
    const X = (x) => W / 2 + x * sc, Y = (y) => H - pad - y * sc;
    const step = ymax > 15 ? 5 : ymax > 8 ? 2 : 1;
    ctx.strokeStyle = css("--line"); ctx.fillStyle = css("--ink-3"); ctx.font = font(11, true); ctx.lineWidth = 1;
    for (let y = 0; y <= ymax; y += step) { ctx.beginPath(); ctx.moveTo(X(-xmax), Y(y)); ctx.lineTo(X(xmax), Y(y)); ctx.stroke(); ctx.fillText(y + " m", 4, Y(y) + 4); }
    ctx.save(); ctx.beginPath(); ctx.rect(X(-xmax), Y(ymax), 2 * xmax * sc, ymax * sc); ctx.clip();
    const a0 = (P.azMin + P.azTilt) * Math.PI / 180, a1 = (P.azMax + P.azTilt) * Math.PI / 180, R = P.rCfarMax ? Math.min(P.rUse, P.rCfarMax) : P.rUse;
    ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (let k = 0; k <= 40; k++) { const a = a0 + (a1 - a0) * k / 40; ctx.lineTo(X(R * Math.sin(a)), Y(R * Math.cos(a))); }
    ctx.closePath(); ctx.fillStyle = css("--beam"); ctx.fill(); ctx.strokeStyle = css("--beam-edge"); ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    if (P.rMin) { ctx.beginPath(); ctx.arc(X(0), Y(0), P.rMin * sc, Math.PI, 2 * Math.PI); ctx.strokeStyle = css("--beam-edge"); ctx.stroke(); }
    const box = (b, color, dash, label) => {
      if (!b) return; ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.lineWidth = 1.5;
      ctx.strokeRect(X(b[0]), Y(b[3]), (b[1] - b[0]) * sc, (b[3] - b[2]) * sc); ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.fillStyle = color; ctx.font = font(11, false); ctx.fillText(label, X(b[0]) + 4, Y(b[3]) + 13);
    };
    if (P.firmware === "pt") { box(P.bb, css("--accent"), [], "boundaryBox"); box(P.sbb, css("--ink-3"), [4, 3], "staticBoundaryBox"); }
    // targets
    for (const T of targets) {
      ctx.fillStyle = css("--body"); ctx.globalAlpha = 0.4;
      if (T.type === "person") { ctx.beginPath(); ctx.ellipse(X(T.x), Y(T.y), 0.25 * sc, 0.15 * sc, 0, 0, 7); ctx.fill(); }
      else if (T.type === "fan") { ctx.fillRect(X(T.x - T.radius), Y(T.y) - 3, 2 * T.radius * sc, 6); }
      else { ctx.beginPath(); ctx.arc(X(T.x), Y(T.y), 6, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.fillStyle = css("--ink-2"); ctx.font = font(11, true); ctx.fillText(String(T.id), X(T.x) + 8, Y(T.y) - 6);
    }
    for (const p of sim.frame ? sim.frame.points : []) {
      ctx.fillStyle = p.inBox && !p.isStatic ? css("--pt") : css("--pt-out");
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3, 0, 7); ctx.fill();
    }
    for (const id in sim.tracks) {
      const tr = sim.tracks[id]; if (!tr || !tr.on) continue;
      ctx.strokeStyle = css("--track"); ctx.lineWidth = 2; ctx.strokeRect(X(tr.x - 0.3), Y(tr.y + 0.3), 0.6 * sc, 0.6 * sc); ctx.lineWidth = 1;
      ctx.fillStyle = css("--track"); ctx.font = font(11, true); ctx.fillText(`track ${id}`, X(tr.x + 0.34), Y(tr.y));
      if (tr.startY) { ctx.setLineDash([6, 4]); ctx.strokeStyle = css("--track"); ctx.beginPath(); ctx.moveTo(X(-xmax), Y(tr.startY)); ctx.lineTo(X(xmax), Y(tr.startY)); ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.restore();
    ctx.fillStyle = css("--ink"); ctx.fillRect(X(-xmax), Y(0), 2 * xmax * sc, 2);
    ctx.fillStyle = css("--accent"); ctx.fillRect(X(0) - 9, Y(0) - 6, 18, 8);
    ctx.fillStyle = css("--ink-2"); ctx.font = font(11, true);
    ctx.fillText(`reach ${R.toFixed(1)} m · azimuth ${P.azMin}° to ${P.azMax}°`, X(-xmax) + 4, 14);
    const pts = sim.frame ? sim.frame.points : [];
    const trk = Object.entries(sim.tracks).filter(([, t]) => t && t.on).map(([id, t]) => `${id} from ${t.startY ? t.startY.toFixed(1) : "?"} m`).join(", ");
    $("roomReadout").innerHTML = `<span>points this frame <b>${pts.length}</b></span>` + (P.firmware === "pt" && P.trkOn ? `<span>a track needs <b>${P.allocPts}</b> points for <b>${P.det2act}</b> frames</span><span>tracks <b>${trk || "none"}</b></span>` : `<span>clutter removal <b>${P.clutterRemoval ? "on" : "off"}</b></span>`);
  }

  function drawRD() {
    const { ctx, W, H } = canvas("rd");
    const P = A && A.P; if (!P) return;
    const padL = 48, padB = 26, padT = 10, w = W - padL - 10, h = H - padB - padT;
    const X = (r) => padL + (r / P.rMax) * w, Y = (v) => padT + h / 2 - (v / P.vMax) * (h / 2);
    ctx.fillStyle = css("--panel"); ctx.fillRect(padL, padT, w, h);
    // cell grid when cells are big enough to see
    const cw = (P.rangeBin / P.rMax) * w, chh = (P.vRes / P.vMax) * (h / 2);
    if (cw > 5 && chh > 5) {
      ctx.strokeStyle = css("--line"); ctx.lineWidth = 0.5;
      for (let x = padL; x <= padL + w; x += cw) { ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + h); ctx.stroke(); }
      for (let y = padT + h / 2; y >= padT; y -= chh) { ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke(); }
      for (let y = padT + h / 2; y <= padT + h; y += chh) { ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke(); }
      ctx.lineWidth = 1;
    }
    if (P.firmware === "oob") {
      ctx.fillStyle = css("--beam");
      const r0 = P.rMin || 0, r1 = P.rCfarMax || P.rUse, v0 = P.vCfarMin !== undefined ? Math.max(-P.vMax, P.vCfarMin) : -P.vMax, v1 = P.vCfarMax !== undefined ? Math.min(P.vMax, P.vCfarMax) : P.vMax;
      ctx.fillRect(X(r0), Y(v1), X(Math.min(r1, P.rMax)) - X(r0), Y(v0) - Y(v1));
    }
    const hist = sim.history.length ? sim.history : sim.frame ? [sim.frame.scat] : [];
    hist.forEach((scat, hi) => {
      const age = (hist.length - 1 - hi) / Math.max(1, hist.length);
      for (const s of scat) {
        if (!s.inFov || s.r > P.rMax) continue;
        const stat = Math.abs(s.vr) < 1e-3;
        ctx.globalAlpha = (1 - age) * Math.max(0.15, Math.min(1, (s.snr + 6) / 14)) * (stat && P.clutterRemoval ? 0.2 : 1);
        ctx.fillStyle = s.aliased ? css("--alias") : stat ? css("--pt-out") : css("--pt");
        ctx.fillRect(X(s.r) - Math.max(2, cw / 2), Y(s.vrSeen) - Math.max(2, chh / 2), Math.max(4, cw), Math.max(4, chh));
      }
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css("--ink-3"); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + w, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = css("--line"); ctx.strokeRect(padL, padT, w, h);
    ctx.fillStyle = css("--ink-2"); ctx.font = font(11, true);
    ctx.fillText(`+${P.vMax.toFixed(1)}`, 4, padT + 10); ctx.fillText("0", 30, Y(0) + 4); ctx.fillText(`−${P.vMax.toFixed(1)}`, 4, padT + h);
    ctx.fillText("0 m", padL, H - 8); ctx.textAlign = "right"; ctx.fillText(`${P.rMax.toFixed(1)} m   range →`, padL + w, H - 8); ctx.textAlign = "left";
    ctx.fillText("m/s", 6, Y(0) + 18);
    const al = (sim.frame ? sim.frame.scat : []).some((s) => s.inFov && s.aliased && s.r <= P.rMax);
    $("rdNote").innerHTML = al
      ? `<div class="callout alias">Pink cells move faster than ±${P.vMax.toFixed(2)} m/s, so they show up at the wrong speed (aliasing). Shorten the idle or ramp time, or use fewer TX per loop.</div>`
      : `<div class="callout">Each cell is ${(P.rangeBin * 100).toFixed(1)} cm × ${P.vRes.toFixed(2)} m/s. Grey = not moving${P.firmware === "oob" ? (P.clutterRemoval ? " (removed by clutterRemoval)" : "") : ""}; positive speed = moving away.${P.firmware === "oob" ? " The shaded area is the cfarFovCfg window." : ""}</div>`;
  }

  function drawSide() {
    const { ctx, W, H } = canvas("side");
    const P = A && A.P; if (!P) return;
    const ymax = sceneYMax(P), zmax = Math.max(3.2, P.h + 0.6), pad = 26;
    const sc = Math.min((W - 2 * pad) / ymax, (H - 2 * pad) / zmax);
    const X = (y) => pad + y * sc, Z = (z) => H - pad - z * sc;
    const step = ymax > 15 ? 5 : ymax > 8 ? 2 : 1;
    ctx.strokeStyle = css("--line"); ctx.fillStyle = css("--ink-3"); ctx.font = font(11, true);
    for (let y = 0; y <= ymax; y += step) { ctx.beginPath(); ctx.moveTo(X(y), Z(0)); ctx.lineTo(X(y), Z(zmax)); ctx.stroke(); if (y) ctx.fillText(String(y), X(y) - 3, H - 8); }
    for (let z = 1; z <= zmax; z++) ctx.fillText(z + " m", 2, Z(z) + 4);
    ctx.fillStyle = css("--ink"); ctx.fillRect(X(0), Z(0), ymax * sc, 2);
    const t = P.elTilt * Math.PI / 180, e0 = P.elMin * Math.PI / 180, e1 = P.elMax * Math.PI / 180, R = P.rUse;
    ctx.save(); ctx.beginPath(); ctx.rect(X(0), Z(zmax), ymax * sc, zmax * sc); ctx.clip();
    ctx.beginPath(); ctx.moveTo(X(0), Z(P.h));
    for (let k = 0; k <= 30; k++) { const ang = -t + e0 + (e1 - e0) * k / 30; ctx.lineTo(X(R * Math.cos(ang)), Z(P.h + R * Math.sin(ang))); }
    ctx.closePath(); ctx.fillStyle = css("--beam"); ctx.fill(); ctx.strokeStyle = css("--beam-edge"); ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    if (P.firmware === "pt" && P.bb) { ctx.strokeStyle = css("--accent"); ctx.lineWidth = 1.5; ctx.strokeRect(X(P.bb[2]), Z(P.bb[5]), (P.bb[3] - P.bb[2]) * sc, (P.bb[5] - P.bb[4]) * sc); ctx.lineWidth = 1; }
    const scat = sim.frame ? sim.frame.scat : [];
    for (const s of scat) { ctx.fillStyle = s.inFov ? css("--pt") : css("--pt-out"); ctx.beginPath(); ctx.arc(X(s.y), Z(s.z), 3.5, 0, 7); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = css("--accent"); ctx.fillRect(X(0) - 2, Z(P.h) - 7, 8, 14);
    ctx.fillStyle = css("--ink-2"); ctx.font = font(11, true);
    ctx.fillText(`radar ${P.h} m up, ${P.elTilt}° down, elevation ${P.elMin}° to ${P.elMax}° · grey = outside the beam`, pad, 14);
  }

  function drawSpec() {
    const { ctx, W, H } = canvas("spec");
    const P = A && A.P; if (!P) return;
    const padL = 46, padB = 20, padT = 8, w = W - padL - 8, h = H - padB - padT;
    ctx.fillStyle = css("--panel"); ctx.fillRect(padL, padT, w, h);
    const n = 200, cw = w / n, acc = css("--pt"), al = css("--alias");
    sim.spec.forEach((c, i) => {
      let mx = 1e-9; for (const v of c.col) mx = Math.max(mx, v);
      const rh = h / c.nb;
      for (let k = 0; k < c.nb; k++) {
        const lvl = Math.max(0, 1 + Math.log10(c.col[k] / mx + 1e-6) / 2.5);
        if (lvl <= 0.03) continue;
        ctx.globalAlpha = lvl; ctx.fillStyle = c.aliased ? al : acc;
        ctx.fillRect(padL + (n - sim.spec.length + i) * cw, padT + h - (k + 1) * rh, cw + 0.6, rh + 0.6);
      }
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css("--ink-3"); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, padT + h / 2); ctx.lineTo(padL + w, padT + h / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = css("--ink-2"); ctx.font = font(11, true);
    ctx.fillText(`+${P.vMax.toFixed(1)}`, 4, padT + 10); ctx.fillText("0", 30, padT + h / 2 + 4); ctx.fillText(`−${P.vMax.toFixed(1)}`, 4, padT + h);
    ctx.fillText(`m/s · newest frame on the right · ${(n / P.fps).toFixed(0)} s shown`, padL, H - 4);
    const recent = sim.spec.slice(-20).some((c) => c.aliased);
    $("specNote").innerHTML = recent
      ? `<div class="callout alias">Pink columns contain motion faster than ±${P.vMax.toFixed(2)} m/s that wraps around (aliasing).</div>`
      : `<div class="callout">Walking shows as a body line plus limb curves that swing once per step; a fan shows as a band that fills ±(blade tip speed). Zero-speed reflectors are left out.</div>`;
  }

  function drawChirp() {
    const { ctx, W, H } = canvas("chirp");
    const P = A && A.P;
    if (!P) { ctx.fillStyle = css("--ink-3"); ctx.font = font(13, false); ctx.fillText("Needs a valid profileCfg and frameCfg.", 16, 30); return; }
    const top = 22, fh = 120, padL = 74, w = W - padL - 20;
    const loopW = w * 0.6, sx = loopW / P.loopUs;
    const fY = (g) => top + fh - ((g - P.f0) / Math.max(0.01, P.bwRamp)) * fh;
    ctx.font = font(11, true); ctx.fillStyle = css("--ink-3");
    ctx.fillText(`${P.fEnd.toFixed(2)} GHz`, 4, top + 4); ctx.fillText(`${P.f0.toFixed(2)} GHz`, 4, top + fh + 4);
    for (let i = 0; i < P.nTx; i++) {
      const t0 = padL + i * P.chirpUs * sx, rs = t0 + P.idle * sx, re = rs + P.rampEnd * sx;
      ctx.fillStyle = css("--panel"); ctx.fillRect(t0, top, P.idle * sx, fh);
      ctx.fillStyle = css("--accent-soft"); ctx.fillRect(rs + P.adcStart * sx, top, Math.max(1, P.sampleUs * sx), fh);
      ctx.strokeStyle = css("--accent"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(t0, fY(P.f0)); ctx.lineTo(rs, fY(P.f0)); ctx.lineTo(re, fY(P.fEnd)); ctx.lineTo(re, fY(P.f0)); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = css("--ink-2"); ctx.fillText(`chirp ${P.chirpStart + i}`, rs + 2, top + fh + 14);
    }
    ctx.fillStyle = css("--ink-2"); ctx.font = font(12, false);
    [`One loop = ${P.nTx} chirp${P.nTx > 1 ? "s" : ""} × ${P.chirpUs.toFixed(0)} µs = ${P.loopUs.toFixed(0)} µs`,
      `idle ${P.idle} µs (plain) · ramp ${P.rampEnd} µs`,
      `ADC ${P.nAdc} samples in ${P.sampleUs.toFixed(2)} µs (shaded)`,
      `slope ${P.slope} MHz/µs · ${(P.bwSampled * 1000).toFixed(0)} MHz sampled`,
      `${P.nRx} RX × ${P.nTx} TX = ${P.virt} virtual antennas`].forEach((s, k) => ctx.fillText(s, padL + loopW + 16, top + 12 + k * 20));
    const by = top + fh + 44, bh = 26;
    ctx.fillStyle = css("--panel"); ctx.fillRect(padL, by, w, bh);
    const aw = Math.min(1, P.activeMs / P.period) * w;
    ctx.fillStyle = P.activeMs >= P.period ? css("--err") : css("--accent"); ctx.fillRect(padL, by, aw, bh);
    ctx.strokeStyle = css("--line"); ctx.strokeRect(padL, by, w, bh);
    ctx.fillStyle = css("--ink-3"); ctx.font = font(11, true); ctx.fillText("frame", 4, by + 17);
    ctx.fillStyle = css("--ink-2"); ctx.font = font(12, false);
    ctx.fillText(`${P.loops} loops of chirps: ${P.activeMs.toFixed(1)} ms`, padL + Math.min(aw + 8, w - 260), by + bh + 18);
    ctx.textAlign = "right"; ctx.fillText(`frame period ${P.period} ms (${P.fps.toFixed(1)} fps) · ${Math.max(0, P.period - P.activeMs).toFixed(1)} ms left for processing and output`, padL + w, by - 6); ctx.textAlign = "left";
  }

  function renderSceneStatus() {
    const P = A && A.P; if (!P || !sim.frame) return;
    for (const T of targets) {
      const el = $("stat" + T.id); if (!el) continue;
      const mine = sim.frame.scat.filter((s) => s.id === T.id);
      const vis = mine.filter((s) => s.inFov && s.inRange);
      if (!vis.length) { el.textContent = mine.some((s) => s.inFov) ? "out of range" : "outside the beam"; continue; }
      const r = vis.reduce((a, s) => a + s.r, 0) / vis.length;
      const al = vis.some((s) => s.aliased);
      const pts = sim.frame.points.filter((p) => p.id === T.id).length;
      el.textContent = `${r.toFixed(1)} m · ${pts} pts${al ? " · aliased" : ""}`;
    }
  }

  /* ---------------- loop ---------------- */
  let last = performance.now(), acc = 0;
  function tick(now) {
    const dt = Math.min(250, now - last); last = now;
    if (sim.playing && A && A.P) {
      acc += dt; let n = 0;
      while (acc >= A.P.period && n < 4) { stepSim(A.P.period); acc -= A.P.period; n++; }
      if (acc > A.P.period * 4) acc = 0;
      if (n) drawAll();
    }
    requestAnimationFrame(tick);
  }

  /* ---------------- files ---------------- */
  function loadText(text, name) {
    ta.value = text; fileName = name || null;
    const a = M.analyze(text, Object.assign(opts(), { firmware: $("firmware").value }));
    baseP = a.P; update();
  }
  $("openBtn").addEventListener("click", async () => {
    if (desktop()) {
      const r = await window.pywebview.api.open_cfg();
      if (r && r.text != null) loadText(r.text, r.name);
    } else $("fileInput").click();
  });
  $("fileInput").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => loadText(String(rd.result), f.name); rd.readAsText(f); e.target.value = "";
  });
  $("saveBtn").addEventListener("click", async () => {
    const name = fileName || "radar.cfg";
    if (desktop()) {
      const r = await window.pywebview.api.save_cfg(ta.value, name);
      if (r && r.name) { fileName = r.name; renderSetup(); flash(`Saved ${r.name}`); }
      return;
    }
    const blob = new Blob([ta.value.replace(/\n/g, "\r\n")], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $("copyBtn").addEventListener("click", () => {
    try { navigator.clipboard.writeText(ta.value).then(() => flash("Copied"), () => { ta.select(); flash("Selected: press Ctrl+C"); }); }
    catch (e) { ta.select(); flash("Selected: press Ctrl+C"); }
  });
  function flash(msg) { const v = $("verdictText"), old = v.textContent; v.textContent = msg; setTimeout(() => { if (v.textContent === msg) renderIssues(); }, 1500); }
  const dz = $("dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => loadText(String(rd.result), f.name); rd.readAsText(f);
  });

  /* ---------------- wire up ---------------- */
  $("preset").innerHTML = `<option value="">Choose an example…</option>` + PRESETS.map((p) => `<option value="${p.id}">${M.esc(p.name)}</option>`).join("");
  $("firmware").innerHTML = `<option value="auto">Auto-detect</option>` + Object.entries(M.FIRMWARE).map(([k, f]) => `<option value="${k}">${M.esc(f.name)}</option>`).join("");
  $("device").innerHTML = Object.entries(M.DEVICES).map(([k, d]) => `<option value="${k}">${M.esc(d.name)}</option>`).join("");
  function setDevice(id, keepBand) {
    $("device").value = id; const d = M.DEVICES[id];
    if (!keepBand) { $("bandLo").value = d.bandLo; $("bandHi").value = d.bandHi; }
  }
  $("preset").addEventListener("change", () => {
    const p = PRESETS.find((x) => x.id === $("preset").value); if (!p) return;
    setDevice(p.device); $("firmware").value = "auto"; sim.spec = []; sim.history = []; sim.tracks = {};
    loadText(p.text, null);
  });
  $("device").addEventListener("change", () => { setDevice($("device").value); store.set("device", $("device").value); update(); });
  ["firmware", "bandLo", "bandHi", "baud", "mountH", "mountTilt"].forEach((id) => $(id).addEventListener("input", () => { store.set(id, $(id).value); update(); }));
  let deb = null;
  ta.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(update, 120); });
  $("addBtn").addEventListener("click", () => {
    const type = $("addType").value;
    const T = mk({ type, x: type === "mover" ? -1 : 0.5, y: type === "mover" ? 8 : 3, heading: type === "mover" ? -10 : 0 });
    targets.push(T); saveScene(); renderScene();
  });
  $("refRange").addEventListener("input", () => { if (!sim.playing) { stepSim(0); drawAll(); } });
  $("playBtn").addEventListener("click", () => { sim.playing = !sim.playing; $("playBtn").textContent = sim.playing ? "Pause" : "Play"; });
  $("playBtn").textContent = sim.playing ? "Pause" : "Play";
  buildControls();

  // restore
  setDevice(store.get("device", "xwr6843"));
  for (const id of ["firmware", "bandLo", "bandHi", "baud", "mountH", "mountTilt"]) { const v = store.get(id, null); if (v !== null) $(id).value = v; }
  const savedScene = store.get("scene", null);
  if (Array.isArray(savedScene) && savedScene.length) { targets = savedScene; nextId = Math.max(...targets.map((t) => t.id)) + 1; } else targets = defaultScene();
  renderScene();
  const savedText = store.get("text", null);
  if (savedText) loadText(savedText, null);
  else { $("preset").value = PRESETS[2].id; setDevice(PRESETS[2].device); loadText(PRESETS[2].text, null); }
  for (let i = 0; i < 30 && A && A.P; i++) stepSim(A.P.period);
  drawAll();
  const redraw = () => { drawChirp(); drawAll(); };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  requestAnimationFrame(tick);
})();
