/**
 * @file Twitter stream configuration endpoint handlers
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const express = require('express')
const passport = require('passport')
const stream = require('../stream')
const Config = require('../models/Config')

const router = express.Router()

// Ensure all endpoints from here on are called with a valid JWT
router.use(passport.authenticate('jwt', { session: false }))

// Get current stream configuration/status
router.get('/', (req, res) => {
  Config.findOne({ name: 'stream' }, (err, config) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!config) {
      return res.status(500).json({ error: 'Invalid stream configuration' })
    }

    res.status(200).json(
      Object.assign({}, config.toObject().value, {
        is_active: !!stream.twitterStream
      })
    )
  })
})

// Update stream configuration/status
router.patch('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  Config.findOne({ name: 'stream' }, (err, config) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!config) {
      return res.status(500).json({ error: 'Invalid stream configuration' })
    }

    const userId = config.value.user_id || req.user.id
    const isActive = req.body.is_active

    delete req.body.is_active

    config.value = req.body

    if (
      isActive === true ||
      (typeof isActive !== 'boolean' && !!stream.twitterStream)
    ) {
      config.value.user_id = userId
    } else {
      config.value.user_id = null
    }

    config.save((err, config) => {
      if (err) {
        console.log(err)
        return res.status(500).json({ error: err })
      }

      if (
        isActive === true ||
        (typeof isActive !== 'boolean' && !!stream.twitterStream)
      ) {
        stream
          .startTwitterStream(config)
          .then(() => {
            res.status(204).end()
          })
          .catch(err => {
            console.log(err)
            return res.status(500).json({ error: err })
          })
      } else {
        stream
          .stopTwitterStream()
          .then(() => {
            res.status(204).end()
          })
          .catch(err => {
            console.log(err)
            return res.status(500).json({ error: err })
          })
      }
    })
  })
})

// Straight up stop the twitter stream
router.delete('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Invalid user role' })
  }

  stream.stopTwitterStream()
  res.status(204).end()
})

module.exports = router
