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
const botToken = "7824135861:AAEi3-nXSnhXs7WusqZd-vPElh1I7WfvdCE"; // Usando o token do bot fornecido

const sessionFile = "session.txt";
let sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "";
const stringSession = new StringSession(sessionString);
const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

let fileName;

async function startClient() {
  await client.start({
    botAuthToken: botToken, // Usando o token do bot
    onError: (err) => console.error(err),
  });
  console.log("Conectado ao Telegram");
  fs.writeFileSync(sessionFile, client.session.save());
}

async function downloadFile(fileUrl, chatId) {
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
    let progressMessage;

    response.data.on("data", async (chunk) => {
      downloadedLength += chunk.length;
      const progress = (downloadedLength / totalLength) * 100;
      console.log(`Download: ${progress.toFixed(2)}%`);
      try {
        if (progressMessage && progressMessage.id) {
          await client.editMessage(chatId, {
            message: `Download: ${progress.toFixed(2)}%`,
            id: progressMessage.id,
          });
        } else {
          progressMessage = await client.sendMessage(chatId, {
            message: `Download: ${progress.toFixed(2)}%`,
          });
        }
      } catch (error) {
        console.error("Erro ao enviar/editar mensagem de progresso do download:", error);
      }
    });

    response.data.on("end", async () => {
      if (progressMessage && progressMessage.id) {
        try {
          await client.deleteMessages(chatId, [progressMessage.id], { revoke: true });
        } catch (error) {
          console.error("Erro ao apagar mensagem de progresso do download:", error);
        }
      }
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
      let progressMessage;

      let fileOptions = {
        file: filePath,
        caption: fileName,
        supportsStreaming: true,
        progressCallback: async (progress) => {
          console.log(`Upload: ${(progress * 100).toFixed(2)}%`);
          try {
            if (progressMessage && progressMessage.id) {
              await client.editMessage(chatId, {
                message: `Upload: ${(progress * 100).toFixed(2)}%`,
                id: progressMessage.id,
              });
            } else {
              progressMessage = await client.sendMessage(chatId, {
                message: `Upload: ${(progress * 100).toFixed(2)}%`,
              });
            }
          } catch (error) {
            console.error("Erro ao enviar/editar mensagem de progresso do upload:", error);
          }
        },
      };

      if (threadId) {
        fileOptions.replyTo = threadId;
      }

      console.log("Enviando arquivo para chatId:", chatId);
      try {
        await client.sendFile(chatId, fileOptions);
      } catch (uploadError) {
        console.error("Erro ao enviar arquivo para o Telegram:", uploadError);
        if (uploadError.message.includes("error code: 521")) {
          console.error("Servidor do Telegram está indisponível (código de erro 521).");
          throw new Error("Servidor do Telegram está indisponível.");
        } else {
          throw new Error("Falha ao enviar arquivo para o Telegram.");
        }
      }

      if (progressMessage && progressMessage.id) {
        try {
          await client.deleteMessages(chatId, [progressMessage.id], { revoke: true });
        } catch (error) {
          console.error("Erro ao apagar mensagem de progresso do upload:", error);
        }
      }

      try {
        if (sentMessage && sentMessage.id) {
          await new Promise(resolve => setTimeout(resolve, 1000));
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
  const { fileUrl, chatId, threadId, messageId } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ error: "URL do arquivo e ID do chat são obrigatórios" });
  }

  try {
    await startClient();
    const filePath = await downloadFile(fileUrl, chatId);
    const chat = await client.getEntity(chatId);

    const success = await uploadFile(path.
