const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = "7824135861:AAEi3-nXSnhXs7WusqZd-vPElh1I7WfvdCE"; // Token do seu bot

const stringSession = new StringSession(""); // Use uma sessão vazia para teste

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

async function run() {
  try {
    await client.start({ botAuthToken: botToken });
    await client.sendMessage("YOUR_CHAT_ID", { // Substitua pelo ID do chat
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
