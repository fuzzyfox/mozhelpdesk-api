const jwt = require('jsonwebtoken')

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
