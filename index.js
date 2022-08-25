const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");

app.use(express.static(__dirname));

let currentPlayer = "player1";

let rooms = {};

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

let abilities = {
  get: () => {
    return {
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
  }}
}


function checkIfCardTypeValid(roomName, player, cardId){
  const data = cardData[cardId];

  if (data === undefined) return false;
  const roomData     = rooms[roomName];
  const playerData   = roomData[getPlayers(roomName, player)[0]];
  const cardType     = data.cardType;
  const extraDeck    = data.extraDeck;
  const cardTypeLeft = playerData[cardType + "sLeft"];

  if (extraDeck) return false;
  
  return cardTypeLeft > 0;
}

function getRandomCard(roomName, player) {
  //player: String, "player1" or "player2", whoever is drawing the card

  return getRandomCardWeighted(roomName, player, {}, 1);
}

function getRandomCardWeighted(roomName, player, data, randomFactor){
  //player:       String, "player1" or "player2"
  //data:         Object, keys are cardIds, values are weights
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  let weights = {};
  const roomData   = rooms[roomName];
  const playerData = roomData[getPlayers(roomName, player)[0]];

  //add cards from given data set if they're in the card list, and the player can add it
  for (const [id, value] of Object.entries(data)){
    if (playerData.cardsLeft[id] > 0 && checkIfCardTypeValid(roomName, player, id)){ //if undefined, this is also false
      weights[id] = value;
    }
  }

  //add cards if they're in the card list, not in the current weight object, and player can still add it
  for (const id of roomData.cardIds){
    if (weights[id] === undefined && playerData.cardsLeft[id] > 0 && checkIfCardTypeValid(roomName, player, id)){ //if undefined, this is also false
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
      playerData.cardsLeft[id]--;// = playerData.cardsLeft[id] - 1;
      const data = cardData[id];
      const cardType = data.cardType;
      playerData[cardType + "sLeft"]--;// = playerData[cardType + "sLeft"] - 1;
      return id;
    }
  }
  const fallBackData = cardData[lastId];
  const cardType = fallBackData.cardType; 
  playerData[cardType + "sLeft"]++;// = playerData[cardType + "sLeft"] - 1;
  playerData.cardsLeft[lastId]--;// = playerData.cardsLeft[lastId] - 1;
  return lastId;

}

function getRandomCardWeightedByTotalCount(roomName, player, randomFactor){
  return getRandomCardWeighted(roomName, player, totalUsages, randomFactor);
}

function getRandomCardWeightedByLastCard(roomName, player, lastCard, randomFactor){
  //player:       String, "player1" or "player2", whoever is drawing the card
  //lastCard:     String, id of the last card drawn by player
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  if (lastCard === null) return getRandomCard(roomName, player);

  let connectionsToLastCard = mainDeckConnections[lastCard]; //can I assume lastCard is always in mainDeckConnections?

  if (connectionsToLastCard === undefined) {
    return getRandomCardWeightedByTotalCount(roomName, player, randomFactor);
  }

  return getRandomCardWeighted(roomName, player, connectionsToLastCard, randomFactor);
}

function getAbilityStatus(roomName){
  const abilityStatus = {
    player1: {},
    player2: {}
  }
  const roomData =  rooms[roomName];

  const ids = {
    player1: roomData.player1Id,
    player2: roomData.player2Id
  }

  for (const player in abilityStatus){
    const playerData = roomData[ids[player]];
    const abilities = playerData.abilities;
    for (const ability in abilities){
      const abilityId = abilities[ability].id;
      let canUse = player === currentPlayer;
      canUse     = canUse && playerData.turnsBeforeUseAbility <= 0;
      canUse     = canUse && abilities[ability].count() > 0;
      canUse     = canUse && playerData.rerolls + abilities[ability].targetMe.rerolls >= 0;

      abilityStatus[player][abilityId] = canUse;

    }
  }
  return abilityStatus;
}

function getDefaultPlayerData(creatorName, role){
  return {
    name: creatorName,
    role: role,
    cardsLeft: {},
    cards: [],
    rerolls: 5,
    turnsBeforeRerollGained: 5,
    totalTurnsBeforeRerollGained: 5,
    rerollsPerGain: 2,
    turnsBeforeUseReroll: 1,
    turnsBeforeUseAbility: 1,
    nextCardGained: null,
    spellsLeft: 0,
    trapsLeft: 0,
    monstersLeft: 0,
    abilities: abilities.get()
  }
}

function makeRoom(roomName, creatorId, creatorName){
  rooms[roomName] = {
    players: 1,
    viewers: 0
  };
  rooms[roomName][creatorId] = getDefaultPlayerData(creatorName, "player1");
}

function emitRooms(){
  let roomNames = [];
  for (const roomName in rooms){
    roomNames.push(roomName);
  }
  io.emit("rooms", roomNames);
}

function getPlayers(roomName, playerRole){
  //returns array of ids for roomName that match playerRole
  let players  = [];
  let roomData = rooms[roomName];

  for (const id in roomData){
    const data = roomData[id];
    if (data.role === playerRole){
      players.push(id);
    }
  }
  return players;
}

function getPlayersData(roomName, playerRole, dataName){
  let data = {};
  const players = getPlayers[roomName, playerRole];
  const roomData = rooms[roomName];
  for (const player of players){
    data[player] = roomData[dataName];
  }

  return data;
}

function emitAbilityChange(roomName){
  io.to(roomName).emit("ability-update", getAbilityStatus(roomName));
}

function emitPlayerDataChanges(roomName){
  const roomData       = rooms[roomName];
  const player1Data    = roomData[getPlayers(roomName, "player1")[0]];
  const player2Data    = roomData[getPlayers(roomName, "player2")[0]]; 
  const player1Rerolls = player1Data.rerolls;
  const player2Rerolls = player2Data.rerolls;

  io.to(roomName).emit("data-change", player1Rerolls, player2Rerolls, getAbilityStatus(roomName));
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

io.on("connection", (socket) => {

  emitRooms();

  socket.on("make-room", (roomName, creatorName) =>{
    makeRoom(roomName, socket.id, creatorName);
    emitRooms();
    socket.join(roomName);
    io.to(roomName).emit("join-room", "player1", roomName, creatorName, "");
  });

  socket.on("join-room", (roomName, joinerName) => {
    const roomData     = rooms[roomName];
    const joinerRole   = roomData.players === 1 ? "player2" : "viewer";

    roomData[socket.id] = getDefaultPlayerData(joinerName, joinerRole);

    const player1Id   = getPlayers(roomName, "player1")[0];
    const player2Id   = getPlayers(roomName, "player2")[0];
    const player1Name = roomData[player1Id].name;
    const player2Name = roomData[player2Id].name;

    roomData[player1Id].opponentId  = player2Id;
    roomData[player2Id].opponentId  = player1Id;
    roomData.player1Id = player1Id;
    roomData.player2Id = player2Id;
    roomData.totalCards = 0;

    roomData.players++;
    socket.join(roomName);



    io.to(roomName).emit("join-room", joinerRole, roomName, player1Name, player2Name);
  });

  socket.on("getLists", (roomName) => {
    io.to(roomName).emit("setLists", cardListNames, banListNames, setListNames);
  });

  socket.on("ready-change", (roomName, player, readyText) => {
    io.to(roomName).emit("ready-change", player, readyText);
  });

  socket.on("start-game", (roomName, data) => {
    const cardListName = data["card-dropdown"];
    const banListName  = data["ban-dropdown"];
    const setListName  = data["set-dropdown"];
    randomFactor       = data["randomFactor"];
    
    const roomData  = rooms[roomName];
    const player1Id = roomData.player1Id;
    const player2Id = roomData.player2Id;

    let totalCardsAllowed = 0;
    for (const type of ["spells", "traps", "monsters"]){
      const dataName = type + "-textbox";
      const propertyName = type + "Left";
      roomData[player1Id][propertyName] = data[dataName];
      roomData[player2Id][propertyName] = data[dataName];
      totalCardsAllowed += data[dataName];
    }

    roomData.totalCardsAllowed = totalCardsAllowed * 2;

    //all names are the values of the dropdowns chosen by player 1
    //they correspond to the files stored on the server
    let idFile = fs.readFileSync("./public/cardLists/" + cardListName + ".txt","utf-8");
    roomData.cardIds = idFile.split("\n");
    let banFile = fs.readFileSync("./public/banLists/" + banListName + ".json");
    banList = JSON.parse(banFile);
    //set the number of cards left for each player, default is 3, unless the banlist mentions the card
    //then it's set to the banlist value
    for (const id of roomData.cardIds) {
      roomData[player1Id].cardsLeft[id] = banList[id] ? banList[id] : 3;
      roomData[player2Id].cardsLeft[id] = banList[id] ? banList[id] : 3;
    }
    io.to(roomName).emit("start-game", roomData[player1Id].abilities);
    currentPlayer = "player2";
    emitPlayerDataChanges(roomName);
    currentPlayer = "player1";
  });

  socket.on("draw-card", (roomName, player) => {
    //drawing a card is what switches the currentPlayer
    const roomData     = rooms[roomName];
    const data         = roomData[getPlayers(roomName, player)[0]];
    const lastCard     = data.cards[data.cards.length - 1];
    let drawCard;
    
    if (data.nextCardGained === "same" && data.cardsLeft[lastCard] > 0 && checkIfCardTypeValid(roomName, player, lastCard)){
      drawCard = lastCard;
      data.cardsLeft[drawCard]--; //random function does this automatically

    } else if (data.nextCardGained === "opponentSame"){
      const opponentData = roomData[data.opponentId]; 
      const opponentLastCard = opponentData.cards[opponentData.cards.length - 2];
      if (data.cardsLeft[opponentLastCard] > 0 && checkIfCardTypeValid(roomName, player, opponentLastCard)){
        drawCard = opponentLastCard;
        data.cardsLeft[drawCard]--;
      }
    } else {
      drawCard = getRandomCardWeightedByLastCard(roomName, player, lastCard, randomFactor);
    }

    data.cards.push(drawCard);

    data.nextCardGained          = null;
    data.turnsBeforeRerollGained = Math.max(--data.turnsBeforeRerollGained, 0);
    data.turnsBeforeUseAbility   = Math.max(--data.turnsBeforeUseAbility, 0);
    data.turnsBeforeUseReroll    = Math.max(--data.turnsBeforeUseReroll, 0);
    
    if (data.turnsBeforeRerollGained <= 0){
      data.rerolls += data.rerollsPerGain;
      data.turnsBeforeRerollGained = data.totalTurnsBeforeRerollGained;
    }

    currentPlayer                = player === "player1" ? "player2" : "player1";

    roomData.totalCards++;
    if (roomData.totalCards >= roomData.totalCardsAllowed){
      io.to(roomName).emit("end-game");
      return;
    }
    
    emitPlayerDataChanges(roomName);
    io.to(roomName).emit("draw-card", player, drawCard);
  });

  socket.on("reroll", (roomName, player) => {
    const roomData     = rooms[roomName];
    const playerData   = roomData[getPlayers(roomName, player)[0]];
    //don't reroll is player has no rerolls left, has a waiting period before rerolling, or has no cards
    if (playerData.rerolls <= 0 || playerData.turnsBeforeUseReroll > 0 || playerData.cards.length == 0){
      return;
    }
    
    const playerCards    = playerData.cards;
    const previousCardId = playerCards[playerCards.length - 1];
    const drawCard       = getRandomCard(roomName, player);

    playerData.rerolls--;
    playerData.cardsLeft[previousCardId]++;
    playerCards[playerCards.length - 1] = drawCard;
  
    emitPlayerDataChanges(roomName);
    io.to(roomName).emit("reroll", drawCard, player);
  });

  socket.on("ability", (roomName, abilityName, player) => {
    const roomData  = rooms[roomName];
    const myData    = roomData[getPlayers(roomName, player)[0]];

    if (myData.turnsBeforeUseAbility > 0 || player != currentPlayer){
      return;
    }

    const opponentData   = roomData[myData.opponentId];
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
    emitPlayerDataChanges(roomName);
  });

  socket.on("download", (roomName, player) =>{
    const roomData     = rooms[roomName];
    const playerData   = roomData[getPlayers(roomName, player)[0]];
    const cards        = playerData.cards;

    let ydkFile = "#main";
    for (const card of cards){
      ydkFile += "\n" + card;
    }
    ydkFile += "\n!extra\n!side";

    io.to(roomName).emit("download", player, ydkFile);
  });

  socket.on("disconnecting", () => {
    for (const roomName in rooms){
      if (rooms[roomName][socket.id] != undefined){
        const isPlayer1 = rooms[roomName][socket.id].role === "player1";
        rooms[roomName].players--;
        delete rooms[roomName][socket.id];
        if (rooms[roomName].players === 0 || isPlayer1){
          io.to(roomName).emit("room-closed");
          delete rooms[roomName];
          emitRooms();
        }
        
      }
    }
  });

  socket.on("disconnect", () => {
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
