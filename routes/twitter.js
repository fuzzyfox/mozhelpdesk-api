/**
 * @file Twitter API proxied endpoints w/ super powers where needed.
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const express = require('express')
const passport = require('passport')
const Twitter = require('twitter')
const stream = require('../stream').tweet

const Ticket = require('../models/Ticket')

const router = express.Router()

// Ensure all endpoints from here on are called with a valid JWT
router.use(passport.authenticate('jwt', { session: false }))

// Automatically initialise a twitter client instance using the current users
// account for use by tweet endpoints
router.use((req, res, next) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  req.twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: req.user.tokens.twitter.token,
    access_token_secret: req.user.tokens.twitter.tokenSecret
  })
  next()
})

// Proxy calls to twitter search api as the current user
//
// BUG: There is a bug in the twitter search api which means that it doesn't get
//      fresh/updated tweets for a HUGE delay. This is likely some caching,
//      however adding a cacheBuster to the request has no effect. Instead we
//      fetch a fresh copy of each tweet returned by the search and assign it
//      over the returned result. This means data is fresher whenever possible.
router.get('/search/tweets', (req, res) => {
  return req.twitterClient.get(
    '/search/tweets',
    {
      ...req.query,
      cacheBuster: Date.now()
    },
    (err, result, response) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.set(
        Object.entries(response.headers).reduce((headers, entry) => {
          if (entry[0].match(/^x-/i)) {
            headers[entry[0]] = entry[1]
          }
          return headers
        }, {})
      )

      const tweetIds = new Set()
      result.statuses.forEach(function traverse(tweet) {
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

      //  Ontop of hydrating tweets due to the search bug, we also want to get
      //  the mozhelp data for any known tweets and apply that ontop. We can do
      //  that data fetching in paralell with the tweet lookup call.
      Promise.all([
        new Promise((resolve, reject) =>
          req.twitterClient.get(
            '/statuses/lookup',
            {
              id: [...tweetIds].slice(0, 100).join(',')
            },
            (err, hydratedTweets) =>
              err ? reject(err) : resolve(hydratedTweets)
          )
        ),
        Ticket.mergeTweetsWithTickets(result.statuses)
      ])
        .then(([hydratedTweets, tweets]) => {
          if (hydratedTweets && hydratedTweets.length) {
            result.statuses = tweets.map(function traverse(tweet) {
              const hydratedTweet = hydratedTweets.find(
                hydrated => hydrated.id_str === tweet.id_str
              )

              if (!hydratedTweet) {
                return tweet
              }

              tweet = Object.assign({}, tweet, hydratedTweet)

              if (tweet.retweeted_status) {
                tweet.retweeted_status = traverse(tweet.retweeted_status)
              }

              if (tweet.quoted_status) {
                tweet.quoted_status = traverse(tweet.quoted_status)
              }

              return tweet
            })
          }

          res.status(200).json(result)
        })
        .catch(err => {
          console.log(err)
          res.status(200).json({
            ...result,
            error: err
          })
        })
    }
  )
})

// Proxy calls to twitter's status creation endpoint
//
// When a user sends a tweet we want to automatically update the states of
// any known tweets, including marking the sent tweet as known
router.post('/statuses/update', (req, res) => {
  req.twitterClient.post(
    '/statuses/update',
    req.body,
    (err, sentTweet, response) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      // we're going to do the rest of the checks/etc... non-blocking
      // IFF they error we'll just accept that and move on anyway
      res.status(201).json(sentTweet)

      // handle response as a sent sentTweet (no need to block response)
      const newTicket = new Ticket(sentTweet)
      newTicket.mozhelp_status = 'SENT'
      newTicket.save((err, newTicket) => {
        if (err) {
          return console.error(err)
        }

        stream.emit('save', Object.assign(sentTweet, newTicket.toObject()))
      })

      // detect status change of a known tweet (no need to block response)
      if (req.body.in_reply_to_status_id) {
        Ticket.findOne(
          { twid: req.body.in_reply_to_status_id },
          (err, ticket) => {
            if (err) {
              return console.error(err)
            }

            if (!ticket) {
              return
            }

            if (req.body.mozhelp_status) {
              ticket.mozhelp_status = req.body.mozhelp_status.toUpperCase()
            } else if (
              ['NEW', 'NO_ACTION_REQUIRED'].includes(ticket.mozhelp_status)
            ) {
              ticket.mozhelp_status = 'IN_PROGRESS'
            }

            ticket.save((err, ticket) => {
              if (err) {
                return console.error(err)
              }

              // stream.emit('save', ticket)

              // NOTE: Think about possibly cutting this hydrate call...
              Ticket.hydrateTweetTickets(ticket, req.twitterClient)
                .catch(console.warn)
                .then(
                  hydrated => stream && stream.emit('save', hydrated || ticket)
                )
            })
          }
        )
      }
    }
  )
})

// Straight proxy requests to twitter, with mozhelp information merged into
// response tweets where possible.
router.use((req, res) => {
  const method = req.method.toLowerCase()

  if (method === 'get') {
    return req.twitterClient.get(
      req.path,
      {
        ...req.query,
        cacheBuster: Date.now()
      },
      (err, result, response) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        res.set(
          Object.entries(response.headers).reduce((headers, entry) => {
            if (entry[0].match(/^x-/i)) {
              headers[entry[0]] = entry[1]
            }
            return headers
          }, {})
        )

        // result is single tweet?
        if (result.id_str && result.text) {
          return Ticket.mergeTweetsWithTickets(result)
            .catch(console.error)
            .then(tweet => res.status(200).json(tweet || result))
        }

        // simple tweet array
        if (Array.isArray(result) && result[0].id_str && result[0].text) {
          return Ticket.mergeTweetsWithTickets(result)
            .catch(console.error)
            .then(tweets => res.status(200).json(tweets || result))
        }

        // single nested tweet
        if (result.status && result.status.id_str) {
          return Ticket.mergeTweetsWithTickets(result.status)
            .catch(console.error)
            .then(tweet =>
              res.status(200).json({
                ...result,
                status: tweet || result.status
              })
            )
        }

        // tweets nested in an obj
        if (result.statuses && result.statuses.length) {
          return Ticket.mergeTweetsWithTickets(result.statuses)
            .catch(console.error)
            .then(tweets =>
              res.status(200).json({
                ...result,
                statuses: tweets || result.statuses
              })
            )
        }

        // no idea, just return the result
        res.status(200).json(result)
      }
    )
  }

  if (method === 'post') {
    return req.twitterClient.post(
      req.path,
      req.body,
      (err, tweet, response) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        res.set(
          Object.entries(response.headers).reduce((headers, entry) => {
            if (entry[0].match(/^x-/i)) {
              headers[entry[0]] = entry[1]
            }
            return headers
          }, {})
        )

        res.status(200).json(tweet)
      }
    )
  }
})

module.exports = router
