(() => {
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const tonic = document.querySelector("#only-tonic");
const progressionTitle = document.querySelector("#progression-title");
const currentChord = document.querySelector("#current-chord");
const progression = document.querySelector("#progression");
const start = document.querySelector("#start");
const stop = document.querySelector("#stop");
const status = document.querySelector("#only-status");
const rightScore = document.querySelector("#right-score");
const wrongScore = document.querySelector("#wrong-score");
const accuracy = document.querySelector("#accuracy");
const threshold = document.querySelector("#threshold");
const duration = document.querySelector("#duration");
const tempoValue = document.querySelector("#tempo-value");
const tempoDown = document.querySelector("#tempo-down");
const tempoUp = document.querySelector("#tempo-up");
const thresholdValue = document.querySelector("#threshold-value");
const durationValue = document.querySelector("#duration-value");
const levelMeter = document.querySelector("#level-meter");
const peakValue = document.querySelector("#peak-value");
const noteDot = document.querySelector("#note-dot");
const triggeredNote = document.querySelector("#triggered-note");
const muteChords = document.querySelector("#mute-chords");

NOTE_NAMES.forEach((note, index) => tonic.add(new Option(note, index)));
const savedThreshold = localStorage.getItem("call-response-threshold");
const savedDuration = localStorage.getItem("call-response-duration");
const savedTempo = localStorage.getItem("only-right-notes-tempo");
const initialTempo = savedTempo === null ? 100 : Math.max(40, Math.min(220, Number(savedTempo) || 100));
const savedMute = localStorage.getItem("only-right-notes-muted") === "true";
if (savedThreshold !== null) threshold.value = savedThreshold;
if (savedDuration !== null) duration.value = savedDuration;
durationValue.textContent = `${duration.value} ms`;
tempoValue.dataset.bpm = initialTempo;
tempoValue.textContent = `${initialTempo} BPM`;

let synth;
let metronome;
let mic;
let analyser;
let monitorTimer;
let progressionRows = [];
let activeIndex = -1;
let right = 0;
let wrong = 0;
let lastPitch = null;
let candidatePitch = null;
let candidateStartedAt = 0;
let noteStartedAt = 0;
let running = false;
let progressionTimer;
let chordsMuted = savedMute;
const levelHistory = [];

function thresholdAmplitude() { return 10 ** (Number(threshold.value) / 20); }
function setStatus(message, type = "") { status.textContent = message; status.className = `status ${type}`; }
function updateAccuracy() {
  const total = right + wrong;
  accuracy.textContent = total ? `${Math.round((right / total) * 100)}%` : "0%";
}
function showNote(note) {
  triggeredNote.textContent = NOTE_NAMES[note];
  noteDot.classList.remove("active");
  void noteDot.offsetWidth;
  noteDot.classList.add("active");
}
function parseChord(token) {
  const clean = token.replace(/[()]/g, "");
  if (clean === "%") return null;
  const match = clean.match(/^([b#]*)([IViv]+)(.*)$/);
  if (!match) return { label: token, pitchClasses: [] };
  const degreeNames = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
  const roman = match[2].toUpperCase();
  const degree = degreeNames[roman];
  const accidental = (match[1].match(/#/g) || []).length - (match[1].match(/b/g) || []).length;
  const majorScale = [0, 2, 4, 5, 7, 9, 11];
  const root = (Number(tonic.value) + majorScale[degree] + accidental + 12) % 12;
  const suffix = match[3];
  const quality = match[2] === match[2].toLowerCase() || suffix.startsWith("-") ? "minor" : "major";
  const intervals = quality === "minor" ? [0, 3, 7] : [0, 4, 7];
  if (suffix.includes("ø")) intervals.splice(2, 1, 6);
  if (suffix.includes("o")) intervals.splice(1, 1, 3);
  if (suffix.includes("7")) intervals.push(suffix.includes("Δ") ? 11 : 10);
  if (suffix.includes("Δ") && !intervals.includes(11)) intervals.push(11);
  if (suffix.includes("+9")) intervals.push(2);
  return { label: token, pitchClasses: intervals.map((interval) => (root + interval) % 12), root };
}
function renderProgression() {
  progression.replaceChildren(...progressionRows.map((row, index) => {
    const item = document.createElement("span");
    item.className = "progression-chord";
    item.textContent = row.label;
    item.dataset.index = index;
    return item;
  }));
}
async function loadProgression() {
  const response = await fetch("./progressions.csv");
  if (!response.ok) throw new Error("Could not load progressions.csv");
  const lines = (await response.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const validLines = lines.filter((line) => line.includes(";"));
  if (!validLines.length) throw new Error("progressions.csv contains no valid title; chord rows.");
  const selectedLine = validLines[Math.floor(Math.random() * validLines.length)];
  const separatorIndex = selectedLine.indexOf(";");
  const title = selectedLine.slice(0, separatorIndex).trim();
  const chordText = selectedLine.slice(separatorIndex + 1).trim();
  if (!title || !chordText) throw new Error(`Invalid progression row: "${selectedLine}"`);
  let previous = null;
  progressionRows = chordText.trim().split(/\s+/).map((token) => {
    const chord = parseChord(token) || previous;
    previous = chord;
    return chord;
  }).filter(Boolean);
  progressionTitle.textContent = title;
  renderProgression();
}
async function ensureAudio() {
  await Tone.start();
  if (!synth) {
    createSynth();
    await Tone.loaded();
    updateMuteButton();
  }
  if (!metronome) metronome = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 } }).toDestination();
}
function createSynth() {
  if (synth) synth.dispose();
  synth = new Tone.Sampler({
    urls: { C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3" },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    release: 1
  }).toDestination();
}
function playChord(chord, time, durationSeconds) {
  if (chordsMuted) return;
  chord.pitchClasses.forEach((pitchClass) => synth.triggerAttackRelease(Tone.Frequency(60 + ((pitchClass - Number(tonic.value) + 12) % 12), "midi"), durationSeconds, time));
}
function chordNoteNames(chord) {
  return chord.pitchClasses.map((pitchClass) => NOTE_NAMES[pitchClass]).join(", ");
}
async function startMonitoring() {
  if (mic) return;
  mic = new Tone.UserMedia();
  await mic.open();
  analyser = new Tone.Analyser("waveform", 2048);
  mic.connect(analyser);
  monitorTimer = setInterval(() => {
    const buffer = analyser.getValue();
    let mean = 0;
    for (const sample of buffer) mean += sample;
    mean /= buffer.length;
    let energy = 0;
    for (const sample of buffer) energy += (sample - mean) ** 2;
    const rms = Math.sqrt(energy / buffer.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const now = performance.now();
    levelHistory.push({ db, time: now });
    while (levelHistory.length && levelHistory[0].time < now - 500) levelHistory.shift();
    const peak = levelHistory.reduce((value, entry) => Math.max(value, entry.db), -Infinity);
    peakValue.textContent = Number.isFinite(peak) ? `${peak.toFixed(1)} dB` : "-∞ dB";
    levelMeter.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60))})`;
    if (!running || rms < thresholdAmplitude()) return;
    const pitch = detectPitch(buffer, Tone.getContext().sampleRate);
    if (pitch === null) return;
    if (pitch !== candidatePitch) { candidatePitch = pitch; candidateStartedAt = now; return; }
    if (now - candidateStartedAt < Number(duration.value) || pitch === lastPitch) return;
    if (lastPitch !== null) scorePitch(lastPitch);
    lastPitch = pitch;
    noteStartedAt = now;
    showNote(pitch);
  }, 50);
}
function detectPitch(buffer, sampleRate) {
  let bestOffset = -1;
  let bestCorrelation = 0;
  for (let offset = Math.floor(sampleRate / 1000); offset < Math.floor(sampleRate / 70); offset += 1) {
    let correlation = 0;
    for (let index = 0; index < buffer.length - offset; index += 1) correlation += buffer[index] * buffer[index + offset];
    if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = offset; }
  }
  return bestOffset > 0 && bestCorrelation > 0.01 ? Math.round(69 + 12 * Math.log2((Tone.getContext().sampleRate / bestOffset) / 440)) % 12 : null;
}
function scorePitch(pitch) {
  const chord = progressionRows[activeIndex];
  if (!chord) return;
  if (chord.pitchClasses.includes(pitch)) right += 1; else wrong += 1;
  rightScore.textContent = right;
  wrongScore.textContent = wrong;
  updateAccuracy();
}
async function begin({ resetScore = true } = {}) {
  await ensureAudio();
  await startMonitoring();
  await loadProgression();
  if (resetScore) {
    right = 0; wrong = 0;
    rightScore.textContent = "0"; wrongScore.textContent = "0"; updateAccuracy();
  }
  lastPitch = null; candidatePitch = null;
  running = true; start.hidden = true; stop.hidden = false;
  scheduleTimeline(0, true);
  setStatus("Count in, then play notes from the highlighted chord.");
}
function scheduleTimeline(startIndex, includeCountIn, rebuildVoices = false) {
  clearTimeout(progressionTimer);
  Tone.Draw.cancel();
  Tone.Transport.cancel();
  if (rebuildVoices && synth) createSynth();
  if (rebuildVoices && metronome) {
    metronome.dispose();
    metronome = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.08 } }).toDestination();
  }
  const beat = 60 / Number(tempoValue.dataset.bpm);
  const startTime = Tone.now() + 0.08;
  const countInBeats = includeCountIn ? 4 : 0;
  activeIndex = includeCountIn ? -1 : startIndex;
  currentChord.textContent = includeCountIn ? "Count in..." : `${progressionRows[startIndex].label}: ${chordNoteNames(progressionRows[startIndex])}`;
  const remainingChords = progressionRows.length - startIndex;
  const totalBeats = countInBeats + remainingChords * 4;
  for (let beatIndex = 0; beatIndex < totalBeats; beatIndex += 1) {
    if (beatIndex % 4 === 1 || beatIndex % 4 === 3) {
      metronome.triggerAttackRelease("C5", Math.min(.12, beat * .25), startTime + beatIndex * beat);
    }
  }
  progressionRows.slice(startIndex).forEach((chord, offset) => {
    const index = startIndex + offset;
    const chordTime = startTime + (countInBeats + offset * 4) * beat;
    Tone.Draw.schedule(() => {
      activeIndex = index;
      document.querySelectorAll(".progression-chord").forEach((item) => item.classList.toggle("active", Number(item.dataset.index) === index));
      currentChord.textContent = `${chord.label}: ${chordNoteNames(chord)}`;
    }, chordTime);
    playChord(chord, chordTime, beat * 4);
  });
  progressionTimer = setTimeout(() => loadProgression().then(() => scheduleTimeline(0, true)).catch((error) => setStatus(error.message, "error")), totalBeats * beat * 1000 + 100);
}
start.addEventListener("click", () => begin().catch((error) => setStatus(error.message, "error")));
stop.addEventListener("click", () => {
  running = false;
  clearTimeout(progressionTimer);
  Tone.Transport.stop();
  Tone.Transport.cancel();
  synth?.releaseAll();
  metronome?.triggerRelease();
  synth?.dispose();
  metronome?.dispose();
  synth = undefined;
  metronome = undefined;
  activeIndex = -1;
  currentChord.textContent = "-";
  document.querySelectorAll(".progression-chord").forEach((item) => item.classList.remove("active"));
  stop.hidden = true;
  start.hidden = false;
  setStatus("Stopped.");
});
function updateMuteButton() {
  muteChords.textContent = chordsMuted ? "Unmute chords" : "Mute chords";
  muteChords.setAttribute("aria-pressed", String(chordsMuted));
  if (synth) synth.volume.value = chordsMuted ? -Infinity : 0;
}
muteChords.addEventListener("click", () => {
  chordsMuted = !chordsMuted;
  localStorage.setItem("only-right-notes-muted", String(chordsMuted));
  updateMuteButton();
});
threshold.addEventListener("input", () => { thresholdValue.textContent = `${threshold.value} dB`; localStorage.setItem("call-response-threshold", threshold.value); });
duration.addEventListener("input", () => { durationValue.textContent = `${duration.value} ms`; localStorage.setItem("call-response-duration", duration.value); });
function updateTempo(delta) {
  const next = Math.max(40, Math.min(220, Number(tempoValue.dataset.bpm || tempoValue.textContent.replace(" BPM", "")) + delta));
  tempoValue.dataset.bpm = next;
  tempoValue.textContent = `${next} BPM`;
  localStorage.setItem("only-right-notes-tempo", next);
  if (running) scheduleTimeline(Math.max(0, activeIndex), activeIndex < 0, true);
}
function holdTempoButton(button, delta) {
  let interval;
  const stopHolding = () => { clearInterval(interval); interval = undefined; };
  button.addEventListener("pointerdown", () => {
    updateTempo(delta);
    interval = setInterval(() => updateTempo(delta), 100);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((event) => button.addEventListener(event, stopHolding));
}
holdTempoButton(tempoDown, -1);
holdTempoButton(tempoUp, 1);
updateMuteButton();
loadProgression().catch((error) => setStatus(error.message, "error"));
startMonitoring().catch((error) => setStatus(`Microphone monitoring unavailable: ${error.message}`, "error"));
})();
