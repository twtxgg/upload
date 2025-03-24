app.post("/upload", async (req, res) => {
  const { fileUrl, chatId, threadId } = req.body;

  if (!fileUrl || !chatId) {
    return res.status(400).json({ error: "File URL and chat ID are required" });
  }

  try {
    await startClient();
    const filePath = await downloadFile(fileUrl);
    //Obtem informações do chat.
    const chat = await client.getEntity(chatId);
    //Verifica o tipo de chat.
    if (chat.className === "User" || chat.className === "Chat") {
      //Chat privado ou grupo
      await uploadFile(path.join(__dirname, "upload", filePath), chatId, threadId);
    } else if (chat.className === "Channel") {
      //Canal
      await uploadFile(path.join(__dirname, "upload", filePath), chatId, threadId);
    }
    res.status(200).json({ message: "File uploaded successfully!" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

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
