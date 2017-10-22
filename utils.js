/**
 * @file Contains random utility methods needed throughout the server. Its
 *       basically a dumping ground for pure methods that get called repeatedly
 *       but dont have a real home just yet.
 *
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const jwt = require('jsonwebtoken')

/**
 * Generate a valid JWT for the given user.
 *
 * @param  {User}   user User model instance
 * @return {string}      JWT for the given user
 */
const generateUserJWT = user =>
  jwt.sign(
    Object.assign(
      {},
      {
        id: user._id,
        twitter: user.twitter,
        profile: user.profile,
        role: user.role
      }
    ),
    process.env.JWT_SECRET || 'irrelephant',
    {
      expiresIn: 60 * 60, // 1hr in ms
      issuer: process.env.API_DOMAIN,
      subject: user.id
    }
  )

module.exports = {
  generateUserJWT
}
