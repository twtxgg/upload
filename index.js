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

// Configurações de proxy para rate limiting
app.set('trust proxy', 1);

// Configurações de segurança
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Configurações do Telegram
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const MAX_FILE_SIZE = 2000 * 1024 * 1024;

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

function generateUniqueFilename(originalName, customName = null) {
  const ext = path.extname(originalName);
  
  if (customName) {
    const customWithoutExt = customName.endsWith(ext) 
      ? customName.slice(0, -ext.length) 
      : customName;
    return `${customWithoutExt}${ext}`;
  }
  
  const base = path.basename(originalName, ext);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

async function startTelegramClient() {
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

async function isSupportedFileType(url) {
  const supportedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".pdf", ".zip"];
  try {
    const urlObj = new URL(url);
    const extension = path.extname(urlObj.pathname.toLowerCase());
    
    if (supportedExtensions.includes(extension)) {
      return true;
    }
    
    const response = await axios.head(url);
    const contentType = response.headers['content-type'];
    
    const supportedMimeTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'application/pdf',
      'application/zip'
    ];
    
    return supportedMimeTypes.some(mime => contentType.includes(mime));
    
  } catch {
    return false;
  }
}

async function downloadFile(fileUrl, customName = null) {
  if (!(await isSupportedFileType(fileUrl))) {
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

    const finalName = generateUniqueFilename(originalName, customName);
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

async function uploadFile(filePath, fileName, chatId, threadId = null, caption = null) {
  try {
    const chat = await client.getEntity(chatId);
    console.log(`Enviando arquivo para ${chat.title || chat.username}`);

    const finalCaption = caption || fileName;
    const isVideo = ['.mp4', '.mov', '.avi', '.mkv'].includes(path.extname(filePath).toLowerCase());

    // 1. Envia mensagem de status
    let statusMessage;
    try {
      statusMessage = await client.sendMessage(chatId, {
        message: `📤 Enviando arquivo: ${finalCaption}`,
        ...(threadId && { replyTo: threadId })
      });
    } catch (statusError) {
      console.error("⚠️ Não foi possível enviar mensagem de status:", statusError);
    }

    // 2. Envia o arquivo principal
    await client.sendFile(chatId, {
      file: filePath,
      caption: finalCaption,
      supportsStreaming: isVideo, // Habilita streaming apenas para vídeos
      ...(threadId && { replyTo: threadId }),
      progressCallback: (progress) => {
        const percent = Math.round(progress * 100);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Upload: ${percent}%`);
      }
    });

    // 3. Remove mensagem de status (se existir)
    if (statusMessage) {
      try {
        await client.deleteMessages(chatId, [statusMessage.id], { revoke: true });
      } catch (deleteError) {
        console.error("⚠️ Não foi possível remover mensagem de status:", deleteError);
      }
    }

    console.log(`\n✅ Arquivo enviado: ${finalCaption}`);
    fs.unlinkSync(filePath);
    
  } catch (error) {
    console.error("\n❌ Erro ao enviar arquivo:", error);
    try { fs.unlinkSync(filePath); } catch {} // Garante remoção do arquivo temporário
    throw new Error(`Falha no envio: ${error.message}`);
  }
}

app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId, customName, caption } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ 
      error: "URL do arquivo e ID do chat são obrigatórios" 
    });
  }

  try {
    await startTelegramClient();
    const { fileName, filePath } = await downloadFile(fileUrl, customName);
    await uploadFile(filePath, fileName, chatId, threadId, caption);
    
    res.status(200).json({ 
      success: true,
      message: "Arquivo enviado com sucesso!",
      fileName,
      caption
    });
  } catch (error) {
    console.error("Erro no processamento:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "Erro ao processar o arquivo"
    });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
