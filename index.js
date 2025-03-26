const fs = require('fs').promises; // Usando a versão com promises
const path = require('path');
const { createWriteStream } = require('fs');

// ... (mantenha as outras importações e configurações iniciais)

/**
 * Envia arquivo para o Telegram com tratamento especial para vídeos
 */
async function uploadFile(filePath, fileName, chatId, threadId = null) {
  try {
    const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(path.extname(fileName));
    
    // Configurações comuns para todos os arquivos
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

    // Configurações adicionais para vídeos
    if (isVideo) {
      fileOptions.supportsStreaming = true;
      fileOptions.attributes = [{
        _: 'documentAttributeVideo',
        duration: 0, // Será preenchido se tiver ffprobe
        w: 1280,
        h: 720,
        roundMessage: false,
        supportsStreaming: true
      }];
      fileOptions.mimeType = 'video/mp4';
    }

    // Envia mensagem de início
    await client.sendMessage(chatId, {
      message: `📤 Enviando ${isVideo ? 'vídeo' : 'arquivo'}: ${fileName}`,
      replyTo: threadId
    });

    // Envia o arquivo
    await client.sendFile(chatId, fileOptions);
    process.stdout.write("\n");
    console.log(`Arquivo enviado com sucesso: ${fileName}`);

    // Remove o arquivo local com tratamento de erro
    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      console.warn("Aviso: Não foi possível remover o arquivo temporário:", unlinkError.message);
    }
    
  } catch (error) {
    console.error("\nErro ao enviar arquivo:", error);
    
    // Tenta remover o arquivo temporário mesmo em caso de erro
    try {
      await fs.unlink(filePath).catch(() => {});
    } catch {}
    
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}

/**
 * Baixa o arquivo com tratamento mais robusto
 */
async function downloadFile(fileUrl, customName = null) {
  if (!isSupportedFileType(fileUrl)) {
    throw new Error("Tipo de arquivo não suportado");
  }

  let writer;
  try {
    const urlObj = new URL(fileUrl);
    const originalName = path.basename(decodeURIComponent(urlObj.pathname)) || 'arquivo';
    const ext = path.extname(originalName) || '.mp4';
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
    // Fecha o writer se existir
    if (writer) writer.end();
    
    // Tenta remover arquivo parcialmente baixado
    if (writer && writer.path) {
      try {
        await fs.unlink(writer.path).catch(() => {});
      } catch {}
    }
    
    console.error("\nErro durante o download:", err.message);
    throw err;
  }
}
