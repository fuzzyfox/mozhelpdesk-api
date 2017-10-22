const mongoose = require('mongoose')
const mongoosePaginate = require('mongoose-paginate')

const schema = new mongoose.Schema(
  {
    twitter: { type: String, unique: true },
    handle: { type: String, unique: true },

    profile: {
      name: String,
      email: { type: String, unique: true },
      picture: String
    },

    role: {
      type: String,
      enum: ['admin', 'wizard', 'guru', 'spectator'],
      default: 'spectator'
    },

    tokens: { type: Object, select: false }
  },
  { timestamps: true }
)

schema.plugin(mongoosePaginate)

const model = mongoose.model('User', schema)

module.exports = model
