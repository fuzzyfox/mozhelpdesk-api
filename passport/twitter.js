const passport = require('passport')
const TwitterStrategy = require('passport-twitter').Strategy

const User = require('../models/User')

passport.use(
  new TwitterStrategy(
    {
      consumerKey: process.env.TWITTER_CONSUMER_KEY,
      consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
      callbackURL: '/auth/twitter/callback',
      passReqToCallback: true
    },
    (req, token, tokenSecret, profile, done) => {
      User.findOne({ twitter: profile.id }, '+tokens', (err, user) => {
        if (err) {
          return done(err)
        }

        user = user || new User()
        user.twitter = profile.id
        user.handle = profile._json.screen_name
        user.tokens = user.tokens || {
          twitter: { token, tokenSecret }
        }
        user.profile = user.profile || {}
        user.profile.name = user.profile.name || profile.displayName
        user.profile.picture =
          user.profile.picture || profile._json.profile_image_url_https

        user.save(done)
      })
    }
  )
)
