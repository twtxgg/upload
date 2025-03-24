async function uploadFile(filePath, chatId, threadId) {
  try {
    const me = await client.getMe();
    console.log("Informações do bot:", me);

    const chat = await client.getEntity(chatId);
    console.log("Informações do chat:", chat);

    let messageOptions = {
      message: `Uploading file: ${fileName}`,
    };

    if (threadId) {
      messageOptions.replyTo = threadId;
    }

    console.log("Enviando mensagem para chatId:", chatId);
    await client.sendMessage(chatId, messageOptions);

    let fileOptions = {
      file: filePath,
      caption: fileName,
      supportsStreaming: true,
    };

    if (threadId) {
      fileOptions.replyTo = threadId;
    }

    console.log("Enviando arquivo para chatId:", chatId);
    await client.sendFile(chatId, fileOptions);

    console.log(`\nArquivo ${filePath} enviado com sucesso!`);
    fs.unlinkSync(filePath);
    return;
  } catch (error) {
    console.error("Erro ao enviar arquivo:", error);
    throw new Error("Falha ao enviar arquivo para o Telegram");
  }
}
