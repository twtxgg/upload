const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const path = require("path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const readline = require("readline");
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
require("dotenv").config();

// Configuração do FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

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
 * Gera um nome de arquivo único
 * @param {string} originalName - Nome original do arquivo
 * @param {string|null} customName - Nome personalizado (opcional)
 * @returns {string} Nome do arquivo único
 */
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

/**
 * Obtém metadados de vídeo usando FFmpeg
 * @param {string} filePath - Caminho do arquivo de vídeo
 * @returns {Promise<object|null>} Metadados do vídeo
 */
async function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error("Erro ao obter metadados do vídeo:", err);
        resolve(null);
      } else {
        resolve(metadata.format);
      }
    });
  });
}

/**
 * Inicia o cliente do Telegram
 */
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

/**
 * Verifica se o tipo de arquivo é suportado (focado em vídeos)
 * @param {string} url - URL do arquivo
 * @returns {Promise<boolean>} True se for suportado
 */
async function isSupportedFileType(url) {
  const supportedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
  const supportedMimeTypes = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/webm',
    'video/x-m4v'
  ];

  try {
    const urlObj = new URL(url);
    const extension = path.extname(urlObj.pathname.toLowerCase());
    
    // Verifica primeiro pela extensão
    if (supportedExtensions.includes(extension)) {
      return true;
    }
    
    // Se não reconhecer pela extensão, verifica pelo content-type
    const response = await axios.head(url);
    const contentType = response.headers['content-type'] || '';
    
    return supportedMimeTypes.some(mime => contentType.includes(mime));
    
  } catch {
    return false;
  }
}

/**
 * Faz download de um arquivo de vídeo
 * @param {string} fileUrl - URL do arquivo
 * @param {string|null} customName - Nome personalizado (opcional)
 * @returns {Promise<{fileName: string, filePath: string}>} Informações do arquivo baixado
 */
async function downloadFile(fileUrl, customName = null) {
  if (!(await isSupportedFileType(fileUrl))) {
    throw new Error("Tipo de arquivo de vídeo não suportado");
  }

  try {
    const urlObj = new URL(fileUrl);
    const encodedFileName = urlObj.pathname;
    const decodedFileName = decodeURIComponent(encodedFileName);
    let originalName = path.basename(decodedFileName);

    // Garante que arquivos de vídeo tenham extensão .mp4 se não tiverem extensão
    if (!path.extname(originalName)) {
      const response = await axios.head(fileUrl);
      const contentType = response.headers['content-type'] || '';
      
      if (contentType.includes('video')) {
        originalName += ".mp4";
      }
    }

    const finalName = generateUniqueFilename(originalName, customName);
    const filePath = path.join(UPLOAD_DIR, finalName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
      maxContentLength: MAX_FILE_SIZE,
      timeout: 300000, // 5 minutos para vídeos grandes
    });

    const contentLength = response.headers["content-length"];
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
      throw new Error(`Arquivo muito grande (limite: ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    let downloadedLength = 0;
    let lastProgress = 0;

    response.data.on("data", (chunk) => {
      downloadedLength += chunk.length;
      const progress = Math.round((downloadedLength / contentLength) * 100);
      
      // Mostra progresso apenas se mudou significativamente
      if (progress > lastProgress + 5 || progress === 100) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Download: ${progress}%`);
        lastProgress = progress;
      }
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
 * Faz upload de um arquivo para o Telegram
 * @param {string} filePath - Caminho local do arquivo
 * @param {string} fileName - Nome do arquivo
 * @param {string|number} chatId - ID do chat/channel
 * @param {number|null} threadId - ID da thread (opcional)
 * @param {string|null} caption - Legenda (opcional)
 */
async function uploadFile(filePath, fileName, chatId, threadId = null, caption = null) {
  try {
    const chat = await client.getEntity(chatId);
    console.log(`Enviando arquivo para ${chat.title || chat.username}`);

    const finalCaption = caption || fileName;
    const fileExt = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt);

    // 1. Envia mensagem de status
    let statusMessage;
    try {
      statusMessage = await client.sendMessage(chatId, {
        message: `📤 Enviando ${isVideo ? 'vídeo' : 'arquivo'}: ${finalCaption}`,
        ...(threadId && { replyTo: threadId })
      });
    } catch (statusError) {
      console.error("⚠️ Não foi possível enviar mensagem de status:", statusError);
    }

    // Configurações específicas para vídeos
    const uploadOptions = {
      file: filePath,
      caption: finalCaption,
      ...(threadId && { replyTo: threadId }),
      progressCallback: (progress) => {
        const percent = Math.round(progress * 100);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Upload: ${percent}%`);
      }
    };

    if (isVideo) {
      const metadata = await getVideoMetadata(filePath);
      uploadOptions.supportsStreaming = true;
      uploadOptions.attributes = [{
        _: 'documentAttributeVideo',
        supportsStreaming: true,
        duration: metadata?.duration ? Math.floor(metadata.duration) : 0,
        w: metadata?.width || 0,
        h: metadata?.height || 0
      }];
    }

    // 2. Envia o arquivo principal
    await client.sendFile(chatId, uploadOptions);

    // 3. Remove mensagem de status (se existir)
    if (statusMessage) {
      try {
        await client.deleteMessages(chatId, [statusMessage.id], { revoke: true });
      } catch (deleteError) {
        console.error("⚠️ Não foi possível remover mensagem de status:", deleteError);
      }
    }

    console.log(`\n✅ ${isVideo ? 'Vídeo' : 'Arquivo'} enviado: ${finalCaption}`);
    fs.unlinkSync(filePath);
    
  } catch (error) {
    console.error("\n❌ Erro ao enviar arquivo:", error);
    try { fs.unlinkSync(filePath); } catch {} // Garante remoção do arquivo temporário
    throw new Error(`Falha no envio: ${error.message}`);
  }
}

// Rotas da API

/**
 * Rota para upload de vídeos
 */
app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId, customName, caption } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ 
      error: "URL do arquivo e ID do chat são obrigatórios" 
    });
  }

  try {
    // Verifica se é um vídeo antes de iniciar o processo
    const isVideo = await isSupportedFileType(fileUrl);
    if (!isVideo) {
      return res.status(400).json({ 
        error: "Tipo de arquivo não suportado. Somente vídeos são permitidos." 
      });
    }

    await startTelegramClient();
    const { fileName, filePath } = await downloadFile(fileUrl, customName);
    await uploadFile(filePath, fileName, chatId, threadId, caption);
    
    res.status(200).json({ 
      success: true,
      message: "Vídeo enviado com sucesso!",
      fileName,
      caption,
      isVideo: true
    });
  } catch (error) {
    console.error("Erro no processamento:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "Erro ao processar o vídeo"
    });
  }
});

/**
 * Rota de health check
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
