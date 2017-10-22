/**
 * @file This file contains the schema / model setup for mozhelp users (volunteers).
 *       Users authenticate with twitter so that they can use their own accounts
 *       for responding to "tweets"/tickets. We only store details of the
 *       volunteers however, not all twitter users the system encounters
 *
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const mongoose = require('mongoose')
const mongoosePaginate = require('mongoose-paginate')

const schema = new mongoose.Schema(
  {
    /**
     * Twitter's id for the user
     * @type {string}
     */
    twitter: { type: String, unique: true },
    /**
     * Twitter handle / screen_name
     * @type {string}
     */
    handle: { type: String, unique: true },

    /**
     * Basic profile information
     * @type {object}
     */
    profile: {
      name: String,
      email: { type: String, unique: true },
      picture: String
    },

    /**
     * Mozhelp team role
     *
     * * `admin`      – Server admin rights, can do everything below + modify
     *                  server settings / user roles
     * * `wizard`     – Can do everyhing below as well as respond using the
     *                  official festival account(s)
     * * `guru`       – Base user level for those on the team. Allows access to
     *                  search, stream, notes, etc...
     * * `spectator`  – Default role, for those who login before being confirmed
     *                  as a team member
     *
     * @type {string}
     */
    role: {
      type: String,
      enum: ['admin', 'wizard', 'guru', 'spectator'],
      default: 'spectator'
    },

    /**
     * User's Twitter access tokens generated during authentication with Twitter API
     *
     * NOTE: By default this field will not be returned with queries to the DB.
     *       It must be explicity requested. This is to help keep token details
     *       secret. They should NEVER be exposed over the API.
     * @type {object}
     */
    tokens: { type: Object, select: false }
  },
  { timestamps: true }
)

schema.plugin(mongoosePaginate)

const model = mongoose.model('User', schema)

module.exports = model
