// Generates Kotlin from the JS source of truth: PresetLibrary.kt + parity vectors.
const fs = require('fs'), path = require('path');
global.window = global; global.document = undefined;
const E = require('../engine/motion-engine.js');
const P = require('../engine/presets.js');
require('../demos/scenes.js');
const SCENES = global.SCENES;

const kv = v => typeof v === 'number' ? `V.Num(${num(v)})` : /^-\$/.test(v) ? `V.Ref("${v.slice(2)}", -1.0)` : `V.Ref("${v.slice(1)}", 1.0)`;
const num = v => { const s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; };
const map = o => `mapOf(${Object.entries(o || {}).map(([k, v]) => `"${k}" to ${kv(v)}`).join(', ')})`;
let kt = `package nayroz.motion\n\n// GENERATED from engine/presets.js — do not edit by hand.\nobject PresetLibrary {\n  val all: Map<String, Preset> = listOf(\n`;
for (const [id, p] of Object.entries(P)) {
  const parts = [`"${id}"`, `Phase.${p.phase.toUpperCase()}`];
  parts.push(`duration = ${num(p.duration || 0)}`);
  if (p.ease) parts.push(`ease = "${p.ease}"`);
  if (p.from) parts.push(`from = ${map(p.from)}`);
  if (p.to) parts.push(`to = ${map(p.to)}`);
  if (p.keyframes) parts.push(`keyframes = listOf(${p.keyframes.map(k => `Keyframe(${num(k.t)}, ${map(k.props)}${k.ease ? `, "${k.ease}"` : ''})`).join(', ')})`);
  if (p.loop) parts.push(`loop = LoopSpec(${num(p.loop.period)}, Wave.${(p.loop.wave || 'sine').toUpperCase()}, mapOf(${Object.entries(p.loop.props).map(([k, [a, b]]) => `"${k}" to (${num(a)} to ${num(b)})`).join(', ')})${p.loop.amplitude ? ', ' + num(p.loop.amplitude) : ''})`);
  if (p.params) parts.push(`params = mapOf(${Object.entries(p.params).map(([k, d]) => `"${k}" to Param(${num(d.default)}${d.min !== undefined ? ', ' + num(d.min) : ''}${d.max !== undefined ? ', ' + num(d.max) : ''})`).join(', ')})`);
  kt += `    Preset(${parts.join(', ')}),\n`;
}
kt += `  ).associateBy { it.id }\n}\n`;
fs.mkdirSync(path.join(__dirname, 'src/commonMain/kotlin/nayroz/motion'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'src/commonMain/kotlin/nayroz/motion/PresetLibrary.kt'), kt);

// ---- parity vectors ----
const easeNames = Object.keys(E.EASINGS);
const easeVec = easeNames.map(n => [n, [...Array(21)].map((_, i) => E.EASINGS[n](i / 20))]);
const sceneIds = ['luxury-wedding-ar', 'sale-pop', 'snappy-stretch', 'islamic-ramadan', 'transitions', 'education-steps'];
let vk = `package nayroz.motion\n\n// GENERATED parity vectors from the JS reference engine.\nobject ParityVectors {\n  val eases: List<Pair<String, DoubleArray>> = listOf(\n`;
vk += easeVec.map(([n, a]) => `    "${n}" to doubleArrayOf(${a.map(x => num(+x.toFixed(12))).join(', ')})`).join(',\n') + '\n  )\n';
vk += `  val scenes: List<Triple<String, Scene, List<Pair<Double, Map<String, Map<String, Double>>>>>> = listOf(\n`;
const lib = P;
for (const id of sceneIds) {
  const sc = SCENES[id];
  // units = word count for split elements (DOM-free equivalent of stage.html)
  const units = {}; for (const e of sc.elements) if (e.split) units[e.key] = e.split === 'word' ? e.text.split(/\s+/).filter(Boolean).length : [...e.text].length;
  const tracks = sc.tracks.map(t => ({ ...t, units: units[t.el] || 1 }));
  const laid = E.layout({ ...sc, tracks }, lib);
  const samples = [0, 250, 700, 1300, 2100, 3333, 4800, 6100, 7900].filter(t => t < sc.duration).map(t => [t, E.evaluate(laid, t)]);
  const ktTracks = tracks.map(t => `Track(el = "${t.el}", preset = "${t.preset}", at = ${t.at === undefined ? 'null' : typeof t.at === 'number' ? num(t.at) : `"${t.at}"`}, params = mapOf(${Object.entries(t.params || {}).map(([k, v]) => `"${k}" to ${typeof v === 'number' ? num(v) : `"${v}"`}`).join(', ')}), units = ${t.units}${t.stagger ? `, stagger = Stagger(${num(t.stagger.each)}${t.stagger.from ? `, "${t.stagger.from}"` : ''})` : ''}${t.length ? `, length = ${num(t.length)}` : ''})`);
  const ktSamples = samples.map(([t, st]) => `${num(t)} to mapOf(${Object.entries(st).map(([k, pr]) => `"${k}" to mapOf(${Object.entries(pr).map(([a, b]) => `"${a}" to ${num(+b.toFixed(9))}`).join(', ')})`).join(', ')})`);
  vk += `    Triple("${id}", Scene(${num(sc.duration)}, listOf(${ktTracks.join(', ')})), listOf(${ktSamples.join(', ')})),\n`;
}
vk += `  )\n}\n`;
fs.mkdirSync(path.join(__dirname, 'src/jvmTest/kotlin'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'src/jvmTest/kotlin/ParityVectors.kt'), vk);
fs.writeFileSync(path.join(__dirname, '../engine/presets.json'), JSON.stringify(P, null, 1));
console.log('presets', Object.keys(P).length, 'eases', easeNames.length, 'scenes', sceneIds.length);
