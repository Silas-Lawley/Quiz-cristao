// Armazenamento simples em arquivo JSON.
// Para uso com mais usuarios/producao seria melhor trocar por um banco real
// (Postgres, SQLite, etc), mas para comecar isso funciona sem dependencias extras.
const fs = require('fs');
const path = require('path');

// DATA_DIR pode ser configurado via variavel de ambiente para apontar para um
// disco persistente (ex: em hospedagens como o Render, onde o disco do projeto
// e apagado a cada deploy, exceto a pasta montada como disco persistente).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'users.json');
const STATS_PATH = path.join(DATA_DIR, 'dayStats.json');

function ensureFile(filePath, fallback) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
}

function loadAll() {
  ensureFile(DB_PATH, {});
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveAll(data) {
  ensureFile(DB_PATH, {});
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------- Estatisticas/estado do dia (por dayKey, ex "2026-07-17") ----------
// Guarda: se o dia ja foi encerrado (closed), se o resumo ja foi enviado
// (summarySent) e, para cada indice de pergunta (0,1,2), quantos acertaram e
// quantos responderam ao todo.
function loadStats() {
  ensureFile(STATS_PATH, {});
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveStats(data) {
  ensureFile(STATS_PATH, {});
  fs.writeFileSync(STATS_PATH, JSON.stringify(data, null, 2));
}

function defaultDayMeta() {
  return { closed: false, summarySent: false, questionStats: [] };
}

function getDayMeta(dayKey) {
  const all = loadStats();
  return all[dayKey] || defaultDayMeta();
}

function updateDayMeta(dayKey, patch) {
  const all = loadStats();
  const current = all[dayKey] || defaultDayMeta();
  all[dayKey] = { ...current, ...patch };
  saveStats(all);
  return all[dayKey];
}

function recordQuestionAnswer(dayKey, questionIndex, isCorrect) {
  const all = loadStats();
  const meta = all[dayKey] || defaultDayMeta();
  if (!meta.questionStats[questionIndex]) meta.questionStats[questionIndex] = { correct: 0, total: 0 };
  meta.questionStats[questionIndex].total += 1;
  if (isCorrect) meta.questionStats[questionIndex].correct += 1;
  all[dayKey] = meta;
  saveStats(all);
  return meta;
}

function isDayClosed(dayKey) {
  return !!getDayMeta(dayKey).closed;
}

function defaultUser(phone) {
  return {
    phone,
    subscribedAt: new Date().toISOString(),
    active: true,
    // progresso do dia atual
    currentDayKey: null,       // ex "2026-07-17"
    currentQuestionIndex: 0,   // 0,1,2
    correctToday: 0,
    awaitingAnswer: false,
    awaitingContinue: false,   // true = ja corrigiu a pergunta, esperando "SIM" pra ir pra proxima
    lastDailyAlertKey: null,   // ultimo dia em que recebeu o alerta
    // historico
    daysPlayed: [],            // lista de dayKeys já concluidos
    totalCorrect: 0,
    totalAnswered: 0,
    streak: 0,
    lastPlayedKey: null,
  };
}

function getUser(phone) {
  const all = loadAll();
  return all[phone] || null;
}

function getOrCreateUser(phone) {
  const all = loadAll();
  if (!all[phone]) {
    all[phone] = defaultUser(phone);
    saveAll(all);
  }
  return all[phone];
}

function updateUser(phone, patch) {
  const all = loadAll();
  if (!all[phone]) all[phone] = defaultUser(phone);
  all[phone] = { ...all[phone], ...patch };
  saveAll(all);
  return all[phone];
}

function getAllActiveUsers() {
  const all = loadAll();
  return Object.values(all).filter(u => u.active);
}

function getAllUsersRaw() {
  const all = loadAll();
  return Object.values(all);
}

function getAllDayStats() {
  return loadStats();
}

function unsubscribe(phone) {
  return updateUser(phone, { active: false });
}

function resubscribe(phone) {
  return updateUser(phone, { active: true });
}

module.exports = {
  getUser,
  getOrCreateUser,
  updateUser,
  getAllActiveUsers,
  getAllUsersRaw,
  getAllDayStats,
  unsubscribe,
  resubscribe,
  getDayMeta,
  updateDayMeta,
  recordQuestionAnswer,
  isDayClosed,
  DATA_DIR,
};
