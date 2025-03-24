const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { TelegramClient, Api } = require("telegram");
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

        const writer = fs.createWriteStream(path.join(__dirname, "upload", fileName));

        const response = await axios({
            method: "get",
            url: fileUrl,
            responseType: "stream",
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
        console.log("Informações do bot:", me);

        const chat = await client.getEntity(chatId);
        console.log("Informações do chat:", chat);

        let messageOptions = {
            message: `Enviando arquivo: ${fileName}`,
        };

        if (threadId) {
            messageOptions.replyTo = threadId;
        }

        console.log("Enviando mensagem para chatId:", chatId);
        await client.sendMessage(chatId, messageOptions);

        let fileOptions = {
            file: filePath,
            caption: fileName,
            supportsStreaming: true,
        };

        if (threadId) {
            fileOptions.replyTo = threadId;
        }

        console.log("Enviando arquivo para chatId:", chatId);
        await client.sendFile(chatId, fileOptions);

        console.log(`\nArquivo ${filePath} enviado com sucesso!`);
        fs.unlinkSync(filePath);
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
        const targetChatId = chatId; // Usar sempre o chatId fornecido

        console.log("Enviando para chatId:", targetChatId); // Log para verificar o chatId usado

        await uploadFile(path.join(__dirname, "upload", filePath), targetChatId, threadId);

        res.status(200).json({ message: "Arquivo enviado com sucesso!" });
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor em execução na porta ${port}`);
});
