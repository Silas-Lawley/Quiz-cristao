require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const twilio = require('twilio');
const cron = require('node-cron');

const store = require('./store');
const quiz = require('./quizLogic');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const { MessagingResponse } = twilio.twiml;
const GROUP_NAME = process.env.GROUP_NAME || 'Quiz Cristão';

// ---------- Cliente Twilio (para envio proativo, ex. alerta diario) ----------
let client = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('Twilio configurado: SIM (Account SID e Auth Token presentes).');
} else {
  console.log('Twilio configurado: NAO — TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ausentes. Mensagens proativas (alerta das 8h, resumo das 20h) NAO serao enviadas de verdade.');
}

async function sendWhatsApp(to, body) {
  if (!client) {
    console.log('[DEV] (sem credenciais Twilio, mensagem nao enviada de fato)', to, body);
    return;
  }
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body,
  });
}

// ---------- Webhook principal do WhatsApp ----------
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From; // ex: "whatsapp:+5511999999999"
  const bodyRaw = (req.body.Body || '').trim();
  const bodyLower = bodyRaw.toLowerCase();
  const twiml = new MessagingResponse();

  try {
    const reply = await handleIncoming(from, bodyRaw, bodyLower);
    if (reply) twiml.message(reply);
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
    twiml.message('Ops, tivemos um probleminha por aqui. Tente novamente em instantes.');
  }

  res.type('text/xml').send(twiml.toString());
});

async function handleIncoming(from, bodyRaw, bodyLower) {
  let user = store.getUser(from);

  // ---- Palavras-chave gerais ----
  if (['sair', 'parar', 'cancelar', 'stop'].includes(bodyLower)) {
    if (user) store.unsubscribe(from);
    return 'Voce foi removido da lista do Quiz Cristão. Para voltar, envie *INSCREVER* a qualquer momento. 🙏';
  }

  if (['inscrever', 'quero participar', 'start', 'startquiz'].includes(bodyLower)) {
    if (!user) {
      user = store.getOrCreateUser(from);
    } else if (!user.active) {
      user = store.resubscribe(from);
    }
    return (
      `Bem-vindo(a) ao *${GROUP_NAME}*! 🙌\n\n` +
      `Todos os dias voce vai receber um aviso quando as 3 perguntas do dia estiverem liberadas.\n` +
      `Quer comecar agora mesmo? Responda *INICIAR*.\n\n` +
      `Para sair a qualquer momento, envie *SAIR*.`
    );
  }

  if (!user) {
    return (
      `Ola! 👋 Este e o *${GROUP_NAME}*, um quiz diario com perguntas sobre a Biblia, personagens biblicos, o ministerio de Jesus e a mensagem do evangelho.\n\n` +
      `Para se inscrever, responda *INSCREVER*.`
    );
  }

  const todayKey = quiz.dayKey(new Date());

  if (bodyLower === 'iniciar') {
    return startTodayQuiz(user);
  }

  if (user.awaitingAnswer) {
    if (store.isDayClosed(todayKey)) {
      // dia encerrado no meio da resposta (ex: pergunta enviada antes das 20h,
      // resposta chegou depois)
      store.updateUser(user.phone, { awaitingAnswer: false });
      return `⏰ As perguntas de hoje ja foram encerradas as 20h. O resumo com o indice de acerto ja foi enviado. Volte amanha as 8h!`;
    }
    return handleAnswer(user, bodyRaw);
  }

  if (user.awaitingContinue) {
    return handleContinue(user, bodyLower);
  }

  // já respondeu hoje ou nao esta em meio a uma pergunta
  if (user.daysPlayed.includes(todayKey)) {
    return `Voce ja concluiu o quiz de hoje! Volte amanha para novas perguntas. Envie *SAIR* se quiser cancelar as notificacoes.`;
  }

  if (store.isDayClosed(todayKey)) {
    return `⏰ As perguntas de hoje ja foram encerradas as 20h. O resumo com o indice de acerto ja foi enviado. Volte amanha as 8h!`;
  }

  return `Nao entendi. Responda *INICIAR* para comecar o quiz de hoje, ou *SAIR* para cancelar.`;
}

function startTodayQuiz(user) {
  const todayKey = quiz.dayKey(new Date());
  if (user.daysPlayed.includes(todayKey)) {
    return `Voce ja concluiu o quiz de hoje! Volte amanha para novas perguntas.`;
  }
  if (store.isDayClosed(todayKey)) {
    return `⏰ As perguntas de hoje ja foram encerradas as 20h. Volte amanha as 8h para as novas perguntas!`;
  }
  const questions = quiz.getTodaysQuestions(new Date());
  store.updateUser(user.phone, {
    currentDayKey: todayKey,
    currentQuestionIndex: 0,
    correctToday: 0,
    awaitingAnswer: true,
  });
  return quiz.formatQuestion(questions[0], 0, questions.length);
}

function handleAnswer(user, bodyRaw) {
  const questions = quiz.getTodaysQuestions(new Date());
  const idx = user.currentQuestionIndex;
  const item = questions[idx];
  const choice = parseInt(bodyRaw, 10) - 1;

  if (isNaN(choice) || choice < 0 || choice >= item.opts.length) {
    return `Por favor responda apenas com o numero da alternativa (1-${item.opts.length}).`;
  }

  const isCorrect = choice === item.correct;
  const newCorrectToday = user.correctToday + (isCorrect ? 1 : 0);
  const feedback = quiz.formatFeedback(item, isCorrect);

  // registra no indice de acerto global desta pergunta (para o resumo das 20h)
  store.recordQuestionAnswer(quiz.dayKey(new Date()), idx, isCorrect);

  const nextIndex = idx + 1;
  if (nextIndex < questions.length) {
    // nao envia a proxima pergunta ainda: corrige primeiro e espera confirmacao
    store.updateUser(user.phone, {
      currentQuestionIndex: nextIndex,
      correctToday: newCorrectToday,
      awaitingAnswer: false,
      awaitingContinue: true,
    });
    return `${feedback}\n\nDeseja continuar para a próxima pergunta? Responda *SIM* para continuar.`;
  }

  // ultima pergunta do dia: fecha o quiz e monta resumo
  const todayKey = quiz.dayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = quiz.dayKey(yesterday);
  const newStreak = user.lastPlayedKey === yKey ? user.streak + 1 : 1;

  const updated = store.updateUser(user.phone, {
    awaitingAnswer: false,
    currentQuestionIndex: 0,
    correctToday: 0,
    daysPlayed: [...user.daysPlayed, todayKey],
    totalCorrect: user.totalCorrect + newCorrectToday,
    totalAnswered: user.totalAnswered + questions.length,
    streak: newStreak,
    lastPlayedKey: todayKey,
  });

  const summary = quiz.formatSummary(updated, newCorrectToday, questions.length);
  return `${feedback}\n\n${summary}`;
}

const AFFIRMATIVE_WORDS = ['sim', 's', 'continuar', 'ok', 'proxima', 'próxima', 'vamos', 'bora', 'yes'];

function handleContinue(user, bodyLower) {
  if (!AFFIRMATIVE_WORDS.includes(bodyLower)) {
    return `Não entendi. Responda *SIM* para ver a próxima pergunta, ou *SAIR* para cancelar as notificações.`;
  }

  const todayKey = quiz.dayKey(new Date());
  if (store.isDayClosed(todayKey)) {
    store.updateUser(user.phone, { awaitingContinue: false });
    return `⏰ As perguntas de hoje ja foram encerradas as 20h. O resumo com o indice de acerto ja foi enviado. Volte amanha as 8h!`;
  }

  const questions = quiz.getTodaysQuestions(new Date());
  const idx = user.currentQuestionIndex;
  store.updateUser(user.phone, { awaitingContinue: false, awaitingAnswer: true });
  return quiz.formatQuestion(questions[idx], idx, questions.length);
}

// ---------- Alerta diario (envio proativo) ----------
// IMPORTANTE: fora da janela de 24h de conversa, o WhatsApp exige um template
// pre-aprovado (Message Template) para mensagens iniciadas pela empresa.
// Em modo sandbox da Twilio isso nao se aplica, mas em producao (numero oficial)
// sera necessario criar e aprovar um template equivalente a este texto.
async function sendDailyAlerts() {
  const users = store.getAllActiveUsers();
  const todayKey = quiz.dayKey(new Date());
  console.log(`[CRON 8h] Disparado as ${new Date().toString()}. Twilio configurado: ${!!client}. Inscritos ativos: ${users.length}.`);
  if (!client) {
    console.log('[CRON 8h] AVISO: Twilio nao configurado — nenhuma mensagem real sera enviada (apenas log).');
  }
  if (users.length === 0) {
    console.log('[CRON 8h] AVISO: nenhum inscrito ativo encontrado. Verifique /admin/debug para checar se os dados persistiram.');
  }

  for (const user of users) {
    if (user.lastDailyAlertKey === todayKey) continue; // ja avisado hoje
    try {
      await sendWhatsApp(
        user.phone,
        `☀️ Bom dia! As perguntas de hoje do *${GROUP_NAME}* ja estao disponiveis.\n\nResponda *INICIAR* quando quiser comecar.`
      );
      store.updateUser(user.phone, { lastDailyAlertKey: todayKey });
    } catch (err) {
      console.error(`Falha ao enviar para ${user.phone}:`, err.message);
    }
  }
}

// ---------- Encerramento diario (20h) + resumo com indice de acerto ----------
// Fecha a possibilidade de responder e envia a TODOS os inscritos (nao so quem
// respondeu) o resumo com o percentual de acerto de cada pergunta do dia.
async function closeDayAndBroadcast() {
  const todayKey = quiz.dayKey(new Date());
  const meta = store.getDayMeta(todayKey);

  if (meta.summarySent) {
    console.log(`Resumo de ${todayKey} ja havia sido enviado, pulando.`);
    return;
  }

  store.updateDayMeta(todayKey, { closed: true });

  const questions = quiz.getTodaysQuestions(new Date());
  const broadcast = quiz.formatClosingBroadcast(todayKey, questions, meta.questionStats || []);

  const users = store.getAllActiveUsers();
  console.log(`Encerrando o dia ${todayKey} e enviando resumo para ${users.length} usuario(s)...`);

  for (const user of users) {
    // se alguem ainda estava no meio de uma pergunta (ou esperando confirmar
    // a proxima), encerra a sessao dele
    if (user.awaitingAnswer || user.awaitingContinue) {
      store.updateUser(user.phone, { awaitingAnswer: false, awaitingContinue: false });
    }
    try {
      await sendWhatsApp(user.phone, broadcast);
    } catch (err) {
      console.error(`Falha ao enviar resumo para ${user.phone}:`, err.message);
    }
  }

  store.updateDayMeta(todayKey, { summarySent: true });
}

const cronExpr = process.env.DAILY_CRON || '0 8 * * *';
const closeCronExpr = process.env.CLOSE_CRON || '0 20 * * *';
const timezone = process.env.TIMEZONE || 'America/Sao_Paulo';
cron.schedule(cronExpr, sendDailyAlerts, { timezone });
cron.schedule(closeCronExpr, closeDayAndBroadcast, { timezone });

// ---------- Rotas de teste manual ----------
app.post('/admin/send-daily-alerts', async (req, res) => {
  await sendDailyAlerts();
  res.json({ ok: true });
});

app.post('/admin/close-day', async (req, res) => {
  await closeDayAndBroadcast();
  res.json({ ok: true });
});

// ---------- Painel de estatisticas (protegido por token) ----------
function maskPhone(phone) {
  // whatsapp:+5511999998888 -> +55 11 9****-8888 (aproximado, so pra nao expor o numero inteiro)
  const digits = phone.replace('whatsapp:', '');
  if (digits.length <= 4) return digits;
  return digits.slice(0, -8) + '****' + digits.slice(-4);
}

function buildStatsHTML() {
  const users = store.getAllUsersRaw();
  const dayStats = store.getAllDayStats();
  const activeUsers = users.filter(u => u.active);

  const totalEver = users.length;
  const totalActive = activeUsers.length;

  const dayKeys = Object.keys(dayStats).sort().reverse();

  // participacao por dia + acumulado por categoria
  let globalCorrect = 0;
  let globalTotal = 0;
  const categoryAcc = {}; // cat -> {correct, total}

  const dayRows = dayKeys.map(dk => {
    const meta = dayStats[dk];
    const stats = meta.questionStats || [];
    const [y, m, d] = dk.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    let questions = [];
    try {
      questions = quiz.getTodaysQuestions(dateObj);
    } catch (e) {
      questions = [];
    }
    let dayCorrect = 0;
    let dayTotal = 0;
    stats.forEach((s, i) => {
      dayCorrect += s.correct || 0;
      dayTotal += s.total || 0;
      globalCorrect += s.correct || 0;
      globalTotal += s.total || 0;
      const cat = questions[i] ? questions[i].cat : 'desconhecida';
      if (!categoryAcc[cat]) categoryAcc[cat] = { correct: 0, total: 0 };
      categoryAcc[cat].correct += s.correct || 0;
      categoryAcc[cat].total += s.total || 0;
    });
    const participantes = stats.length > 0 ? Math.max(...stats.map(s => s.total || 0)) : 0;
    const pct = dayTotal > 0 ? Math.round((dayCorrect / dayTotal) * 100) : 0;
    return { dk, participantes, pct, closed: !!meta.closed };
  });

  const globalPct = globalTotal > 0 ? Math.round((globalCorrect / globalTotal) * 100) : 0;

  const catLabels = quiz.CATEGORY_LABELS || {};
  const categoryRows = Object.entries(categoryAcc)
    .map(([cat, s]) => ({
      cat: catLabels[cat] || cat,
      pct: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      total: s.total,
    }))
    .sort((a, b) => b.total - a.total);

  const topStreaks = users
    .slice()
    .sort((a, b) => (b.streak || 0) - (a.streak || 0))
    .slice(0, 5)
    .map(u => ({ phone: maskPhone(u.phone), streak: u.streak || 0, daysPlayed: (u.daysPlayed || []).length }));

  const rowsHtml = dayRows
    .slice(0, 30)
    .map(
      r => `<tr><td>${r.dk}${r.closed ? '' : ' <span class="tag">em andamento</span>'}</td><td>${r.participantes}</td><td>${r.pct}%</td></tr>`
    )
    .join('');

  const catHtml = categoryRows
    .map(c => `<tr><td>${c.cat}</td><td>${c.pct}%</td><td>${c.total}</td></tr>`)
    .join('');

  const streakHtml = topStreaks
    .map(s => `<tr><td>${s.phone}</td><td>${s.streak} dia(s)</td><td>${s.daysPlayed}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Estatísticas — ${GROUP_NAME}</title>
<style>
  body { font-family: Georgia, serif; background: #f4efe6; color: #2c2a26; padding: 24px; max-width: 780px; margin: 0 auto; }
  h1 { color: #8a6a22; }
  h2 { color: #8a6a22; margin-top: 32px; font-size: 1.1rem; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
  .card { background: #fff; border: 1px solid #e6ddca; border-radius: 10px; padding: 14px 18px; min-width: 140px; }
  .card .num { font-size: 1.6rem; font-weight: bold; color: #8a6a22; display: block; }
  .card .label { font-size: 0.8rem; color: #6b675f; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e6ddca; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e6ddca; font-size: 0.9rem; }
  th { background: #faf6ec; }
  .tag { font-size: 0.7rem; color: #a9812e; }
</style>
</head>
<body>
  <h1>📊 Estatísticas — ${GROUP_NAME}</h1>
  <div class="cards">
    <div class="card"><span class="num">${totalActive}</span><span class="label">Inscritos ativos</span></div>
    <div class="card"><span class="num">${totalEver}</span><span class="label">Já se inscreveram (total)</span></div>
    <div class="card"><span class="num">${dayKeys.length}</span><span class="label">Dias com atividade</span></div>
    <div class="card"><span class="num">${globalPct}%</span><span class="label">Acerto geral (${globalCorrect}/${globalTotal})</span></div>
  </div>

  <h2>Participação por dia (últimos 30)</h2>
  <table><tr><th>Dia</th><th>Participantes</th><th>% acerto do dia</th></tr>${rowsHtml || '<tr><td colspan="3">Sem dados ainda.</td></tr>'}</table>

  <h2>Acerto por categoria</h2>
  <table><tr><th>Categoria</th><th>% acerto</th><th>Respostas</th></tr>${catHtml || '<tr><td colspan="3">Sem dados ainda.</td></tr>'}</table>

  <h2>Maiores sequências (streak)</h2>
  <table><tr><th>Usuário</th><th>Sequência</th><th>Dias jogados</th></tr>${streakHtml || '<tr><td colspan="3">Sem dados ainda.</td></tr>'}</table>
</body>
</html>`;
}

// ---------- Diagnostico (protegido por token) ----------
// Ajuda a descobrir por que um alerta proativo (8h/20h) pode nao ter chegado,
// sem precisar vasculhar o dashboard do Render manualmente.
app.get('/admin/debug', (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.query.token !== token) {
    return res.status(401).json({ erro: 'Acesso negado. Adicione ?token=SEU_TOKEN na URL.' });
  }

  let discoGravavel = true;
  let erroDisco = null;
  try {
    const testPath = path.join(store.DATA_DIR, '.write-test');
    fs.writeFileSync(testPath, String(Date.now()));
    fs.unlinkSync(testPath);
  } catch (e) {
    discoGravavel = false;
    erroDisco = e.message;
  }

  const activeUsers = store.getAllActiveUsers();
  const todayKey = quiz.dayKey(new Date());

  res.json({
    horarioAgoraNoServidor: new Date().toString(),
    timezoneConfigurada: process.env.TIMEZONE || 'America/Sao_Paulo (padrao)',
    dailyCron: process.env.DAILY_CRON || '0 8 * * * (padrao)',
    closeCron: process.env.CLOSE_CRON || '0 20 * * * (padrao)',
    twilioConfigurado: !!client,
    numeroWhatsappConfigurado: process.env.TWILIO_WHATSAPP_NUMBER || '(nao definido)',
    pastaDeDados: store.DATA_DIR,
    discoGravavel,
    erroDisco,
    totalInscritosAtivos: activeUsers.length,
    inscritos: activeUsers.map(u => ({
      telefone: maskPhone(u.phone),
      inscritoEm: u.subscribedAt,
      ultimoAlertaRecebidoNoDia: u.lastDailyAlertKey,
      diasJogados: (u.daysPlayed || []).length,
    })),
    diaDeHoje: todayKey,
    statsDeHoje: store.getDayMeta(todayKey),
  });
});

app.get('/admin/stats', (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (token && req.query.token !== token) {
    return res.status(401).send('Acesso negado. Adicione ?token=SEU_TOKEN na URL.');
  }
  res.type('text/html').send(buildStatsHTML());
});

app.get('/', (req, res) => {
  res.send(`${GROUP_NAME} - servidor rodando.`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor do ${GROUP_NAME} rodando na porta ${PORT}`);
  console.log(`Webhook do WhatsApp: POST /whatsapp`);
  console.log(`Alerta diario agendado: "${cronExpr}" (${timezone})`);
});

module.exports = { app, handleIncoming };
