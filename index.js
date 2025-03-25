const express = require("express");
const fs = require("fs");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = "7824135861:AAEi3-nXSnhXs7WusqZd-vPElh1I7WfvdCE";

const sessionFile = "session.txt";
let sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "";
const stringSession = new StringSession(sessionString);
const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

let fileName;

async function startClient() {
  await client.start({
    botAuthToken: botToken,
    onError: (err) => console.error(err),
  });
  console.log("Conectado ao Telegram");
  fs.writeFileSync(sessionFile, client.session.save());
}

async function downloadFileFromTelegram(messageId, chatId) {
  try {
    const message = await client.getMessageById(chatId, messageId);
    if (!message.media) {
      throw new Error("Mensagem não contém mídia.");
    }
    const filePath = await client.downloadMedia(message.media, {
      progressCallback: (progress) => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`Download: ${(progress * 100).toFixed(2)}%`);
      },
    });
    process.stdout.write("\n");
    fileName = path.basename(filePath);
    return filePath;
  } catch (err) {
    console.error("Erro ao baixar arquivo do Telegram:", err);
    throw err;
  }
}

async function uploadFile(filePath, chatId, threadId) {
  try {
    const me = await client.getMe();
    console.log("Informação do bot:", me);

    const chat = await client.getEntity(chatId);
    console.log("Informação do chat:", chat);

    let messageOptions = {
      message: `Enviando arquivo: ${fileName}`,
    };

    if (threadId) {
      messageOptions.replyTo = threadId;
    }

    console.log("Enviando mensagem para chatId:", chatId);
    let sentMessage;
    try {
      sentMessage = await client.sendMessage(chatId, messageOptions);
    } catch (sendMsgError) {
      console.error("Erro ao enviar mensagem inicial:", sendMsgError);
      throw new Error("Falha ao enviar mensagem inicial.");
    }

    if (sentMessage && sentMessage.id) {
      let fileOptions = {
        file: filePath,
        caption: fileName,
        supportsStreaming: true,
        progressCallback: (progress) => {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(`Upload: ${(progress * 100).toFixed(2)}%`);
        },
      };

      console.log("Enviando arquivo para chatId:", chatId);
      await client.sendFile(chatId, fileOptions);

      process.stdout.write("\n");

      try {
        if (sentMessage && sentMessage.id) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await client.deleteMessages(chatId, [sentMessage.id], { revoke: true });
        } else {
          console.error("sentMessage ou sentMessage.id não definidos ao deletar.");
        }
      } catch (deleteMsgError) {
        console.error("Erro ao deletar mensagem inicial:", deleteMsgError);
      }
    } else {
      console.error("Falha ao enviar mensagem inicial ou obter ID da mensagem.");
      throw new Error("Falha ao enviar mensagem inicial ou obter ID da mensagem.");
    }

    console.log(`\nArquivo ${filePath} enviado com sucesso!`);
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error("Erro ao enviar arquivo:", error);
    throw new Error("Falha ao enviar arquivo para o Telegram");
    return false;
  }
}

app.post("/upload", async (req, res) => {
  const { forwardedMessageId, chatId, threadId, messageId } = req.body;

  if (!forwardedMessageId || !chatId) {
    return res
      .status(400)
      .json({ error: "ID da mensagem encaminhada e ID do chat são obrigatórios" });
  }

  try {
    await startClient();
    const filePath = await downloadFileFromTelegram(forwardedMessageId, chatId);
    const success = await uploadFile(filePath, chatId, threadId);

    if (success) {
      try {
        await client.deleteMessages(chatId, [messageId], { revoke: true });
        res.status(200).json({ success: true });
      } catch (deleteOriginalMessageError) {
        console.error(
          "Erro ao deletar mensagem original:",
          deleteOriginalMessageError
        );
        res
          .status(500)
          .json({ success: false, error: "Falha ao deletar mensagem original." });
      }
    } else {
      res.status(500).json({ success: false, error: "Falha ao enviar arquivo." });
    }
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
