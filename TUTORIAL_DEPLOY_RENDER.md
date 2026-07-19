# Tutorial: colocar o Quiz Cristão no ar (Render + GitHub)

Este tutorial assume que você **não** tem experiência com terminal/linha de comando — tudo é feito pelo navegador. Custo estimado: **~US$ 7,25/mês** (US$ 7 do servidor + US$ 0,25 do disco que guarda os dados dos inscritos).

Tempo estimado: 20-30 minutos.

---

## Parte 1 — Colocar o código no GitHub

O GitHub é onde o código vai ficar guardado, e é de lá que o Render vai "puxar" o projeto.

### 1.1 Criar conta no GitHub (pule se já tiver uma)

1. Acesse **https://github.com/signup**.
2. Preencha e-mail, senha e nome de usuário.
3. Confirme o e-mail que o GitHub enviar.

### 1.2 Criar um repositório novo

1. Logado no GitHub, clique no **+** no canto superior direito → **New repository**.
2. Em "Repository name", coloque `quiz-cristao`.
3. Marque como **Private** (assim só você vê o código).
4. Não marque nenhuma opção de "Add a README" — deixe em branco.
5. Clique em **Create repository**.

### 1.3 Subir os arquivos do projeto

1. Na página do repositório recém-criado, clique no link **"uploading an existing file"** (aparece no meio da página).
2. Agora, no seu computador, abra a pasta `quiz-cristao` que eu te entreguei.
3. **Selecione todos os arquivos de DENTRO da pasta** (não a pasta em si) — ou seja, entre na pasta `quiz-cristao` e selecione `server.js`, `store.js`, `quizLogic.js`, `questions.js`, `package.json`, `render.yaml`, `.gitignore`, `README.md` etc.
   - ⚠️ **Não envie o arquivo `.env`** — ele tem suas senhas da Twilio. Se aparecer na lista de seleção, desmarque/remova antes de arrastar.
   - Também não precisa enviar a pasta `data/` nem `node_modules/` se existirem.
4. Arraste todos esses arquivos selecionados para a área de upload do GitHub.
5. Role para baixo e clique em **Commit changes**.

Pronto — o código está no GitHub, pronto para o Render usar.

---

## Parte 2 — Criar o serviço no Render

### 2.1 Criar conta no Render

1. Acesse **https://render.com** → **Get Started**.
2. Escolha **"Sign up with GitHub"** — isso já conecta as duas contas automaticamente.
3. Autorize o Render a acessar seus repositórios (pode escolher "Only select repositories" e marcar apenas `quiz-cristao`).

### 2.2 Criar o Web Service a partir do Blueprint

O projeto já vem com um arquivo `render.yaml`, que diz ao Render exatamente como configurar tudo (incluindo o disco persistente).

1. No painel do Render, clique em **New +** → **Blueprint**.
2. Selecione o repositório `quiz-cristao`.
3. O Render vai ler o `render.yaml` e mostrar o serviço `quiz-cristao` pronto para criar, já no plano **Starter** com **1GB de disco**.
4. Clique em **Apply** (ou **Create**).

Se por algum motivo a opção "Blueprint" não aparecer ou der erro, alternativa manual:

<details>
<summary>Clique aqui para o passo a passo manual (caso o Blueprint falhe)</summary>

1. **New +** → **Web Service** → selecione o repositório `quiz-cristao`.
2. Name: `quiz-cristao`.
3. Runtime: `Node`.
4. Build Command: `npm install`.
5. Start Command: `npm start`.
6. Instance Type: **Starter ($7/mês)**.
7. Depois de criado, vá em **Disks** (menu lateral do serviço) → **Add Disk**: Name `quiz-cristao-data`, Mount Path `/data`, Size `1 GB`.
8. Vá em **Environment** e adicione as variáveis listadas na Parte 2.3 abaixo, incluindo `DATA_DIR=/data`.

</details>

### 2.3 Preencher as variáveis secretas

O `render.yaml` já preenche a maioria das variáveis automaticamente, mas duas ficam marcadas como secretas e precisam ser digitadas manualmente por você:

1. No painel do serviço `quiz-cristao`, vá em **Environment**.
2. Preencha:
   - `TWILIO_ACCOUNT_SID` → cole o Account SID (o que começa com `AC...`).
   - `TWILIO_AUTH_TOKEN` → cole o Auth Token da Twilio.
   - Se você já tinha compartilhado esses valores comigo antes, é uma boa hora para **gerar um Auth Token novo** no Console da Twilio (Account → API keys & tokens → Auth Token → Create new) e usar o novo aqui, por segurança.
3. Clique em **Save Changes**. O Render vai reiniciar o serviço automaticamente.

### 2.4 Aguardar o deploy

1. Vá na aba **Logs** do serviço.
2. Espere aparecer algo como `Servidor do Quiz Cristão rodando na porta 3000` (ou `10000`, o Render define a porta automaticamente — o código já lida com isso).
3. No topo da página do serviço, copie a **URL pública** (algo como `https://quiz-cristao.onrender.com`).

---

## Parte 3 — Conectar ao WhatsApp (Twilio)

1. Acesse o **Console da Twilio** → **Messaging** → **Try it out** → **Send a WhatsApp message** (a mesma tela do Sandbox que você já usou).
2. No campo **"When a message comes in"**, cole:
   ```
   https://SEU-ENDERECO.onrender.com/whatsapp
   ```
   (troque pela URL que você copiou, mantendo o `/whatsapp` no final). Método: **POST**.
3. Clique em **Save**.

---

## Parte 4 — Testar

1. Pelo WhatsApp do seu celular, envie para `+1 415 523 8886`:
   ```
   join recall-shot
   ```
2. Depois envie: `INSCREVER`.
3. Depois envie: `INICIAR` e responda as 3 perguntas.
4. Se quiser testar o encerramento das 20h sem esperar o horário, acesse (no navegador, ou peça pra mim):
   ```
   https://SEU-ENDERECO.onrender.com/admin/close-day
   ```
   (isso precisa ser um POST — mais fácil me pedir para eu rodar esse teste por você quando chegar a hora).

Se tudo funcionar, o bot já está rodando 24 horas por dia na nuvem — pode fechar o MacBook, viajar, o que for, que o quiz continua funcionando e enviando os alertas das 8h e das 20h sozinho.

---

## Custos e o que revisar depois

- **~US$ 7,25/mês** (Starter $7 + disco $0.25) cobrado pelo Render no cartão que você cadastrar.
- Isso ainda é o **modo sandbox** da Twilio — funciona para testar com você e algumas pessoas que derem `join`. Para toda a igreja usar sem precisar mandar `join` antes, é preciso migrar para um número de WhatsApp Business aprovado e criar templates de mensagem aprovados pela Meta (isso está detalhado na seção "Importante para produção" do `README.md`).

## Se algo der errado

Me diga em qual dos passos travou (ex: "não apareceu o botão Blueprint", "deu erro no build", "a URL não responde") que eu te ajudo a resolver a partir daí.
