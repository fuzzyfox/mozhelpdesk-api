/**
 * @file Tweet / ticket endpoint handlers
 */

const express = require('express')
const passport = require('passport')
const Twitter = require('twitter')

const router = express.Router()
const Ticket = require('../models/Ticket')
const stream = require('../stream').tweet

// Ensure all endpoints from here on are called with a valid JWT
router.use(passport.authenticate('jwt', { session: false }))

// Automatically initialise a twitter client instance using the current users
// account for use by tweet endpoints
router.use((req, res, next) => {
  req.twitterClient = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token_key: req.user.tokens.twitter.token,
    access_token_secret: req.user.tokens.twitter.tokenSecret
  })
  next()
})

// Get all known tweets from the system (paginated)
router.get('/', (req, res) => {
  Ticket.paginate(
    {},
    {
      offset: parseInt(req.query.offset, 10) || 0,
      limit: Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 100)),
      page: parseInt(req.query.page, 10) || 1
    },
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      Ticket.hydrateTweetTickets(result.docs, req.twitterClient)
        .catch(console.error)
        .then(hydrated => {
          result.docs = hydrated || result.docs
          res.status(200).json(result)
        })
    }
  )
})

// Create a new known tweet in the system
router.post('/', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Ticket.findOne({ twid: req.body.twid || req.body.id_str }, (err, tweet) => {
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

        const ticket = new Ticket(
          Object.assign({}, tweet, {
            twid: tweet.id_str,
            mozhelp_status: req.body.mozhelp_status || 'NEW'
          })
        )

        ticket.save((err, ticket) => {
          if (err) {
            return res.status(500).json({ error: err })
          }

          res.status(201).json({ _id: ticket.id })

          stream && stream.emit('save', ticket)

          // Tweet.hydrateTweetTickets(tweet, req.twitterClient)
          //   .catch(console.warn)
          //   .then(hydrated => stream && stream.emit('save', hydrated || tweet))
        })
      }
    )
  })
})

// Get a specific known tweet
router.get('/:ticketId', (req, res) => {
  Ticket.findById(req.params.ticketId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not found' })
    }

    Ticket.hydrateTweetTickets(tweet, req.twitterClient)
      .catch(console.error)
      .then(hydrated => res.status(200).json(hydrated || tweet))
  })
})

// Update a specific known tweet
router.patch('/:ticketId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Ticket.findById(req.params.ticketId, (err, tweet) => {
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

      stream && stream.emit('save', tweet)

      // Tweet.hydrateTweetTickets(tweet, req.twitterClient)
      //   .catch(console.warn)
      //   .then(hydrated => stream && stream.emit('save', hydrated || tweet))
    })
  })
})

// Get notes on a specific known tweet
router.get('/:ticketId/notes', (req, res) => {
  Ticket.findById(req.params.ticketId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not found' })
    }

    res.status(200).json(tweet.mozhelp_notes)
  })
})

// Add note to a specific known tweet
router.post('/:ticketId/notes', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Ticket.findById(req.params.ticketId, (err, tweet) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!tweet) {
      return res.status(404).json({ error: 'Not found' })
    }

    const note = Ticket.Note(req.body)
    note.user = req.user._id
    tweet.mozhelp_notes.push(note)

    tweet.save((err, tweet) => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.status(201).json({ _id: tweet.mozhelp_notes.pop().id })

      Ticket.findById(req.params.ticketId, (err, tweet) => {
        if (err) {
          console.error(err)
          return stream && stream.emit('error', err)
        }
        stream && stream.emit('save', tweet.toObject())
      })

      // Tweet.hydrateTweetTickets(tweet, req.twitterClient)
      //   .catch(console.warn)
      //   .then(hydrated => stream && stream.emit('save', hydrated || tweet))
    })
  })
})

// Update a note on a specific known tweet
router.put('/:ticketId/notes/:noteId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Ticket.findOne(
    {
      _id: req.params.ticketId,
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

        Ticket.findById(req.params.ticketId, (err, tweet) => {
          if (err) {
            console.error(err)
            return stream && stream.emit('error', err)
          }
          stream && stream.emit('save', tweet.toObject())
        })

        // Tweet.hydrateTweetTickets(tweet, req.twitterClient)
        //   .catch(console.warn)
        //   .then(hydrated => stream && stream.emit('save', hydrated || tweet))
      })
    }
  )
})

// Delete a note from a specific known tweet
router.delete('/:ticketId/notes/:noteId', (req, res) => {
  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Ticket.findOne(
    {
      _id: req.params.ticketId,
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

        Ticket.findById(req.params.ticketId, (err, tweet) => {
          if (err) {
            console.error(err)
            return stream && stream.emit('error', err)
          }
          stream && stream.emit('save', tweet.toObject())
        })

        // Tweet.hydrateTweetTickets(tweet, req.twitterClient)
        //   .catch(console.warn)
        //   .then(hydrated => stream && stream.emit('save', hydrated || tweet))
      })
    }
  )
})

module.exports = router
