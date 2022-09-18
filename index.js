const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");
const { isTypedArray } = require("util/types");

app.use(express.static(__dirname));

const rooms               = {};
const cardTypes           = ["Spells", "Traps", "Normal Monsters", "Effect Monsters"];
const cardData            = JSON.parse(fs.readFileSync("./public/cards/cardData.json"));
const cardListNames       = fs.readdirSync("./public/cardLists/").map((x) => {return x.replace(".txt", "");});
const banListNames        = fs.readdirSync("./public/banLists/").map((x) => {return x.replace(".json", "");});
const setListNames        = fs.readdirSync("./public/setLists/").map((x) => {return x.replace(".json", "");});
const mainDeckConnections = JSON.parse(fs.readFileSync("./public/connections/mainDeck-connections.json"));
const totalUsages         = JSON.parse(fs.readFileSync("./public/connections/totalUsages.json"));

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
      },
      canUse: true
    },

    "Another, Please!" : {
      count: () => {return 2},
      id: "another-please",
      description: "You loved the last card you got so much, why not get another one?",
      targetMe: {
        nextCardGained: "same",
        rerolls: -1,
        turnsBeforeUseAbility: 1
      },
      canUse: true
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
      },
      canUse: true
    },

    "Russian Roulette" : {
      count: () => {return 2},
      id: "russian-roulette",
      description: "You're in a bind, you'll gain some rerolls, but at what cost?",
      function: (roomName, player) => {
        const roomData      = rooms[roomName];
        const myData        = roomData[roomData[player]];
        const indexToReroll = Math.round(Math.random() * (myData.cards.length - 1));
        const rerollData = rerollCard(roomName, player, indexToReroll);
        io.to(roomName).emit("reroll", rerollData.drawCard, rerollData.cardToReroll, player);
      },
      targetMe: {
        rerolls: +2,
        turnsBeforeUseAbility: 1
      }, 
      canUse: true
    },
    "Long Term Success" : {
      count: () => {return 2},
      id: "long-term",
      description: "I knew intro to business would pay off! Pay 3 rerolls now, get 6 back in 5 turns",
      function: (roomName, player) => {
        const roomData = rooms[roomName];
        const myData   = roomData[roomData[player]];

        myData.rerolls += 6;

      }, 
      functionDelay: 5,
      turnsUntilFunction: 5,
      currentlyActive: false,
      targetMe : {
        rerolls: -3
      },
      canUse: true
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
  if (extraDeckAllowed) return true;//if this is for the extra deck (line above is true), then this should just return true since user isn't putting in any data for extra deck monsters

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

  //add cards if they're in the card list, and player can still add it
  for (const id of roomData.cardIds){
    if (!checkIfCardValid(roomName, player, id, extraDeckAllowed)) continue;
    if (data[id] !== undefined){
      weights[id] = data[id];
    } else {
      weights[id] = 1;
    }
  }

  //set each weight from 1 (randomFactor = 1) to itself (randomFactor = 0)
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

  for (const [id, value] of Object.entries(weights)){
    countValue += value; 
    lastId = id;
    if (randomValue <= countValue) return id;
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
    const abilities  = playerData.abilities;
    for (const ability in abilities){
      const abilityId = abilities[ability].id;
      const canUse    = player === roomData.currentPlayer && //if not current player, can't use abilities
                        playerData.turnsBeforeUseAbility <= 0 && //still turns to go before able to use ability
                        abilities[ability].count() > 0 && //ability has ran out of uses
                       (playerData.rerolls + abilities[ability].targetMe.rerolls) >= 0 && //after using ability, user will not have negative rerolls
                        !abilities[ability].currentlyActive &&
                        !(roomData.status === "download"); //if it's in the download time, both decks full, no abilities

      abilityStatus[player][abilityId] = canUse;
      abilities[ability].canUse = canUse;
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
    playerList: [creatorId],
    viewers:    0,
    totalCards: 0,
    status:     "waiting",
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
  const roomData     = rooms[roomName];
  const myData       = roomData[roomData[player]];
  const cardsAllowed = roomData.banList[cardId] === undefined ? 3 : roomData.banList[cardId];
  let   cardsUsed    = 0;

  for (let i = 0; i < myData.cards.length; i++){
    if (myData.cards[i] === cardId){
      cardsUsed++;
    }
  }

  if (cardsAllowed - cardsUsed < 0){
    roomData.logText += "\nERROR: " + cardId + " has " + Math.abs(cardsAllowed) + " too many cards";
  }

  return cardsAllowed - cardsUsed;
}

function updateCardTypeCounts(roomName){
  const roomData = rooms[roomName];
  const players  = {
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

function getNextCard(roomName, player){
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

  return drawCard;
}

function updateStatsAfterCardDraw(roomName, player){
  const roomData = rooms[roomName];
  const myData   = roomData[roomData[player]];

  myData.nextCardGained          = null;
  myData.turnsBeforeRerollGained = Math.max(--myData.turnsBeforeRerollGained, 0);
  myData.turnsBeforeUseAbility   = Math.max(--myData.turnsBeforeUseAbility, 0);
  myData.turnsBeforeUseReroll    = Math.max(--myData.turnsBeforeUseReroll, 0);

  for (const abilityName in myData.abilities) {
    const ability = myData.abilities[abilityName];
    if (ability.functionDelay && ability.currentlyActive){
      ability.turnsUntilFunction--;
      if (ability.turnsUntilFunction === 0){
        ability.turnsUntilFunction = ability.functionDelay;
        ability.currentlyActive = false;
        ability.function(roomName, player);
      }
    }
  }
  
  if (myData.turnsBeforeRerollGained <= 0){
    myData.rerolls += myData.rerollsPerGain;
    myData.turnsBeforeRerollGained = myData.totalTurnsBeforeRerollGained;
  }

  roomData.currentPlayer = player === "player1" ? "player2" : "player1";

  roomData.totalCards++;
}

function rerollCard(roomName, player, cardToReroll){
  const roomData    = rooms[roomName];
  const playerData  = roomData[roomData[player]];
  const playerCards = playerData.cards;

  if (cardToReroll === -1){
    cardToReroll = Math.round(Math.random() * (playerCards.length - 1));
  }

  playerCards[cardToReroll] = null;

  const drawCard = getRandomCard(roomName, player, false);

  playerCards[cardToReroll] = drawCard;
  updateCardTypeCounts(roomName);
  emitPlayerDataChanges(roomName);
  io.to(roomName).emit("reroll", drawCard, roomData.banList[drawCard] === undefined ? 3 : roomData.banList[drawCard], cardToReroll, player);
  return {drawCard, cardToReroll};
}

function emitCardTypeData(roomName, player){
  const roomData = rooms[roomName];
  const myData   = roomData[roomData[player]];
  let data = "";
  for (const cardType of cardTypes){
    const propCardType = cleanCardType(cardType, "");
    if (data !== ""){
      data += "<br>";
    }
    data += cardType + ": " + myData[propCardType + "Used"] + "/"+ myData[propCardType + "Allowed"];
  }
  io.to(roomName).emit("card-type-data", player, data);
}

function emitLogEvent(roomName, player, logToMe, logToOpponent){
  const roomData = rooms[roomName];
  const myData   = roomData[roomData[player]];
  
  io.to(roomData[player]).emit("log-update", logToMe);
  if (logToOpponent !== ""){
    io.to(myData.opponentId).emit("log-update", logToOpponent);
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
    const joinerRole   = roomData.playerList.length === 1 ? "player2" : "viewer";

    if (joinerRole !== "viewer"){
      roomData[socket.id] = getDefaultPlayerData(joinerName, joinerRole);
    }
    roomData.player2    = roomData.player2 === undefined ? socket.id : roomData.player2;

    const player1Id   = roomData.player1;
    const player2Id   = roomData.player2;
    const player1Name = roomData[player1Id].name;
    const player2Name = roomData[player2Id].name;

    roomData[player1Id].opponentId  = player2Id;
    roomData[player2Id].opponentId  = player1Id;
    roomData.player1                = player1Id;

    roomData.playerList.push(socket.id);
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
    roomData.status  =  "playing";

    let totalCardsAllowed = 0;
    for (const cardType of cardTypes){
      const componentCardType = cleanCardType(cardType, "-");
      const propCardType      = cleanCardType(cardType, "");
      const dataName          = componentCardType + "-textbox";
      const allowedPropName   = propCardType + "Allowed";
      const usedPropName      = propCardType + "Used";

      roomData[player1Id][allowedPropName] = data[dataName];
      roomData[player2Id][allowedPropName] = data[dataName];
      roomData[player1Id][usedPropName]    = 0;
      roomData[player2Id][usedPropName]    = 0;
      
      totalCardsAllowed += data[dataName];
      roomData.logText += "\n" + allowedPropName + ": " + data[dataName];
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
    emitCardTypeData(roomName, "player1");
    emitCardTypeData(roomName, "player2");
    roomData.currentPlayer = "player1";
  });

  socket.on("draw-card", (roomName, player) => {
    //drawing a card is what switches the currentPlayer
    const roomData = rooms[roomName];
    const myData   = roomData[roomData[player]];
    const drawCard = getNextCard(roomName, player);
    
    myData.cards.push(drawCard);
    updateStatsAfterCardDraw(roomName, player);
    updateCardTypeCounts(roomName);
    emitPlayerDataChanges(roomName);
    emitCardTypeData(roomName, player)
    io.to(roomName).emit("draw-card", player, drawCard, roomData.banList[drawCard] === undefined ? 3 : roomData.banList[drawCard]);
    emitLogEvent(roomName, player, "I drew " + cardData[drawCard].name + "!", "");
    if (roomData.totalCards >= roomData.totalCardsAllowed){
      roomData.status = "download";
      io.to(roomName).emit("end-game");
      return;
    }


  });

  socket.on("reroll", (roomName, player) => {
    const roomData = rooms[roomName];
    const myData   = roomData[roomData[player]];
    //don't reroll is player has no rerolls left, has a waiting period before rerolling, or has no cards
    if (myData.rerolls <= 0 || myData.turnsBeforeUseReroll > 0 || myData.cards.length == 0){
      return;
    }
    myData.rerolls--;
    const lastCard = myData.cards[myData.cards.length - 1];
    const newCard =  rerollCard(roomName, player, myData.cards.length - 1);
    emitLogEvent(roomName, player, "Rerolled " + cardData[lastCard].name + " into " + cardData[newCard.drawCard].name, "");
    emitCardTypeData(roomName, player);
  });

  socket.on("ability", (roomName, abilityName, player) => {
    const roomData  = rooms[roomName];
    const myData    = roomData[roomData[player]];

    if (myData.turnsBeforeUseAbility > 0 || player != roomData.currentPlayer || !myData.abilities[abilityName].canUse){
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
      } else if (typeof value === "string"){
        myData[trait] = value;
      }
    }

    for (const trait in targetOpponent){
      const value = targetOpponent[trait];
      if (typeof value === "number"){
        opponentData[trait] += value;
      } else if (typeof value === "string"){
        opponentData[trait] = value;
      }
    }
    if (ability.function){
      if (ability.functionDelay){
        ability.currentlyActive = true;
      } else {
        ability.function(roomName, player);
      }
    }

    updateCardTypeCounts(roomName);
    emitPlayerDataChanges(roomName);
    emitCardTypeData(roomName, player);
    emitLogEvent(roomName, player, "Used " + abilityName, myData.name + " used ability");
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
      for (let i = 0; i < rooms[roomName].playerList.length; i++){
        const id = rooms[roomName].playerList[i];
        if (id === socket.id){
          rooms[roomName].playerList.splice(i, 1);
          const role      = rooms[roomName][socket.id].role ;
          const isPlayer1 = role  === "player1";
          delete rooms[roomName][socket.id];
          if (rooms[roomName].players === 0 || isPlayer1 || (rooms[roomName].status === "playing" && role !== "viewer")){
            console.log(rooms[roomName].logText);
            io.to(roomName).emit("room-closed");
            delete rooms[roomName];
            emitRooms();
            break;
          } else if (rooms[roomName].status === "waiting"){
            if (role === "player2"){
              delete rooms[roomName].player2;
            }
            io.to(roomName).emit("opponent-left-lobby");
          }
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
