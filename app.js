(() => {
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const MODES = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  "Harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "Melodic minor": [0, 2, 3, 5, 7, 9, 11],
  Ionian: [0, 2, 4, 5, 7, 9, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Aeolian: [0, 2, 3, 5, 7, 8, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10]
};

const tonic = document.querySelector("#tonic");
const mode = document.querySelector("#mode");
const sequencePanel = document.querySelector("#sequence-panel");
const sequence = document.querySelector("#sequence");
const liveResponse = document.querySelector("#live-response");
const level = document.querySelector("#level");
const status = document.querySelector("#status");
const practiceCard = document.querySelector(".practice-card");
const playCall = document.querySelector("#play-call");
const startOver = document.querySelector("#start-over");
const scoreDisplay = document.querySelector("#score");
const highScoreDisplay = document.querySelector("#high-score");
const replayCall = document.querySelector("#replay-call");
const threshold = document.querySelector("#threshold");
const duration = document.querySelector("#duration");
const thresholdValue = document.querySelector("#threshold-value");
const durationValue = document.querySelector("#duration-value");
const levelMeter = document.querySelector("#level-meter");
const peakValue = document.querySelector("#peak-value");
const noteDot = document.querySelector("#note-dot");
const triggeredNote = document.querySelector("#triggered-note");

NOTE_NAMES.forEach((note, index) => tonic.add(new Option(note, index)));
Object.keys(MODES).forEach((name) => mode.add(new Option(name, name)));
mode.value = "Major";

let call = [];
let synth;
let mic;
let analyser;
let responseTimer;
let responseNotes = [];
let noteStartedAt = 0;
let lastPitch = null;
let candidatePitch = null;
let candidateStartedAt = 0;
let responseActive = false;
let gameActive = false;
let roundTimer;
let replayingCall = false;
let score = 0;
const levelHistory = [];
const callDurations = [];
const savedThreshold = localStorage.getItem("call-response-threshold");
const savedDuration = localStorage.getItem("call-response-duration");
const savedHighScore = Number(localStorage.getItem("call-response-high-score") || 0);

if (savedThreshold !== null) threshold.value = savedThreshold;
if (savedDuration !== null) duration.value = savedDuration;
durationValue.textContent = `${duration.value} ms`;
highScoreDisplay.textContent = savedHighScore;

function getScale() {
  return MODES[mode.value].map((offset) => (Number(tonic.value) + offset) % 12);
}

function noteName(degree) {
  return NOTE_NAMES[getScale()[degree % 7]];
}

function renderSequence() {
  sequence.replaceChildren();
  liveResponse.replaceChildren();
  level.textContent = `Level ${call.length}`;
}

function renderLiveBlocks(callCount, responseCount, showNames = false, pulseType = "") {
  sequence.replaceChildren(...call.slice(0, callCount).map((degree) => {
    const chip = document.createElement("span");
    chip.className = `note-chip${pulseType === "call" && callCount > 0 ? " pulse" : ""}`;
    chip.textContent = showNames ? noteName(degree) : "";
    chip.setAttribute("aria-label", showNames ? noteName(degree) : "Call note");
    return chip;
  }));
  liveResponse.replaceChildren(...responseNotes.slice(0, responseCount).map((note) => {
    const chip = document.createElement("span");
    chip.className = `note-chip response-chip${pulseType === "response" && responseCount > 0 ? " pulse" : ""}`;
    chip.textContent = showNames ? NOTE_NAMES[note] : "";
    chip.setAttribute("aria-label", showNames ? NOTE_NAMES[note] : "Response note");
    return chip;
  }));
}

function pulseBlock(container) {
  const block = container.lastElementChild;
  if (!block) return;
  block.classList.remove("pulse");
  void block.offsetWidth;
  block.classList.add("pulse");
}

function setStatus(message, type = "") {
  status.textContent = message;
  status.className = `status ${type}`;
}

function showTriggeredNote(note) {
  triggeredNote.textContent = NOTE_NAMES[note];
  noteDot.classList.remove("active");
  void noteDot.offsetWidth;
  noteDot.classList.add("active");
}

function thresholdAmplitude() {
  return 10 ** (Number(threshold.value) / 20);
}

function updateThresholdLabel() {
  thresholdValue.textContent = `${threshold.value} dB`;
}

async function ensureAudio() {
  await Tone.start();
  if (!synth) {
    createSynth();
    await Tone.loaded();
  }
}

function createSynth() {
  if (synth) synth.dispose();
  synth = new Tone.Sampler({
    urls: { C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3" },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    release: 1
  }).toDestination();
}

function playNote(degree, time, noteDuration) {
  const scaleDegree = degree % 7;
  const midi = 60 + ((getScale()[scaleDegree] - getScale()[0] + 12) % 12) + 12 * Math.floor(degree / 7);
  Tone.Draw.schedule(() => showTriggeredNote(midi % 12), time);
  synth.triggerAttackRelease(Tone.Frequency(midi, "midi"), noteDuration, time);
}

function playChord(rootDegree, time) {
  [rootDegree, rootDegree + 2, rootDegree + 4].forEach((degree) => playNote(degree, time, "4n"));
}

function addScorePoint() {
  score += 1;
  scoreDisplay.textContent = score;
}

function recordResponseNote(note) {
  responseNotes.push(note);
  addScorePoint();
}

function finishPlayback() {
  responseActive = true;
  replayingCall = false;
  noteStartedAt = 0;
  lastPitch = null;
  candidatePitch = null;
  candidateStartedAt = 0;
  replayCall.textContent = "↻";
  replayCall.setAttribute("aria-label", "Replay call");
  replayCall.classList.remove("playing");
  replayCall.hidden = false;
  setStatus("Your turn. Play the full series of notes.");
}

async function playSequence({ replay = false, includeIntro = false } = {}) {
  await ensureAudio();
  playCall.disabled = true;
  if (!replay) startOver.hidden = true;
  replayingCall = replay;
  sequencePanel.hidden = true;
  replayCall.hidden = true;
  if (!replay) {
    responseNotes = [];
    renderLiveBlocks(0, 0);
  }
  responseActive = false;
  setStatus("Listen closely...");
  const now = Tone.now() + 0.08;
  if (includeIntro) {
    [0, 3, 4].forEach((degree, index) => playChord(degree, now + index * 0.75));
  }
  let time = now + (includeIntro ? 2.5 : 0.08);
  call.forEach((degree, index) => {
    const noteDuration = callDurations[index] || ["2n", "4n", "8n", "8t"][Math.floor(Math.random() * 4)];
    const seconds = Tone.Time(noteDuration).toSeconds() + 0.1;
    callDurations[index] = noteDuration;
    playNote(degree, time, seconds);
    Tone.Draw.schedule(() => {
      renderLiveBlocks(index + 1, 0);
      pulseBlock(sequence);
    }, time);
    time += seconds + 0.1;
  });
  roundTimer = setTimeout(finishPlayback, (time - now) * 1000);
}

function frequencyToMidi(frequency) {
  return Math.round(69 + 12 * Math.log2(frequency / 440));
}

function detectPitch(buffer, sampleRate) {
  let mean = 0;
  for (const sample of buffer) mean += sample;
  mean /= buffer.length;
  let energy = 0;
  for (const sample of buffer) energy += (sample - mean) ** 2;
  const rms = Math.sqrt(energy / buffer.length);
  const levelDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  const now = performance.now();
  levelHistory.push({ db: levelDb, time: now });
  while (levelHistory.length && levelHistory[0].time < now - 500) levelHistory.shift();
  const peakDb = levelHistory.reduce((peak, entry) => Math.max(peak, entry.db), -Infinity);
  peakValue.textContent = Number.isFinite(peakDb) ? `${peakDb.toFixed(1)} dB` : "-∞ dB";
  levelMeter.style.transform = `scaleX(${Math.max(0, Math.min(1, (levelDb + 60) / 60))})`;
  if (rms < thresholdAmplitude()) return null;

  let bestOffset = -1;
  let bestCorrelation = 0;
  const minOffset = Math.floor(sampleRate / 1000);
  const maxOffset = Math.min(Math.floor(sampleRate / 70), Math.floor(buffer.length / 2));
  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < buffer.length - offset; index += 1) {
      const left = buffer[index] - mean;
      const right = buffer[index + offset] - mean;
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    correlation = denominator > 0 ? correlation / denominator : 0;
    if (correlation > bestCorrelation) { bestCorrelation = correlation; bestOffset = offset; }
  }
  return bestOffset > 0 && bestCorrelation > 0.35 ? frequencyToMidi(sampleRate / bestOffset) % 12 : null;
}

async function startMonitoring() {
  if (mic) return;
  mic = new Tone.UserMedia();
  await mic.open();
  analyser = new Tone.Analyser("waveform", 2048);
  mic.connect(analyser);
  responseTimer = setInterval(() => {
    const pitch = detectPitch(analyser.getValue(), Tone.getContext().sampleRate);
    const now = performance.now();
    if (pitch === null) {
      candidatePitch = null;
      if (lastPitch !== null && now - noteStartedAt >= Number(duration.value)) {
        if (responseActive) {
          recordResponseNote(lastPitch);
          renderLiveBlocks(call.length, responseNotes.length);
          pulseBlock(liveResponse);
          if (responseNotes.length >= call.length) finishResponse();
        }
        lastPitch = null;
      }
      return;
    }

    if (pitch !== candidatePitch) {
      candidatePitch = pitch;
      candidateStartedAt = now;
      return;
    }
    if (now - candidateStartedAt < Number(duration.value)) return;
    if (pitch === lastPitch) {
      if (responseActive && responseNotes.length === call.length - 1 && now - noteStartedAt >= Number(duration.value)) {
        recordResponseNote(lastPitch);
        renderLiveBlocks(call.length, responseNotes.length);
        pulseBlock(liveResponse);
        finishResponse();
      }
      return;
    }
    if (lastPitch !== null && responseActive) {
      recordResponseNote(lastPitch);
      renderLiveBlocks(call.length, responseNotes.length);
    }
    lastPitch = pitch;
    noteStartedAt = candidateStartedAt;
    showTriggeredNote(pitch);
    if (responseActive) renderLiveBlocks(call.length, responseNotes.length + 1);
    pulseBlock(liveResponse);
    return;
  }, 50);
}

function finishResponse() {
  responseActive = false;
  playCall.disabled = false;
  const expected = call.map((degree) => getScale()[degree % 7]);
  const response = responseNotes.slice(0, call.length);
  const correct = response.length === expected.length && response.every((note, index) => note === expected[index]);
  if (correct) {
    call.push(Math.floor(Math.random() * 7));
    renderSequence();
    setStatus("Correct! Listen for the next call.", "success");
    clearTimeout(roundTimer);
    practiceCard.classList.remove("level-complete");
    void practiceCard.offsetWidth;
    practiceCard.classList.add("level-complete");
    roundTimer = setTimeout(playSequence, 2000);
  } else {
    gameActive = false;
    sequencePanel.hidden = false;
    renderLiveBlocks(call.length, response.length, true);
    const savedHighScore = Number(localStorage.getItem("call-response-high-score") || 0);
    const newHighScore = Math.max(savedHighScore, score);
    localStorage.setItem("call-response-high-score", newHighScore);
    highScoreDisplay.textContent = newHighScore;
    startOver.hidden = false;
    setStatus(`Not quite. Final score: ${score}. Start over to play again.`, "error");
  }
}

function resetGame() {
  clearTimeout(roundTimer);
  gameActive = true;
  responseActive = false;
  score = 0;
  scoreDisplay.textContent = score;
  sequencePanel.hidden = true;
  callDurations.length = 0;
  call = [Math.floor(Math.random() * 7)];
  playCall.hidden = true;
  renderSequence();
  playSequence({ includeIntro: true });
}

playCall.addEventListener("click", resetGame);
replayCall.addEventListener("click", () => {
  if (!replayingCall) playSequence({ replay: true });
});
startOver.addEventListener("click", resetGame);
tonic.addEventListener("change", () => {});
mode.addEventListener("change", () => {});
threshold.addEventListener("input", () => {
  updateThresholdLabel();
  localStorage.setItem("call-response-threshold", threshold.value);
});
duration.addEventListener("input", () => {
  durationValue.textContent = `${duration.value} ms`;
  localStorage.setItem("call-response-duration", duration.value);
});
updateThresholdLabel();
startMonitoring().catch((error) => setStatus(`Microphone monitoring unavailable: ${error.message}`, "error"));
})();
