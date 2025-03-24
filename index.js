const express = require("express");
const fs = require("fs");
const axios = require("axios");
const { TelegramClient, Api } = require("telegram");
const { ReplyInlineMarkup, KeyboardButtonCallback } = require("telegram/tl/types"); // Importação direta
const { StringSession } = require("telegram/sessions");
const readlineSync = require("readline-sync");
const path = require("path");
require("dotenv").config();

// ... (rest of your code)

async function uploadFile(filePath, chatId, threadId) {
  try {
    let messageOptions = {
      message: `Uploading file: ${fileName}`,
      buttons: new ReplyInlineMarkup({ // Usando a importação direta
        rows: [
          [
            new KeyboardButtonCallback({ // Usando a importação direta
              text: "Clique aqui para teste",
              data: "test_button",
            }),
          ],
        ],
      }),
    };

    // ... (rest of the function)
  } catch (error) {
    // ...
  }
}

// ... (rest of your code)
