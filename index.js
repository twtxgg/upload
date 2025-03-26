const express = require("express");
const fs = require("fs");
const fsp = require("fs").promises;
const { createWriteStream } = require("fs");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions"); // Correção aqui
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
const stringSession = new StringSession(sessionString); // Agora deve funcionar
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
  const ext = path.extname(originalName) || '.mp4';
  const base = customName || path.basename(originalName, ext) || 'arquivo';
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
      await fsp.writeFile(sessionFile, client.session.save()); // Usando fsp
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

  let writer;
  try {
    const urlObj = new URL(fileUrl);
    const originalName = path.basename(decodeURIComponent(urlObj.pathname)) || 'arquivo';
    const finalName = generateUniqueFilename(originalName, customName);
    const filePath = path.join(UPLOAD_DIR, finalName);

    writer = createWriteStream(filePath);
    
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
      const progress = contentLength ? Math.round((downloadedLength / contentLength) * 100) : 0;
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
    if (writer) writer.end();
    
    if (writer && writer.path) {
      try {
        await fsp.unlink(writer.path).catch(() => {});
      } catch {}
    }
    
    console.error("\nErro durante o download:", err.message);
    throw err;
  }
}

/**
 * Envia arquivo para o Telegram com tratamento especial para vídeos
 */
async function uploadFile(filePath, fileName, chatId, threadId = null) {
  try {
    const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(path.extname(fileName));
    
    const fileOptions = {
      file: filePath,
      caption: fileName,
      progressCallback: (progress) => {
        const percent = Math.round(progress * 100);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`Upload: ${percent}%`);
      },
    };

    if (isVideo) {
      fileOptions.supportsStreaming = true;
      fileOptions.attributes = [{
        _: 'documentAttributeVideo',
        duration: 0,
        w: 1280,
        h: 720,
        roundMessage: false,
        supportsStreaming: true
      }];
      fileOptions.mimeType = 'video/mp4';
    }

    await client.sendMessage(chatId, {
      message: `📤 Enviando ${isVideo ? 'vídeo' : 'arquivo'}: ${fileName}`,
      replyTo: threadId
    });

    await client.sendFile(chatId, fileOptions);
    process.stdout.write("\n");
    console.log(`Arquivo enviado com sucesso: ${fileName}`);

    try {
      await fsp.unlink(filePath);
    } catch (unlinkError) {
      console.warn("Aviso: Não foi possível remover o arquivo temporário:", unlinkError.message);
    }
    
  } catch (error) {
    console.error("\nErro ao enviar arquivo:", error);
    
    try {
      await fsp.unlink(filePath).catch(() => {});
    } catch {}
    
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}

/**
 * Processa comandos recebidos via mensagem
 */
async function processCommand(command, chatId) {
  try {
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
