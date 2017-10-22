const express = require('express')
const passport = require('passport')

const router = express.Router()
const User = require('../models/User')

router.use(passport.authenticate('jwt', { session: false }))

router.get('/', (req, res) => {
  User.paginate(
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

      res.status(200).json(result)
    }
  )
})

router.get('/:userId', (req, res) => {
  if (req.params.userId === 'me') {
    req.params.userId = req.user.id
  }

  User.findById(req.params.userId, (err, user) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!user) {
      return res.status(404).json({ error: 'Not Found' })
    }

    res.status(200).json(user)
  })
})

router.patch('/:userId', (req, res) => {
  if (req.params.userId === 'me') {
    req.params.userId = req.user.id
  }

  if (req.user.role === 'spectator') {
    return res.status(403).json({ error: 'Invalid User Role' })
  }

  User.findById(req.params.userId, (err, user) => {
    if (err) {
      return res.status(500).json({ error: err })
    }

    if (!user) {
      return res.status(404).json({ error: 'Not Found' })
    }

    if (!req.body) {
      return res.status(400).json({ error: 'No Data' })
    }

    const fields = Object.entries(req.body).filter(([name, value]) =>
      ['profile', 'role'].includes(name)
    )

    const hasScope = !fields.reduce((invalidScope, field) => {
      if (invalidScope) {
        return true
      }

      if (field === 'role' && req.user.role !== 'admin') {
        return true
      }

      if (
        field === 'profile' &&
        (req.user.role !== 'admin' || req.user.id !== user.id)
      ) {
        return true
      }
    }, false)

    if (!hasScope) {
      return res
        .status(403)
        .json({ error: 'You cannot change other users details' })
    }

    fields.forEach(([field, value]) => {
      user[field] = value
    })

    user.save(err => {
      if (err) {
        return res.status(500).json({ error: err })
      }

      res.status(204).end()
    })
  })
})

module.exports = router
