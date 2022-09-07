const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");

app.use(express.static(__dirname));

const rooms = {};
const cardTypes = ["Spells", "Traps", "Normal Monsters", "Effect Monsters"];

let cardData = fs.readFileSync("./public/cards/cardData.json");
cardData = JSON.parse(cardData);

const cardListFiles = fs.readdirSync("./public/cardLists/");
const cardListNames = cardListFiles.map((x) => {
  return x.replace(".txt", "");
});

const banListFiles = fs.readdirSync("./public/banLists/");
const banListNames = banListFiles.map((x) => {
  return x.replace(".json", "");
});

const setListFiles = fs.readdirSync("./public/setLists/");
const setListNames = setListFiles.map((x) => {
  return x.replace(".json", "");
});

let mainDeckConnections = fs.readFileSync("./public/connections/mainDeck-connections.json");
mainDeckConnections = JSON.parse(mainDeckConnections);

let totalUsages = fs.readFileSync("./public/connections/totalUsages.json");
totalUsages = JSON.parse(totalUsages);

const abilities = {
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

function cleanCardType(cardType, replace){
  return cardType.toLowerCase().replace(" ", replace);
}

function getCardType(cardData){
  if (cardData.specificCardType === undefined || cardData.cardType === "spell" || cardData.cardType === "trap"){
    return cardData.cardType;
  }
  const cardType = cardData.specificCardType + cardData.cardType;
  return cleanCardType(cardType, "");
}

function checkIfCardTypeValid(roomName, player, cardId, extraDeckAllowed){
  updateCardTypeCounts(roomName);
  const data = cardData[cardId];

  if (data === undefined) return false;

  const roomData        = rooms[roomName];
  const playerData      = roomData[roomData[player]];
  const cardType        = getCardType(data); //spell/trap or effectmonster/normalmonster
  const extraDeck       = data.extraDeck; 
  const cardTypeAllowed = playerData[cardType + "sAllowed"];
  const cardTypeUsed    = playerData[cardType + "sUsed"];

  if (extraDeck != extraDeckAllowed) return false;
  if (extraDeckAllowed){ //if this is for the extra deck (line above is true), then this should just return true since user isn't putting in any data for extra deck monsters
    return true;
  }
  if (cardTypeAllowed - cardTypeUsed < 0){
    roomData.logText += "\nERROR: " + cardData[cardId].name + " appears too many times in " + player + "'s deck";
  }
  
  return cardTypeAllowed - cardTypeUsed > 0;
}

function checkIfCardValid(roomName, player, cardId, extraDeckAllowed){
  return checkIfCardTypeValid(roomName, player, cardId, extraDeckAllowed) && cardsLeft(roomName, player, cardId) > 0;
}

function getRandomCard(roomName, player, extraDeckAllowed) {
  //player: String, "player1" or "player2", whoever is drawing the card
  return getRandomCardWeighted(roomName, player, {}, 1, extraDeckAllowed);
}

function getRandomCardWeighted(roomName, player, data, randomFactor, extraDeckAllowed){
  //player:       String, "player1" or "player2"
  //data:         Object, keys are cardIds, values are weights
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  const weights  = {};
  const roomData = rooms[roomName];

  //add cards from given data set if they're in the card list, and the player can add it
  for (const [id, value] of Object.entries(data)){
    if (roomData.cardIds.includes(id) && checkIfCardValid(roomName, player, id, extraDeckAllowed)){ //if undefined, this is also false
      weights[id] = value;
    }
  }

  //add cards if they're in the card list, not in the current weight object, and player can still add it
  for (const id of roomData.cardIds){
    if (weights[id] === undefined && checkIfCardValid(roomName, player, id, extraDeckAllowed)){ //if undefined, this is also false
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
  let lastId        = "300302042"; //this a random skill card, forever log showed fallbackData not being set
                                   //I imagine it is because there was nothing in weights

  for (const [id, value] of Object.entries(weights)){
    countValue += value; 
    lastId = id;
    if (randomValue <= countValue){
      const data     = cardData[id];

      return id;
    }
  }
  roomData.logText += "\nFall back data had to be used";
  roomData.logText += "\nRoom:         " + roomName;
  roomData.logText += "\nPlayer:       " + player;
  roomData.logText += "\nWeights size: " + Object.keys(weights).length;
  roomData.logText += "\nId:           " + lastId;
  return lastId;

}

function getRandomCardWeightedByTotalCount(roomName, player, randomFactor, extraDeckAllowed){
  return getRandomCardWeighted(roomName, player, totalUsages, randomFactor, extraDeckAllowed);
}

function getRandomCardWeightedByLastCard(roomName, player, lastCard, randomFactor, extraDeckAllowed){
  //player:       String, "player1" or "player2", whoever is drawing the card
  //lastCard:     String, id of the last card drawn by player
  //randomFactor: float,  0-1, how random to make the card draw, based on the connection map

  if (lastCard === undefined) {
    rooms[roomName].logText += "\n" + player + " has no last card, going random"; 
    return getRandomCard(roomName, player, extraDeckAllowed);
  }

  const connectionsToLastCard = mainDeckConnections[lastCard]; //can I assume lastCard is always in mainDeckConnections?

  if (connectionsToLastCard === undefined) {
    rooms[roomName].logText += "\n" + player + " has no connections to last card (" + cardData[lastCard].name + "), going weighted by total";
    return getRandomCardWeightedByTotalCount(roomName, player, randomFactor, extraDeckAllowed);
  }
  rooms[roomName].logText += "\n" + player + " has connection to last card (" + cardData[lastCard].name + "), going weighted by last card";
  return getRandomCardWeighted(roomName, player, connectionsToLastCard, randomFactor, extraDeckAllowed);
}

function getAbilityStatus(roomName){
  const abilityStatus = {
    player1: {},
    player2: {}
  }
  const roomData =  rooms[roomName];

  const ids = {
    player1: roomData.player1,
    player2: roomData.player2
  }

  for (const player in abilityStatus){
    const playerData = roomData[ids[player]];
    const abilities = playerData.abilities;
    for (const ability in abilities){
      const abilityId = abilities[ability].id;
      let canUse = player === roomData.currentPlayer; //if not current player, can't use abilities
          canUse = canUse && playerData.turnsBeforeUseAbility <= 0; //still turns to go before able to use ability
          canUse = canUse && abilities[ability].count() > 0; //ability has ran out of uses
          canUse = canUse && (playerData.rerolls + abilities[ability].targetMe.rerolls) >= 0; //after using ability, user will not have negative rerolls

      abilityStatus[player][abilityId] = canUse;
    }
  }
  return abilityStatus;
}

function getDefaultPlayerData(playerName, role){
  //TODO: update this so that it takes info from cardTypes
  return {
    name: playerName,
    role: role,
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
    normalmonstersLeft: 0,
    effectmonstersLeft: 0,
    abilities: abilities.get()
  }
}

function makeRoom(roomName, creatorId, creatorName){
  rooms[roomName] = {
    players:    1,
    viewers:    0,
    totalCards: 0,
    player1:    creatorId,
    logText:        "-------------------------------\nLog file for " + roomName + "\n-------------------------------",
    // log:        (text) => {
    //   this.logText += "\n" + text;
    // },
  };
  rooms[roomName][creatorId] = getDefaultPlayerData(creatorName, "player1");
}

function emitRooms(){
  const roomNames = [];
  for (const roomName in rooms){
    roomNames.push(roomName);
  }
  io.emit("rooms", roomNames);
}

function emitPlayerDataChanges(roomName){
  const roomData       = rooms[roomName];
  const player1Data    = roomData[roomData.player1];
  const player2Data    = roomData[roomData.player2]; 

  if (player1Data.rerolls < 0){
    roomData.logText += "\nERROR: player1 rerolls below 0";
  }
  if (player2Data.rerolls < 0){
    roomData.logText += "\nERROR: player2 rerolls below 0";
  }
  player1Data.rerolls = Math.max(player1Data.rerolls, 0); //Christian was having issues with negative rerolls
  player2Data.rerolls = Math.max(player2Data.rerolls, 0); //need to look into, for now we set a minimum of 0

  const player1Rerolls = player1Data.rerolls;
  const player2Rerolls = player2Data.rerolls;

  io.to(roomName).emit("data-change", player1Rerolls, player2Rerolls, getAbilityStatus(roomName));
}

function cardsLeft(roomName, player, cardId){
  const roomData   = rooms[roomName];
  const myData     = roomData[roomData[player]];
  let   cardsLeft  = roomData.banList[cardId] === undefined ? 3 : roomData.banList[cardId];
  let   cardsUsed  = 0;

  for (let i = 0; i < myData.cards.length; i++){
    if (myData.cards[i] === cardId){
      cardsUsed++;
    }
  }

  cardsLeft -= cardsUsed;

  if (cardsLeft < 0){
    roomData.logText += "\nERROR: " + cardId + " has " + Math.abs(cardsLeft) + " too many cards";
  }

  return cardsLeft;
}

function updateCardTypeCounts(roomName){
  const roomData    = rooms[roomName];
  const players = {
    player1: roomData[roomData.player1],
    player2: roomData[roomData.player2]
  }

  for (const player in players){
    const playerData  = players[player];
    const playerCards = playerData.cards;
    for (const cardType of cardTypes){
      const dataCardType = cleanCardType(cardType, "");
      playerData[dataCardType + "Used"] = 0;
    }

    for (const cardId of playerCards){
      if (cardId === null){ //last card set to null on reroll
        continue;
      }
      const cardType = getCardType(cardData[cardId]);
      playerData[cardType + "sUsed"]++;
    }
  }
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

io.on("connection", (socket) => {
  for (const room of socket.rooms){
    if (room != socket.id){
      socket.leave(room);
    }
  }
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
    roomData.player2    = roomData.player2 === undefined ? socket.id : roomData.player2;

    const player1Id   = roomData.player1;
    const player2Id   = roomData.player2;
    const player1Name = roomData[player1Id].name;
    const player2Name = roomData[player2Id].name;

    roomData[player1Id].opponentId  = player2Id;
    roomData[player2Id].opponentId  = player1Id;
    roomData.player1                = player1Id;

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
    const randomFactor = data["randomFactor"];
    
    const roomData  = rooms[roomName];
    const player1Id = roomData.player1;
    const player2Id = roomData.player2;

    roomData.logText += "\nCard list for room: " + cardListName;
    roomData.logText += "\nBan list for room:  " + banListName;
    roomData.logText += "\nSet list for room:  " + setListName;

    let totalCardsAllowed = 0;
    for (const cardType of cardTypes){
      const componentCardType = cleanCardType(cardType, "-");
      const propCardType      = cleanCardType(cardType, "");
      const dataName = componentCardType + "-textbox";
      const propertyName = propCardType + "Allowed";
      roomData[player1Id][propertyName] = data[dataName];
      roomData[player2Id][propertyName] = data[dataName];
      totalCardsAllowed += data[dataName];
      roomData.logText += "\n" + propertyName + ": " + data[dataName];
    }

    roomData.logText += "\nRandom Factor:      " + randomFactor;

    //all names are the values of the dropdowns chosen by player 1
    //they correspond to the files stored on the server
    const idFile  = fs.readFileSync("./public/cardLists/" + cardListName + ".txt","utf-8");
    const banFile = fs.readFileSync("./public/banLists/" + banListName + ".json");

    roomData.cardIds           = idFile.split("\n");
    roomData.banList           = JSON.parse(banFile);
    roomData.totalCardsAllowed = totalCardsAllowed * 2;
    roomData.randomFactor      = parseFloat(randomFactor);

    io.to(roomName).emit("start-game", roomData[player1Id].abilities);
    emitPlayerDataChanges(roomName);
    roomData.currentPlayer = "player1";
  });

  socket.on("draw-card", (roomName, player) => {
    //drawing a card is what switches the currentPlayer
    const roomData = rooms[roomName];
    const myData   = roomData[roomData[player]];
    const lastCard = myData.cards[myData.cards.length - 1];
    let drawCard;
    
    if (myData.nextCardGained === "same" && checkIfCardValid(roomName, player, lastCard, false)){
      
      drawCard = lastCard;

    } else if (myData.nextCardGained === "opponentSame"){

      const opponentData     = roomData[myData.opponentId]; 
      const opponentLastCard = opponentData.cards[opponentData.cards.length - 2]; // -2 since the opponent will have drawn a card since then
      
      if (checkIfCardValid(roomName, player, opponentLastCard, false)){
      
        drawCard = opponentLastCard;
      
      } else {

        drawCard = getRandomCard(roomName, player, false);

      }
    } else {
      drawCard = getRandomCardWeightedByLastCard(roomName, player, lastCard, roomData.randomFactor, false);
    }

    myData.cards.push(drawCard);

    myData.nextCardGained          = null;
    myData.turnsBeforeRerollGained = Math.max(--myData.turnsBeforeRerollGained, 0);
    myData.turnsBeforeUseAbility   = Math.max(--myData.turnsBeforeUseAbility, 0);
    myData.turnsBeforeUseReroll    = Math.max(--myData.turnsBeforeUseReroll, 0);
    
    if (myData.turnsBeforeRerollGained <= 0){
      myData.rerolls += myData.rerollsPerGain;
      myData.turnsBeforeRerollGained = myData.totalTurnsBeforeRerollGained;
    }

    roomData.currentPlayer = player === "player1" ? "player2" : "player1";

    roomData.totalCards++;
    if (roomData.totalCards >= roomData.totalCardsAllowed){
      io.to(roomName).emit("end-game");
      return;
    }
    updateCardTypeCounts(roomName);
    emitPlayerDataChanges(roomName);
    io.to(roomName).emit("draw-card", player, drawCard);
  });

  socket.on("reroll", (roomName, player) => {
    const roomData = rooms[roomName];
    const myData   = roomData[roomData[player]];
    //don't reroll is player has no rerolls left, has a waiting period before rerolling, or has no cards
    if (myData.rerolls <= 0 || myData.turnsBeforeUseReroll > 0 || myData.cards.length == 0){
      return;
    }
    
    const playerCards    = myData.cards;
    playerCards[playerCards.length - 1] = null;
    const drawCard       = getRandomCard(roomName, player, false);

    myData.rerolls--;
    playerCards[playerCards.length - 1] = drawCard;
    updateCardTypeCounts(roomName);
    emitPlayerDataChanges(roomName);
    io.to(roomName).emit("reroll", drawCard, player);
  });

  socket.on("ability", (roomName, abilityName, player) => {
    const roomData  = rooms[roomName];
    const myData    = roomData[roomData[player]];

    if (myData.turnsBeforeUseAbility > 0 || player != roomData.currentPlayer){
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
    updateCardTypeCounts(roomName);
    emitPlayerDataChanges(roomName);
  });

  socket.on("download", (roomName, player) =>{
    const roomData = rooms[roomName];
    const myData   = roomData[roomData[player]];
    const cards    = myData.cards;

    let ydkFile = "#main";
    for (const card of cards){
      ydkFile += "\n" + card;
    }
    ydkFile += "\n#extra\n";
    for (let i = 0; i < 15; i++){
      const lastCard = myData.cards[myData.cards.length - 1];
      const drawCard = getRandomCardWeightedByLastCard(roomName, player, lastCard, roomData.randomFactor, true);
      myData.cards.push(drawCard);
      ydkFile += drawCard + "\n";
    }
    ydkFile += "!side";
    let lastCard = myData.cards[roomData.totalCards - 1];
    for (const cardType of cardTypes){
      const dataCardType = cleanCardType(cardType, "");
      myData[dataCardType + "Allowed"] += 15;
    }
    for (let i = 0; i < 15; i++){
      const drawCard = getRandomCardWeightedByLastCard(roomName, player, lastCard, roomData.randomFactor, false);
      myData.cards.push(drawCard);
      ydkFile += "\n" + drawCard;
      lastCard = myData.cards[myData.cards.length - 1];
    }

    io.to(roomName).emit("download", player, ydkFile);
  });

  socket.on("disconnecting", () => {
    for (const roomName in rooms){
      if (rooms[roomName][socket.id] != undefined){
        const isPlayer1 = rooms[roomName][socket.id].role === "player1";
        rooms[roomName].players--;
        delete rooms[roomName][socket.id];
        if (rooms[roomName].players === 0 || isPlayer1){
          console.log(rooms[roomName].logText);
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

server.listen(8080, () => {
  console.log("listening on *:8080");
});
