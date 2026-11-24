/* Example configs written for this tool (not copied from TI's files). Each one is meant to teach something. */
(function (root) {
  "use strict";
  const OOB_TAIL = `multiObjBeamForming -1 1 0.5
clutterRemoval -1 1
calibDcRangeSig -1 0 -5 8 256
extendedMaxVelocity -1 0
lvdsStreamCfg -1 0 0 0
compRangeBiasAndRxChanPhase 0.0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0
measureRangeBiasAndRxChanPhase 0 1.5 0.2
CQRxSatMonitor 0 3 5 121 0
CQSigImgMonitor 0 127 4
analogMonitor 0 0
aoaFovCfg -1 -90 90 -90 90`;
  const PT_DSP = `dynamicRACfarCfg -1 4 4 2 2 8 12 4 12 3.00 8.00 0.40 1 1
staticRACfarCfg -1 6 2 2 2 8 8 6 4 8.00 15.00 0.30 0 0
dynamicRangeAngleCfg -1 0.75 0.0010 1 0
dynamic2DAngleCfg -1 1.5 0.0300 1 0 1 0.30 0.85 8.00
staticRangeAngleCfg -1 0 8 8
bpmCfg -1 0 0 1
antGeometry0 0 -1 -2 -3 -2 -3 -4 -5 -4 -5 -6 -7
antGeometry1 -1 -1 -1 -1 0 0 0 0 -1 -1 -1 -1
antPhaseRot 1 1 1 1 1 1 1 1 1 1 1 1
fovCfg -1 70.0 20.0
compRangeBiasAndRxChanPhase 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0`;
  const PT_HEAD = `sensorStop
flushCfg
dfeDataOutputMode 1
channelCfg 15 7 0
adcCfg 2 1
adcbufCfg -1 0 1 1 1
lowPower 0 0
profileCfg 0 60.75 30.00 7.00 40.00 0 0 60.00 1 128 4500.00 2 1 36
chirpCfg 0 0 0 0 0 0 0 1
chirpCfg 1 1 0 0 0 0 0 4
chirpCfg 2 2 0 0 0 0 0 2
frameCfg 0 2 64 0 55.00 1 0`;
  const PT_TRACK = `staticBoundaryBox -2.5 2.5 0.5 7 0 2.5
boundaryBox -3 3 0.5 7.5 0 2.5
sensorPosition 1.5 0 10
gatingParam 3 2 2 3 4
stateParam 3 3 12 500 5 6000
allocationParam 40 100 0.1 10 0.5 20
maxAcceleration 0.4 0.4 0.1
trackingCfg 1 2 800 20 46 96 55
presenceBoundaryBox -2.5 2.5 0.5 7 0 2.5`;

  root.MCL_PRESETS = [
    {
      id: "oob-fine", device: "xwr6843", name: "Out-of-box demo: 2D, 5 cm range resolution",
      text: `sensorStop
flushCfg
dfeDataOutputMode 1
channelCfg 15 5 0
adcCfg 2 1
adcbufCfg -1 0 1 1 1
lowPower 0 0
profileCfg 0 60.25 7 6 60 0 0 60 1 256 5000 0 0 30
chirpCfg 0 0 0 0 0 0 0 1
chirpCfg 1 1 0 0 0 0 0 4
frameCfg 0 1 32 0 100 1 0
guiMonitor -1 1 1 0 0 0 1
cfarCfg -1 0 2 8 4 3 0 15 1
cfarCfg -1 1 0 4 2 3 1 15 1
${OOB_TAIL}
cfarFovCfg -1 0 0 10
cfarFovCfg -1 1 -8 8
bpmCfg -1 0 0 1
calibData 0 0 0
sensorStart`,
    },
    {
      id: "oob-3d-heat", device: "xwr6843", name: "Out-of-box demo: 3D at 20 fps with a heatmap the UART cannot carry",
      text: `sensorStop
flushCfg
dfeDataOutputMode 1
channelCfg 15 7 0
adcCfg 2 1
adcbufCfg -1 0 1 1 1
lowPower 0 0
profileCfg 0 60.75 30 6 40 0 0 70 1 128 4000 0 0 30
chirpCfg 0 0 0 0 0 0 0 1
chirpCfg 1 1 0 0 0 0 0 4
chirpCfg 2 2 0 0 0 0 0 2
frameCfg 0 2 64 0 50 1 0
guiMonitor -1 1 1 0 0 1 1
cfarCfg -1 0 2 8 4 3 0 15 1
cfarCfg -1 1 0 4 2 3 1 15 1
${OOB_TAIL}
cfarFovCfg -1 0 0.25 8
cfarFovCfg -1 1 -5 5
bpmCfg -1 0 0 1
calibData 0 0 0
sensorStart`,
    },
    {
      id: "pt-wall", device: "xwr6843", name: "People tracking: wall mount, about 7 m",
      text: `${PT_HEAD}
${PT_DSP}
${PT_TRACK}
sensorStart`,
    },
    {
      id: "pt-mixed", device: "xwr6843", name: "Problem: lines from other firmware, mismatched tracker step",
      text: `${PT_HEAD.replace("frameCfg 0 2 64 0 55.00 1 0", "frameCfg 0 2 64 0 100.00 1 0")}
guiMonitor -1 1 1 0 0 0 1
${PT_DSP}
vitalsign 15 150
${PT_TRACK}
sensorStart`,
    },
    {
      id: "aliasing", device: "xwr6843", name: "Problem: long chirps, fast movers alias",
      text: `sensorStop
flushCfg
dfeDataOutputMode 1
channelCfg 15 7 0
adcCfg 2 1
adcbufCfg -1 0 1 1 1
lowPower 0 0
profileCfg 0 60.75 160 6 100 0 0 30 1 256 3000 0 0 30
chirpCfg 0 0 0 0 0 0 0 1
chirpCfg 1 1 0 0 0 0 0 4
chirpCfg 2 2 0 0 0 0 0 2
frameCfg 0 2 32 0 100 1 0
guiMonitor -1 1 0 0 0 0 0
cfarCfg -1 0 2 8 4 3 0 15 1
cfarCfg -1 1 0 4 2 3 1 15 1
${OOB_TAIL}
cfarFovCfg -1 0 0.25 20
cfarFovCfg -1 1 -2 2
bpmCfg -1 0 0 1
calibData 0 0 0
sensorStart`,
    },
  ];
})(typeof self !== "undefined" ? self : this);
