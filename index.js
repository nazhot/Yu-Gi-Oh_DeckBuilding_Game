const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");

app.use(express.static(__dirname));

let players = [];
let cardListFiles = fs.readdirSync("./public/cardLists/");
let cardListNames = cardListFiles.map((x) => {
  return x.replace(".txt", "");
});
let banListFiles = fs.readdirSync("./public/banLists/");
let banListNames = banListFiles.map((x) => {
  return x.replace(".json", "");
});
let setListFiles = fs.readdirSync("./public/setLists/");
let setListNames = setListFiles.map((x) => {
  return x.replace(".json", "");
});
let cardIds;
let banList;
let setList;

let playerCardsLeft = {
  player1: {},
  player2: {},
};

function getRandomCard(player) {
  let drawCard;
  do {
    drawCard = cardIds[Math.floor(Math.random() * cardIds.length)];
  } while (playerCardsLeft[player][drawCard] <= 0);
  playerCardsLeft[player][drawCard]--;
  return drawCard;
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

io.on("connection", (socket) => {
  players.push(socket.id);
  if (players.length === 1) {
    io.emit("player1", socket.id);
  } else if (players.length === 2) {
    io.emit("player2", socket.id);
  } else {
    io.emit("viewer", socket.id);
  }

  socket.on("getLists", () => {
    io.emit("setLists", cardListNames, banListNames, setListNames);
  });

  socket.on("ready-change", (player, readyText) => {
    io.emit("ready-change", player, readyText);
  });

  socket.on("start-game", (cardListName, banListName, setListName) => {
    let idFile = fs.readFileSync(
      "./public/cardLists/" + cardListName + ".txt",
      "utf-8"
    );
    cardIds = idFile.split("\n");
    let banFile = fs.readFileSync("./public/banLists/" + banListName + ".json");
    banList = JSON.parse(banFile);
    for (let i = 0; i < cardIds.length; i++) {
      let id = cardIds[i];
      playerCardsLeft.player1[id] = banList[id] ? banList[id] : 3;
      playerCardsLeft.player2[id] = banList[id] ? banList[id] : 3;
    }
    io.emit("start-game");
  });

  socket.on("draw-card", (isPlayer1) => {
    let player = isPlayer1 ? "player1" : "player2";
    let drawCard = getRandomCard(player);
    io.emit("draw-card", isPlayer1, drawCard);
  });

  socket.on("reroll", (isPlayer1, previousCardId) => {
    let player = isPlayer1 ? "player1" : "player2";
    playerCardsLeft[player][previousCardId]++;
    let drawCard = getRandomCard(player);
    io.emit("reroll", drawCard, isPlayer1);
  });

  socket.on("disconnect", () => {
    players = players.filter((player) => player !== socket.id);
    io.emit("disconnected", socket.id, players);
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
