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
 * Gera um nome de arquivo único com timestamp
 */
function generateUniqueFilename(originalName, customName = null) {
  const ext = path.extname(originalName);
  const base = customName || path.basename(originalName, ext);
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
 * Verifica e corrige metadados de vídeo
 */
async function ensureVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      
      if (!metadata.format.duration || !metadata.streams[0].width) {
        console.log('Metadados incompletos, recodificando vídeo...');
        
        const tempPath = filePath + '.temp.mp4';
        ffmpeg(filePath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .format('mp4')
          .on('end', () => {
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            resolve();
          })
          .on('error', reject)
          .save(tempPath);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Verifica e ajusta resolução de vídeo se necessário
 */
async function checkVideoConstraints(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) return resolve(); // Não é vídeo, não precisa processar
      
      if (videoStream.width > 1920 || videoStream.height > 1080) {
        console.log('Redimensionando vídeo para 1080p...');
        const tempPath = filePath + '.temp.mp4';
        ffmpeg(filePath)
          .size('1920x1080')
          .videoCodec('libx264')
          .audioCodec('aac')
          .format('mp4')
          .on('end', () => {
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            resolve();
          })
          .on('error', reject)
          .save(tempPath);
      } else {
        resolve();
      }
    });
  });
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

    // Verifica se o nome do arquivo tem uma extensão
    if (!path.extname(originalName)) {
      originalName += ".mp4";
    }

    // Gera o nome final do arquivo
    const finalName = generateUniqueFilename(originalName, customName);
    const filePath = path.join(UPLOAD_DIR, finalName);
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
      method: "get",
      url: fileUrl,
      responseType: "stream",
      maxContentLength: MAX_FILE_SIZE,
    });

    // Verifica o tamanho do arquivo
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
    // Processamento especial para vídeos
    if (path.extname(fileName).match(/\.(mp4|mov|avi|mkv)$/i)) {
      await ensureVideoMetadata(filePath);
      await checkVideoConstraints(filePath);
      
      // Obter metadados atualizados para vídeo
      const metadata = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      
      // Configurações otimizadas para vídeo
      const fileOptions = {
        file: filePath,
        caption: fileName,
        supportsStreaming: true,
        attributes: [
          {
            _: 'documentAttributeVideo',
            duration: metadata.format.duration || 0,
            w: videoStream?.width || 1280,
            h: videoStream?.height || 720,
            roundMessage: false,
            supportsStreaming: true
          }
        ],
        mimeType: 'video/mp4',
        progressCallback: (progress) => {
          const percent = Math.round(progress * 100);
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(`Upload: ${percent}%`);
        },
      };

      // Envia mensagem de início
      await client.sendMessage(chatId, {
        message: `📤 Enviando vídeo: ${fileName}`,
        replyTo: threadId
      });

      await client.sendFile(chatId, fileOptions);
    } else {
      // Processamento para outros tipos de arquivo
      await client.sendMessage(chatId, {
        message: `📤 Enviando arquivo: ${fileName}`,
        replyTo: threadId
      });

      await client.sendFile(chatId, {
        file: filePath,
        caption: fileName,
        progressCallback: (progress) => {
          const percent = Math.round(progress * 100);
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(`Upload: ${percent}%`);
        },
      });
    }

    process.stdout.write("\n");
    console.log(`Arquivo enviado com sucesso: ${fileName}`);
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("\nErro ao enviar arquivo:", error);
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}

/**
 * Processa comandos recebidos via mensagem
 */
async function processCommand(command, chatId) {
  try {
    // Comando /rename - formato: /rename novo_nome url_do_arquivo
    if (command.startsWith('/rename')) {
      const parts = command.split(' ');
      if (parts.length < 3) {
        await client.sendMessage(chatId, {
          message: "Formato incorreto. Use: /rename novo_nome url_do_arquivo"
        });
        return;
      }
      
      const customName = parts[1];
      const fileUrl = parts.slice(2).join(' ');
      
      await client.sendMessage(chatId, {
        message: `⏳ Iniciando download e renomeando para: ${customName}`
      });
      
      const { fileName, filePath } = await downloadFile(fileUrl, customName);
      await uploadFile(filePath, fileName, chatId);
      
      await client.sendMessage(chatId, {
        message: `✅ Arquivo renomeado e enviado com sucesso como: ${customName}`
      });
    }
  } catch (error) {
    console.error("Erro ao processar comando:", error);
    await client.sendMessage(chatId, {
      message: `❌ Erro: ${error.message}`
    });
  }
}

// Rota de upload
app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId, customName } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ 
      error: "URL do arquivo e ID do chat são obrigatórios" 
    });
  }

  try {
    await startClient();
    const { fileName, filePath } = await downloadFile(fileUrl, customName);
    await uploadFile(filePath, fileName, chatId, threadId);
    
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

// Rota para processar comandos via HTTP
app.post("/command", async (req, res) => {
  const { command, chatId } = req.body;

  if (!command || !chatId) {
    return res.status(400).json({ 
      error: "Comando e ID do chat são obrigatórios" 
    });
  }

  try {
    await startClient();
    await processCommand(command, chatId);
    
    res.status(200).json({ 
      success: true,
      message: "Comando processado com sucesso!"
    });
  } catch (error) {
    console.error("Erro no processamento:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "Erro ao processar o comando"
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
