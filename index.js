const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");

app.use(express.static(__dirname));

let players = [];

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

io.on("connection", (socket) => {
  players.push(socket.id);
  if (players.length === 1) {
    console.log("emitting player 1");
    io.emit("player1", socket.id);
  } else if (players.length === 2) {
    console.log("emitting player 2");
    io.emit("player2", socket.id);
  } else {
    console.log("emitting viewer");
    io.emit("viewer", socket.id);
  }

  socket.on("ready-change", (player, readyText) => {
    console.log("emitting ready-change");
    io.emit("ready-change", player, readyText);
  });

  socket.on("start-game", () => {
    console.log("starting game!");
    io.emit("start-game");
  });

  socket.on("draw-card", (isPlayer1) => {
    console.log((isPlayer1 ? "Player 1 " : "Player 2 ") + " drew a card!");
    let idFile = fs.readFileSync("./public/cards/ids.txt", "utf-8");
    let ids = idFile.split("\n");
    let drawCard = ids[Math.floor(Math.random() * ids.length)];
    console.log(drawCard);
    // let files = fs.readdirSync("./public/cardImages/");
    // let drawCard = files[Math.floor(Math.random() * files.length)];
    io.emit("draw-card", isPlayer1, drawCard);
  });

  socket.on("disconnect", () => {
    players = players.filter((player) => player.id !== socket.id);
    io.emit("disconnected", socket.id, players);
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
