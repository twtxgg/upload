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
  console.log("Conectado ao Telegram");
  fs.writeFileSync(sessionFile, client.session.save());
}

async function downloadFile(fileUrl) {
  try {
    const urlObj = new URL(fileUrl);
    const encodedFileName = urlObj.pathname;
    const decodedFileName = decodeURIComponent(encodedFileName);
    fileName = path.basename(decodedFileName);

    // Verifica se o nome do arquivo tem uma extensão
    if (!path.extname(fileName)) {
      fileName += ".mp4"; // Adiciona a extensão .mp4 se não houver extensão
    }

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
      const progress = Math.round((downloadedLength / totalLength) * 100);
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`Download: ${progress}%`);
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
    const uploadedFile = await client.uploadFile({
      file: filePath,
      useWeb: true, // Ativar envio via servidores web
      partSize: 512 * 1024, // Fragmentos de 512 KB
    });

    if (!uploadedFile) {
      throw new Error("Falha ao processar o arquivo para upload.");
    }

    let fileOptions = {
      file: uploadedFile, // Arquivo processado via uploadFile
      caption: fileName,
      mimeType: "video/mp4", // Certifique-se do MIME correto
      supportsStreaming: true, // Habilitar streaming
      attributes: [
        {
          duration: 120, // Duração do vídeo
          w: 1280, // Largura
          h: 720, // Altura
        },
      ],
      progressCallback: (progress) => {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`Upload: ${Math.round(progress * 100)}%`);
      },
    };

    if (threadId) {
      fileOptions.replyTo = threadId;
    }

    console.log("Enviando arquivo para chatId:", chatId);
    await client.sendFile(chatId, fileOptions);

    process.stdout.write("\n");
    console.log(`\nArquivo ${filePath} enviado com sucesso!`);
    fs.unlinkSync(filePath); // Remove o arquivo local
    return;
  } catch (error) {
    console.error("Erro ao enviar arquivo:", error);
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}

app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ error: "URL do arquivo e ID do chat são obrigatórios" });
  }

  try {
    await startClient();
    const filePath = await downloadFile(fileUrl);
    const chat = await client.getEntity(chatId);

    if (chat.className === "User" || chat.className === "Chat" || chat.className === "Channel") {
      await uploadFile(path.join(__dirname, "upload", filePath), chatId, threadId);
      res.status(200).json({ message: "Arquivo enviado com sucesso!" });
    } else {
      res.status(400).json({ error: "Chat ID inválido" });
    }
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
