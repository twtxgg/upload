const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const path = require("path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const readline = require("readline");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Configurações de segurança
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100 // limite de 100 requisições por IP
});
app.use(limiter);

// Configurações do Telegram
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB

const sessionFile = "session.txt";
let sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "";
const stringSession = new StringSession(sessionString);
const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

// Diretório para uploads
const UPLOAD_DIR = path.join(__dirname, "upload");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

/**
 * Gera um nome de arquivo seguro
 */
function generateSafeFilename(originalName, customName = null) {
  const ext = path.extname(originalName);
  let base = customName || path.basename(originalName, ext);
  
  // Remove caracteres inválidos
  base = base.replace(/[\/\\:*?"<>|]/g, '');
  base = base.substring(0, 100); // Limita o tamanho
  
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

/**
 * Inicia o cliente do Telegram
 */
async function startClient() {
  try {
    if (!client.connected) {
      await client.start({
        botAuthToken: botToken,
        onError: (err) => console.error("Erro no cliente Telegram:", err),
      });
      console.log("Conectado ao Telegram");
      fs.writeFileSync(sessionFile, client.session.save());
    }
  } catch (err) {
    console.error("Falha ao iniciar cliente Telegram:", err);
    throw err;
  }
}

/**
 * Verifica se a URL aponta para um tipo de arquivo suportado
 */
function isSupportedFileType(url) {
  const supportedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".pdf", ".zip"];
  try {
    const urlObj = new URL(url);
    const extension = path.extname(urlObj.pathname.toLowerCase());
    return supportedExtensions.includes(extension);
  } catch {
    return false;
  }
}

/**
 * Baixa o arquivo da URL fornecida
 */
async function downloadFile(fileUrl, customName = null) {
  if (!isSupportedFileType(fileUrl)) {
    throw new Error("Tipo de arquivo não suportado");
  }

  try {
    const urlObj = new URL(fileUrl);
    const encodedFileName = urlObj.pathname;
    const decodedFileName = decodeURIComponent(encodedFileName);
    let originalName = path.basename(decodedFileName);

    if (!path.extname(originalName)) {
      originalName += ".mp4";
    }

    const finalName = generateSafeFilename(originalName, customName);
    const filePath = path.join(UPLOAD_DIR, finalName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
      maxContentLength: MAX_FILE_SIZE,
    });

    const contentLength = response.headers["content-length"];
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
      throw new Error(`Arquivo muito grande (limite: ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    let downloadedLength = 0;

    response.data.on("data", (chunk) => {
      downloadedLength += chunk.length;
      const progress = Math.round((downloadedLength / contentLength) * 100);
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Download: ${progress}%`);
    });

    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", () => {
        process.stdout.write("\n");
        resolve();
      });
      writer.on("error", reject);
    });

    console.log(`Download concluído: ${finalName}`);
    return { fileName: finalName, filePath };
  } catch (err) {
    console.error("\nErro durante o download:", err.message);
    throw err;
  }
}

/**
 * Envia arquivo para o Telegram
 */
async function uploadFile(filePath, fileName, chatId, threadId = null) {
  try {
    const chat = await client.getEntity(chatId);
    console.log(`Enviando arquivo para ${chat.title || chat.username}`);

    await client.sendMessage(chatId, {
      message: `📤 Enviando arquivo: ${fileName}`,
      replyTo: threadId
    });

    const fileOptions = {
      file: filePath,
      caption: fileName,
      supportsStreaming: true,
      progressCallback: (progress) => {
        const percent = Math.round(progress * 100);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Upload: ${percent}%`);
      },
    };

    await client.sendFile(chatId, fileOptions);
    process.stdout.write("\n");
    console.log(`Arquivo enviado com sucesso: ${fileName}`);

    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("\nErro ao enviar arquivo:", error);
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}

// Rota de upload
app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, customName } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ 
      error: "URL do arquivo e ID do chat são obrigatórios" 
    });
  }

  try {
    await startClient();
    const { fileName, filePath } = await downloadFile(fileUrl, customName);
    await uploadFile(filePath, fileName, chatId);
    
    res.status(200).json({ 
      success: true,
      message: "Arquivo enviado com sucesso!",
      fileName 
    });
  } catch (error) {
    console.error("Erro no processamento:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "Erro ao processar o arquivo"
    });
  }
});

// Rota de saúde
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
