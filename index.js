const express = require("express");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const readlineSync = require("readline-sync");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;

const sessionFile = "session.txt";
let sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "";

const stringSession = new StringSession(sessionString);
const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

async function startClient() {
    try {
        await client.start({
            phoneNumber: async () => phoneNumber,
            password: async () => readlineSync.question("Digite sua senha de 2FA: "),
            phoneCode: async () => readlineSync.question("Digite o código recebido: "),
            onError: (err) => console.error(err),
        });
        console.log("Conectado ao Telegram");
        fs.writeFileSync(sessionFile, client.session.save());
    } catch (error) {
        console.error("Erro ao iniciar o cliente:", error);
        throw error;
    }
}

async function streamFileToChat(fileUrl, chatId) {
    try {
        const response = await axios({
            method: "get",
            url: fileUrl,
            responseType: "stream",
        });

        const fileName = new URL(fileUrl).pathname.split("/").pop();
        const mimeType = response.headers["content-type"] || "application/octet-stream";

        await client.sendFile(chatId, {
            file: response.data, // Diretamente o fluxo de dados
            caption: fileName,
            mimeType: mimeType,
            forceDocument: false, // Ou true para forçar como documento
            progressCallback: (progress) => {
                console.log(`Streaming: ${Math.round(progress * 100)}%`);
            },
        });

        console.log(`Arquivo ${fileName} transmitido com sucesso!`);
    } catch (error) {
        console.error("Erro ao transmitir o arquivo:", error.message);
        throw error;
    }
}

app.post("/upload", async (req, res) => {
    const { fileUrl } = req.body;
    const chatId = "7824135861"; // ID do chat fixado aqui
    if (!fileUrl) {
        return res.status(400).json({ error: "File URL é obrigatória" });
    }

    try {
        await startClient();
        await streamFileToChat(fileUrl, chatId);
        res.status(200).json({ message: "Arquivo transmitido com sucesso!" });
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
