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
