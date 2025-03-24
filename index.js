const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const botToken = process.env.BOT_TOKEN;
const chatId = 7824135861; // ID do chat

const bot = new TelegramBot(botToken, { polling: true });

bot.on('polling_error', (error) => {
    console.error('Erro de polling:', error);
});

bot.sendMessage(chatId, 'Teste de botão inline', {
    reply_markup: {
        inline_keyboard: [[{ text: 'Clique aqui', callback_data: 'teste' }]]
    }
}).then(() => {
    console.log('Mensagem com botão inline enviada!');
}).catch((error) => {
    console.error('Erro ao enviar mensagem:', error);
});
