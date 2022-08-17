const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const fs = require("fs");
const cardFunctions = require("./cardFunctions");

app.use(express.static(__dirname));

let players = [];
let idFile = fs.readFileSync("./public/cards/ids.txt", "utf-8");
let ids = idFile.split("\n");

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

  socket.on("ready-change", (player, readyText) => {
    io.emit("ready-change", player, readyText);
  });

  socket.on("start-game", () => {
    io.emit("start-game");
  });

  socket.on("draw-card", (isPlayer1) => {
    let drawCard = cardFunctions.getRandomCard(ids);
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
