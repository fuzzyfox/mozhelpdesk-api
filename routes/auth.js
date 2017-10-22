/**
 * @file Authentication endpoint handlers.
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const express = require('express')
const passport = require('passport')
const { generateUserJWT } = require('../utils')

const router = express.Router()

// Handle initial call to twitter to authenticate the current user
router.get('/twitter', passport.authenticate('twitter', { session: false }))

// Handle response from twitter api and authenticate user for continued access
// if possible
router.get('/twitter/callback', (req, res, next) =>
  passport.authenticate('twitter', { session: false }, (err, user, info) => {
    console.log(err, user, info)
    if (err || !user) {
      return res.render('auth/failure', {
        error: JSON.stringify(err),
        info: JSON.stringify(info)
      })
    }

    res.render('auth/success', {
      authToken: generateUserJWT(user)
    })
  })(req, res)
)

// Handle JWT refresh by generating a new token assuming the incoming token is
// still valid
router.get(
  '/refresh',
  passport.authenticate('jwt', { session: false }),
  (req, res) => {
    res.status(200).json({
      token: generateUserJWT(req.user)
    })
  }
)

module.exports = router
