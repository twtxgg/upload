const path = require("path");

async function streamFileToChat(fileUrl, chatId) {
    try {
        // Baixando o vídeo para um arquivo temporário
        const response = await axios({
            method: "get",
            url: fileUrl,
            responseType: "stream",
        });

        const fileName = new URL(fileUrl).pathname.split("/").pop();
        const filePath = path.join(__dirname, fileName);

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        // Enviando o arquivo baixado
        await client.sendFile(chatId, {
            file: filePath,
            caption: fileName,
        });

        console.log(`Arquivo ${fileName} enviado com sucesso!`);
        // Removendo o arquivo temporário após o envio
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error("Erro ao transmitir o arquivo:", error.message);
        throw error;
    }
}
