const BANK = require('./questions');

const PER_DAY = 3;
const TOTAL_BLOCKS = Math.floor(BANK.length / PER_DAY);
const EPOCH = new Date(2026, 0, 1); // mesma referencia usada no quiz web, mantem os dois sincronizados

const CATEGORY_LABELS = {
  geral: 'Conhecimento Biblico',
  evangelho: 'Mensagem do Evangelho',
  personagens: 'Personagens Biblicos',
  ministerio: 'Ministerio de Jesus',
  sangue: 'O Poder do Sangue de Jesus',
  panorama: 'Panorama Biblico',
};

function dayKey(date) {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}

function blockIndexForDate(date) {
  const diff = Math.floor((date - EPOCH) / 86400000);
  return ((diff % TOTAL_BLOCKS) + TOTAL_BLOCKS) % TOTAL_BLOCKS;
}

function getTodaysQuestions(date = new Date()) {
  const block = blockIndexForDate(date);
  return BANK.slice(block * PER_DAY, block * PER_DAY + PER_DAY);
}

function formatQuestion(item, index, total) {
  const catLabel = CATEGORY_LABELS[item.cat] || item.cat;
  let msg = `*Pergunta ${index + 1} de ${total}* _(${catLabel})_\n\n${item.q}\n\n`;
  item.opts.forEach((opt, i) => {
    msg += `${i + 1}. ${opt}\n`;
  });
  msg += `\nResponda com o numero da alternativa (1-${item.opts.length}).`;
  return msg;
}

function formatFeedback(item, isCorrect) {
  const head = isCorrect ? '✅ Certo!' : '❌ Nao foi dessa vez.';
  return `${head}\n\n📖 *${item.ref}*\n${item.exp}`;
}

function formatSummary(user, correctToday, totalToday) {
  const pct = user.totalAnswered > 0 ? Math.round((user.totalCorrect / user.totalAnswered) * 100) : 0;
  return (
    `🏁 *Quiz de hoje concluido!*\n\n` +
    `Voce acertou ${correctToday} de ${totalToday} hoje.\n\n` +
    `📊 *Seu historico*\n` +
    `Dias participados: ${user.daysPlayed.length}\n` +
    `Sequencia atual: ${user.streak} dia(s)\n` +
    `Indice de acerto total: ${pct}% (${user.totalCorrect}/${user.totalAnswered})\n\n` +
    `Ate amanha! 🙏`
  );
}

function formatClosingBroadcast(dayKey, questions, questionStats) {
  let msg = `⏰ *As perguntas de hoje (${dayKey}) foram encerradas.*\n\nAqui está o índice de acerto de cada uma:\n\n`;
  questions.forEach((item, i) => {
    const stat = questionStats[i] || { correct: 0, total: 0 };
    const pct = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : null;
    const pctLabel = pct === null ? 'sem respostas hoje' : `${pct}% acertaram (${stat.correct}/${stat.total})`;
    msg += `*Pergunta ${i + 1}:* ${item.q}\n📖 ${item.ref} — ${pctLabel}\n\n`;
  });
  msg += `Amanhã tem mais 3 perguntas, a partir das 8h. Até lá! 🙏`;
  return msg;
}

module.exports = {
  PER_DAY,
  dayKey,
  getTodaysQuestions,
  formatQuestion,
  formatFeedback,
  formatSummary,
  formatClosingBroadcast,
  CATEGORY_LABELS,
};
