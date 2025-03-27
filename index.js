const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const path = require("path");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const readline = require("readline");
const { exec, execSync } = require("child_process");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// Verifica se FFmpeg está disponível
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
  console.log('FFmpeg está disponível no sistema');
} catch (e) {
  console.warn('FFmpeg não está instalado. Alguns recursos de vídeo podem não funcionar corretamente');
}

// Configurações do Telegram
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const botToken = process.env.BOT_TOKEN;
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB

// Configurações do servidor
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Sessão do Telegram
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

// Funções auxiliares
function generateUniqueFilename(originalName, customName = null) {
  const ext = path.extname(originalName);
  if (customName) {
    const customWithoutExt = customName.endsWith(ext) ? customName.slice(0, -ext.length) : customName;
    return `${customWithoutExt}${ext}`;
  }
  const base = path.basename(originalName, ext);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

/**
 * Obtém metadados básicos do vídeo (com fallback se FFmpeg não estiver disponível)
 */
async function getVideoMetadata(filePath) {
  if (!ffmpegAvailable) {
    return { duration: 0, width: 0, height: 0 };
  }

  return new Promise((resolve) => {
    exec(`ffprobe -v error -show_entries format=duration -show_entries stream=width,height -of json "${filePath}"`,
      (error, stdout) => {
        if (error) {
          console.warn('Erro ao obter metadados do vídeo, usando valores padrão');
          resolve({ duration: 0, width: 0, height: 0 });
        } else {
          try {
            const metadata = JSON.parse(stdout);
            const videoStream = metadata.streams.find(s => s.width);
            resolve({
              duration: parseFloat(metadata.format.duration) || 0,
              width: videoStream ? videoStream.width : 0,
              height: videoStream ? videoStream.height : 0
            });
          } catch (e) {
            resolve({ duration: 0, width: 0, height: 0 });
          }
        }
      });
  });
}

/**
 * Corrige metadados de vídeo se FFmpeg estiver disponível
 */
async function fixVideoMetadata(filePath) {
  if (!ffmpegAvailable) {
    return filePath;
  }

  const fixedPath = filePath.replace(/(\.\w+)$/, '_fixed$1');
  
  return new Promise((resolve) => {
    exec(`ffmpeg -i "${filePath}" -map_metadata 0 -c copy "${fixedPath}"`, 
      (error) => {
        if (error) {
          console.error('Erro ao corrigir metadados, usando arquivo original');
          resolve(filePath);
        } else {
          fs.unlinkSync(filePath);
          resolve(fixedPath);
        }
      });
  });
}

// Funções principais
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
  const supportedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
  try {
    const urlObj = new URL(url);
    const extension = path.extname(urlObj.pathname.toLowerCase());
    if (supportedExtensions.includes(extension)) return true;
    
    const response = await axios.head(url);
    const contentType = response.headers['content-type'] || '';
    return [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm'
    ].some(mime => contentType.includes(mime));
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
    let originalName = path.basename(decodeURIComponent(urlObj.pathname));
    if (!path.extname(originalName)) originalName += ".mp4";

    const finalName = generateUniqueFilename(originalName, customName);
    const filePath = path.join(UPLOAD_DIR, finalName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
      maxContentLength: MAX_FILE_SIZE,
      timeout: 300000,
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
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log(`\nDownload concluído: ${finalName}`);
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
    const fileExt = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt);

    // Corrige metadados se for vídeo
    let finalFilePath = filePath;
    let videoMetadata = { duration: 0, width: 0, height: 0 };
    
    if (isVideo) {
      finalFilePath = await fixVideoMetadata(filePath);
      videoMetadata = await getVideoMetadata(finalFilePath);
      console.log(`Metadados do vídeo - Duração: ${videoMetadata.duration}s`);
    }

    // Envia mensagem de status
    let statusMessage;
    try {
      statusMessage = await client.sendMessage(chatId, {
        message: `📤 Enviando ${isVideo ? 'vídeo' : 'arquivo'}: ${finalCaption}`,
        ...(threadId && { replyTo: threadId })
      });
    } catch (statusError) {
      console.error("⚠️ Não foi possível enviar mensagem de status:", statusError);
    }

    // Configurações de envio
    const uploadOptions = {
      file: finalFilePath,
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
      uploadOptions.supportsStreaming = true;
      uploadOptions.attributes = [{
        _: 'documentAttributeVideo',
        supportsStreaming: true,
        duration: Math.floor(videoMetadata.duration),
        w: videoMetadata.width,
        h: videoMetadata.height
      }];
    }

    // Envia o arquivo
    await client.sendFile(chatId, uploadOptions);

    // Remove mensagem de status se existir
    if (statusMessage) {
      try {
        await client.deleteMessages(chatId, [statusMessage.id], { revoke: true });
      } catch (deleteError) {
        console.error("⚠️ Não foi possível remover mensagem de status:", deleteError);
      }
    }

    console.log(`\n✅ ${isVideo ? 'Vídeo' : 'Arquivo'} enviado: ${finalCaption}`);
    fs.unlinkSync(finalFilePath);
    
  } catch (error) {
    console.error("\n❌ Erro ao enviar arquivo:", error);
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(`Falha no envio: ${error.message}`);
  }
}

// Rotas
app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId, customName, caption } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ error: "URL do arquivo e ID do chat são obrigatórios" });
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
  res.status(200).json({ 
    status: "healthy",
    ffmpeg_available: ffmpegAvailable 
  });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
  console.log(`FFmpeg disponível: ${ffmpegAvailable}`);
});
