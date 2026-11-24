// Run: node tests/engine.test.js            (no dependencies)
// Optional: MCL_TI_CFG_DIRS="dir1;dir2" also checks every .cfg TI ships, which must produce zero REJECTs.
const fs = require("fs");
const path = require("path");
const M = require("../app/engine.js");
const { MCL_PRESETS } = require("../app/presets.js");

let fail = 0, pass = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log("  FAIL", msg); } }
const errs = (a) => a.issues.filter((i) => i.sev === "e");
const warns = (a) => a.issues.filter((i) => i.sev === "w");
const preset = (id) => MCL_PRESETS.find((p) => p.id === id).text;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// unknown demo -> generic mode, foreign commands become notes
{
  const t = preset("oob-fine").replace("sensorStart", "configRANSAC 1 2 3\nsensorStart");
  const a = M.analyze(t, {});
  ok(a.firmware === "generic", "unknown demo command switches auto-detect to generic, got " + a.firmware);
  ok(errs(a).length === 0, "generic mode does not reject demo-specific commands");
}

// examples behave as described
{
  const a = M.analyze(preset("pt-wall"), { device: "xwr6843" });
  ok(a.firmware === "pt", "pt-wall detected as people tracking");
  ok(errs(a).length === 0 && warns(a).length === 0, "pt-wall is clean: " + a.issues.map((i) => i.msg).join(" | "));
}
{
  const a = M.analyze(preset("oob-fine"), { device: "xwr6843" });
  ok(a.firmware === "oob", "oob-fine detected as out-of-box");
  ok(errs(a).length === 0, "oob-fine has no rejects: " + errs(a).map((i) => i.msg).join(" | "));
  ok(near(a.P.rangeRes, 0.0488, 0.001), "oob-fine range resolution ~4.9 cm, got " + a.P.rangeRes);
  ok(near(a.P.rMax, 12.49, 0.05), "oob-fine max range 12.5 m, got " + a.P.rMax);
  ok(a.P.virt === 8, "2 TX x 4 RX = 8 virtual antennas");
}
{
  const a = M.analyze(preset("oob-3d-heat"), { device: "xwr6843" });
  ok(warns(a).some((i) => /Output per frame/.test(i.msg)), "heatmap preset warns about the data port");
}
{
  const a = M.analyze(preset("pt-mixed"), { device: "xwr6843" });
  ok(errs(a).length === 2, "pt-mixed rejects guiMonitor and vitalsign, got " + errs(a).length);
  const dt = warns(a).find((i) => /deltaT/.test(i.msg));
  ok(dt && dt.fix, "pt-mixed flags deltaT with a fix");
  const fixed = M.analyze(M.applyOp(preset("pt-mixed"), dt.fix.op), { device: "xwr6843" });
  ok(!fixed.issues.some((i) => /deltaT/.test(i.msg)), "applying the fix clears the deltaT warning");
}
{
  const a = M.analyze(preset("aliasing"), { device: "xwr6843" });
  ok(a.P.vMax < 2, "aliasing preset max speed below 2 m/s, got " + a.P.vMax);
  const f = M.frame(a.P, [{ id: 1, type: "person", x: 0, y: 4, speed: 1.4, heading: 0, swing: 1.6 }], 0.3, () => 0.5, 15);
  ok(f.scat.some((s) => s.aliased), "fast limbs alias with this chirp");
}

// argument rules
{
  const t = preset("pt-wall").replace(/profileCfg .*/, "profileCfg 0 60.75 30 7 40 0 0 60 1 128 4500 2 1");
  ok(errs(M.analyze(t, {})).some((i) => /profileCfg/.test(i.msg)), "short profileCfg rejected");
}
{
  const t = preset("pt-wall").replace(/dynamic2DAngleCfg .*/, "dynamic2DAngleCfg -1 1.5 0.03 1 0 1 0.3");
  ok(errs(M.analyze(t, {})).some((i) => /dynamic2DAngleCfg/.test(i.msg)), "7-value dynamic2DAngleCfg rejected when method is 1");
  const t2 = t.replace("dynamicRangeAngleCfg -1 0.75 0.0010 1 0", "dynamicRangeAngleCfg -1 0.75 0.0010 2 0");
  ok(!errs(M.analyze(t2, {})).some((i) => /dynamic2DAngleCfg/.test(i.msg)), "7-value dynamic2DAngleCfg accepted when method is 2");
}
{
  const t = preset("pt-wall").replace(/frameCfg .*/, "frameCfg 0 2 64 0 10 1 0");
  ok(errs(M.analyze(t, {})).some((i) => /chirps take/.test(i.msg)), "frame shorter than the chirps rejected");
}
{
  const t = preset("oob-fine").replace("profileCfg 0 60.25", "profileCfg 0 59.5");
  ok(warns(M.analyze(t, { device: "xwr6843" })).some((i) => /enables the 57/.test(i.msg)), "chirp at 59.5 GHz warns on a 6843 (57-60 needs firmware support)");
  const t2 = preset("oob-fine").replace("profileCfg 0 60.25", "profileCfg 0 56");
  ok(errs(M.analyze(t2, { device: "xwr6843" })).some((i) => /only works inside/.test(i.msg)), "chirp at 56 GHz rejected on a 6843");
  const t3 = preset("oob-fine").replace("compRangeBiasAndRxChanPhase 0.0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0", "compRangeBiasAndRxChanPhase 0.0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0");
  ok(!errs(M.analyze(t3, { device: "xwr1642" })).some((i) => /compRange/.test(i.msg)), "17-value compRangeBias accepted on a 2-TX 1642");
  ok(errs(M.analyze(t3, { device: "xwr6843" })).some((i) => /compRange/.test(i.msg)), "17-value compRangeBias rejected on a 3-TX 6843");
  ok(warns(M.analyze(preset("oob-fine"), { device: "xwr6843", bandLo: 61, bandHi: 61.5 })).some((i) => /allowed/.test(i.msg)), "user band warning");
}

// scene sign convention: walking toward the radar = negative radial speed
{
  const a = M.analyze(preset("pt-wall"), {});
  const f = M.frame(a.P, [{ id: 1, type: "person", x: 0, y: 4, speed: 1.2, heading: 0, swing: 0 }], 0, () => 0.5, 15);
  const chest = f.scat[1];
  ok(chest.vr < -1 && chest.vr > -1.25, "approaching chest has negative radial speed, got " + chest.vr);
}

// TI's own sample configs must never be rejected
// TI files where our rule fires and we believe the file itself is inconsistent (unverified on hardware).
const KNOWN_TI = {
  "ODS_6m_default.cfg": /chirps take/,   // frameCfg asks for 512 loops x 3 chirps x 89.1 us = 137 ms inside a 55 ms frame
};
const dirs = (process.env.MCL_TI_CFG_DIRS || "").split(";").filter(Boolean);
let tiFiles = 0;
for (const d of dirs) {
  const walk = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).forEach((f) => walk(path.join(p, f))) : p.endsWith(".cfg") && check(p);
  const check = (p) => {
    const text = fs.readFileSync(p, "utf8");
    if (!/profileCfg/.test(text) || !/sensorStart/.test(text)) return;   // skip partial command files (idle power etc.)
    tiFiles++;
    const dev = /16xx|1642/i.test(p) ? "xwr1642" : /18xx|1843/i.test(p) ? "xwr1843" : /14xx|1443/i.test(p) ? "xwr1443" : "xwr6843";
    const a = M.analyze(text, { device: dev });
    const e = errs(a);
    const known = KNOWN_TI[path.basename(p)];
    if (e.length && known && e.every((i) => known.test(i.msg))) { console.log(`  note: ${path.basename(p)} - ${e[0].msg.replace(/<[^>]+>/g, "")} (known, see KNOWN_TI)`); pass++; return; }
    if (e.length) { fail++; console.log(`  TI cfg rejected (${a.firmware}): ${p}\n     ` + e.map((i) => `L${i.line == null ? "-" : i.line + 1} ${i.msg.replace(/<[^>]+>/g, "")}`).join("\n     ")); }
    else pass++;
  };
  if (fs.existsSync(d)) walk(d);
}
if (dirs.length) console.log(`checked ${tiFiles} TI sample configs`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
