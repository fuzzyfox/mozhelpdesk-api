/**
 * @file This file contains the schema / model setup for "Tweets" which are
 *       treated like tickets by the system. It will likely be renamed to
 *       reflect this if/when slack support is added. Right now we cache just
 *       the bare minimum data from tweets that we need in order to correctly
 *       display them in the app, as well as to respond/track them.
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
 * Tweet Schema
 *
 * @type {mongoose.Schema}
 */
const tweetSchema = new mongoose.Schema({
  /**
   * Twitter's ID for the tweet (id_str)
   * @type {string}
   */
  twid: { type: String, unique: true, required: true },
  /**
   * Tweet contents (or status)
   * @type {string}
   */
  text: String,
  /**
   * Tweet language
   *
   * We cache this so we can add translation in the near future
   *
   * @type {string}
   */
  lang: String,
  /**
   * Tweet in reply to id
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
   * Twitter user who created the tweet
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
 * Dumby tweet factory
 *
 * This factory exists so that we can ensure a somewhat standard response when
 * merging known tweets with responses from the twitter api/stream.
 *
 * @return {object} mozhelp related properties all tweets should have
 */
const dumbyTweetObj = () => ({
  mozhelp_status: 'NO_ACTION_REQUIRED',
  mozhelp_notes: []
})

tweetSchema.plugin(mongooseAutopopulate)
tweetSchema.plugin(mongoosePaginate)

/**
 * Merge tweet(s) from twitter api/stream with known/tracked tweets in the db
 *
 * @param  {(object|Array.<object>)}                      tweets               Tweet(s) to merge
 * @param  {function}                                     [callback=function(] Callback method given merged tweet(s)
 * @return {(Promise.<object>|Promise.<Array.<object>>)}                       Promise of merged tweet(s)
 */
tweetSchema.statics.mergeWithKnown = function(
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

    this.find({ twid: { $in: [...tweetIds] } }, (err, knownTweets) => {
      knownTweets = knownTweets || []
      knownTweets = knownTweets.map(
        tweet => (tweet.toObject ? tweet.toObject() : tweet)
      )

      tweets = tweets.map(function traverse(tweet) {
        tweet = Object.assign(
          knownTweets.find(known => known.twid === tweet.id_str) ||
            dumbyTweetObj(),
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
 * @param  {(object|Array.<object>)}                      docs                 Tweet basics (cached data)
 * @param  {Twitter}                                      twitterClient        Twitter client instance to use when hydrating
 * @param  {function}                                     [callback=function(] Callback method given hydrated tweet(s)
 * @return {(Promise.<object>|Promise.<Array.<object>>)}                       Promise of hydrated tweet(s)
 */
tweetSchema.statics.hydrate = function(
  docs,
  twitterClient,
  callback = function() {}
) {
  return new Promise((resolve, reject) => {
    const isSingleDoc = !Array.isArray(docs)
    docs = isSingleDoc ? [docs] : docs
    docs = docs.map(doc => doc.toObject())

    twitterClient.get(
      '/statuses/lookup',
      {
        id: docs.map(doc => doc.twid).join(',')
      },
      (err, hydratedTweets) => {
        if (err) {
          callback(err, docs)
          return reject(err)
        }

        docs = docs.map(doc =>
          Object.assign(
            doc,
            hydratedTweets.find(hydrated => hydrated.id_str === doc.twid) || {}
          )
        )

        const tweetIds = new Set()
        docs.forEach(function traverse(tweet) {
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
          (err, hydratedTweets) => {
            if (err) {
              callback(err, docs)
              return reject(err)
            }

            docs = docs.map(function traverse(tweet) {
              const hydratedTweet = hydratedTweets.find(
                hydrated => hydrated.id_str === tweet.id_str
              )

              if (!hydratedTweet) {
                return tweet
              }

              const origTweet = tweet
              tweet = Object.assign({}, origTweet, hydratedTweet)

              if (tweet.retweeted_status) {
                tweet.retweeted_status = traverse(origTweet.retweeted_status)
              }

              if (tweet.quoted_status) {
                tweet.quoted_status = traverse(origTweet.quoted_status)
              }

              return tweet
            })

            console.log(docs)

            this.mergeWithKnown(docs)
              .then(tweets => {
                console.log(tweets)

                isSingleDoc ? resolve(tweets[0]) : resolve(tweets)
              })
              .catch(err => {
                callback(err, docs)
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
tweetSchema.statics.Note = mongoose.model('Note', noteSchema)

/**
 * Tweet model
 * @type {mongoose.Model}
 */
const Tweet = mongoose.model('Tweet', tweetSchema)

module.exports = Tweet
