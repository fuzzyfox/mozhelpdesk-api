const Twitter = require('twitter')
const _ = require('lodash')

const io = require('../io')
const Ticket = require('../models/Ticket')
const User = require('../models/User')

const isTweet = _.conforms({
  id_str: _.isString,
  text: _.isString
})

let twitterClient = null
let twitterStream = null
let twitterStreamReconnectTimeout = null

const INIT_BACKOFF_TIME = 1.6
let backoffTime = INIT_BACKOFF_TIME

const startTwitterStream = config => {
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

      const initConnection = () => {
        if (!twitterClient) {
          return (
            io.tweet &&
            io.tweet.emit(
              'error',
              'Cannot init Twitter stream without configured Twitter client'
            )
          )
        }

        twitterClient.stream(
          'statuses/filter',
          { track: config.value.search_term },
          stream => {
            if (!stream) {
              // create exponential backoff
              backoffTime = Math.floor(Math.pow(backoffTime, 2))

              clearTimeout(twitterStreamReconnectTimeout)
              twitterStreamReconnectTimeout = null
              twitterStream = null

              // if no connection after 2 mins abort reconnect
              if (backoffTime > 120) {
                backoffTime = INIT_BACKOFF_TIME
                return (
                  io.tweet &&
                  io.tweet.emit('error', 'Twitter stream reconnect failed')
                )
              }

              twitterStreamReconnectTimeout = setTimeout(
                initConnection,
                backoffTime * 1000 // convert sec to ms
              )
              return (
                io &&
                io.tweet.emit(
                  'error',
                  `Twitter stream disconnected, reconnecting in ${backoffTime} seconds`
                )
              )
            }

            twitterStream = stream
            backoffTime = INIT_BACKOFF_TIME

            stream.on('data', event => {
              if (!isTweet(event)) {
                return io.tweet && io.tweet.emit('raw', event)
              }

              const ticket = new Ticket(event)

              if (event.retweeted_status) {
                ticket.mozhelp_status = 'NO_ACTION_REQUIRED'
              }

              ticket.save((err, ticket) => {
                if (err) {
                  io.tweet && io.tweet.emit('error', err)
                  return console.error(err)
                }

                io.tweet && io.tweet.emit('save', ticket.toObject())
              })
            })

            stream.on('error', err => {
              io.tweet && io.tweet.emit('error', err)
              console.error(err)

              twitterStream = null
              initConnection()
            })
          }
        )
      }

      initConnection()

      resolve()
    })
  })
}

const stopTwitterStream = (emit = true) => {
  return new Promise(resolve => {
    clearTimeout(twitterStreamReconnectTimeout)
    twitterStream && twitterStream.destroy()
    twitterStream = null
    twitterClient = null
    twitterStreamReconnectTimeout = null
    io.tweet && io.tweet.emit('stop', 'Twitter stream stopped')
    resolve()
  })
}

module.exports = {
  startTwitterStream,
  stopTwitterStream,
  get twitterStream() {
    return twitterStream
  },
  get twitterStreamReconnecting() {
    return twitterStreamReconnectTimeout !== null
  }
}
