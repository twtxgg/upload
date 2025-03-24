const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const readlineSync = require("readline-sync");
const path = require("path");
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

let fileName; // Adicionado para escopo global

async function startClient() {
  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => "meuamor17",
    phoneCode: async () =>
      readlineSync.question("Enter the code you received: "),
    onError: (err) => console.error(err),
  });
  console.log("Connected to Telegram");
  fs.writeFileSync(sessionFile, client.session.save());
}

async function downloadFile(fileUrl) {
  try {
    const urlObj = new URL(fileUrl);
    const encodedFileName = urlObj.pathname;
    const decodedFileName = decodeURIComponent(encodedFileName);
    fileName = path.basename(decodedFileName); // Atribui a fileName aqui

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
    console.error("Error during axios request:", err.message);
    throw err;
  }
}

async function uploadFile(filePath, chatId, threadId) {
  try {
    let messageOptions = {
      message: `Uploading file: ${fileName}`,
    };

    if (threadId) {
      messageOptions.replyTo = threadId;
    }

    await client.sendMessage(chatId, messageOptions);

    let fileOptions = {
      file: filePath,
      caption: fileName,
      supportsStreaming: true,
    };

    if (threadId) {
      fileOptions.replyTo = threadId;
    }

    await client.sendFile(chatId, fileOptions);

    console.log(`\nFile ${filePath} uploaded successfully!`);
    fs.unlinkSync(filePath);
    return;
  } catch (error) {
    console.error("Error uploading file:", error);
    throw new Error("Failed to upload file to Telegram");
  }
}

app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ error: "File URL and chat ID are required" });
  }

  try {
    await startClient();
    const filePath = await downloadFile(fileUrl);
    const chat = await client.getEntity(chatId);

    if (chat.className === "User" || chat.className === "Chat") {
      await uploadFile(path.join(__dirname, "upload", filePath), chatId, threadId);
    } else if (chat.className === "Channel") {
      await uploadFile(path.join(__dirname, "upload", filePath), chatId, threadId);
    }

    res.status(200).json({ message: "File uploaded successfully!" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
