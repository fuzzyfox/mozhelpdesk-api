/**
 * @file Links Twitter stream, SocketIO and automatic tweet tracking together.
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const socketio = require('socket.io')

module.exports = {
  io: null,
  tweet: null,
  slack: null,
  init(http) {
    this.io = socketio(http, {
      path: '/socket.io'
    })
    this.tweet = this.io.of('/tweet')
    this.slack = this.io.of('/slack')
  }
}
