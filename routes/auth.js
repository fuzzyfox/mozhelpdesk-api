const express = require('express')
const passport = require('passport')
const { generateUserJWT } = require('../utils')

const router = express.Router()

router.get('/twitter', passport.authenticate('twitter', { session: false }))

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
