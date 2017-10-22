const mongoose = require('mongoose')
const mongoosePaginate = require('mongoose-paginate')
const mongooseAutopopulate = require('mongoose-autopopulate')

const noteSchema = new mongoose.Schema(
  {
    note: String,
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      autopopulate: true
    }
  },
  { timestamps: true }
)

const tweetSchema = new mongoose.Schema({
  twid: { type: String, unique: true },
  text: String,
  lang: String,
  in_reply_to_status_id_str: String,
  retweeted_status_id_str: String,
  created_at: Date,

  user: {
    id_str: String,
    name: String,
    screen_name: String,
    profile_image_url_https: String
  },

  mozhelp_status: {
    type: String,
    enum: ['NEW', 'NO_ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETE', 'SENT'],
    default: 'NEW'
  },

  mozhelp_notes: [noteSchema]
})

const dumbyTweetObj = () => ({
  mozhelp_status: 'NO_ACTION_REQUIRED',
  mozhelp_notes: []
})

tweetSchema.plugin(mongooseAutopopulate)
tweetSchema.plugin(mongoosePaginate)

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

tweetSchema.statics.Note = mongoose.model('Note', noteSchema)

const Tweet = mongoose.model('Tweet', tweetSchema)

module.exports = Tweet
