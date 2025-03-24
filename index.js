const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
require("dotenv").config();

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;

const stringSession = new StringSession("");

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

async function run() {
  try {
    await client.start({ botAuthToken: botToken });
    await client.sendMessage(7824135861, { // Usando o ID fornecido
      message: "Teste de botão inline",
      buttons: new Api.ReplyInlineMarkup({
        rows: [
          [
            new Api.KeyboardButtonCallback({
              text: "Clique aqui",
              data: "teste",
            }),
          ],
        ],
      }),
    });
    console.log("Mensagem com botão inline enviada!");
    await client.disconnect();
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
  }
}

run();
