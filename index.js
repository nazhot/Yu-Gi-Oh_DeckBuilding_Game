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

let abilities = {
  "Three For Two" : {
    count: () => {return 2},
    id: "three-for-two",
    description: "Get 2 more rerolls, but your opponent is getting 3!",
    targetMe: {
      rerolls: 2,
      turnsBeforeUseAbility: 1
    },
    
    targetOpponent: {
      rerolls: 3
    }
  },

  "Another, Please!" : {
    count: () => {return 2},
    id: "another-please",
    description: "You loved the last card you got so much, why not get another one?",
    targetMe: {
      nextCardGained: "same",
      rerolls: -1,
      turnsBeforeUseAbility: 1
    }
  },

  "They'll Have What I'm Having" : {
    count: () => {return 2},
    id: "theyll-have",
    description: "You hated the last card you got so much, why not give one to your opponent?",
    targetMe: {
      rerolls: -1,
      turnsBeforeUseAbility: 1,
      turnsBeforeUseReroll: 1
    }, 
    targetOpponent: {
      nextCardGained: "opponentSame"
    }
  }
}

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
      monstersLeft: 0,
      abilities: {}
    }
  }
}



let playerData = {
  player1: {},
  player2: {}
}

playerData.player1 = playerDataPrototype.setup();
playerData.player2 = playerDataPrototype.setup();

for (const abilityName in abilities){
  playerData.player1.abilities[abilityName] = abilities[abilityName];
  playerData.player2.abilities[abilityName] = abilities[abilityName];
}

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
    io.emit("start-game", playerData.player1.abilities);
  });

  socket.on("draw-card", (isPlayer1) => {
    const player       = isPlayer1 ? "player1" : "player2";
    const data         = playerData[player];
    const lastCard     = data.cards[data.cards.length - 1];
    let drawCard;
    
    if (data.nextCardGained === "same" && data.cardsLeft[lastCard] > 0 && checkIfCardTypeValid(player, lastCard)){
      drawCard = lastCard;
      // data.cards.push(lastCard)
      // io.emit("draw-card", isPlayer1, lastCard);
      // data.nextCardGained = null;
      // return;
    } else if (data.nextCardGained === "opponentSame"){
      const opponent = isPlayer1 ? "player2" : "player1";
      const opponentData = playerData[opponent]; 
      const opponentLastCard = opponentData.cards[opponentData.cards.length - 2];
      if (data.cardsLeft[opponentLastCard] > 0 && checkIfCardTypeValid(player, opponentLastCard)){
        drawCard = opponentLastCard;
        // data.cards.push(opponentLastCard);
        // io.emit("draw-card", isPlayer1, opponentLastCard);
      }
    } else {
      drawCard = getRandomCardWeightedByLastCard(player, lastCard, 0);
    }

    data.cards.push(drawCard);

    data.nextCardGained          = null;
    data.turnsBeforeRerollGained = Math.max(--data.turnsBeforeRerollGained, 0);
    data.turnsBeforeUseAbility   = Math.max(--data.turnsBeforeUseAbility, 0);
    data.turnsBeforeUseReroll    = Math.max(--data.turnsBeforeUseReroll, 0);

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

  socket.on("ability", (abilityName, isPlayer1) => {
    const player       = isPlayer1 ? "player1" : "player2";
    const myData       = playerData[player];

    if (myData.turnsBeforeUseAbility > 0){
      return;
    }

    const opponent       = isPlayer1 ? "player2" : "player1";
    const opponentData   = playerData[opponent];
    const ability        = myData.abilities[abilityName];
    const targetMe       = ability.targetMe;
    const targetOpponent = ability.targetOpponent;

    for (const trait in targetMe){
      const value = targetMe[trait];
      if (typeof value === "number"){
        myData[trait] += value;
      } else {
        myData[trait] = value;
      }
    }

    for (const trait in targetOpponent){
      const value = targetOpponent[trait];
      if (typeof value === "number"){
        opponentData[trait] += value;
      } else {
        opponentData[trait] = value;
      }
    }

    console.log("My rerolls: " + myData.rerolls);
    console.log("Opponent rerolls: " + opponentData.rerolls);
    io.emit("ability", isPlayer1, myData.rerolls, opponentData.rerolls);
  });

  socket.on("disconnect", () => {
    players = players.filter((player) => player !== socket.id);
    io.emit("disconnected", socket.id, players);
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
