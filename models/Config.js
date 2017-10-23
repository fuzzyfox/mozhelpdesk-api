/**
 * @file This file contains the schema / model setup for the database stored
 *       configurations. Right now this is pretty much just the twitter stream
 *       configs.
 *
 * @author William Duyck <fuzzyfox0@gmail.com>
 */

const mongoose = require('mongoose')

/**
 * Config Schema
 *
 * The config collection in the DB is a set of key/value pairs which define
 * specific settings. The value can be anything, including nested objects, etc...
 *
 * @type {mongoose.Schema}
 */
const schema = new mongoose.Schema({
  /**
   * Config option name
   * @type {string}
   */
  name: { type: String, unique: true },

  /**
   * Config option value
   * @type {*}
   */
  value: mongoose.Schema.Types.Mixed
})

/**
 * Initialise the config collection on the DB
 *
 * This method gets called during server launch, and it configures the default
 * settings if they're not found.
 *
 * @return {void}
 */
schema.statics.init = function() {
  this.findOne({ name: 'stream' }, (err, config) => {
    if (err) {
      return console.error(err)
    }

    if (!config) {
      config = new this({
        name: 'stream',
        value: {
          search_term:
            'mozhelp OR #mozhelp OR @mozhelp OR (mozfest AND help) OR (#mozfest AND help) OR (@mozillafestival AND help)',
          user_id: ''
        }
      })

      config.save(err => err && console.error(err))
    }
  })
}

/**
 * Config Model
 *
 * @type {mongoose.Model}
 */
const model = mongoose.model('Config', schema)

module.exports = model
