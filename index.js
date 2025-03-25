const express = require("express");
const fs = require("fs");
const axios = require("axios");
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
  fs.writeFileSync(sessionFile, client.session.save());
}

async function downloadFile(fileUrl) {
  try {
    const urlObj = new URL(fileUrl);
    const encodedFileName = urlObj.pathname;
    const decodedFileName = decodeURIComponent(encodedFileName);
    fileName = path.basename(decodedFileName);

    const writer = fs.createWriteStream(path.join(__dirname, "upload", fileName));

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
    });

    const totalLength = response.headers["content-length"];
    let downloadedLength = 0;

    response.data.on("data", (chunk) => {
      downloadedLength += chunk.length;
      const progress = (downloadedLength / totalLength) * 100;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`Download: ${progress.toFixed(2)}%`);
    });

    response.data.on("end", () => {
      process.stdout.write("\n");
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(fileName));
      writer.on("error", (err) => {
        reject(err);
      });
    });
  } catch (err) {
    console.error("Erro durante a requisição axios:", err.message);
    throw err;
  }
}

async function uploadFile(filePath, chatId, threadId) {
  try {
    let messageOptions = {
      message: `Enviando arquivo: ${fileName}`,
    };

    if (threadId) {
      messageOptions.replyTo = threadId;
    }

    let sentMessage;
    try {
      sentMessage = await client.sendMessage(chatId, messageOptions);
    } catch (sendMsgError) {
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

      await client.sendFile(chatId, fileOptions);

      process.stdout.write("\n");

      try {
        if (sentMessage && sentMessage.id) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          await client.deleteMessages(chatId, [sentMessage.id], { revoke: true });
        }
      } catch (deleteMsgError) {
        console.error("Erro ao deletar mensagem inicial:", deleteMsgError);
      }
    } else {
      throw new Error("Falha ao enviar mensagem inicial ou obter ID da mensagem.");
    }

    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}

app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId, messageId } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ error: "URL do arquivo e ID do chat são obrigatórios" });
  }

  try {
    await startClient();
    const filePath = await downloadFile(fileUrl);
    const success = await uploadFile(path.join(__dirname, "upload", filePath), chatId, threadId);

    if (success) {
      try {
        await client.deleteMessages(chatId, [messageId], { revoke: true });
        res.status(200).json({ success: true });
      } catch (deleteOriginalMessageError) {
        res.status(500).json({ success: false, error: "Falha ao deletar mensagem original." });
      }
    } else {
      res.status(500).json({ success: false, error: "Falha ao enviar arquivo." });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
