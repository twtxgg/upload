const telegramAuthToken = `7824135861:AAEi3-nXSnhXs7WusqZd-vPElh1I7WfvdCE`;
const webhookEndpoint = "/endpoint";
const nodeServerUrl = "http://ec2-18-220-113-247.us-east-2.compute.amazonaws.com:3000";

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
    const messageId = update.message.message_id;

    console.log("chatId:", chatId, "threadId:", threadId, "userText:", userText);

    if (isValidUrl(userText)) {
      try {
        const body = threadId ? JSON.stringify({ fileUrl: userText, chatId: chatId, threadId: threadId, messageId: messageId }) : JSON.stringify({ fileUrl: userText, chatId: chatId, messageId: messageId });
        console.log("Corpo da requisição para o Node.js:", JSON.stringify(body));

        const response = await fetch(`${nodeServerUrl}/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-with": "XMLHttpRequest",
          },
          body: body,
        });

        const responseJson = await response.json();

        if (responseJson.success) {
          const deleteResult = await deleteMessageFromBot(chatId, messageId);
          if (deleteResult) {
            console.log("Mensagem original deletada com sucesso.");
          } else {
            console.log("Falha ao deletar a mensagem original.");
          }
        }
        console.log("Resposta do Node.js:", JSON.stringify(responseJson));
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
      await sendMessageToBot(chatId, responseText);
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
  const url = `https://api.telegram.org/bot${telegramAuthToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(
    message
  )}`;
  await fetch(url);
}

async function deleteMessageFromBot(chatId, messageId) {
  try {
    const url = `https://api.telegram.org/bot${telegramAuthToken}/deleteMessage?chat_id=${chatId}&message_id=${messageId}`;
    const response = await fetch(url);
    const responseJson = await response.json();

    if (responseJson.ok) {
      return true; // Mensagem deletada com sucesso
    } else {
      console.error("Erro ao deletar mensagem:", responseJson);
      return false; // Falha ao deletar a mensagem
    }
  } catch (error) {
    console.error("Erro ao deletar mensagem:", error);
    return false; // Falha ao deletar a mensagem
  }
}
