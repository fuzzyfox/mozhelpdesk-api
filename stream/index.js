const socketio = require('socket.io')
const Twitter = require('twitter')
const User = require('../models/User')
const Tweet = require('../models/Tweet')
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

                const tweet = new Tweet(event)
                tweet.twid = event.id_str
                tweet.save((err, tweet) => {
                  if (err) {
                    console.error(err)
                    return this.tweet.emit('error', err.toString())
                  }

                  Tweet.hydrate(tweet, twitterClient)
                    .catch(console.warn)
                    .then(hydrated =>
                      this.tweet.emit('save', hydrated || tweet)
                    )
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
