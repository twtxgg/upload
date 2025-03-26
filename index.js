const telegramAuthToken = `7824135861:AAEi3-nXSnhXs7WusqZd-vPElh1I7WfvdCE`;
const webhookEndpoint = "/endpoint";
const nodeServerUrl = "http://ec2-18-220-113-247.us-east-2.compute.amazonaws.com:3000"; // Removido ec2-user@

addEventListener("fetch", (event) => {
    event.respondWith(handleIncomingRequest(event));
});

async function handleIncomingRequest(event) {
    let url = new URL(event.request.url);
    let path = url.pathname;
    let method = event.request.method;
    let workerUrl = `${url.protocol}//${url.host}`;

    if (method === "POST" && path === webhookEndpoint) {
        const update = await event.request.json();
        console.log("Mensagem recebida do Telegram:", JSON.stringify(update));
        event.waitUntil(processUpdate(update));
        return new Response("Ok");
    } else if (method === "GET" && path === "/configure-webhook") {
        const url = `https://api.telegram.org/bot${telegramAuthToken}/setWebhook?url=${workerUrl}${webhookEndpoint}`;
        const response = await fetch(url);

        if (response.ok) {
            return new Response("Webhook set successfully", { status: 200 });
        } else {
            return new Response("Failed to set webhook", { status: response.status });
        }
    } else {
        return new Response("Not found", { status: 404 });
    }
}

async function processUpdate(update) {
    if ("message" in update) {
        const chatId = update.message.chat.id;
        const userText = update.message.text;
        let threadId = update.message.message_thread_id;

        console.log("chatId:", chatId, "threadId:", threadId, "userText:", userText);

        if (isValidUrl(userText)) {
            try {
                const body = threadId ? JSON.stringify({ fileUrl: userText, chatId: chatId, threadId: threadId }) : JSON.stringify({ fileUrl: userText, chatId: chatId });
                console.log("Corpo da requisição para o Node.js:", JSON.stringify(body));

                const response = await fetch(`${nodeServerUrl}/upload`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Requested-with": "XMLHttpRequest",
                    },
                    body: body,
                });
                console.log("Resposta do Node.js:", JSON.stringify(response));
            } catch (error) {
                console.error("Erro ao enviar requisição:", error);
                const responseText = `Error uploading file: ${error.message}`;
                await sendMessageToBot(chatId, responseText);
            }
        } else if (
            !(
                update.message.document ||
                update.message.text.startsWith("Uploading file") ||
                update.message.text.startsWith("Downloading file")
            )
        ) {
            const responseText = "Invalid URL!";
            const sentMessage = await sendMessageToBot(chatId, responseText);

            console.log("Resposta do sendMessage:", JSON.stringify(sentMessage)); // Log da resposta do sendMessage

            if (sentMessage && sentMessage.result && sentMessage.result.message_id) {
                const messageIdToDelete = sentMessage.result.message_id;

                console.log("messageID para deletar:", messageIdToDelete); // Log do messageIdToDelete

                setTimeout(() => {
                    console.log("Timeout executado"); // Log do timeout
                    deleteMessageFromBot(chatId, messageIdToDelete);
                }, 3000);
            }
        }
    }
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

async function sendMessageToBot(chatId, message) {
    const url = `https://api.telegram.org/bot${telegramAuthToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(message)}`;
    const response = await fetch(url);
    return response.json();
}

async function deleteMessageFromBot(chatId, messageId) {
    console.log("Deletando mensagem:", chatId, messageId); // Log da chamada da função
    const url = `https://api.telegram.org/bot${telegramAuthToken}/deleteMessage?chat_id=${chatId}&message_id=${messageId}`;
    const response = await fetch(url);
    const responseJson = await response.json();
    console.log("Resposta do deleteMessage:", JSON.stringify(responseJson)); // Log da resposta da API
}
