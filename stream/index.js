/**
 * @file Links Twitter stream, SocketIO and automatic tweet tracking together.
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const socketio = require('socket.io')
const Twitter = require('twitter')
const User = require('../models/User')
const Ticket = require('../models/Ticket')
const _ = require('lodash')

const isTweet = _.conforms({
  id_str: _.isString,
  text: _.isString
})

let twitterClient = null
let twitterStream = null
let twitterStreamReconnectTimeout = null

module.exports = {
  io: null,
  tweet: null,
  get twitterStream() {
    return twitterStream
  },
  get twitterStreamReconnecting() {
    return twitterStreamReconnectTimeout !== null
  },
  init(http) {
    this.io = socketio(http)
    this.tweet = this.io.of('/tweet')
  },
  startTwitterStream(config) {
    this.stopTwitterStream()

    return new Promise((resolve, reject) => {
      if (!config.value.user_id) {
        return reject(new Error('Stream user not configured'))
      }

      User.findById(config.value.user_id, '+tokens', (err, user) => {
        if (err) {
          return reject(err)
        }

        if (!user) {
          return reject(new Error('Stream user not found'))
        }

        twitterClient = new Twitter({
          consumer_key: process.env.TWITTER_CONSUMER_KEY,
          consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
          access_token_key: user.tokens.twitter.token,
          access_token_secret: user.tokens.twitter.tokenSecret
        })

        const startStream = () => {
          twitterClient.stream(
            'statuses/filter',
            {
              track: config.value.search_term
            },
            stream => {
              twitterStream = stream

              twitterStream.on('data', event => {
                if (!isTweet(event)) {
                  return this.tweet.emit('raw', event)
                }

                const ticket = new Ticket(event)
                ticket.twid = event.id_str
                ticket.save((err, ticket) => {
                  if (err) {
                    console.error(err)
                    return this.ticket.emit('error', err.toString())
                  }

                  this.tweet.emit(
                    'save',
                    Object.assign(event, ticket.toObject())
                  )

                  // NOTE: This is a bad idea as a busy stream means hitting the
                  //       twitter rate limits a butt tone quicker
                  // Tweet.hydrateTweetTickets(ticket, twitterClient)
                  //   .catch(console.warn)
                  //   .then(hydrated =>
                  //     this.tweet.emit('save', hydrated || ticket)
                  //   )
                })
              })

              twitterStream.on('error', err => {
                console.error(err)
                twitterStream = null
                this.tweet.emit('error', err.toString())
                twitterStreamReconnectTimeout = setTimeout(startStream, 5000)
              })
            }
          )
        }

        startStream()

        resolve()
      })
    })
  },
  stopTwitterStream(emit = true) {
    return new Promise(resolve => {
      clearTimeout(twitterStreamReconnectTimeout)
      twitterStream && twitterStream.destroy()
      twitterClient = null
      twitterStream = null
      twitterStreamReconnectTimeout = null
      emit && this.tweet.emit('stopped', true)
      resolve()
    })
  }
}
