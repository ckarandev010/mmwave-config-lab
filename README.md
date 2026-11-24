# mmWave Config Lab

See what a TI mmWave radar config does **before** you flash it.

Paste or open a `.cfg` and get:

- **What the radar will say.** Every line is checked against the firmware's own argument
  rules. A wrong value count or a command the firmware doesn't have is flagged with the line
  number, the same way the radar would answer "Invalid usage" or "not recognized".
- **What the chirp can measure.** Range resolution, max range, max speed, speed resolution,
  frame rate, angle resolution, and whether the output fits through the UART each frame.
- **What a scene looks like to it.** A simulated room with walking people, moving objects,
  spinning fans and static clutter, drawn four ways: from above (field of view, detections,
  tracks), range–Doppler, side view (height, tilt, elevation beam) and Doppler over time
  (micro-Doppler, with aliasing shown in pink).
- **What a change does.** Sliders rewrite the config lines, and every number shows what it
  was before.

Runs as a Windows app (`mmWaveConfigLab.exe`) or as a plain web page (`app/index.html`). No
install, no network, no telemetry.

## Supported

| Firmware | Rules taken from |
|---|---|
| Out-of-box demo | mmWave SDK 3.6 `utils/cli/src/cli_mmwave.c`, `demo/xwr68xx/mmw/mss/mmw_cli.c` |
| 3D People Tracking | Radar Toolbox `People_Tracking/3D_People_Tracking/src/6843/mss` |
| Other TI demos | common sensor commands only; demo-specific lines are listed but not checked |

Devices: IWR/AWR6843, 1843, 1642, 1443 (mmWave SDK 3.x parts). Device limits live in
`app/engine.js` (`DEVICES`); correct them there if your datasheet says otherwise.

Every sample config TI ships for these two firmwares passes the checker, with one exception.
TI's `ODS_6m_default.cfg` asks for 512 loops × 3 chirps × 89.1 µs = 137 ms of chirps inside
a 55 ms frame. We believe that file is inconsistent, but it has not been checked on hardware.

**Not covered:** AWR2944 / MCU+ SDK, cascade (2- and 4-chip) boards, L-series (IWRL6432/6844),
advanced-frame physics, `extendedMaxVelocity` unfolding.

## What the simulation is (and isn't)

The line checker and the chirp numbers are exact: the same formulas and rules the firmware
uses. The scene is a simplified model. Each target is a handful of point reflectors. A
reflector is detected with a probability that falls with range to the fourth power, and
its points are snapped to the radar's range and speed cells. It shows the direction a change
pushes things (closer tracks, aliased limbs, a smaller field of view), not exact point counts.
Set "1 m² target detectable to" to match your hardware.

## Run

- **Windows app:** download `mmWaveConfigLab.exe` from Releases and double-click it.
  It needs the Edge WebView2 runtime, which Windows 10/11 already include.
- **Browser:** open `app/index.html`.

## Build

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1    # -> dist\mmWaveConfigLab.exe
```

Needs Python 3.10+ and Node (for the tests). The build runs the tests first.

## Test

```
node tests/engine.test.js
```

Add `MCL_TI_CFG_DIRS="<sdk>/packages/ti/demo;<toolbox>/.../3D_People_Tracking"` to also run
every TI sample config through the checker. None of them should be rejected.

## Layout

```
app/engine.js     parsing, argument rules, FMCW physics, scene model (no DOM; runs in Node)
app/app.js        UI and drawing
app/presets.js    example configs written for this tool
desktop/          native window (pywebview) + icon
tests/            engine tests
```

Not affiliated with or endorsed by Texas Instruments. TI, mmWave and xWR are TI's names, used
here only to say which hardware this works with.
