/**
 * @file This file contains the schema / model setup for "Tweets" which are
 *       treated like tickets by the system. Right now we cache just the bare
 *       minimum data from tweets that we need in order to correctly display
 *       them in the app, as well as to respond/track them.
 *
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const mongoose = require('mongoose')
const mongoosePaginate = require('mongoose-paginate')
const mongooseAutopopulate = require('mongoose-autopopulate')

/**
 * Note Schema
 *
 * @type {mongoose.Schema}
 */
const noteSchema = new mongoose.Schema(
  {
    /**
     * Note contents
     *
     * @type {string}
     */
    note: String,

    /**
     * Note author
     *
     * @type {ObjectId}
     */
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      autopopulate: true
    }
  },
  { timestamps: true }
)

/**
 * Ticket Schema
 *
 * @type {mongoose.Schema}
 */
const ticketSchema = new mongoose.Schema({
  // tweet: {
  //   type: mongoose.Schema.Types.ObjectId,
  //   ref: 'Tweet',
  //   autopopulate: true
  // },
  //
  // slack: {
  //   type: mongoose.Schema.Types.ObjectId,
  //   ref: 'SlackThread',
  //   autopopulate: true
  // },

  /**
   * Twitter's ID for the tweet (id_str)
   * @type {string}
   */
  twid: { type: String, unique: true, required: true },
  /**
   * Ticket contents (or status)
   * @type {string}
   */
  text: String,
  /**
   * Ticket language
   *
   * We cache this so we can add translation in the near future
   *
   * @type {string}
   */
  lang: String,
  /**
   * Ticket in reply to id
   * @type {string}
   */
  in_reply_to_status_id_str: String,
  /**
   * Retweeted tweet id
   * @type {string}
   */
  retweeted_status_id_str: String,
  /**
   * Created timestamp from Twitter
   * @type {date}
   */
  created_at: Date,

  /**
   * Twitter user who created the tweet / ticket
   * @type {object}
   */
  user: {
    /**
     * Twitter's id for the user
     * @type {string}
     */
    id_str: String,
    name: String,
    screen_name: String,
    profile_image_url_https: String
  },

  /**
   * Mozhelp status
   * @type {object}
   */
  mozhelp_status: {
    type: String,
    enum: ['NEW', 'NO_ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETE', 'SENT'],
    default: 'NEW'
  },

  /**
   * Collection of notes left on the tweet by mozhelp volunteers
   * @type {array}
   */
  mozhelp_notes: [noteSchema]
})

/**
 * Dumby ticket factory
 *
 * This factory exists so that we can ensure a somewhat standard response when
 * merging known tweets with responses from the twitter api/stream.
 *
 * @return {object} mozhelp related properties all tweets / tickets should have
 */
const dumbyTicketObj = () => ({
  mozhelp_status: 'NO_ACTION_REQUIRED',
  mozhelp_notes: []
})

ticketSchema.plugin(mongooseAutopopulate)
ticketSchema.plugin(mongoosePaginate)

ticketSchema.methods.findReplies = function(callback = function() {}) {
  return new Promise((resolve, reject) => {
    this.model('Ticket').find({}, (err, tickets) => {
      if (err) {
        return reject(err)
      }

      console.log(tickets)

      tickets = tickets.reduce(
        (replies, ticket) => {
          console.log(replies.twid)

          if (!ticket.in_reply_to_status_id_str) {
            return replies
          }

          const inReplyTo = replies.find(reply => {
            return reply.twid === ticket.in_reply_to_status_id_str
          })

          if (!inReplyTo) {
            return replies
          }

          replies.push(ticket)
          return replies
        },
        [this.toObject()]
      )

      tickets.shift()

      callback(null, tickets)
      resolve(tickets)
    })
  })
}

/**
 * Merge tweet(s) from twitter api/stream with known/tracked tickets in the db
 *
 * @param  {(object|Array.<object>)}                      tweets              Tweets(s) to merge
 * @param  {function}                                     [callback=function(] Callback method given merged tweet(s)
 * @return {(Promise.<object>|Promise.<Array.<object>>)}                       Promise of merged tweet(s)
 */
ticketSchema.statics.mergeTweetsWithTickets = function(
  tweets,
  callback = function() {}
) {
  return new Promise((resolve, reject) => {
    const tweetIds = new Set()
    const isSingleTweet = !Array.isArray(tweets)
    tweets = isSingleTweet ? [tweets] : tweets
    tweets = tweets.map(tweet => (tweet.toObject ? tweet.toObject() : tweet))

    tweets.forEach(function traverse(tweet) {
      tweetIds.add(tweet.id_str)

      if (tweet.retweeted_status) {
        tweetIds.add(tweet.retweeted_status.id_str)
        traverse(tweet.retweeted_status)
      }

      if (tweet.quoted_status) {
        tweetIds.add(tweet.quoted_status.id_str)
        traverse(tweet.quoted_status)
      }
    })

    this.find({ twid: { $in: [...tweetIds] } }, (err, tickets) => {
      tickets = tickets || []
      tickets = tickets.map(
        ticket => (ticket.toObject ? ticket.toObject() : ticket)
      )

      tweets = tweets.map(function traverse(tweet) {
        tweet = Object.assign(
          tickets.find(ticket => ticket.twid === tweet.id_str) ||
            dumbyTicketObj(),
          tweet
        )

        if (tweet.retweeted_status) {
          tweet.retweeted_status = traverse(tweet.retweeted_status)
        }

        if (tweet.quoted_status) {
          tweet.quoted_status = traverse(tweet.quoted_status)
        }

        return tweet
      })

      if (isSingleTweet) {
        tweets = tweets[0]
      }

      callback(err, tweets)

      err ? reject(err) : resolve(tweets)
    })
  })
}

/**
 * Hydrate tweet(s) with full objects from the twitter api
 *
 * NOTE: This method makes a minimum if TWO twitter api calls in order to fully
 *       hydrate tweets completely due to the nested nature of tweets
 *       (retweeted_status, quoted_status)
 *
 * @param  {(object|Array.<object>)}                      docs                 Ticket basics (cached data)
 * @param  {Twitter}                                      twitterClient        Twitter client instance to use when hydrating
 * @param  {function}                                     [callback=function(] Callback method given hydrated tweet(s)
 * @return {(Promise.<object>|Promise.<Array.<object>>)}                       Promise of hydrated tweet(s)
 */
ticketSchema.statics.hydrateTweetTickets = function(
  tickets,
  twitterClient,
  callback = function() {}
) {
  return new Promise((resolve, reject) => {
    const isSingleTicket = !Array.isArray(tickets)
    tickets = isSingleTicket ? [tickets] : tickets
    tickets = tickets.map(ticket => ticket.toObject())

    twitterClient.get(
      '/statuses/lookup',
      {
        id: tickets.map(ticket => ticket.twid).join(',')
      },
      (err, hydratedTickets) => {
        if (err) {
          callback(err, tickets)
          return reject(err)
        }

        tickets = tickets.map(ticket =>
          Object.assign(
            ticket,
            hydratedTickets.find(hydrated => hydrated.id_str === ticket.twid) ||
              {}
          )
        )

        const tweetIds = new Set()
        tickets.forEach(function traverse(tweet) {
          tweetIds.add(tweet.id_str)

          if (tweet.retweeted_status) {
            tweetIds.add(tweet.retweeted_status.id_str)
            traverse(tweet.retweeted_status)
          }

          if (tweet.quoted_status) {
            tweetIds.add(tweet.quoted_status.id_str)
            traverse(tweet.quoted_status)
          }
        })

        twitterClient.get(
          '/statuses/lookup',
          {
            id: [...tweetIds].slice(0, 100).join(',')
          },
          (err, hydratedTickets) => {
            if (err) {
              callback(err, tickets)
              return reject(err)
            }

            tickets = tickets.map(function traverse(tweet) {
              const hydratedTicket = hydratedTickets.find(
                hydrated => hydrated.id_str === tweet.id_str
              )

              if (!hydratedTicket) {
                return tweet
              }

              const origTicket = tweet
              tweet = Object.assign({}, origTicket, hydratedTicket)

              if (tweet.retweeted_status) {
                tweet.retweeted_status = traverse(origTicket.retweeted_status)
              }

              if (tweet.quoted_status) {
                tweet.quoted_status = traverse(origTicket.quoted_status)
              }

              return tweet
            })

            this.mergeTweetsWithTickets(tickets)
              .then(
                tweets =>
                  isSingleTicket ? resolve(tweets[0]) : resolve(tweets)
              )
              .catch(err => {
                callback(err, tickets)
                reject(err)
              })
          }
        )
      }
    )
  })
}

/**
 * Note model
 * @type {mongoose.Model}
 */
ticketSchema.statics.Note = mongoose.model('Note', noteSchema)

/**
 * Ticket model
 * @type {mongoose.Model}
 */
const Ticket = mongoose.model('Ticket', ticketSchema)

module.exports = Ticket
