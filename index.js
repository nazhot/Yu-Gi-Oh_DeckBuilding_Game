const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");

app.use(express.static(__dirname));

let players = [];

let cardData = fs.readFileSync("./public/cards/cardData.json");
cardData = JSON.parse(cardData);

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

let playerDataPrototype = {
  setup: () => {
    return {  
      name: "",
      id: "",
      cardsLeft: {},
      cards: [],
      rerolls: 5,
      turnsBeforeRerollGained: 5,
      rerollsPerGain: 2,
      turnsBeforeUseReroll: 0,
      turnsBeforeUseAbility: 0,
      nextCardGained: null,
      spellsLeft: 0,
      trapsLeft: 0,
      monstersLeft: 0
    }
  }
}

let playerData = {
  player1: {},
  player2: {}
}

playerData.player1 = playerDataPrototype.setup();
playerData.player2 = playerDataPrototype.setup();

function checkIfCardTypeValid(player, cardId){
  const data = cardData[cardId];

  if (data === undefined) return false;

  const cardType     = data.cardType;
  const extraDeck    = data.extraDeck;
  const cardTypeLeft = playerData[player][cardType + "sLeft"];

  if (extraDeck) return false;
  
  return cardTypeLeft > 0;
}

function getRandomCard(player) {
  //player: String, "player1" or "player2", whoever is drawing the card
  
  return getRandomCardWeighted(player, {}, 1);
}

function getRandomCardWeighted(player, data, randomFactor){
  //player:       String, "player1" or "player2"
  //data:         Object, keys are cardIds, values are weights
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  let weights = {};

  //add cards from given data set if they're in the card list, and the player can add it
  for (const [id, value] of Object.entries(data)){
    if (playerData[player].cardsLeft[id] > 0 && checkIfCardTypeValid(player, id)){ //if undefined, this is also false
      weights[id] = value;
    }
  }

  //add cards if they're in the card list, not in the current weight object, and player can still add it
  for (const id of cardIds){
    if (weights[id] === undefined && playerData[player].cardsLeft[id] > 0 && checkIfCardTypeValid(player, id)){ //if undefined, this is also false
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
      playerData[player].cardsLeft[id] = playerData[player].cardsLeft[id] - 1;
      const data = cardData[id];
      const cardType = data.cardType;
      playerData[player][cardType + "sLeft"] = playerData[player][cardType + "sLeft"] - 1;
      return id;
    }
  }
  const fallBackData = cardData[lastId];
  const cardType = fallBackData.cardType;
  playerData[player][cardType + "sLeft"] = playerData[player][cardType + "sLeft"] - 1;
  playerData[player].cardsLeft[lastId] = playerData[player].cardsLeft[lastId] - 1;
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

  socket.on("start-game", (data) => {
    const cardListName = data["card-dropdown"];
    const banListName  = data["ban-dropdown"];
    const setListName  = data["set-dropdown"];

    //should refactor this later to be expandable a lot more easily
    playerData.player1.spellsLeft   = data["spells-textbox"];
    playerData.player1.trapsLeft    = data["traps-textbox"];
    playerData.player1.monstersLeft = data["monsters-textbox"];

    playerData.player2.spellsLeft   = data["spells-textbox"];
    playerData.player2.trapsLeft    = data["traps-textbox"];
    playerData.player2.monstersLeft = data["monsters-textbox"];

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
      playerData.player1.cardsLeft[id] = banList[id] ? banList[id] : 3;
      playerData.player2.cardsLeft[id] = banList[id] ? banList[id] : 3;
    }
    io.emit("start-game");
  });

  socket.on("draw-card", (isPlayer1, lastCard) => {
    let player = isPlayer1 ? "player1" : "player2";
    let drawCard = getRandomCardWeightedByLastCard(player, lastCard, 0);
    playerData[player]["cards"].push(drawCard);
    io.emit("draw-card", isPlayer1, drawCard);
  });

  socket.on("reroll", (player) => {
    //don't reroll is player has no rerolls left, has a waiting period before rerolling, or has no cards
    if (playerData[player].rerolls <= 0 || playerData[player].turnsBeforeUseReroll > 0 || playerData[player].cards.length == 0){
      return;
    }
    
    const playerCards    = playerData[player]["cards"];
    const previousCardId = playerCards[playerCards.length - 1];
    const drawCard       = getRandomCard(player);

    playerData[player]["rerolls"]--;
    playerData[player]["cardsLeft"][previousCardId]++;
    playerCards[playerCards.length - 1] = drawCard;

    io.emit("reroll", drawCard, player, playerData[player]["rerolls"]);
  });

  socket.on("disconnect", () => {
    players = players.filter((player) => player !== socket.id);
    io.emit("disconnected", socket.id, players);
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
