const socket           = io(); //comment out for server
//const socket = io("https://noahzydel.com", {path: "/decksocket/"});
const roomNameLength   = 4; //how long the room id should be
let numRerolls         = 5; //number of rerolls to start with. Just used for initial display purposes, server handles actual tracking //TODO: remove the need for this initial value (provide via the server)
const listNames        = ["card", "ban", "set"]; //names used to get all dropdown information
const cardTypes        = ["Spells", "Traps", "Normal Monsters", "Effect Monsters"];
const dropDowns        = {}; //holder for the three drop down elements, since they're so similar in name
const cardTypeElements = {}; //holder for the different text boxes for inputting how many of each card type you want
let   myRole           = ""; //role that the client has (player1, player2, or viewer)
let   myRoomName       = ""; //unique room id that is (roomNameLength) chars long, based on the socket id of the host
let   myUsername       = ""; //client-picked name that is displayed to the lobby

const largeImageApiPath = "https://images.ygoprodeck.com/images/cards/";
const smallImageApiPath = "https://images.ygoprodeck.com/images/cards_small/";
const cardWidth         = "10%"; //card width within the deck container (10% means 10 cards in every row, 20% means 5, etc)

const startButton        = document.getElementById("start-game-button");
const readyButton        = document.getElementById("ready-button");
const bottomNavBar       = document.getElementById("playing-bottom-bar");
const downloadButton     = document.getElementById("download-button");
const joinRoomForm       = document.getElementById("room-form");
const drawButton         = document.getElementById("draw-button");
const rerollButton       = document.getElementById("reroll-button");
const deckContainer      = document.getElementById("playing-deck-container");

socket.emit("getLists");
firstTimeSetup();

/**
 * Make the game lobby for other player(s) to join
*/
function makeRoom(){
  const roomHolder  = document.getElementById("rooms");
  const elementList = roomHolder.getElementsByTagName("li");
  const roomList    = [];

  for (let i = 0; i < elementList.length; i++){
    roomList.push(elementList[i].innerHTML);
  }

  //create the unique room id
  let idSlice = "";
  for (let i = 0; i < socket.id.length - roomNameLength; i += roomNameLength){

    idSlice = socket.id.slice(i, i + roomNameLength);

    if (!roomList.includes(idSlice)){
      break;
    }
  }

  myUsername = prompt("Please enter your name");

  if (myUsername === null){
    return;
  }

  myUsername   = myUsername ? myUsername : "Lame-o";
  
  document.getElementById("lobby-room-name").innerHTML  = idSlice;
  socket.emit("make-room", idSlice, myUsername);
  return;
}

/**
 * Clean up a given card type, by converting it to lowercase and replacing spaces with given 'replace'
 * @param  {String} cardType The card type ("Normal Monster", "Continuous Trap", etc.)
 * @param  {String} replace  What to replace spaces with (usually "-" or "")
 * @return {String}          The edited card type text
*/
function cleanCardType(cardType, replace){
  return cardType.toLowerCase().replace(" ", replace);
}

/**
 * Do all one-time things needed when client first connects: set dropdowns and add event listeners
*/
function firstTimeSetup(){
  //set random factor
  const randomFactor = document.getElementById("random-factor");
  for (let i = 0; i <= 100; i += 25){
    const randomValue           = document.createElement("option");
          randomValue.innerHTML = i + "%";
          randomValue.value     = i / 100.0;

    randomFactor.appendChild(randomValue);
  }
  //add onkeyup/onpaste to counts
  for (const cardType of cardTypes){
    const componentCardType  = cleanCardType(cardType, "-");
    const cardTypeElement         = document.getElementById(componentCardType + "-count");
          cardTypeElement.value   = 10;
          cardTypeElement.onkeyup = getExpectedDeckSize;
          cardTypeElement.onpaste = getExpectedDeckSize;
    
    cardTypeElements[componentCardType] = cardTypeElement;
  }

  for (const listName of listNames){
    const dropDown = document.getElementById(listName + "-list-dropdown");
    dropDowns[listName] = dropDown;
  }

  drawButton.addEventListener("click", () => {
    socket.emit("draw-card", myRoomName, myRole);
    drawButton.style.visibility   = "hidden";
    rerollButton.style.visibility = "hidden";
  });

  rerollButton.addEventListener("click", () => {
    socket.emit("reroll", myRoomName, myRole);
  });

  startButton.addEventListener("click", () => {
    const data = {};

    for (const listName of listNames){
      data[listName + "-dropdown"] = dropDowns[listName].value;
    }

    for (const cardType of cardTypes){
      const componentCardType = cleanCardType(cardType, "-");
      let value = cardTypeElements[componentCardType].value;
      value = value === "" ? 0 : value;
      data[componentCardType + "-textbox"] = Math.floor(value);
    }

    data.randomFactor = document.getElementById("random-factor").value;
    socket.emit("start-game", myRoomName, data);
    drawButton.style.visibility   = "visible";
    rerollButton.style.visibility = "visible";
  });

  downloadButton.addEventListener("click", () => {
    socket.emit("download", myRoomName, myRole);
  });

  joinRoomForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const roomInput = document.getElementById("join-room-input");
    if (!roomInput.value) {
      return;
    }

    const roomList = document.getElementById("rooms").getElementsByTagName("li");
    for (let i = 0; i < roomList.length; i++){
      const room = roomList[i].innerHTML;
      if (roomInput.value === room){
        joinRoom(room);
        return;
      }
    }
    alert("No room found with name " + roomInput.value);
  });
}


/**
 * Set ready button and start button (if applicable) for the player based on their role
*/
function makeMyComponents(){

  if (myRole === "viewer"){
    return;
  }

  readyButton.innerHTML             = "NOT READY";
  readyButton.style.backgroundColor = "darkred";

  if (myRole === "player1"){
    startButton.style.visibility = "hidden";
    startButton.style.display    = "block";
    document.getElementById("variable-game-settings-container").style.display = "grid";
  } else if (myRole == "player2" ){
    document.getElementById("game-settings-container").style.display = "grid";
  } else {
    console.log("Attempted to make components, but myRole is not correct");
  }
}

/**
 * Generate the tool tip text for an ability
 * @param  {Object} abilityData Contains all of the information about the ability, used to make the text
 * @return {String}             The tool tip text
*/
function makeToolTipText(abilityData){
  let   toolText       = abilityData.description + "<br />Me<br />";
  const targetMe       = abilityData.targetMe;
  const targetOpponent = abilityData.targetOpponent;

  for (const trait in targetMe){
    const value     = targetMe[trait];
          toolText += "•" +  trait + ": " + value + "<br />";
  }

  if (targetOpponent === undefined){
    return toolText;
  }

  toolText += "<br />Opponent";
  
  for (const trait in targetOpponent){
    const value     = targetOpponent[trait];
          toolText += "<br />•" +  trait + ": " + value;
  }

  return toolText;
}

/**
 * Create the div that acts as a button to activate an ability
 * @param {String} abilityName   Name of the ability
 * @param {Object} abilityData   All the data about the ability
 * @param {Number} abilityNumber Number of the ability, used to determine its position in the bottom nav bar
*/
function makeAbilityComponent(abilityName, abilityData, abilityNumber){
  const newAbility                       = document.createElement("div");
        newAbility.className             = "ability abilityClass";
        newAbility.id                    = abilityData.id + "-ability"
        newAbility.style.backgroundColor = "#a086b7";
        newAbility.innerHTML             = abilityName;
        newAbility.style.gridArea        = "ability" + abilityNumber;
        newAbility.addEventListener("click", () => {
          socket.emit("ability", myRoomName, abilityName, myRole);
        });

  const newAbilityToolTip           = document.createElement("span");
        newAbilityToolTip.id        = abilityData.id + "-ability-tooltip"
        newAbilityToolTip.className = "ability-tooltip abilityClass";
        newAbilityToolTip.innerHTML = makeToolTipText(abilityData);

  newAbility.appendChild(newAbilityToolTip);              
  bottomNavBar.appendChild(newAbility);
  
  
}

/**
 * Make all of the ability components
 * @param {Object} abilitiesData All the data about the abilities
*/
function makeAbilities(abilitiesData){
  //remove all previous abilities if they are present
  const pastAbilities = document.getElementsByClassName("abilityClass");
  
  while (pastAbilities.length > 0){
    pastAbilities[0].parentNode.removeChild(pastAbilities[0]);
  }

  let   abilityNumber = 1;

  for (const abilityName in abilitiesData){
    makeAbilityComponent(abilityName, abilitiesData[abilityName], abilityNumber);
    abilityNumber++;
  }
}

/**
 * Check if both players have readied up
 * @return {Boolean} Are both players ready
*/
function checkIfBothReady() {
  const player1 = document.getElementById("player1-status").innerHTML;
  const player2 = document.getElementById("player2-status").innerHTML;
  return player1 === "READY" && player2 === "READY";
}

/**
 * Change own ready button to its opposite, and emit that change so opponent/viewer can see it
 * @param {String} player The player that clicked their ready button ["player1", "player2"]
*/
function readyButtonClicked() {
  const ready = readyButton.innerHTML === "READY";

  readyButton.innerHTML             = ready ? "NOT READY" : "READY";
  readyButton.style.backgroundColor = ready ? "darkred"   : "darkgreen";

  socket.emit("ready-change", myRoomName, myRole, readyButton.innerHTML);
}

/**
 * Add newly drawn card to the current player's deck
 * @param {Object} playerSide     The document element containing the current player's deck
 * @param {String} largeCardImage The path to the image of the drawn card
 * @param {String} cardId         The id of the drawn card
 * @param {Number} limit          How many of this card are allowed in a deck (based on banlist, not current count)
*/
function setDrawnCard(playerSide, largeCardImage, cardId, limit) {
  const newCard             = document.createElement("img");
        newCard.src         = largeCardImage;
        newCard.alt         = cardId;
        newCard.className   = "small-card";
        newCard.style.width = cardWidth;
  //when moused over, show the image in the middle card
  //when not moused over, default to card back
  setCardMouseEvents(newCard, limit);
  playerSide.appendChild(newCard);
}

/**
 * Set the onmouseover and onmouseleave functions of a card being put into players deck
 * @param {Object} card  The card element to add the functions to
 * @param {Number} limit How many of the card is allowed per ban list
*/
function setCardMouseEvents(card, limit){
  card.onmouseover = () => {
    const largeCards = document.getElementsByClassName("large-card");
    for (const largeCard of largeCards){
      largeCard.src = card.src;
    }
    const cardLimitText = document.getElementById("ban-list-info");
    cardLimitText.innerHTML = "Number of Cards Allowed: " + limit;
  };
  card.onmouseleave = () => {
    const largeCards = document.getElementsByClassName("large-card");
    for (const largeCard of largeCards){
      largeCard.src = "public/images/back.png";
    }
    const cardLimitText = document.getElementById("ban-list-info");
    cardLimitText.innerHTML = "";
  };
}

/**
 * Check if given value is a valid number
 * @param {String} value The value to check
*/
function checkIfNumber(value){
  return (!isNaN(value) && !isNaN(parseFloat(value)));
}

/**
 * Get the size of the decks, based on what player1 entered into textboxes. Also verifies they are valid numbers
 * @return {Number} The sum of all of the numbers in card type textboxes, -1 if at least one isn't a valid number
*/ 
function getExpectedDeckSize(){
  let totalCount = 0;
  let isValid    = true;
  for (const cardType of cardTypes){
    const componentCardType = cleanCardType(cardType, "-");
    const textBox = document.getElementById(componentCardType + "-count");
    const value   = textBox.value;

    totalCount += Math.floor(value);

    if (isNaN(value)){
      textBox.style.backgroundColor = "red";
      isValid = false;
    } else {
      textBox.style.backgroundColor = "white";
    }
  }
  return isValid ? totalCount : -1;
}

/**
 * Set the text of the reroll button so that it contains how many rerolls player has left
 * @param {Number} playerRerolls How many rerolls the player has
*/
function setRerollText(playerRerolls){
  rerollButton.innerHTML = "Re-Roll (" + playerRerolls + ")";
}

/**
 * Set ability divs to fully opaque or mostly transparent, based on whether it can be used or not
 * @param {Object} abilityStatus Keys {String} Ids of all abilities | Values {Boolean} Whether ability can be used
*/
function setAbilityStatus(abilityStatus){
  if (myRole === "viewer"){
    return;
  }
  const abilities = abilityStatus[myRole];
  
  for (const abilityId in abilities){
    const canUse     = abilities[abilityId];
    const abilityDiv = document.getElementById(abilityId + "-ability");

    abilityDiv.style.opacity = canUse ? 1.0 : 0.2;
  }
}

/**
 * Emit the current game settings, so that player2 can see what player1 set them to
 *  Attached to onchange of dropdowns and textboxes
*/ 
function emitGameSettings(){
  const settingsArray = [];
  const allSettings   = document.getElementsByClassName("settings");
  for (const setting of allSettings){
    if (setting.value){
      settingsArray.push(setting.value);
    } else {
      settingsArray.push(setting.innerHTML);
    }
  }
  socket.emit("update-game-settings", myRoomName, settingsArray);
}

/**
 * Download the ydk file associated with the player's cards
 * @param {String} filename The name the downloaded file will have
 * @param {String} text     The text of the ydk file, list of card ids
*/
function download(filename, text) {
  const element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';

  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

/**
 * Connect to an already made room
 * @param {String} roomName Id of the room to connect to
*/ 
function joinRoom(roomName){
  let username = prompt("Please enter your name");
      username = username ? username : "Lame-o";
  if (username === null){
      return;
  }
  socket.emit("join-room", roomName, username);
}

/**
 * Set the list of open rooms on room screen
 * @param {Object} roomList Array containing all of the rooms currently stored by the server
*/
socket.on("rooms", (roomList) => {
  const roomsParent = document.getElementById("rooms");
  while (roomsParent.firstChild){
    roomsParent.removeChild(roomsParent.firstChild);
  }
  for (const roomName of roomList){
    const room           = document.createElement("li");
          room.innerHTML = roomName;
          room.onclick   = () => {
            joinRoom(roomName);
          };

    roomsParent.appendChild(room);
  }
});

/**
 * Join an open room, and switch over to lobby screen
 * @param {String} playerRole  Which role the emitting player has: player1, player2, viewer
 * @param {String} room        Id of the room being joined
 * @param {String} player1Name The username selected by player1, always set
 * @param {String} player2Name The username selected by player2, will default to "" if player1 emitted
*/ 
socket.on("join-room", (playerRole, room, player1Name, player2Name) => {
  document.getElementById("player1-username").innerHTML = player1Name + ":";

  if (player2Name != ""){
    document.getElementById("player2-username").innerHTML = player2Name + ":";
    document.getElementById("player2-status").innerHTML   = "NOT READY";
  }

  if (myRole != ""){ //already joined
    socket.emit("ready-change", myRoomName, myRole, readyButton.innerHTML);
    emitGameSettings();
    return; 
  }

  myRole     = playerRole;
  myRoomName = room;

  if (myRole === "viewer"){
    document.getElementById("viewer-player1-username").innerHTML = player1Name;
    document.getElementById("viewer-player2-username").innerHTML = player2Name;
  } else {
    document.getElementById(myRole + "-username").style.backgroundColor = "#bc5a84";
    document.getElementById("game-settings-container").style.display    = "grid";
  }

  document.getElementById("room-screen").style.display    = "none";
  document.getElementById("lobby-screen").style.display = "grid";

  makeMyComponents(playerRole); 
});

/**
 * Gets the list of all players, player1, player2, and viewers
  * Emitted whenever a viewer enters/leaves
 * @param {Object} playerList Contains player information. Properties are player1, player2, and viewers
 *                            {String} player1 Name of player1
 *                            {String} player2 Name of player2
 *                            {Object} viewers Array of names of the viewers
*/ 
socket.on("player-list", (playerList)=> {
  const viewerList = document.getElementById("viewer-list");
  while (viewerList.lastChild){
    viewerList.removeChild(viewerList.lastChild);
  }
  viewerList.innerHTML = "Viewers:";
  for (const viewer of playerList.viewers){
    const viewerElement           = document.createElement("li");
          viewerElement.innerHTML = viewer;

    viewerList.appendChild(viewerElement);
  }
});


/**
 * Sets player2 values back to their default
 *  Emitted when the opponent left the lobby screen of a game you started
*/ 
socket.on("opponent-left-lobby", () => {
  document.getElementById("player2-username").innerHTML = "";
  document.getElementById("player2-status").innerHTML = "NOT CONNECTED";
});

/**
 * Goes back to room screen, removes player2 username, sets all of the player's settings to default, and removes any previous cards
 *  Emitted when player1 leaves a game at any stage, or either player leaves during playing phase
*/ 
socket.on("room-closed", () => {       
  document.getElementById("room-screen").style.display    = "block";
  document.getElementById("lobby-screen").style.display = "none";
  document.getElementById("playing-screen").style.display = "none";
  document.getElementById("viewing-screen").style.display = "none";
  document.getElementById("player1-connection").innerHTML = "NOT READY";
  document.getElementById("player2-username").innerHTML   = "";
  document.getElementById("player2-connection").innerHTML = "NOT READY";

  myRole     = "";
  myRoomName = "";
  myUsername = "";
  numRerolls = 5;
  
  //remove all previous cards
  const deckContainer = document.getElementById("playing-deck-container");
  while (deckContainer.lastChild) {
    deckContainer.removeChild(deckContainer.lastChild);
  }

  alert("ROOM CLOSED");
});

/**
 * Sets that player's ready status, and checks if both players are ready and settings are valid (to show start button to player1)
 *  Emitted when either player clicks readyButton
 * @param {String} player    Whoever clicked their readyButton: player1, player2
 * @param {String} readyText Whether that player is now ready or not: READY, NOT READY
*/ 
socket.on("ready-change", (player, readyText) => {
  const readyTextComponent           = document.getElementById(player + "-status");
        readyTextComponent.innerHTML = readyText;
  //if client is player1, additional check has to be done to see if both players are ready and start button should be shown
  if (myRole === "player2" || myRole === "viewer") {
    return;
  }

  const bothReady = checkIfBothReady();
  const deckSize  = getExpectedDeckSize();

  if (bothReady && deckSize >= 40 && deckSize <= 60) {
    startButton.style.visibility = "visible";
    startButton.style.display = "block";
  } else {
    startButton.style.visibility = "hidden";
  }
});

/**
 * Update the game settings to what player1 set them to, should only be going to player2
 *  Emitted when player1 changes dropdown or textbox
 * @param {Object} settings Array of all of the settings from player1, includes the labels
*/
socket.on("update-game-settings", (settings) => {
  const settingsContainer = document.getElementById("game-settings-container");
  while (settingsContainer.lastChild){
    settingsContainer.removeChild(settingsContainer.lastChild);
  }
  for (const setting of settings){
    const settingElement           = document.createElement("p");
          settingElement.innerHTML = setting;

    settingsContainer.appendChild(settingElement);
  }
});

/**
 * Sets all of the dropdowns with values based on what files are stored on server for card/ban/set lists
 *  Emitted when player first connects to website
 * @param {Object} cardLists Array containing the names of the allowed card lists
 * @param {Object} banLists  Array containing the names of the allowed ban lists
 * @param {Object} setLists  Array containing the names of the allowed set lists
*/ 
socket.on("set-lists", (cardLists, banLists, setLists) => {
  let lists = {
    card: cardLists,
    ban: banLists,
    set: setLists,
  };

  for (let i = 0; i < listNames.length; i++) {
    const listName = listNames[i]; //card, ban, set
    const list     = lists[listName];
    for (let j = 0; j < lists[listName].length; j++) {
      const dropDown           = document.getElementById(listName + "-list-dropdown");
      const newEntry           = document.createElement("option");
            newEntry.value     = list[j];
            newEntry.innerHTML = list[j];
      
      dropDown.appendChild(newEntry);
    } 
  }
});

/**
 * Start the game, creating ability divs and switching to playing screen, or switching to viewing screen
 *  Emitted when player1 clicks start game button
 * @param {Object} abilitiesData All of the data surrounding abilities in the game, their id, description, functions, etc.
*/ 
socket.on("start-game", (abilitiesData) => {

  document.getElementById("lobby-screen").style.display = "none";

  if (myRole === "viewer"){
    document.getElementById("viewing-screen").style.display = "inline-block";
  } else {
    makeAbilities(abilitiesData);
    document.getElementById("playing-screen").style.display = "grid";
  }
});

/**
 * Draw a new card, display its image in the deck container of the player/viewer, hide reroll/draw button
 *  Emitted when drawButton is clicked
 * @param {String} player   Player that drew the card: player1, player2
 * @param {String} drawCard Id of the card that was drawn
 * @param {Number} limit    How many of that card are allowed based on chosen ban list
*/ 
socket.on("draw-card", (player, drawCard, limit) => {
  const showCard = (myRole === "viewer" || myRole === player);
  
  if (!showCard){
    drawButton.style.visibility   = "visible";
    rerollButton.style.visibility = "visible";
  } else {
    const newLargeCardPath = showCard ? (largeImageApiPath + drawCard + ".jpg") : "/public/images/back.png";
    const containerForCard = myRole === "viewer" ? document.getElementById("viewer-" + player + "-deck-container") : deckContainer;
    
    setDrawnCard(containerForCard, newLargeCardPath, drawCard, limit);
  }        
});

/**
 * Reroll a card in the player's deck, changing its image and limit
 *  Emitted when rerollButton is clicked
 * @param {String} newCardId       Id of the card after rerolling
 * @param {Number} limit           How many of that card are allowed based on chosen ban list
 * @param {Number} newCardPosition Index of the card that was rerolled
 * @param {String} player          Player that did the rerolling: player1, player2
*/ 
socket.on("reroll", (newCardId, limit, newCardPosition, player) => {
  const showCard = (myRole === "viewer" || myRole === player);

  if (!showCard){
    return;
  }

  const containerForCard = myRole === "viewer" ? document.getElementById("viewer-" + player + "-deck-container") : deckContainer;

  const rerolledCard     = containerForCard.children[newCardPosition];
        rerolledCard.src = largeImageApiPath + newCardId + ".jpg";
        rerolledCard.alt = newCardId;
  setCardMouseEvents(rerolledCard, limit);
});

/**
 * Update data values (rerolls, ability statuses) whenever they change
 *  Emitted when a player uses an ability, rerolls, or draws a card. Emitted to both players every time
 * @param {Number} player1Rerolls How many rerolls player1 now has
 * @param {Number} player2Rerolls How many rerolls player2 now has
 * @param {Object} abilityStatus  Keys {String} Ids of all abilities | Values {Boolean} Whether ability can be used
*/
socket.on("data-change", (player1Rerolls, player2Rerolls, abilityStatus) => {
  setRerollText(myRole === "player1" ? player1Rerolls : player2Rerolls);
  setAbilityStatus(abilityStatus);
});

/**
 * Update the player log with actions taken
 *  Emitted when player uses ability, rerolls, or draws, or when opponent uses ability
 * @param {String} logInformation Line that is to be added to the log
*/
socket.on("log-update", (logInformation) => {
  const newLogEntry           = document.createElement("li");
        newLogEntry.innerHTML = logInformation;
        newLogEntry.className = "playing-log-entry";
  document.getElementById("playing-log").appendChild(newLogEntry);
});

/**
 * Sets the card type data for the player
 *  Emitted whenever the deck changes (some abilities, reroll, draw)
 * @param {String} player Whose data it is
 * @param {String} data   Information on card types in deck
*/
socket.on("card-type-data", (player, data) => {
  if (myRole === player){
    document.getElementById("deck-data").innerHTML = data;
  }
});

/**
 * Hide the player's draw/ability buttons, and show the download button
 *  Emitted when the total number of cards in both players' decks reaches the set limit
*/
socket.on("end-game", () => {
  if (myRole === "viewer"){
    return;
  }
  
  downloadButton.style.visibility = "visible";
  rerollButton.style.visibility   = "visible";
  drawButton.style.visibility     = "hidden";
});

/**
 * Download the ydk file associated with the player's cards
 *  Emitted when downloadButton is clicked
 * @param {String} player  Who clicked the download button
 * @param {String} ydkFile Data the ydk file will contain
*/
socket.on("download", (player, ydkFile) => {
  if (myRole === "viewer"){
    return;
  }
  if (myRole === player){
    console.log("trying to download");
    download("NoahDeck.ydk", ydkFile);
  }
});