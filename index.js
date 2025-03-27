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
const port = process.env.PORT || 3001; // Changed default port to avoid conflicts

// Configurações de proxy e segurança
app.set('trust proxy', 1);
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

// Telegram Client Setup
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

// Upload Directory Setup
const UPLOAD_DIR = path.join(__dirname, "upload");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Helper Functions
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
        onError: (err) => console.error("Telegram client error:", err),
      });
      console.log("Connected to Telegram");
      fs.writeFileSync(sessionFile, client.session.save());
    }
  } catch (err) {
    console.error("Failed to start Telegram client:", err);
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
    throw new Error("Unsupported file type");
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
      throw new Error(`File too large (limit: ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
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

    console.log(`Download complete: ${finalName}`);
    return { fileName: finalName, filePath };
  } catch (err) {
    console.error("\nDownload error:", err.message);
    throw err;
  }
}

async function uploadFile(filePath, fileName, chatId, threadId = null, caption = null) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("File not found");
    }

    const chat = await client.getEntity(chatId);
    console.log(`Sending to ${chat.title || chat.username}`);

    const finalCaption = caption || fileName;
    const fileExt = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(fileExt);

    // Status message
    let statusMessage;
    try {
      statusMessage = await client.sendMessage(chatId, {
        message: `📤 Uploading ${isVideo ? 'video' : 'file'}: ${finalCaption}`,
        ...(threadId && { replyTo: threadId })
      });
    } catch (statusError) {
      console.error("Status message error:", statusError);
    }

    // Upload with appropriate options
    const uploadOptions = {
      file: filePath,
      caption: finalCaption,
      workers: 1,
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
        duration: 0,
        w: 0,
        h: 0
      }];
    }

    await client.sendFile(chatId, uploadOptions);

    // Clean up status message
    if (statusMessage) {
      try {
        await client.deleteMessages(chatId, [statusMessage.id], { revoke: true });
      } catch (deleteError) {
        console.error("Failed to delete status message:", deleteError);
      }
    }

    console.log(`\n✅ ${isVideo ? 'Video' : 'File'} sent: ${finalCaption}`);
    fs.unlinkSync(filePath);
    
  } catch (error) {
    console.error("\n❌ Upload failed:", error);
    try { fs.unlinkSync(filePath); } catch {}
    throw new Error(`Upload failed: ${error.message}`);
  }
}

// Routes
app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId, customName, caption } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ 
      error: "File URL and chat ID are required" 
    });
  }

  try {
    await startTelegramClient();
    const { fileName, filePath } = await downloadFile(fileUrl, customName);
    await uploadFile(filePath, fileName, chatId, threadId, caption);
    
    res.status(200).json({ 
      success: true,
      message: "File sent successfully!",
      fileName,
      caption,
      isVideo: ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(path.extname(filePath).toLowerCase())
    });
  } catch (error) {
    console.error("Processing error:", error);
    res.status(500).json({ 
      success: false,
      error: error.message || "File processing error"
    });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "healthy",
    timestamp: new Date().toISOString() 
  });
});

// Error handling for EADDRINUSE
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use`);
    process.exit(1);
  }
});

// Clean exit handler
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit();
});
