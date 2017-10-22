const express = require('express')
const passport = require('passport')
const Twitter = require('twitter')

const router = express.Router()
const Tweet = require('../models/Tweet')
const stream = require('../stream').tweet

router.use(passport.authenticate('jwt', { session: false }))

router.use((req, res, next) => {
  req.twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: req.user.tokens.twitter.token,
    access_token_secret: req.user.tokens.twitter.tokenSecret
  })
  next()
})

router.get('/', (req, res) => {
  Tweet.paginate(
    {},
    {
      offset: req.query.offset,
      limit: Math.max(1, Math.min(req.query.limit || 25, 25)),
      page: req.query.page || 1
    },
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      Tweet.hydrate(result.docs, req.twitterClient)
        .catch(console.error)
        .then(hydrated => {
          result.docs = hydrated || result.docs
          res.status(200).json(result)
        })
    }
  )
})

router.post('/', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Tweet.findOne({ twid: req.body.twid || req.body.id_str }, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (tweet) {
      return res.status(409).json({ error: 'Already tracking' })
    }

    req.twitterClient.get(
      `/statuses/show/${req.body.twid || req.body.id_str}`,
      {},
      (err, tweet) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        tweet = new Tweet({
          ...tweet,
          twid: tweet.id_str,
          mozhelp_status: req.body.mozhelp_status || 'NEW'
        })

        tweet.save((err, tweet) => {
          if (err) {
            return res.status(500).json({ error: err })
          }

          res.status(201).json({ _id: tweet.id })

          Tweet.hydrate(tweet, req.twitterClient)
            .catch(console.warn)
            .then(hydrated => stream && stream.emit('save', hydrated || tweet))
        })
      }
    )
  })
})

router.get('/:tweetId', (req, res) => {
  Tweet.findById(req.params.tweetId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not found' })
    }

    Tweet.hydrate(tweet, req.twitterClient)
      .catch(console.error)
      .then(hydrated => res.status(200).json(hydrated || tweet))
  })
})

router.patch('/:tweetId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Tweet.findById(req.params.tweetId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not Found' })
    }

    if (!req.body) {
      return res.status(400).json({ error: 'No Data' })
    }

    const fields = Object.entries(req.body).filter(([name, value]) =>
      ['mozhelp_status'].includes(name)
    )

    fields.forEach(([field, value]) => {
      tweet[field] = value
    })

    tweet.save(err => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.status(204).end()

      Tweet.hydrate(tweet, req.twitterClient)
        .catch(console.warn)
        .then(hydrated => stream && stream.emit('save', hydrated || tweet))
    })
  })
})

router.get('/:tweetId/notes', (req, res) => {
  Tweet.findById(req.params.tweetId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not found' })
    }

    res.status(200).json(tweet.mozhelp_notes)
  })
})

router.post('/:tweetId/notes', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Tweet.findById(req.params.tweetId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not found' })
    }

    const note = Tweet.Note(req.body)
    note.user = req.user._id
    tweet.mozhelp_notes.push(note)
    tweet.save((err, tweet) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.status(201).json({ _id: tweet.mozhelp_notes.pop().id })

      Tweet.hydrate(tweet, req.twitterClient)
        .catch(console.warn)
        .then(hydrated => stream && stream.emit('save', hydrated || tweet))
    })
  })
})

router.put('/:tweetId/notes/:noteId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Tweet.findOne(
    {
      _id: req.params.tweetId,
      'mozhelp_notes._id': req.params.noteId
    },
    (err, tweet) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      if (!tweet) {
        return res.status(404).json({ error: 'Not found' })
      }

      const note = tweet.mozhelp_notes.find(
        note => note.id === req.params.noteId
      )

      if (
        note.user.id !== req.user.id &&
        ['admin', 'wizard'].includes(req.user.role)
      ) {
        return res.status(403).json({ error: 'Incorrect ownership / role' })
      }

      note.note = req.body.note

      tweet.save((err, tweet) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        res.status(204).end()

        Tweet.hydrate(tweet, req.twitterClient)
          .catch(console.warn)
          .then(hydrated => stream && stream.emit('save', hydrated || tweet))
      })
    }
  )
})

router.delete('/:tweetId/notes/:noteId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Tweet.findOne(
    {
      _id: req.params.tweetId,
      'mozhelp_notes._id': req.params.noteId
    },
    (err, tweet) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      if (!tweet) {
        return res.status(404).json({ error: 'Not found' })
      }

      const note = tweet.mozhelp_notes.find(
        note => note.id === req.params.noteId
      )

      if (
        note.user.id !== req.user.id &&
        ['admin', 'wizard'].includes(req.user.role)
      ) {
        return res.status(403).json({ error: 'Incorrect ownership / role' })
      }

      note.remove()

      tweet.save((err, tweet) => {
        if (err) {
          return res.status(500).json({ error: err })
        }

        res.status(204).end()

        Tweet.hydrate(tweet, req.twitterClient)
          .catch(console.warn)
          .then(hydrated => stream && stream.emit('save', hydrated || tweet))
      })
    }
  )
})

module.exports = router