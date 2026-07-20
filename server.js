require('dotenv').config();
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
  console.log(`Enviando alerta diario para ${users.length} usuario(s)...`);

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
