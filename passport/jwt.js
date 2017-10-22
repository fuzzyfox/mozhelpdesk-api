/**
 * @file Configuration for JWT authentication with the API. This is used after
 *       the user has authenticated with Twitter, when a JWT will be generated
 *       for their continued use of the API
 *
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const passport = require('passport')
const passportJWT = require('passport-jwt')
const JWTStrategy = passportJWT.Strategy

const User = require('../models/User')

passport.use(
  new JWTStrategy(
    {
      secretOrKey: process.env.JWT_SECRET || 'irrelephant',
      jwtFromRequest: passportJWT.ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: process.env.API_DOMAIN,
      jsonWebTokenOptions: {
        maxAge: 60 * 60 // 1hr in ms
      },
      passReqToCallback: true
    },
    (req, jwtPayload, done) =>
      User.findOne({ _id: jwtPayload.sub }, '+tokens', done)
  )
)
