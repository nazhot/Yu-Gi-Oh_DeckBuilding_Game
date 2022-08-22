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

let mainDeckConnections = fs.readFileSync("./public/connections/mainDeck-connections.json");
mainDeckConnections = JSON.parse(mainDeckConnections);

let totalUsages = fs.readFileSync("./public/connections/totalUsages.json");
totalUsages = JSON.parse(totalUsages);

let cardIds;
let banList;
let setList;

let playerCardsLeft = {
  player1: {},
  player2: {},
};

console.log(playerCardsLeft.player3);
function getRandomCard(player) {
  //player: String, "player1" or "player2", whoever is drawing the card
  let drawCard;
  do {
    drawCard = cardIds[Math.floor(Math.random() * cardIds.length)];
  } while (playerCardsLeft[player][drawCard] <= 0);
  playerCardsLeft[player][drawCard]--;
  return drawCard;
}

function getRandomCardWeighted(player, data, randomFactor){
  //player:       String, "player1" or "player2"
  //data:         Object, keys are cardIds, values are weights
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  let weights = {};

  //add cards from given data set if they're in the card list, and the player can add it
  for (const [id, value] of Object.entries(data)){
    if (playerCardsLeft[player][id] > 0){ //if undefined, this is also false
      weights[id] = value;
    }
  }

  //add cards if they're in the card list, not in the current weight object, and player can still add it
  for (const id of cardIds){
    if (weights[id] === undefined && playerCardsLeft[player][id] > 0){ //if undefined, this is also false
      weights[id] = 1;
    }
  }


  //set each weight to 1 (randomFactor = 1) to itself (randomFactor = 0)
  let totalWeight = 0;
  for (const [id, value] of Object.entries(weights)){
    const divisor = (1 + randomFactor * (parseFloat(value) - 1));
    weights[id] = parseFloat(value) / divisor;
    totalWeight += weights[id];

  }

  //normalize array
  for (const [id, value] of Object.entries(weights)){
    weights[id] = value / totalWeight;
  }

  const randomValue = Math.random();
  let countValue    = 0;
  let lastId;

  for (const [id, value] of Object.entries(weights)){
    countValue += value;
    lastId = id;
    if (randomValue < countValue){
      playerCardsLeft[player][id] = playerCardsLeft[player][id] - 1;
      return id;
    }
  }

  playerCardsLeft[player][lastId] = playerCardsLeft[player][lastId] - 1;
  return lastId;

}

function getRandomCardWeightedByTotalCount(player, randomFactor){
  return getRandomCardWeighted(player, totalUsages, randomFactor);
}

function getRandomCardWeightedByLastCard(player, lastCard, randomFactor){
  //player:       String, "player1" or "player2", whoever is drawing the card
  //lastCard:     String, id of the last card drawn by player
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  if (lastCard === null) return getRandomCard(player);

  let connectionsToLastCard = mainDeckConnections[lastCard]; //can I assume lastCard is always in mainDeckConnections?
  let idArray               = [];
  let valueArray            = [];

  if (connectionsToLastCard === undefined) {
    return getRandomCardWeightedByTotalCount(player, randomFactor);
  }

  return getRandomCardWeighted(player, connectionsToLastCard, randomFactor);
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
    //all names are the values of the dropdowns chosen by player 1
    //they correspond to the files stored on the server
    let idFile = fs.readFileSync("./public/cardLists/" + cardListName + ".txt","utf-8");
    cardIds = idFile.split("\n");
    let banFile = fs.readFileSync("./public/banLists/" + banListName + ".json");
    banList = JSON.parse(banFile);
    //set the number of cards left for each player, default is 3, unless the banlist mentions the card
    //then it's set to the banlist value
    for (let i = 0; i < cardIds.length; i++) {
      let id = cardIds[i];
      playerCardsLeft.player1[id] = banList[id] ? banList[id] : 3;
      playerCardsLeft.player2[id] = banList[id] ? banList[id] : 3;
    }
    io.emit("start-game");
  });

  socket.on("draw-card", (isPlayer1, lastCard) => {
    let player = isPlayer1 ? "player1" : "player2";
    let drawCard = getRandomCardWeightedByLastCard(player, lastCard, 0);
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
