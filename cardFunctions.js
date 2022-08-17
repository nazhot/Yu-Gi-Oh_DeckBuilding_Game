module.exports = {
  getRandomCard: function (ids) {
    return ids[Math.floor(Math.random() * ids.length)];
  },

  reRoll: function(img, ids) {
    let newCard = this.getRandomCard(ids);
    img.src = newCard;
  }
};
