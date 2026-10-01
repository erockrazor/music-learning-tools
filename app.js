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
const callTempo = document.querySelector("#call-tempo");
const callTempoValue = document.querySelector("#call-tempo-value");
const threshold = document.querySelector("#threshold");
const duration = document.querySelector("#duration");
const thresholdValue = document.querySelector("#threshold-value");
const durationValue = document.querySelector("#duration-value");
const durationRecommendation = document.querySelector("#duration-recommendation");
const levelMeter = document.querySelector("#level-meter");
const peakValue = document.querySelector("#peak-value");
const noteDot = document.querySelector("#note-dot");
const triggeredNote = document.querySelector("#triggered-note");

NOTE_NAMES.forEach((note, index) => tonic.add(new Option(note, index)));
Object.keys(MODES).forEach((name) => mode.add(new Option(name, name)));
mode.value = "Major";

let call = [];
let currentLevel = 1;
let correctStreak = 0;
let incorrectStreak = 0;
let synth;
let mic;
let inputHighPass;
let inputLowPass;
let analyser;
let responseTimer;
let responseNotes = [];
let noteStartedAt = 0;
let lastPitch = null;
let candidatePitch = null;
let candidateStartedAt = 0;
let candidateFrameCount = 0;
let responseActive = false;
let callPlaybackComplete = false;
let roundTimer;
let listenTimer;
let score = 0;
const levelHistory = [];
const callDurations = [];
const savedThreshold = localStorage.getItem("call-response-threshold");
const savedDuration = localStorage.getItem("call-response-duration");
const savedHighScore = Number(localStorage.getItem("call-response-high-score") || 0);
const savedCallTempo = Number(localStorage.getItem("call-response-tempo") || 100);

if (savedThreshold !== null) threshold.value = savedThreshold;
if (savedDuration !== null && Number.isFinite(Number(savedDuration))) {
  duration.value = String(Math.max(Number(duration.min), Math.min(Number(duration.max), Number(savedDuration))));
}
callTempo.value = String(Math.max(40, Math.min(160, savedCallTempo)));
callTempoValue.textContent = `${callTempo.value} BPM`;
updateDurationRecommendation();
durationValue.textContent = `${duration.value} ms`;
highScoreDisplay.textContent = savedHighScore;

function getScale() {
  return MODES[mode.value].map((offset) => (Number(tonic.value) + offset) % 12);
}

function noteName(degree) {
  return NOTE_NAMES[getScale()[degree % 7]];
}

function getDegreeLabel(pitchClass) {
  const interval = (pitchClass - Number(tonic.value) + 12) % 12;
  const naturalIntervals = [0, 2, 4, 5, 7, 9, 11];
  const naturalSolfege = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Ti"];
  const sharpSolfege = ["Di", "Ri", "Fi", "Fi", "Si", "Li", "Di"];
  const flatSolfege = ["Do", "Ra", "Me", "Se", "Le", "Te", "Ta"];
  const modeIntervals = MODES[mode.value];
  let degree = modeIntervals.indexOf(interval);
  let alteration = 0;

  if (degree >= 0) {
    alteration = interval - naturalIntervals[degree];
  } else {
    let closestDistance = Infinity;
    naturalIntervals.forEach((naturalInterval, index) => {
      const difference = ((interval - naturalInterval + 18) % 12) - 6;
      if (Math.abs(difference) < closestDistance) {
        degree = index;
        alteration = difference;
        closestDistance = Math.abs(difference);
      }
    });
  }

  const accidental = alteration < 0 ? "♭" : alteration > 0 ? "♯" : "";
  const syllables = alteration < 0 ? flatSolfege : alteration > 0 ? sharpSolfege : naturalSolfege;
  return { degree: `${accidental}${degree + 1}`, solfege: syllables[degree] };
}

function createCall(levelNumber) {
  const call = [Math.floor(Math.random() * 7)];
  const maxInterval = Math.min(Math.floor(levelNumber / 2), 6);
  while (call.length < levelNumber) {
    const previousDegree = call[call.length - 1];
    const candidates = [];
    for (let interval = 0; interval <= maxInterval; interval += 1) {
      for (const direction of interval === 0 ? [0] : [-1, 1]) {
        const degree = previousDegree + interval * direction;
        if (degree >= 0 && degree < 7) {
          const weight = interval === 0 || interval === 4 ? 0.2 : 1 / (interval + 1);
          candidates.push({ degree, weight });
        }
      }
    }
    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let choice = Math.random() * totalWeight;
    const selected = candidates.find((candidate) => (choice -= candidate.weight) < 0);
    call.push(selected.degree);
  }
  return call;
}

function updateDurationRecommendation() {
  const milliseconds = Math.round((60 / Number(callTempo.value) / 3) * 1000);
  durationRecommendation.textContent = `Less Than ${milliseconds} ms recommended`;
}

function renderSequence() {
  sequence.replaceChildren();
  liveResponse.replaceChildren();
  level.textContent = `Level ${currentLevel}`;
}

function renderLiveBlocks(callCount, responseCount, showNames = false, pulseType = "") {
  sequence.replaceChildren(...call.slice(0, callCount).map((degree) => {
    const chip = document.createElement("span");
    chip.className = `note-chip${pulseType === "call" && callCount > 0 ? " pulse" : ""}`;
    if (showNames) {
      const pitchClass = getScale()[degree % 7];
      const degreeInfo = getDegreeLabel(pitchClass);
      appendNoteLabels(chip, pitchClass);
      chip.setAttribute("aria-label", `${NOTE_NAMES[pitchClass]}, ${degreeInfo.solfege}, scale degree ${degreeInfo.degree}`);
    } else {
      chip.setAttribute("aria-label", "Call note");
    }
    return chip;
  }));
  const visibleResponseNotes = responseNotes.slice(0, responseCount);
  if (responseActive && lastPitch !== null && visibleResponseNotes.length < responseCount) {
    visibleResponseNotes.push(lastPitch);
  }
  liveResponse.replaceChildren(...visibleResponseNotes.map((note) => {
    const chip = document.createElement("span");
    chip.className = `note-chip response-chip${pulseType === "response" && responseCount > 0 ? " pulse" : ""}`;
    appendNoteLabels(chip, note);
    const degreeInfo = getDegreeLabel(note);
    chip.setAttribute("aria-label", `${NOTE_NAMES[note]}, ${degreeInfo.solfege}, scale degree ${degreeInfo.degree}`);
    return chip;
  }));
}

function appendNoteLabels(chip, pitchClass) {
  const degreeInfo = getDegreeLabel(pitchClass);
  const name = document.createElement("span");
  name.className = "note-chip-name";
  name.textContent = NOTE_NAMES[pitchClass];
  const solfege = document.createElement("span");
  solfege.className = "note-chip-solfege";
  solfege.textContent = degreeInfo.solfege;
  const degree = document.createElement("span");
  degree.className = "note-chip-degree";
  degree.textContent = degreeInfo.degree;
  chip.append(name, solfege, degree);
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
  if (responseNotes.length >= call.length) return;
  responseNotes.push(note);
  addScorePoint();
  if (responseNotes.length === call.length) {
    responseActive = false;
    if (callPlaybackComplete) finishResponse();
  }
}

function finishPlayback() {
  callPlaybackComplete = true;
  candidatePitch = null;
  candidateFrameCount = 0;
  sequencePanel.hidden = false;
  renderLiveBlocks(call.length, responseNotes.length);
  if (responseNotes.length >= call.length) {
    responseActive = false;
    finishResponse();
    return;
  }
  responseActive = true;
  setStatus("Your turn. Play the full series of notes.");
}

async function playSequence({ includeIntro = false } = {}) {
  await ensureAudio();
  clearTimeout(roundTimer);
  clearTimeout(listenTimer);
  playCall.disabled = true;
  sequencePanel.hidden = true;
  responseNotes = [];
  renderLiveBlocks(0, 0);
  responseActive = false;
  callPlaybackComplete = false;
  lastPitch = null;
  candidatePitch = null;
  candidateStartedAt = 0;
  candidateFrameCount = 0;
  setStatus("Listen closely...");
  const bpm = Number(callTempo.value);
  const beatSeconds = 60 / bpm;
  Tone.Transport.bpm.value = bpm;
  const now = Tone.now() + 0.08;
  if (includeIntro) {
    [0, 3, 4].forEach((degree, index) => playChord(degree, now + index * beatSeconds));
  }
  let time = now + (includeIntro ? beatSeconds * 3 : 0.08);
  const callStartTime = time;
  const durationBeats = { "2n": 2, "4n": 1, "8n": 0.5, "8t": 1 / 3 };
  call.forEach((degree, index) => {
    const noteDuration = callDurations[index] || ["2n", "4n", "8n", "8t"][Math.floor(Math.random() * 4)];
    const seconds = beatSeconds * durationBeats[noteDuration];
    callDurations[index] = noteDuration;
    playNote(degree, time, seconds);
    Tone.Draw.schedule(() => {
      renderLiveBlocks(index + 1, 0);
      pulseBlock(sequence);
    }, time);
    time += seconds + beatSeconds * 0.08;
  });
  const callDuration = time - callStartTime;
  listenTimer = setTimeout(() => {
    if (callPlaybackComplete) return;
    responseActive = responseNotes.length < call.length;
    lastPitch = null;
    candidatePitch = null;
    candidateStartedAt = 0;
    candidateFrameCount = 0;
    noteStartedAt = 0;
    sequencePanel.hidden = false;
    renderLiveBlocks(call.length, responseNotes.length);
    setStatus("The call is still playing. You can begin your response now.");
  }, Math.max(0, (callStartTime - now + callDuration / 2) * 1000));
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

  // Average pairs to decimate the longer capture window while retaining guitar fundamentals.
  const decimation = 2;
  const samples = new Float32Array(Math.floor(buffer.length / decimation));
  let sampleMean = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const start = index * decimation;
    samples[index] = (buffer[start] + buffer[start + 1]) / decimation;
    sampleMean += samples[index];
  }
  sampleMean /= samples.length;
  for (let index = 0; index < samples.length; index += 1) samples[index] -= sampleMean;

  const analysisRate = sampleRate / decimation;
  const minLag = Math.max(2, Math.floor(analysisRate / 1000));
  const maxLag = Math.min(Math.floor(analysisRate / 70), Math.floor(samples.length / 2));
  const normalizedDifference = new Float32Array(maxLag + 1);
  let cumulativeDifference = 0;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < samples.length - lag; index += 1) {
      const delta = samples[index] - samples[index + lag];
      sum += delta * delta;
    }
    cumulativeDifference += sum;
    normalizedDifference[lag] = cumulativeDifference > 0 ? (sum * lag) / cumulativeDifference : 1;
  }

  let bestLag = -1;
  let bestDifference = Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (normalizedDifference[lag] <= 0.2) {
      while (lag < maxLag && normalizedDifference[lag + 1] < normalizedDifference[lag]) lag += 1;
      bestLag = lag;
      bestDifference = normalizedDifference[lag];
      break;
    }
    if (normalizedDifference[lag] < bestDifference) {
      bestLag = lag;
      bestDifference = normalizedDifference[lag];
    }
  }

  const confidence = 1 - bestDifference;
  if (bestLag < minLag || confidence < 0.8) return null;
  const before = normalizedDifference[bestLag - 1] ?? normalizedDifference[bestLag];
  const center = normalizedDifference[bestLag];
  const after = normalizedDifference[bestLag + 1] ?? center;
  const curvature = before - (2 * center) + after;
  const adjustment = curvature ? 0.5 * (before - after) / curvature : 0;
  const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, adjustment));
  return { pitch: frequencyToMidi(analysisRate / refinedLag) % 12, confidence };
}

async function startMonitoring() {
  if (mic) return;
  mic = new Tone.UserMedia();
  await mic.open();
  inputHighPass = new Tone.Filter(60, "highpass");
  inputLowPass = new Tone.Filter(1200, "lowpass");
  analyser = new Tone.Analyser("waveform", 4096);
  mic.connect(inputHighPass);
  inputHighPass.connect(inputLowPass);
  inputLowPass.connect(analyser);
  responseTimer = setInterval(() => {
    const detection = detectPitch(analyser.getValue(), Tone.getContext().sampleRate);
    const now = performance.now();
    if (!detection) {
      candidatePitch = null;
      candidateFrameCount = 0;
      if (lastPitch !== null && now - noteStartedAt >= Number(duration.value)) {
        if (responseActive) {
          recordResponseNote(lastPitch);
          renderLiveBlocks(call.length, responseNotes.length);
          pulseBlock(liveResponse);
        }
        lastPitch = null;
      }
      return;
    }
    const { pitch } = detection;

    if (pitch !== candidatePitch) {
      candidatePitch = pitch;
      candidateStartedAt = now;
      candidateFrameCount = 1;
      return;
    }
    candidateFrameCount += 1;
    if (candidateFrameCount < 3 || now - candidateStartedAt < Number(duration.value)) return;
    if (pitch === lastPitch) {
      if (responseActive && responseNotes.length < call.length && responseNotes.length === call.length - 1 && now - noteStartedAt >= Number(duration.value)) {
        recordResponseNote(lastPitch);
        renderLiveBlocks(call.length, responseNotes.length);
        pulseBlock(liveResponse);
      }
      return;
    }
    if (lastPitch !== null && responseActive && responseNotes.length < call.length) {
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
  const previousLevel = currentLevel;
  let levelAdvanced = false;
  let levelDropped = false;
  if (correct) {
    correctStreak += 1;
    incorrectStreak = 0;
    if (correctStreak === 3) {
      currentLevel += 1;
      correctStreak = 0;
      levelAdvanced = true;
      practiceCard.classList.remove("level-complete");
      void practiceCard.offsetWidth;
      practiceCard.classList.add("level-complete");
    }
  } else {
    incorrectStreak += 1;
    correctStreak = 0;
    if (incorrectStreak === 3) {
      currentLevel = Math.max(1, currentLevel - 1);
      incorrectStreak = 0;
      levelDropped = true;
    }
  }
  renderLiveBlocks(call.length, response.length, true);
  level.textContent = `Level ${currentLevel}`;
  const savedHighScore = Number(localStorage.getItem("call-response-high-score") || 0);
  const newHighScore = Math.max(savedHighScore, score);
  localStorage.setItem("call-response-high-score", newHighScore);
  highScoreDisplay.textContent = newHighScore;
  const outcome = correct ? "Correct response" : "Incorrect response";
  const levelChange = levelAdvanced
    ? ` Three correct in a row! Advancing to level ${currentLevel}.`
    : levelDropped && currentLevel < previousLevel
      ? ` Three incorrect in a row. Dropping to level ${currentLevel}.`
      : levelDropped
        ? " Three incorrect in a row. Staying at minimum level 1."
        : "";
  setStatus(`${outcome}.${levelChange}`, correct ? "success" : "");
  call = createCall(currentLevel);
  roundTimer = setTimeout(() => playSequence(), 900);
}

function resetGame() {
  clearTimeout(roundTimer);
  clearTimeout(listenTimer);
  playCall.hidden = true;
  startOver.hidden = false;
  responseActive = false;
  currentLevel = 1;
  correctStreak = 0;
  incorrectStreak = 0;
  lastPitch = null;
  candidatePitch = null;
  candidateStartedAt = 0;
  score = 0;
  scoreDisplay.textContent = score;
  sequencePanel.hidden = true;
  callDurations.length = 0;
  call = createCall(currentLevel);
  renderSequence();
  playSequence({ includeIntro: true });
}

playCall.addEventListener("click", resetGame);
startOver.addEventListener("click", resetGame);
tonic.addEventListener("change", () => {});
mode.addEventListener("change", () => {});
callTempo.addEventListener("input", () => {
  callTempoValue.textContent = `${callTempo.value} BPM`;
  localStorage.setItem("call-response-tempo", callTempo.value);
  updateDurationRecommendation();
});
duration.addEventListener("input", () => {
  durationValue.textContent = `${duration.value} ms`;
  localStorage.setItem("call-response-duration", duration.value);
});
threshold.addEventListener("input", () => {
  updateThresholdLabel();
  localStorage.setItem("call-response-threshold", threshold.value);
});
updateThresholdLabel();
startMonitoring().catch((error) => setStatus(`Microphone monitoring unavailable: ${error.message}`, "error"));
})();
