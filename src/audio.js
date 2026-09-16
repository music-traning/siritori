// src/audio.js
let audioCtx = null;

export const initAudio = () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
};

const playTone = (freq, type, duration, startTime, vol = 0.5) => {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  
  gain.gain.setValueAtTime(vol, startTime);
  gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(startTime);
  osc.stop(startTime + duration);
};

export const playShutter = () => {
  initAudio();
  const now = audioCtx.currentTime;
  
  // Noise-like quick sweep for shutter
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
  
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(now);
  osc.stop(now + 0.1);
};

export const playSuccess = () => {
  initAudio();
  const now = audioCtx.currentTime;
  
  // Pop level up: C5, E5, G5, C6
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, i) => {
    playTone(freq, 'sine', 0.15, now + i * 0.08, 0.4);
    playTone(freq, 'triangle', 0.15, now + i * 0.08, 0.3);
  });
};

export const playFailure = () => {
  initAudio();
  const now = audioCtx.currentTime;
  
  // Buzzle: Low dissonant notes
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc1.type = 'sawtooth';
  osc2.type = 'square';
  
  osc1.frequency.setValueAtTime(150, now);
  osc1.frequency.linearRampToValueAtTime(100, now + 0.4);
  
  osc2.frequency.setValueAtTime(140, now);
  osc2.frequency.linearRampToValueAtTime(90, now + 0.4);
  
  gain.gain.setValueAtTime(0.5, now);
  gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
  
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.4);
  osc2.stop(now + 0.4);
};

export const playGameOver = () => {
  initAudio();
  const now = audioCtx.currentTime;
  
  // Descending tritone scale: C4, F#3, C3, F#2
  const notes = [261.63, 185.00, 130.81, 92.50];
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now + i * 0.3);
    if (i === notes.length - 1) {
      osc.frequency.exponentialRampToValueAtTime(40, now + i * 0.3 + 1.0);
    }
    
    gain.gain.setValueAtTime(0.5, now + i * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.3 + (i === notes.length - 1 ? 1.0 : 0.3));
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(now + i * 0.3);
    osc.stop(now + i * 0.3 + (i === notes.length - 1 ? 1.0 : 0.3));
  });
};
