/*
 * mmWave Config Lab - engine
 * Parses a TI mmWave CLI config, checks it against the firmware's own argument rules,
 * derives the chirp physics and simulates a simple scene. No DOM access: runs in the
 * browser (window.MCL) and in Node (require) for tests.
 *
 * Argument rules were read from:
 *   - mmWave SDK 3.6 utils/cli/src/cli_mmwave.c          (common sensor commands)
 *   - mmWave SDK 3.6 demo/xwr68xx/mmw/mss/mmw_cli.c       (out-of-box demo)
 *   - Radar Toolbox 3D People Tracking 6843 mss/*.c       (people tracking demo)
 * argc counts the command word itself, exactly as the C code does.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MCL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const C = 299792458;

  /* ---------------- devices ---------------- */
  // Limits are datasheet values as we understand them; edit here if your part differs.
  const DEVICES = {
    // 57-60 GHz works only with firmware that enables it (TI ships a 57-61 GHz example), so it is a warning, not a reject
    xwr6843: { name: "IWR6843 / AWR6843 (60-64 GHz)", bandLo: 60, bandHi: 64, hardLo: 57, maxFsKsps: 12500, nTx: 3, nRx: 4 },
    xwr1843: { name: "IWR1843 / AWR1843 (76-81 GHz)", bandLo: 76, bandHi: 81, maxFsKsps: 12500, nTx: 3, nRx: 4 },
    xwr1642: { name: "IWR1642 / AWR1642 (76-81 GHz)", bandLo: 76, bandHi: 81, maxFsKsps: 12500, nTx: 2, nRx: 4 },
    xwr1443: { name: "IWR1443 / AWR1443 (76-81 GHz)", bandLo: 76, bandHi: 81, maxFsKsps: 12500, nTx: 3, nRx: 4 },
  };

  /* ---------------- command tables ---------------- */
  const COMMON = {
    sensorStop: [1, 2], flushCfg: [1], version: [1], sensorStart: [1, 2],
    dfeDataOutputMode: [2], channelCfg: [4], adcCfg: [3], profileCfg: [15], chirpCfg: [9], frameCfg: [8],
    advFrameCfg: [6], subFrameCfg: [11], lowPower: [3], contModeCfg: [10], bpmCfgAdvanced: [4],
  };
  const OOB = Object.assign({}, COMMON, {
    guiMonitor: [8], cfarCfg: [10], multiObjBeamForming: [4], calibDcRangeSig: [6], clutterRemoval: [3],
    adcbufCfg: [6], compRangeBiasAndRxChanPhase: "comp", measureRangeBiasAndRxChanPhase: [4], aoaFovCfg: [6],
    cfarFovCfg: [5], extendedMaxVelocity: [3], bpmCfg: [5], CQRxSatMonitor: [6], CQSigImgMonitor: [4],
    analogMonitor: [3], lvdsStreamCfg: [5], configDataPort: [3], queryDemoStatus: [1], calibData: [4],
    idlePowerCycle: [11], idlePowerDown: [11],
  });
  const PT = Object.assign({}, COMMON, {
    sensorStop: [1], sensorStart: [1, 2], resetDevice: [1],
    dynamicRACfarCfg: [15], staticRACfarCfg: [15], dynamicRangeAngleCfg: [6], dynamic2DAngleCfg: "dyn2d",
    dopplerCfarCfg: [7], staticRangeAngleCfg: [5], fineMotionCfg: [6], fovCfg: [4],
    antGeometry0: [13], antGeometry1: [13], antPhaseRot: [13], adcbufCfg: [6], bpmCfg: [5],
    compRangeBiasAndRxChanPhase: "comp", trackingCfg: "tracking", staticBoundaryBox: [7], boundaryBox: [7, 13],
    sensorPosition: [4], gatingParam: [6], stateParam: [7], allocationParam: [7], maxAcceleration: [4],
    presenceBoundaryBox: [7],
  });
  delete PT.advFrameCfg; delete PT.subFrameCfg; delete PT.contModeCfg; delete PT.bpmCfgAdvanced;
  const FIRMWARE = {
    oob: { name: "Out-of-box demo (mmWave SDK 3.x)", table: OOB, required: ["channelCfg", "adcCfg", "profileCfg", "chirpCfg", "frameCfg", "sensorStart"] },
    pt: { name: "3D People Tracking (Radar Toolbox)", table: PT, required: ["channelCfg", "adcCfg", "profileCfg", "chirpCfg", "frameCfg", "fovCfg", "boundaryBox", "sensorPosition", "trackingCfg", "allocationParam", "stateParam", "sensorStart"] },
    generic: { name: "Other TI demo (common commands only)", table: COMMON, lenient: true, required: ["channelCfg", "adcCfg", "profileCfg", "chirpCfg", "frameCfg", "sensorStart"] },
  };
  const ELSEWHERE = {
    pmicCfg: "an L-series (IWRL6844) SDK command",
    vitalsign: "from TI's vital signs lab", VSRangeIdxCfg: "from TI's vital signs lab",
    trackingCfg: "a people-tracking command", boundaryBox: "a people-tracking command", sensorPosition: "a people-tracking command",
    guiMonitor: "an out-of-box demo command", cfarCfg: "an out-of-box demo command", clutterRemoval: "an out-of-box demo command",
    aoaFovCfg: "an out-of-box demo command", cfarFovCfg: "an out-of-box demo command", multiObjBeamForming: "an out-of-box demo command",
    calibDcRangeSig: "an out-of-box demo command", extendedMaxVelocity: "an out-of-box demo command", lvdsStreamCfg: "an out-of-box demo command",
    fovCfg: "a people-tracking command", dynamicRACfarCfg: "a people-tracking command", staticRACfarCfg: "a people-tracking command",
  };

  /* ---------------- helpers ---------------- */
  const num = (x) => (x === undefined ? NaN : Number(x));
  const popcount = (n) => { let c = 0; n = n >>> 0; while (n) { c += n & 1; n >>>= 1; } return c; };
  const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function parse(text) {
    return String(text).split(/\r?\n/).map((raw, i) => {
      const s = raw.replace(/%.*$/, "").trim();
      if (!s || s.startsWith("#") || s.startsWith("//")) return { i, raw, skip: true };
      const t = s.split(/\s+/);
      return { i, raw, cmd: t[0], args: t.slice(1), argc: t.length };
    });
  }

  function detectFirmware(lines) {
    const cmds = new Set(lines.filter((l) => !l.skip).map((l) => l.cmd));
    const pt = ["trackingCfg", "boundaryBox", "sensorPosition", "fovCfg", "dynamicRACfarCfg", "allocationParam"].filter((c) => cmds.has(c)).length;
    const oob = ["guiMonitor", "cfarCfg", "clutterRemoval", "aoaFovCfg", "cfarFovCfg", "multiObjBeamForming"].filter((c) => cmds.has(c)).length;
    // commands neither demo knows and we have no story for: probably another TI demo
    const foreign = [...cmds].filter((c) => OOB[c] === undefined && PT[c] === undefined && ELSEWHERE[c] === undefined);
    if (foreign.length) return "generic";
    return pt > oob ? "pt" : "oob";
  }

  /* ---------------- line checks ---------------- */
  function check(lines, firmwareId, deviceId) {
    const fw = FIRMWARE[firmwareId];
    const dev = DEVICES[deviceId] || DEVICES.xwr6843;
    const issues = [];
    const add = (sev, line, msg, fix) => issues.push({ sev, line, msg, fix: fix || null });
    const cfg = { chirps: [], cfarFov: [], cfar: [] };
    let rangeAngleMethod = 1;
    for (const L of lines) {
      if (L.skip) continue;
      const rule = fw.table[L.cmd];
      if (rule === undefined && fw.lenient) {
        add("i", L.i, `<b>${esc(L.cmd)}</b> is specific to the demo you are running, so it is not checked here.`);
        continue;
      }
      if (rule === undefined) {
        const where = ELSEWHERE[L.cmd];
        add("e", L.i, `<b>${esc(L.cmd)}</b> is not a command in the ${fw.name} firmware${where ? ` (it is ${where})` : ""}. The radar answers that it is not recognized.`, { label: "Delete line", op: { type: "deleteLine", line: L.i } });
        continue;
      }
      if (rule === "tracking") {
        const on = num(L.args[0]) === 1;
        if (on && L.argc < 8) add("e", L.i, `<b>trackingCfg</b> needs at least 7 values when the tracker is on; this line has ${L.argc - 1}.`);
        else if (on) {
          const ps = num(L.args[1]);
          if (!(Number.isInteger(ps) && ps >= 0 && ps <= 4)) add("e", L.i, `<b>trackingCfg</b> parameter set ${esc(L.args[1])} is unknown (0 default, 1 traffic, 2 people counting, 3 outdoor, 4 ceiling).`);
        }
      } else if (rule === "dyn2d") {
        const want = rangeAngleMethod <= 1 ? 10 : 8;
        if (L.argc !== want) add("e", L.i, `<b>dynamic2DAngleCfg</b> needs ${want - 1} values because <code>dynamicRangeAngleCfg</code> selects detection method ${rangeAngleMethod}; this line has ${L.argc - 1}.`);
      } else if (rule === "comp") {
        const want = 2 + 2 * dev.nTx * dev.nRx;   // range bias + one (re, im) pair per TX x RX channel
        if (L.argc !== want) add("e", L.i, `<b>compRangeBiasAndRxChanPhase</b> needs ${want - 1} values on a ${dev.nTx}-TX, ${dev.nRx}-RX device (range bias plus a real/imaginary pair per channel); this line has ${L.argc - 1}.`);
      } else if (!rule.includes(L.argc)) {
        const want = rule.map((a) => a - 1).join(" or ");
        if (fw.lenient) { add("i", L.i, `<b>${esc(L.cmd)}</b> has ${L.argc - 1} values; mmWave SDK 3.x expects ${want}. Newer SDKs differ, so check your demo's documentation.`); continue; }
        add("e", L.i, `<b>${esc(L.cmd)}</b> needs ${want} value${want === "1" ? "" : "s"}; this line has ${L.argc - 1}. The radar answers "Invalid usage".`);
      }
      if (L.cmd === "dynamicRangeAngleCfg") rangeAngleMethod = num(L.args[3]);
      if (L.cmd === "chirpCfg") cfg.chirps.push(L);
      else if (L.cmd === "cfarFovCfg") cfg.cfarFov.push(L);
      else if (L.cmd === "cfarCfg") cfg.cfar.push(L);
      else cfg[L.cmd] = L;
    }
    const real = lines.filter((l) => !l.skip);
    if (real.length) {
      if (real[0].cmd !== "sensorStop") add("w", real[0].i, `Start with <b>sensorStop</b> so a running radar stops before it is reconfigured.`);
      if (!real.some((l) => l.cmd === "flushCfg")) add("w", real[0].i, `No <b>flushCfg</b>: settings from the previous config can carry over.`);
      const last = real[real.length - 1];
      if (last.cmd !== "sensorStart") add("e", last.i, `The last line should be <b>sensorStart</b>; lines after it are not applied until the next start.`);
    } else add("e", null, "The config is empty.");
    for (const r of fw.required) {
      const have = r === "chirpCfg" ? cfg.chirps.length > 0 : r === "frameCfg" ? !!(cfg.frameCfg || cfg.advFrameCfg) : !!cfg[r];
      if (!have) add("e", null, `Missing <b>${r}</b>. sensorStart will fail with "Full configuration must be provided".`);
    }
    return { issues, cfg };
  }

  /* ---------------- physics ---------------- */
  function physics(cfg, issues, opts) {
    opts = opts || {};
    const dev = DEVICES[opts.device || "xwr6843"];
    const bandLo = opts.bandLo != null ? opts.bandLo : dev.bandLo;
    const bandHi = opts.bandHi != null ? opts.bandHi : dev.bandHi;
    const fwId = opts.firmware || "oob";
    const add = (sev, line, msg, fix) => issues.push({ sev, line, msg, fix: fix || null });
    const pr = cfg.profileCfg, fr = cfg.frameCfg;
    if (!fr && cfg.advFrameCfg) add("i", cfg.advFrameCfg.i, "This config uses advanced frames (advFrameCfg). Line checks still apply, but the physics views need a plain frameCfg.");
    if (!pr || pr.argc !== 15 || !fr || fr.argc !== 8) return null;
    const a = pr.args.map(Number), f = fr.args.map(Number);
    const P = { firmware: fwId, device: dev };
    P.f0 = a[1]; P.idle = a[2]; P.adcStart = a[3]; P.rampEnd = a[4]; P.slope = a[7]; P.nAdc = a[9]; P.fs = a[10];
    P.chirpStart = f[0]; P.chirpEnd = f[1]; P.loops = f[2]; P.period = f[4];
    const ch = cfg.channelCfg;
    P.rxMask = ch ? num(ch.args[0]) : 15; P.txMask = ch ? num(ch.args[1]) : 7;
    const adc = cfg.adcCfg; P.adcFmt = adc ? num(adc.args[1]) : 1;    // 0 real, 1 complex 1x, 2 complex 2x
    P.nTx = Math.max(1, P.chirpEnd - P.chirpStart + 1);
    P.nRx = popcount(P.rxMask);
    P.virt = P.nTx * P.nRx;
    P.sampleUs = P.nAdc / (P.fs / 1000);
    P.bwSampled = P.slope * P.sampleUs / 1000;
    P.bwRamp = P.slope * P.rampEnd / 1000;
    P.fEnd = P.f0 + P.bwRamp;
    P.fc = P.f0 + P.slope * (P.adcStart + P.sampleUs / 2) / 1000;
    P.lambda = C / (P.fc * 1e9);
    P.rangeRes = C / (2 * P.bwSampled * 1e9);
    const ifBw = P.adcFmt === 0 ? (P.fs * 1e3) / 2 : P.fs * 1e3;            // usable IF bandwidth, Hz
    P.nRangeBins = P.adcFmt === 0 ? nextPow2(P.nAdc) / 2 : nextPow2(P.nAdc);
    P.rMax = ifBw * C / (2 * P.slope * 1e12);
    P.rangeBin = P.rMax / P.nRangeBins;
    P.rUse = 0.9 * P.rMax;
    P.chirpUs = P.idle + P.rampEnd;
    P.loopUs = P.chirpUs * P.nTx;
    P.vMax = P.lambda / (4 * P.loopUs * 1e-6);
    P.vRes = P.lambda / (2 * P.loops * P.loopUs * 1e-6);
    P.nDopplerBins = nextPow2(P.loops);
    P.activeMs = P.loops * P.loopUs / 1000;
    P.fps = 1000 / P.period;
    P.duty = P.activeMs / P.period;
    P.cubeKB = P.nRangeBins * P.loops * P.virt * 4 / 1024;
    // antennas: TX bit 1 is the elevation-offset TX on 3-TX boards
    const txOf = cfg.chirps.map((c) => num(c.args[7]));
    const azTx = txOf.filter((m) => m & 5).length || 1;
    P.azEl = cfg.antGeometry0 ? new Set(cfg.antGeometry0.args.map(Number)).size : P.nRx * azTx;
    P.elEl = cfg.antGeometry1 ? new Set(cfg.antGeometry1.args.map(Number)).size : (txOf.some((m) => m & 2) ? 2 : 1);
    P.azRes = (2 / Math.max(1, P.azEl)) * 180 / Math.PI;
    P.elRes = P.elEl > 1 ? (2 / P.elEl) * 180 / Math.PI : null;
    // field of view and mount
    P.mountFromCfg = false;
    if (fwId === "pt") {
      const fov = cfg.fovCfg;
      P.azMin = -(fov ? num(fov.args[1]) : 70); P.azMax = -P.azMin;
      P.elMin = -(fov ? num(fov.args[2]) : 20); P.elMax = -P.elMin;
      const sp = cfg.sensorPosition;
      if (sp) { P.h = num(sp.args[0]); P.azTilt = num(sp.args[1]); P.elTilt = num(sp.args[2]); P.mountFromCfg = true; }
    } else {
      const ao = cfg.aoaFovCfg;
      P.azMin = ao ? num(ao.args[1]) : -90; P.azMax = ao ? num(ao.args[2]) : 90;
      P.elMin = ao ? num(ao.args[3]) : -90; P.elMax = ao ? num(ao.args[4]) : 90;
      P.rMin = 0;
      for (const c of cfg.cfarFov) {
        if (num(c.args[1]) === 0) { P.rMin = num(c.args[2]); P.rCfarMax = num(c.args[3]); }
        if (num(c.args[1]) === 1) { P.vCfarMin = num(c.args[2]); P.vCfarMax = num(c.args[3]); }
      }
      P.clutterRemoval = cfg.clutterRemoval ? num(cfg.clutterRemoval.args[1]) === 1 : false;
      P.extVel = cfg.extendedMaxVelocity ? num(cfg.extendedMaxVelocity.args[1]) === 1 : false;
    }
    if (!P.mountFromCfg) { P.h = opts.mountH != null ? opts.mountH : 1; P.azTilt = 0; P.elTilt = opts.mountTilt != null ? opts.mountTilt : 0; }
    const box = (L) => (L ? L.args.slice(0, 6).map(Number) : null);
    P.bb = box(cfg.boundaryBox); P.sbb = box(cfg.staticBoundaryBox);
    const tc = cfg.trackingCfg ? cfg.trackingCfg.args.map(Number) : [];
    P.trkOn = fwId === "pt" && tc[0] === 1; P.maxPts = tc[2] || 0; P.maxTracks = tc[3] || 0; P.trkVmax = (tc[4] || 0) * 0.1; P.deltaT = tc[6] || 0;
    const al = cfg.allocationParam ? cfg.allocationParam.args.map(Number) : [];
    P.allocPts = al[3] || 1;
    const st = cfg.stateParam ? cfg.stateParam.args.map(Number) : [];
    P.det2act = st[0] || 1;
    // data port budget
    P.baud = opts.baud || 921600;
    P.uartBytes = P.baud / 10 * P.period / 1000;
    if (fwId === "pt") {
      const pts = opts.expectedPoints || 50;
      P.outBytesWorst = 48 + P.maxPts * 8 + P.maxTracks * 120;
      P.outBytesTypical = 48 + pts * 8 + Math.min(P.maxTracks, 5) * 120;
      P.outLabel = `${pts} points + a few tracks`;
      P.outLabelWorst = `${P.maxPts} points + ${P.maxTracks} tracks, the trackingCfg limits`;
    } else {
      const g = cfg.guiMonitor ? cfg.guiMonitor.args.map(Number) : [-1, 1, 0, 0, 0, 0, 0];
      const pts = opts.expectedPoints || 50;
      let b = 40;
      const parts = [];
      if (g[1]) { b += 8 + pts * 20; parts.push(`${pts} points`); }
      if (g[2]) { b += 8 + P.nRangeBins * 2; parts.push("range profile"); }
      if (g[3]) { b += 8 + P.nRangeBins * 2; parts.push("noise profile"); }
      if (g[4]) { b += 8 + P.nRangeBins * P.virt * 4; parts.push("range-azimuth heatmap"); }
      if (g[5]) { b += 8 + P.nRangeBins * P.loops * 2; parts.push("range-Doppler heatmap"); }
      if (g[6]) { b += 8 + 24; parts.push("stats"); }
      P.outBytesWorst = b; P.outBytesTypical = b; P.outLabel = parts.join(" + ") || "nothing";
    }

    const ln = (n) => (cfg[n] ? cfg[n].i : null);
    if (P.adcStart + P.sampleUs > P.rampEnd) add("e", ln("profileCfg"), `ADC sampling (${P.adcStart} + ${P.sampleUs.toFixed(2)} µs) runs past the ramp end (${P.rampEnd} µs). The profile is rejected.`);
    else if (P.rampEnd - (P.adcStart + P.sampleUs) < 0.5) add("i", ln("profileCfg"), `ADC sampling ends ${(P.rampEnd - P.adcStart - P.sampleUs).toFixed(2)} µs before the ramp ends. Legal, but tight.`);
    const hardLo = dev.hardLo != null ? dev.hardLo : dev.bandLo;
    if (P.f0 >= hardLo && P.f0 < dev.bandLo && P.fEnd <= dev.bandHi) add("w", ln("profileCfg"), `The chirp starts at ${P.f0.toFixed(2)} GHz. Below ${dev.bandLo} GHz only works with firmware that enables the ${hardLo}–${dev.bandLo} GHz range, and regulations differ there.`);
    else if (P.f0 < dev.bandLo || P.fEnd > dev.bandHi) add("e", ln("profileCfg"), `The chirp spans ${P.f0.toFixed(2)}–${P.fEnd.toFixed(2)} GHz; the ${dev.name.split(" (")[0]} only works inside ${dev.bandLo}–${dev.bandHi} GHz.`);
    else if (P.f0 < bandLo - 1e-6 || P.fEnd > bandHi + 1e-6) add("w", ln("profileCfg"), `The chirp spans ${P.f0.toFixed(2)}–${P.fEnd.toFixed(2)} GHz, outside the ${bandLo}–${bandHi} GHz band you set as allowed.`);
    if (P.fs > dev.maxFsKsps) add("e", ln("profileCfg"), `Sample rate ${P.fs} ksps is above the ${dev.maxFsKsps} ksps this device supports.`);
    if (P.nAdc > 1024) add("e", ln("profileCfg"), `${P.nAdc} ADC samples per chirp is more than the demo's range FFT supports.`);
    if (P.activeMs >= P.period) add("e", ln("frameCfg"), `The chirps take ${P.activeMs.toFixed(1)} ms but the frame is only ${P.period} ms. sensorStart fails.`);
    else if (P.duty > 0.5) add("w", ln("frameCfg"), `Chirps fill ${(P.duty * 100).toFixed(0)}% of the frame, leaving ${(P.period - P.activeMs).toFixed(1)} ms for processing and output.`);
    if (cfg.channelCfg && P.nRx === 0) add("e", ln("channelCfg"), "channelCfg enables no receive antennas.");
    for (const c of cfg.chirps) {
      const m = num(c.args[7]);
      if ((m & ~P.txMask) !== 0) add("e", c.i, `chirpCfg uses TX mask ${m}, but channelCfg only enables TX mask ${P.txMask}.`);
    }
    if (cfg.dfeDataOutputMode && num(cfg.dfeDataOutputMode.args[0]) === 3) add("i", ln("dfeDataOutputMode"), "Advanced frame mode: this tool models the first profile and frameCfg only.");
    const portKB = (P.uartBytes / 1024).toFixed(1), baudTxt = P.baud.toLocaleString("en-US");
    if (P.outBytesTypical > P.uartBytes) add("w", fwId === "pt" ? ln("trackingCfg") : ln("guiMonitor"), `Output per frame (${P.outLabel}, about ${(P.outBytesTypical / 1024).toFixed(1)} KB) is more than the ${portKB} KB a ${baudTxt}-baud port can send in ${P.period} ms. Frames will back up or drop.`);
    else if (P.outBytesWorst > P.uartBytes) add("i", ln("trackingCfg"), `A crowded frame (${P.outLabelWorst}, about ${(P.outBytesWorst / 1024).toFixed(1)} KB) would not fit the ${portKB} KB a ${baudTxt}-baud port sends in ${P.period} ms. Normal scenes are far smaller.`);
    if (fwId === "pt") {
      if (P.trkOn && P.deltaT && Math.abs(P.deltaT - P.period) > 0.5) add("w", ln("trackingCfg"), `trackingCfg deltaT is ${P.deltaT} ms but frames arrive every ${P.period} ms, so the tracker predicts motion with the wrong time step.`, { label: `Set deltaT to ${Math.round(P.period)}`, op: { type: "setArg", cmd: "trackingCfg", idx: 6, val: String(Math.round(P.period)) } });
      if (P.trkOn && P.trkVmax > P.vMax + 0.05) add("i", ln("trackingCfg"), `Tracker max speed ${P.trkVmax.toFixed(1)} m/s is above what the chirp measures without aliasing (±${P.vMax.toFixed(1)} m/s).`);
      if (P.elTilt > 45) add("w", ln("sensorPosition"), `A ${P.elTilt}° down-tilt is a ceiling mount. The wall build expects a wall mount; use TI's overhead people-tracking image.`);
      if (cfg.sensorPosition && !Number.isInteger(P.elTilt)) add("i", ln("sensorPosition"), `The firmware reads the tilt with <code>atoi</code> in one place, so ${P.elTilt}° becomes ${Math.trunc(P.elTilt)}° there. Use whole degrees.`);
      if (P.bb && P.bb[3] > P.rUse) add("w", ln("boundaryBox"), `The tracking zone reaches ${P.bb[3]} m but this chirp only sees about ${P.rUse.toFixed(1)} m.`);
      const inside = (i, o) => i && o && i[0] >= o[0] - 1e-6 && i[1] <= o[1] + 1e-6 && i[2] >= o[2] - 1e-6 && i[3] <= o[3] + 1e-6;
      if (P.sbb && P.bb && !inside(P.sbb, P.bb)) add("w", ln("staticBoundaryBox"), "staticBoundaryBox sticks out of boundaryBox, so a track can be kept where it could never be created.");
    } else {
      if (P.rCfarMax && P.rCfarMax > P.rUse) add("i", cfg.cfarFov.length ? cfg.cfarFov[0].i : null, `cfarFovCfg allows detections out to ${P.rCfarMax} m but this chirp only reaches about ${P.rUse.toFixed(1)} m.`);
      if (P.vCfarMax && P.vCfarMax > P.vMax + 0.01 && !P.extVel) add("i", cfg.cfarFov.length ? cfg.cfarFov[cfg.cfarFov.length - 1].i : null, `cfarFovCfg allows ±${P.vCfarMax} m/s but the chirp only measures ±${P.vMax.toFixed(2)} m/s.`);
      if (P.extVel) add("i", ln("extendedMaxVelocity"), "extendedMaxVelocity is on: the demo can unfold speeds up to about twice the max shown here. This tool does not model that.");
    }
    return P;
  }

  /* ---------------- scene ---------------- */
  // Targets: person (walking, with limbs), mover (point with constant velocity), fan (rotating blades), static.
  // Coordinates: radar at x=0,y=0 looking along +y; z up from the floor. Positive radial speed = moving away.
  function scatterers(t, T) {
    const out = [];
    if (T.type === "person") {
      const sp = T.speed, hd = (T.heading || 0) * Math.PI / 180;          // heading 0 = toward the radar
      const ux = -Math.sin(hd), uy = -Math.cos(hd);
      const ph = 2 * Math.PI * (sp / 0.75) * 0.5 * t, s = Math.sin(ph), sw = T.swing != null ? T.swing : 1.6;
      const parts = [[1.65, 0, 0, 0.5], [1.35, 0, 0, 1], [1.05, 0, 0, 1], [1.1, -0.22, -0.45 * s, 0.35], [1.1, 0.22, 0.45 * s, 0.35],
        [0.5, -0.1, 0.6 * s, 0.6], [0.5, 0.1, -0.6 * s, 0.6], [0.08, -0.1, Math.max(0, s), 0.3], [0.08, 0.1, Math.max(0, -s), 0.3]];
      for (const [z, side, k, rcs] of parts) {
        const v = sp + sw * k;
        out.push({ x: T.x + side * -uy, y: T.y + side * ux, z: z * (T.height || 1.75) / 1.75, vx: ux * v, vy: uy * v, vz: 0, rcs: rcs * (T.rcs || 1), id: T.id });
      }
    } else if (T.type === "mover") {
      const hd = (T.heading || 0) * Math.PI / 180, ux = -Math.sin(hd), uy = -Math.cos(hd);
      out.push({ x: T.x, y: T.y, z: T.z, vx: ux * T.speed, vy: uy * T.speed, vz: 0, rcs: T.rcs || 1, id: T.id });
    } else if (T.type === "fan") {
      const w = 2 * Math.PI * (T.rpm || 600) / 60, R = T.radius || 0.2;
      for (let b = 0; b < 3; b++) {
        const a = w * t + b * 2 * Math.PI / 3;
        // blades spin in the x-z plane facing the radar; their pitch gives a small speed along y too
        out.push({ x: T.x + R * Math.cos(a), y: T.y, z: T.z + R * Math.sin(a), vx: -R * w * Math.sin(a), vy: 0.35 * R * w * Math.cos(a), vz: R * w * Math.cos(a), rcs: T.rcs || 0.3, id: T.id });
      }
    } else {
      out.push({ x: T.x, y: T.y, z: T.z, vx: 0, vy: 0, vz: 0, rcs: T.rcs || 5, id: T.id });
    }
    return out;
  }

  function wrap(v, m) { return ((((v + m) % (2 * m)) + 2 * m) % (2 * m)) - m; }

  // One frame. rng: function returning uniform [0,1). refRange: m at which a 1 m^2 target sits at the detection threshold.
  function frame(P, targets, t, rng, refRange) {
    rng = rng || Math.random;
    const g = () => { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const azT = P.azTilt * Math.PI / 180, elT = P.elTilt * Math.PI / 180;
    const gain = 10 * Math.log10(Math.max(1, P.loops * P.virt * P.nAdc) / (64 * 12 * 128));
    const scat = [], points = [];
    for (const T of targets) for (const s of scatterers(t, T)) {
      const dx = s.x, dy = s.y, dz = s.z - P.h;
      const r = Math.hypot(dx, dy, dz);
      const vr = r > 1e-6 ? (dx * s.vx + dy * s.vy + dz * s.vz) / r : 0;
      const az = Math.atan2(dx, dy) * 180 / Math.PI - P.azTilt;
      const el = Math.atan2(dz, Math.hypot(dx, dy)) * 180 / Math.PI + P.elTilt;   // + tilt points the beam down
      const inFov = dy > 0 && az >= P.azMin && az <= P.azMax && el >= P.elMin && el <= P.elMax;
      const inRange = r <= P.rUse && r >= (P.rMin || 0) && (!P.rCfarMax || r <= P.rCfarMax);
      const snr = 10 * Math.log10(s.rcs) - 40 * Math.log10(r / refRange) + gain;
      const e = { ...s, r, vr, vrSeen: wrap(vr, P.vMax), aliased: Math.abs(vr) > P.vMax, az, el, inFov, inRange, snr };
      scat.push(e);
      if (!inFov || !inRange) continue;
      const pDet = Math.min(0.97, Math.max(0, (snr + 4) / 8));
      const nTry = 1 + Math.round(10 / Math.max(1, r));   // nearer reflectors span more range/angle cells, so more points
      for (let k = 0; k < nTry; k++) {
        if (rng() > pDet) continue;
        const vq = Math.round(e.vrSeen / P.vRes) * P.vRes;
        const isStatic = Math.abs(vq) < P.vRes * 0.5;
        if (isStatic && P.firmware === "oob" && P.clutterRemoval) continue;
        if (P.firmware === "oob" && P.vCfarMax !== undefined && (vq < P.vCfarMin || vq > P.vCfarMax)) continue;
        const rq = Math.round((r + g() * P.rangeRes * 0.3) / P.rangeBin) * P.rangeBin;
        const azm = (Math.atan2(dx, dy) + g() * (P.azRes * Math.PI / 180) * 0.18 + azT * 0);
        const hr = Math.sqrt(Math.max(0, rq * rq - dz * dz));
        const px = hr * Math.sin(azm), py = hr * Math.cos(azm);
        const inBox = P.bb ? px >= P.bb[0] && px <= P.bb[1] && py >= P.bb[2] && py <= P.bb[3] && s.z >= P.bb[4] && s.z <= P.bb[5] : true;
        points.push({ x: px, y: py, z: s.z, r: rq, v: vq, isStatic, inBox, id: s.id });
      }
    }
    const cap = P.firmware === "pt" && P.maxPts ? P.maxPts : 1000;
    return { scat, points: points.slice(0, cap) };
  }

  /* ---------------- edits ---------------- */
  function applyOp(text, op) {
    const l = String(text).split(/\r?\n/);
    if (op.type === "deleteLine") { l.splice(op.line, 1); return l.join("\n"); }
    if (op.type === "setArg") {
      const k = l.findIndex((s) => s.trim().split(/\s+/)[0] === op.cmd);
      if (k < 0) return text;
      const t = l[k].trim().split(/\s+/);
      while (t.length <= op.idx + 1) t.push("0");
      t[op.idx + 1] = op.val;
      l[k] = t.join(" ");
      return l.join("\n");
    }
    return text;
  }
  function getArg(text, cmd, idx) {
    const s = String(text).split(/\r?\n/).find((x) => x.trim().split(/\s+/)[0] === cmd);
    return s ? s.trim().split(/\s+/)[idx + 1] : undefined;
  }

  /* convenience: everything in one call */
  function analyze(text, opts) {
    opts = opts || {};
    const lines = parse(text);
    const firmware = opts.firmware && opts.firmware !== "auto" ? opts.firmware : detectFirmware(lines);
    const { issues, cfg } = check(lines, firmware, opts.device);
    const P = physics(cfg, issues, Object.assign({}, opts, { firmware }));
    const order = { e: 0, w: 1, i: 2 };
    issues.sort((a, b) => order[a.sev] - order[b.sev] || (a.line == null ? -1 : a.line) - (b.line == null ? -1 : b.line));
    return { lines, firmware, issues, cfg, P };
  }

  return { DEVICES, FIRMWARE, parse, detectFirmware, check, physics, analyze, frame, scatterers, applyOp, getArg, wrap, esc };
});
