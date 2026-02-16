/**
 * FERIXDI Studio — UI Sound Engine v1
 * Синтезированные звуки через Web Audio API (без внешних файлов)
 * Минималистичные, приятные, sci-fi эстетика
 */

let _ctx = null;
let _enabled = true;
let _volume = 0.15; // Тихие, ненавязчивые

function _getCtx() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { _enabled = false; }
  }
  if (_ctx && _ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// ─── БАЗОВЫЕ ГЕНЕРАТОРЫ ─────────────────────

function _play(fn) {
  if (!_enabled) return;
  const ctx = _getCtx();
  if (!ctx) return;
  try { fn(ctx); } catch { /* silent fail */ }
}

// ─── ЗВУКИ ──────────────────────────────────

/** Мягкий клик — для обычных кнопок */
export function clickSoft() {
  _play(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(_volume * 0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.08);
  });
}

/** Навигационный свуш — для переходов между секциями */
export function nav() {
  _play(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(_volume * 0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  });
}

/** Выбор элемента — для карточек персонажей/локаций */
export function select() {
  _play(ctx => {
    const t = ctx.currentTime;
    // Двойной тон (pling)
    [880, 1100].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(_volume * 0.5, t + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.1);
    });
  });
}

/** Успех — для завершения генерации, копирования */
export function success() {
  _play(ctx => {
    const t = ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(_volume * 0.5, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.08); osc.stop(t + i * 0.08 + 0.15);
    });
  });
}

/** Ошибка / предупреждение — мягкий двойной низкий тон */
export function error() {
  _play(ctx => {
    const t = ctx.currentTime;
    [300, 220].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(_volume * 0.5, t + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.1); osc.stop(t + i * 0.1 + 0.12);
    });
  });
}

/** Переключатель / toggle */
export function toggle() {
  _play(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(_volume * 0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.06);
  });
}

/** Hover — едва слышный для наведения */
export function hover() {
  _play(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(_volume * 0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.03);
  });
}

/** Генерация старт — sci-fi восходящий тон */
export function generate() {
  _play(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(_volume * 0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    // Фильтр для мягкости
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
  });
}

/** Уведомление — мягкий колокольчик */
export function notify() {
  _play(ctx => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1047; // C6
    gain.gain.setValueAtTime(_volume * 0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
  });
}

/** Копирование в буфер */
export function copy() {
  _play(ctx => {
    const t = ctx.currentTime;
    [1047, 1318].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(_volume * 0.35, t + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.05); osc.stop(t + i * 0.05 + 0.08);
    });
  });
}

// ─── УПРАВЛЕНИЕ ─────────────────────────────

export function setEnabled(v) { _enabled = !!v; }
export function isEnabled() { return _enabled; }
export function setVolume(v) { _volume = Math.max(0, Math.min(1, v)); }

// ─── ГЛОБАЛЬНЫЙ ОБЪЕКТ ──────────────────────
export const sfx = {
  clickSoft, nav, select, success, error,
  toggle, hover, generate, notify, copy,
  setEnabled, isEnabled, setVolume,
};
