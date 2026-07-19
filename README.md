# Quiz Cristão — Bot de WhatsApp

Bot que envia 3 perguntas cristãs por dia via WhatsApp: alerta diário, perguntas uma de cada vez, correção com referência bíblica, encerramento às 20h com resumo do índice de acerto de cada pergunta, e resumo pessoal de desempenho (dias participados, sequência, % de acerto histórico).

Banco de **102 perguntas** (34 dias sem repetir), divididas em 6 temas:
- Conhecimento Bíblico geral
- Mensagem do Evangelho
- Personagens Bíblicos
- Ministério de Jesus
- O Poder do Sangue de Jesus
- Panorama Bíblico

## O que você precisa antes de rodar

1. **Conta Twilio** (grátis para testar): https://www.twilio.com/try-twilio
2. **Node.js 18+** instalado na máquina onde for rodar.
3. Um jeito de expor seu servidor local à internet durante o desenvolvimento (ex: [ngrok](https://ngrok.com)), ou um serviço de hospedagem (Render, Railway, Fly.io) para produção.

## Passo a passo — Twilio Sandbox (para testar)

1. Crie a conta na Twilio e acesse o [Console](https://console.twilio.com).
2. No menu lateral, vá em **Messaging → Try it out → Send a WhatsApp message**. Isso ativa o **WhatsApp Sandbox**.
3. Você verá um número (ex: `+1 415 523 8886`) e um código de ativação (ex: `join palavra-chave`).
4. Copie o **Account SID** e o **Auth Token** (na página inicial do Console) para o arquivo `.env` (veja abaixo).
5. Para um usuário se inscrever durante os testes, ele precisa primeiro enviar `join palavra-chave` para o número do sandbox pelo WhatsApp dele — isso é uma exigência da Twilio no modo sandbox (não existe em produção com número próprio aprovado).

## Configuração do projeto

```bash
cd quiz-cristao
npm install
cp .env.example .env
# edite o .env com seu Account SID, Auth Token e número do sandbox
npm start
```

O servidor sobe em `http://localhost:3000`.

## Conectando o webhook

1. Rode `ngrok http 3000` (ou equivalente) para gerar uma URL pública, ex: `https://abc123.ngrok.app`.
2. No Console da Twilio, na página do Sandbox de WhatsApp, cole em **"When a message comes in"**:
   `https://abc123.ngrok.app/whatsapp` (método POST).
3. Salve. Pronto — mensagens recebidas no sandbox agora chegam no seu servidor.

## Como funciona o fluxo

1. **Inscrição**: usuário envia `INSCREVER` (ou clica em um link `wa.me` pré-preenchido — veja abaixo).
2. **Alerta diário (08:00)**: todo dia às 08:00 (`America/Sao_Paulo`, configurável no `.env` via `DAILY_CRON`), o bot envia uma mensagem avisando que as perguntas do dia estão liberadas.
3. Usuário responde `INICIAR` → recebe a pergunta 1 de 3, com alternativas numeradas.
4. Responde com o número da alternativa → bot corrige, mostra a referência bíblica e a explicação, e envia a próxima pergunta.
5. Ao final da 3ª pergunta, o bot envia o resumo pessoal: acertos do dia, dias participados, sequência atual e % de acerto histórico.
6. **Encerramento (20:00)**: às 20:00 (configurável via `CLOSE_CRON`), o dia é fechado — ninguém mais consegue responder (quem estava no meio de uma pergunta recebe aviso de encerramento) — e o bot envia **a todos os inscritos** (respondendo ou não) um resumo com o índice de acerto de cada uma das 3 perguntas do dia (ex: "Pergunta 2: 45% acertaram").
7. `SAIR` cancela as notificações a qualquer momento.

### Rotas de teste manual (sem esperar o horário do cron)

- `POST /admin/send-daily-alerts` — dispara o alerta das 8h na hora.
- `POST /admin/close-day` — dispara o encerramento das 20h e o resumo de índice de acerto na hora.

## Link de inscrição (estilo "wa.me")

Para produção (número aprovado, sem sandbox), o link fica assim:

```
https://wa.me/SEUNUMERO?text=INSCREVER
```

No modo sandbox, use:

```
https://wa.me/14155238886?text=join%20SUA-PALAVRA-CHAVE
```
(depois disso o usuário precisa mandar `INSCREVER` manualmente uma vez, já que o texto pré-preenchido do sandbox é reservado para o `join`).

## ⚠️ Importante para produção (fora do sandbox)

O WhatsApp exige que mensagens **iniciadas pela empresa** fora de uma janela de 24h de conversa usem um **Message Template pré-aprovado** pela Meta. Isso afeta o **alerta diário das 8h** e o **resumo das 20h**.

Para colocar em produção de verdade, você vai precisar:
1. Migrar do sandbox para um **número de WhatsApp Business API aprovado** (via Twilio ou Meta Cloud API diretamente).
2. Criar e submeter **templates de mensagem** para o alerta diário e para o resumo das 20h, para aprovação da Meta (leva de horas a poucos dias).
3. Trocar as chamadas de envio (`sendDailyAlerts` e `closeDayAndBroadcast` em `server.js`) para usar esses templates aprovados em vez de texto livre.

## Sobre o conteúdo das perguntas

As perguntas novas de personagens bíblicos, ministério de Jesus, sangue de Jesus e panorama bíblico foram escritas originalmente a partir das Escrituras, usando como guia de temas os materiais que você enviou (200 Personagens Bíblicos, Os 3 anos do ministério de Jesus, O poder do sangue de Jesus e Panorama Bíblico). O texto desses materiais é protegido por direitos autorais e de uso pessoal (conforme os próprios "Termos de Uso" nos PDFs), então não foi copiado ou parafraseado — cada pergunta e explicação aqui é redigida com base direta na Bíblia, não no conteúdo proprietário dos e-books.

## Estrutura dos arquivos

- `server.js` — servidor Express, webhook do WhatsApp, agendamento do alerta diário e do encerramento das 20h.
- `quizLogic.js` — lógica de rotação diária das perguntas, formatação de mensagens e do resumo de índice de acerto.
- `questions.js` — banco de 102 perguntas (6 categorias).
- `store.js` — armazenamento simples em JSON (`data/users.json` e `data/dayStats.json`) com progresso, histórico e estatísticas do dia.
- `.env.example` — modelo de variáveis de ambiente.

## Hospedagem (produção)

Quando quiser deixar isso rodando de verdade (sem depender do seu computador ligado), pode subir em serviços como [Render](https://render.com) ou [Railway](https://railway.app) — ambos têm camada gratuita/barata, suportam Node.js diretamente, e bastam duas coisas: configurar as variáveis de ambiente do `.env` no painel deles, e apontar o webhook da Twilio para a URL pública que eles geram.
