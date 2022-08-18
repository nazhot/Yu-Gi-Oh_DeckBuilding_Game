# YuGiOh-DeckBuilding-Game
A new take on Yu-Gi-Oh deck building, adding the element of randomness, some skill, tough choices, and an opponent to deal with.

## Overview
A tool for adding another layer on top of the Yu-Gi-Oh card game! 2 players can go back and forth, getting random cards to compile their decks, with some interaction between opponents. This tool is meant to keep Yu-Gi-Oh fun by: taking a step back from the competitive side, generating decks more akin to playground-style duels, and turning deck building into an interactive game.
## Current Version

v0.0.1
- Ugly as can be
- Two users can connect to the server, and ready/unready up
- Player 1 can set Card / Ban list, from the pre-determined list hosted on server
- When both are ready, player 1 can start game
- During game, players can go back and forth drawing 1 random card at a time
  - Card is completely random at the moment
  - Other player only sees that you drew a card, not what card it was
 - Viewers are allowed
  - See both players full decks, prone to cheating if you are a dishonest cotton headed mini muffin
  
## Previous Versions
N/A

## Hopeful Features
- Less ugly
- When connecting, user can input a username to go by
  - Have this information stored for repeated connecting
- Global settings for player 1 to set
  - Set List (cards that are auto-given to both players before game starts)
- Ability for players to upload their own card/ban/set list for use
- Settings for both players on start screen
  - How many of each spell/trap/monster cards they want
  - Monster type/attribute limitations
- Abilities
  - Re-roll last card you/opponent given
  - View last card opponent given
  - Set own/opponent last card given to 1/2/3
  - Opponent gets same card next turn (yours or theirs)
  - Swap random cards
  - Swap chosen cards
  - Draw multiple cards next turn, opponent can't use powerups
- 
  

## Built With
- node.js
- express.js
- socket.io

## Build Instructions
After forking and cloning, navigate to the repository in your command line and install the NPM packages:
```
npm install
```
Run the following script in your command line:
```
node index.js
```
Once the server is running, go to http://localhost:3000 in your browser.
